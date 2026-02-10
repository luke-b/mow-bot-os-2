
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { InstancedMesh, Object3D, PlaneGeometry, Vector3, DataTexture, RedFormat, LinearFilter, ShaderMaterial, InstancedBufferGeometry, InstancedBufferAttribute, BufferGeometry, Float32BufferAttribute, Scene, OrthographicCamera, WebGLRenderTarget, RGBAFormat, FloatType, NearestFilter, ClampToEdgeWrapping, Mesh } from 'three';
import { GrassBladeMaterial, TerrainShaderMaterial, WaterShaderMaterial, SimulationMaterial } from '../utils/materials';
import { useStore } from '../store';

const WORLD_SIZE = 80;
const SEGMENTS = 128;
// const GRASS_COUNT = 65000; // Legacy
const SIM_RES = 512;

// Hazard Parameters
const WALL_HEIGHT = 2.0;
const POLE_HEIGHT = 2.5;
const WATER_LEVEL = -0.5;

// Interface
export interface WorldData {
  getHeight: (x: number, z: number) => number;
  getTraction: (x: number, z: number) => number;
  getHazardType: (x: number, z: number) => 'GROUND' | 'WATER' | 'OBSTACLE';
  getGrassHeight: (x: number, z: number) => number; // New for physics drag
  obstacles: ObstacleData[];
}

export interface ObstacleData {
  type: 'ROCK' | 'POLE' | 'WALL';
  position: Vector3;
  size: Vector3;
}

// --- POISSON DISK SAMPLING ---
function poissonDiskSampling(radius: number, width: number, height: number, rng: () => number) {
    const k = 30; // rejection limit
    const grid = [];
    const cellSize = radius / Math.sqrt(2);
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const a: number[] = new Array(cols * rows).fill(-1);
    const active: Vector3[] = [];
    const points: Vector3[] = [];

    // Start point
    const x = rng() * width;
    const y = rng() * height;
    const initial = new Vector3(x, 0, y);
    points.push(initial);
    active.push(initial);
    
    const i = Math.floor(x / cellSize);
    const j = Math.floor(y / cellSize);
    a[i + j * cols] = 0;

    while (active.length > 0) {
        const randIndex = Math.floor(rng() * active.length);
        const p = active[randIndex];
        let found = false;

        for (let n = 0; n < k; n++) {
            const angle = rng() * Math.PI * 2;
            const dist = rng() * radius + radius; // r to 2r
            const newX = p.x + Math.cos(angle) * dist;
            const newZ = p.z + Math.sin(angle) * dist;

            if (newX >= 0 && newX < width && newZ >= 0 && newZ < height) {
                const col = Math.floor(newX / cellSize);
                const row = Math.floor(newZ / cellSize);
                let ok = true;
                
                // Check neighbors
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        const idx = (col + dx) + (row + dy) * cols;
                        if (idx >= 0 && idx < a.length && a[idx] !== -1) {
                            const neighbor = points[a[idx]];
                            const d = (neighbor.x - newX) ** 2 + (neighbor.z - newZ) ** 2;
                            if (d < radius * radius) {
                                ok = false;
                            }
                        }
                    }
                }

                if (ok) {
                    const newPoint = new Vector3(newX, 0, newZ);
                    points.push(newPoint);
                    active.push(newPoint);
                    a[col + row * cols] = points.length - 1;
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            active.splice(randIndex, 1);
        }
    }
    return points;
}

// PRNG
class SeededRandom {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  range(min: number, max: number) { return min + this.next() * (max - min); }
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number) => a + t * (b - a);
const grad = (hash: number, x: number, y: number) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
};

export const Terrain = ({ setWorldData }: { setWorldData: (data: WorldData) => void }) => {
  const { gl, camera } = useThree();
  const meshRef = useRef<any>(null);
  const grassRef = useRef<InstancedMesh>(null);
  
  // Store refs
  const regenerateTrigger = useStore((s) => s.regenerateTrigger);
  const worldSeed = useStore((s) => s.worldSeed);
  const hazards = useStore((s) => s.hazards);
  const terrainRoughness = useStore((s) => s.terrainRoughness);
  const robotPosition = useStore(s => s.robotPosition);
  
  // --- GPGPU SETUP ---
  const [simScene] = useState(new Scene());
  const [simCamera] = useState(new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const [targets] = useState(() => {
    const opts = {
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        format: RGBAFormat,
        type: FloatType,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false
    };
    return [
        new WebGLRenderTarget(SIM_RES, SIM_RES, opts),
        new WebGLRenderTarget(SIM_RES, SIM_RES, opts)
    ];
  });
  const currentTargetIdx = useRef(0);
  const simMeshRef = useRef<Mesh>(null);

  // Initialize Simulation Mesh
  useEffect(() => {
      const geo = new PlaneGeometry(2, 2);
      const mesh = new Mesh(geo, SimulationMaterial);
      simScene.add(mesh);
      simMeshRef.current = mesh;
      return () => { simScene.remove(mesh); }
  }, [simScene]);

  // --- PROCEDURAL BLADE GEOMETRY ---
  const bladeGeometry = useMemo(() => {
      // Improve fidelity: 5 segments for smoother curve
      const segments = 5;
      const positions = [];
      const indices = [];
      const width = 0.12; // Slightly wider base for volume
      
      for(let i=0; i<=segments; i++) {
          const t = i / segments;
          const y = t; 
          // Note: Width taper is now handled in Vertex Shader for smoother results
          // We just provide the Quad strip here.
          positions.push(-width/2, y, 0); // Left
          positions.push(width/2, y, 0);  // Right
      }

      for(let i=0; i<segments; i++) {
          const bl = i*2;
          const br = i*2+1;
          const tl = (i+1)*2;
          const tr = (i+1)*2+1;
          
          indices.push(bl, br, tl);
          indices.push(br, tr, tl);
          
          // Double sided indices (explicitly adding them helps some shadow maps)
          indices.push(bl, tl, br);
          indices.push(br, tl, tr);
      }

      // Add Tip (Triangle)
      const tipIndex = (segments+1)*2;
      positions.push(0, 1.05, 0); // Tip vertex slightly extended
      const lastL = segments*2;
      const lastR = segments*2+1;
      indices.push(lastL, lastR, tipIndex);
      indices.push(lastL, tipIndex, lastR); // Back face

      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      
      return geo;
  }, []);

  // --- WORLD GENERATION ---
  const { geometry, worldData, walls, waterGeometry, grassOffsets, grassScales, grassRotations, grassHalfWidths } = useMemo(() => {
    const rng = new SeededRandom(worldSeed);
    
    // 1. Terrain Geometry
    const geo = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const posAttr = geo.attributes.position;
    const count = posAttr.count;
    const colors = new Float32Array(count * 3);
    
    // Feature Params
    const slopeX = rng.range(-0.02, 0.02);
    const slopeZ = rng.range(-0.02, 0.02);
    const pondCenter = new Vector3(rng.range(-20, 20), 0, rng.range(-20, 20));
    const pondRadius = rng.range(8, 15);
    const ridgeStart = new Vector3(rng.range(-30, 30), 0, rng.range(-30, 30));
    const ridgeEnd = new Vector3(ridgeStart.x + rng.range(-20, 20), 0, ridgeStart.z + rng.range(-20, 20));

    // Noise
    const p = new Uint8Array(512);
    for(let i=0; i<256; i++) p[i] = p[256+i] = Math.floor(rng.next() * 256);
    const noise2D = (x: number, y: number) => {
         const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
         const fx = x - Math.floor(x), fy = y - Math.floor(y);
         const u = fade(fx), v = fade(fy);
         const A = p[X]+Y, AA = p[A]+0, AB = p[A+1]+0, B = p[X+1]+Y, BA = p[B]+0, BB = p[B+1]+0;
         return lerp(v, lerp(u, grad(p[AA], fx, fy), grad(p[BA], fx-1, fy)), lerp(u, grad(p[AB], fx, fy-1), grad(p[BB], fx-1, fy-1)));
    };

    // Height Function (Shared)
    const getHeight = (x: number, z: number) => {
        let y = x * slopeX + z * slopeZ;
        y += noise2D(x * 0.1, z * 0.1) * 1.5 * terrainRoughness;
        y += noise2D(x * 0.3 + 10, z * 0.3) * 0.5 * terrainRoughness;

        if (hazards.ridges) {
            const l2 = ridgeStart.distanceToSquared(ridgeEnd);
            if (l2 > 0) {
                const t = Math.max(0, Math.min(1, ((x - ridgeStart.x) * (ridgeEnd.x - ridgeStart.x) + (z - ridgeStart.z) * (ridgeEnd.z - ridgeStart.z)) / l2));
                const projX = ridgeStart.x + t * (ridgeEnd.x - ridgeStart.x);
                const projZ = ridgeStart.z + t * (ridgeEnd.z - ridgeStart.z);
                const d = Math.sqrt((x - projX)**2 + (z - projZ)**2);
                if (d < 3.0) y += Math.cos(d * 0.5) * 0.8;
            }
        }
        
        if (hazards.water) {
            const d = Math.sqrt((x - pondCenter.x)**2 + (z - pondCenter.z)**2);
            if (d < pondRadius + 5) {
                 const hole = Math.max(0, (pondRadius + 5 - d) / (pondRadius + 5));
                 y -= hole * 3.5;
            }
        }
        return y;
    };

    // Mesh Generation
    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const y = getHeight(x, z);
      posAttr.setY(i, y);
      
      let wetness = 0;
      if (hazards.water && y < WATER_LEVEL + 0.2) wetness = 1.0;
      colors[i*3] = wetness;
      colors[i*3+1] = 0.5;
      colors[i*3+2] = 0;
    }
    
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    
    // Hazards Generation (Simplified)
    const obstacleList: ObstacleData[] = [];
    const wallsData: ObstacleData[] = [];
    
    if (hazards.walls) {
         for(let k=0; k<3; k++) {
            let wx = rng.range(-30, 30), wz = rng.range(-30, 30);
            if (getHeight(wx, wz) < WATER_LEVEL) continue;
            const w = { type: 'WALL' as const, position: new Vector3(wx, 1, wz), size: new Vector3(4, WALL_HEIGHT, 4) };
            obstacleList.push(w); wallsData.push(w);
         }
    }
    
    // --- GRASS PLACEMENT (POISSON) ---
    const density = 0.3; // Tuned for performance vs look
    const points = poissonDiskSampling(density, WORLD_SIZE, WORLD_SIZE, () => rng.next());
    
    const gOffsets: number[] = [];
    const gScales: number[] = [];
    const gRots: number[] = [];
    const gWidths: number[] = [];
    
    let validGrassCount = 0;
    points.forEach(p => {
        const wx = p.x - WORLD_SIZE/2;
        const wz = p.z - WORLD_SIZE/2;
        const wy = getHeight(wx, wz);
        
        // Culling
        if (hazards.water && wy < WATER_LEVEL) return;
        
        let hitObs = false;
        wallsData.forEach(w => {
            if (Math.abs(wx - w.position.x) < w.size.x/2 && Math.abs(wz - w.position.z) < w.size.z/2) hitObs = true;
        });
        if (hitObs) return;

        gOffsets.push(wx, wy, wz);
        // Vary height more naturally
        gScales.push(0.5 + rng.next() * 0.6); 
        gRots.push(rng.next() * Math.PI * 2);
        // Vary width
        gWidths.push(0.1 + rng.next() * 0.05);
        validGrassCount++;
    });

    // Shadow Map for Physics (Low Res CPU Grid)
    const physGrid = new Float32Array(64*64);
    for(let i=0; i<physGrid.length; i++) physGrid[i] = 1.0;

    const wData: WorldData = {
        getHeight,
        getTraction: (x, z) => {
            const y = getHeight(x, z);
            if (hazards.water && y < WATER_LEVEL) return 0.1;
            if (hazards.water && y < WATER_LEVEL + 0.5) return 0.3;
            return 1.0;
        },
        getHazardType: (x, z) => {
            const y = getHeight(x, z);
            return (hazards.water && y < WATER_LEVEL) ? 'WATER' : 'GROUND';
        },
        getGrassHeight: (x, z) => {
            // Map x,z to 0..63
            const u = Math.floor(((x / WORLD_SIZE) + 0.5) * 64);
            const v = Math.floor(((z / WORLD_SIZE) + 0.5) * 64);
            if(u >= 0 && u < 64 && v >= 0 && v < 64) {
                return physGrid[v*64 + u]; 
            }
            return 1.0;
        },
        obstacles: obstacleList
    };

    return { 
        geometry: geo, 
        worldData: wData, 
        walls: wallsData, 
        waterGeometry: new PlaneGeometry(WORLD_SIZE, WORLD_SIZE).translate(0, WATER_LEVEL, 0).rotateX(-Math.PI/2),
        grassOffsets: new Float32Array(gOffsets),
        grassScales: new Float32Array(gScales),
        grassRotations: new Float32Array(gRots),
        grassHalfWidths: new Float32Array(gWidths)
    };
  }, [worldSeed, hazards, terrainRoughness]);

  // Pass data up
  useEffect(() => { setWorldData(worldData); }, [worldData, setWorldData]);

  // --- INIT GRASS MESH ---
  useEffect(() => {
     if (grassRef.current) {
         const mesh = grassRef.current;
         const geo = mesh.geometry as InstancedBufferGeometry;
         
         geo.setAttribute('offset', new InstancedBufferAttribute(grassOffsets, 3));
         geo.setAttribute('scale', new InstancedBufferAttribute(grassScales, 1));
         geo.setAttribute('rotation', new InstancedBufferAttribute(grassRotations, 1));
         geo.setAttribute('halfWidth', new InstancedBufferAttribute(grassHalfWidths, 1));
         
         mesh.count = grassOffsets.length / 3;
     }
  }, [grassOffsets]);

  // --- SIMULATION LOOP ---
  useFrame((state, delta) => {
      // 1. Update Simulation Shader Uniforms
      const simMat = SimulationMaterial;
      simMat.uniforms.tPrev.value = targets[currentTargetIdx.current].texture;
      simMat.uniforms.uTime.value = state.clock.elapsedTime;
      simMat.uniforms.uDelta.value = delta;
      
      // Robot Interaction
      simMat.uniforms.uInteractPos.value.set(robotPosition[0], robotPosition[1], robotPosition[2]);
      simMat.uniforms.uIsCutting.value = true; 

      // 2. Render Compute Shader
      const nextIdx = (currentTargetIdx.current + 1) % 2;
      const nextTarget = targets[nextIdx];
      
      const currentRenderTarget = gl.getRenderTarget();
      
      gl.setRenderTarget(nextTarget);
      gl.render(simScene, simCamera);
      gl.setRenderTarget(currentRenderTarget);
      
      currentTargetIdx.current = nextIdx;
      
      // 3. Update Visual Materials
      (grassRef.current?.material as ShaderMaterial).uniforms.tSim.value = nextTarget.texture;
      (grassRef.current?.material as ShaderMaterial).uniforms.time.value = state.clock.elapsedTime;
      
      // Update Sun Position uniform if needed (Matches Scene Sky)
      (grassRef.current?.material as ShaderMaterial).uniforms.sunPosition.value.set(100, 20, 100).normalize();
      
      (meshRef.current?.material as ShaderMaterial).uniforms.tSim.value = nextTarget.texture;

  }, -2); 

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry} receiveShadow>
        <primitive object={TerrainShaderMaterial} attach="material" />
      </mesh>

      {hazards.water && (
        <mesh geometry={waterGeometry}>
            <primitive object={WaterShaderMaterial} attach="material" />
        </mesh>
      )}

      {walls.map((w, i) => (
         <mesh key={`wall-${i}`} position={w.position} castShadow receiveShadow>
            <boxGeometry args={[w.size.x, w.size.y, w.size.z]} />
            <meshStandardMaterial color="#555" roughness={0.8} />
         </mesh>
      ))}

      {/* Grass Instanced Mesh */}
      <instancedMesh 
        ref={grassRef} 
        args={[undefined, undefined, grassOffsets.length / 3]} 
        geometry={bladeGeometry}
        receiveShadow 
        castShadow 
        frustumCulled={false}
      >
        <primitive object={GrassBladeMaterial} attach="material" />
      </instancedMesh>
    </group>
  );
};
