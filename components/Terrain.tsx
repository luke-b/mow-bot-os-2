import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { InstancedMesh, Object3D, PlaneGeometry, Vector3, DataTexture, RedFormat, LinearFilter, LinearMipmapLinearFilter, ShaderMaterial, MeshStandardMaterial, IcosahedronGeometry, BufferAttribute, BoxGeometry, CylinderGeometry } from 'three';
import { GrassShaderMaterial, TerrainShaderMaterial, WaterShaderMaterial } from '../utils/materials';
import { useStore } from '../store';

const WORLD_SIZE = 80;
const SEGMENTS = 128;
const GRASS_COUNT = 40000;
const CUT_RES = 512;

// Hazard Parameters
const WALL_HEIGHT = 2.0;
const POLE_HEIGHT = 2.5;
const WATER_LEVEL = -0.5;

// Data Interface exposed to Robot
export interface WorldData {
  getHeight: (x: number, z: number) => number;
  getTraction: (x: number, z: number) => number; // 0..1 (1=good, 0.2=mud/ice)
  getHazardType: (x: number, z: number) => 'GROUND' | 'WATER' | 'OBSTACLE';
  obstacles: ObstacleData[];
}

export interface ObstacleData {
  type: 'ROCK' | 'POLE' | 'WALL';
  position: Vector3;
  size: Vector3; // For bounding box
}

// PRNG
class SeededRandom {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  // Simple LCG
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  range(min: number, max: number) { return min + this.next() * (max - min); }
}

// Perlin-ish noise helper (simplified for standalone)
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number) => a + t * (b - a);
const grad = (hash: number, x: number, y: number) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
};

export const Terrain = ({ setWorldData }: { setWorldData: (data: WorldData) => void }) => {
  const meshRef = useRef<any>(null);
  const grassRef = useRef<InstancedMesh>(null);
  const rocksRef = useRef<InstancedMesh>(null);
  const polesRef = useRef<InstancedMesh>(null);
  
  const regenerateTrigger = useStore((s) => s.regenerateTrigger);
  const worldSeed = useStore((s) => s.worldSeed);
  const hazards = useStore((s) => s.hazards);
  
  // Cut Map Texture
  const cutTexture = useMemo(() => {
    const data = new Uint8Array(CUT_RES * CUT_RES);
    const tex = new DataTexture(data, CUT_RES, CUT_RES, RedFormat);
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }, []);

  const grassGeometry = useMemo(() => {
    const geo = new PlaneGeometry(0.05, 0.8, 1, 4);
    geo.translate(0, 0.4, 0); 
    return geo;
  }, []);

  // --- Procedural Generation Logic ---
  const { geometry, worldData, walls, waterGeometry } = useMemo(() => {
    const rng = new SeededRandom(worldSeed);
    
    // Arrays for Geometry
    const geo = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const posAttr = geo.attributes.position;
    const count = posAttr.count;
    
    // Vertex Colors for Shader (R=Wetness, G=Type, B=Unused)
    const colors = new Float32Array(count * 3);
    
    // Logic Maps (Internal resolution matches geometry)
    // We will assume continuous function for external query, but store discrete data for mesh
    
    // 1. Base Terrain + Global Slope
    const slopeX = rng.range(-0.02, 0.02);
    const slopeZ = rng.range(-0.02, 0.02);
    
    // 2. Features
    const pondCenter = new Vector3(rng.range(-20, 20), 0, rng.range(-20, 20));
    const pondRadius = rng.range(8, 15);
    
    const ridgeStart = new Vector3(rng.range(-30, 30), 0, rng.range(-30, 30));
    const ridgeEnd = new Vector3(ridgeStart.x + rng.range(-20, 20), 0, ridgeStart.z + rng.range(-20, 20));

    // Data collection for Robot Interface
    const obstacleList: ObstacleData[] = [];
    
    // Helper to get noise
    const p = new Uint8Array(512);
    for(let i=0; i<256; i++) p[i] = p[256+i] = Math.floor(rng.next() * 256);
    const noise2D = (x: number, y: number) => {
         const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
         const fx = x - Math.floor(x), fy = y - Math.floor(y);
         const u = fade(fx), v = fade(fy);
         const A = p[X]+Y, AA = p[A]+0, AB = p[A+1]+0, B = p[X+1]+Y, BA = p[B]+0, BB = p[B+1]+0;
         return lerp(v, lerp(u, grad(p[AA], fx, fy), grad(p[BA], fx-1, fy)), lerp(u, grad(p[AB], fx, fy-1), grad(p[BB], fx-1, fy-1)));
    };

    // --- Generate Heightfield ---
    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      
      let y = 0;
      
      // Base Slope
      y += x * slopeX + z * slopeZ;
      
      // FBM Noise
      y += noise2D(x * 0.1, z * 0.1) * 1.5;
      y += noise2D(x * 0.3 + 10, z * 0.3) * 0.5;

      // Ridge (Linear feature)
      if (hazards.ridges) {
        // Dist to line segment
        const l2 = ridgeStart.distanceToSquared(ridgeEnd);
        if (l2 > 0) {
            const t = Math.max(0, Math.min(1, ((x - ridgeStart.x) * (ridgeEnd.x - ridgeStart.x) + (z - ridgeStart.z) * (ridgeEnd.z - ridgeStart.z)) / l2));
            const projX = ridgeStart.x + t * (ridgeEnd.x - ridgeStart.x);
            const projZ = ridgeStart.z + t * (ridgeEnd.z - ridgeStart.z);
            const distToRidge = Math.sqrt((x - projX)**2 + (z - projZ)**2);
            
            // Add berm
            if (distToRidge < 3.0) {
                y += Math.cos(distToRidge * 0.5) * 0.8; // Bump
            }
        }
      }

      // Pond (Depression)
      let wetness = 0;
      if (hazards.water) {
          const dPond = Math.sqrt((x - pondCenter.x)**2 + (z - pondCenter.z)**2);
          if (dPond < pondRadius + 5) {
              // Smooth falloff into hole
              const hole = Math.max(0, (pondRadius + 5 - dPond) / (pondRadius + 5));
              y -= hole * 3.5; // Deepen
              
              if (y < WATER_LEVEL + 0.2) wetness = 1.0; // Muddy banks
          }
      }

      posAttr.setY(i, y);
      
      // Set Colors
      colors[i*3] = wetness;     // R = Wetness
      colors[i*3+1] = 0.5;       // G = Ground
      colors[i*3+2] = 0;         // B
    }
    
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // --- Generate Hazards (Walls / Poles / Rocks) ---
    const wallsData: ObstacleData[] = [];
    
    if (hazards.walls) {
        const wallCount = Math.floor(rng.range(1, 4));
        for(let k=0; k<wallCount; k++) {
            // Find flat-ish spot far from pond
            let wx = rng.range(-30, 30);
            let wz = rng.range(-30, 30);
            if (hazards.water && Math.sqrt((wx-pondCenter.x)**2 + (wz-pondCenter.z)**2) < pondRadius + 5) continue;

            const wSizeX = rng.range(3, 6);
            const wSizeZ = rng.range(3, 6);
            
            obstacleList.push({ type: 'WALL', position: new Vector3(wx, 1, wz), size: new Vector3(wSizeX, WALL_HEIGHT, wSizeZ) });
            wallsData.push({ type: 'WALL', position: new Vector3(wx, 1, wz), size: new Vector3(wSizeX, WALL_HEIGHT, wSizeZ) });
        }
    }

    const polesData: ObstacleData[] = [];
    if (hazards.poles) {
        const poleCount = 40;
        for(let k=0; k<poleCount; k++) {
            let px = rng.range(-35, 35);
            let pz = rng.range(-35, 35);
            
            // Avoid pond center
            if (hazards.water && Math.sqrt((px-pondCenter.x)**2 + (pz-pondCenter.z)**2) < pondRadius) continue;
            
            obstacleList.push({ type: 'POLE', position: new Vector3(px, 0, pz), size: new Vector3(0.2, POLE_HEIGHT, 0.2) });
            polesData.push({ type: 'POLE', position: new Vector3(px, 0, pz), size: new Vector3(0.2, POLE_HEIGHT, 0.2) });
        }
    }

    const rocksData: ObstacleData[] = [];
    if (hazards.rocks) {
        const rockCount = 50;
        for(let k=0; k<rockCount; k++) {
            let rx = rng.range(-35, 35);
            let rz = rng.range(-35, 35);
            if (hazards.water && Math.sqrt((rx-pondCenter.x)**2 + (rz-pondCenter.z)**2) < pondRadius) continue;
            obstacleList.push({ type: 'ROCK', position: new Vector3(rx, 0, rz), size: new Vector3(1, 1, 1) });
            rocksData.push({ type: 'ROCK', position: new Vector3(rx, 0, rz), size: new Vector3(1, 1, 1) });
        }
    }

    // --- World Data Function (Replicates generation logic for physics) ---
    // This ensures Robot "feels" the exact same math that generated the mesh
    const getWorldHeight = (x: number, z: number) => {
        let y = 0;
        y += x * slopeX + z * slopeZ;
        y += noise2D(x * 0.1, z * 0.1) * 1.5;
        y += noise2D(x * 0.3 + 10, z * 0.3) * 0.5;

        if (hazards.ridges) {
            const l2 = ridgeStart.distanceToSquared(ridgeEnd);
            if (l2 > 0) {
                const t = Math.max(0, Math.min(1, ((x - ridgeStart.x) * (ridgeEnd.x - ridgeStart.x) + (z - ridgeStart.z) * (ridgeEnd.z - ridgeStart.z)) / l2));
                const projX = ridgeStart.x + t * (ridgeEnd.x - ridgeStart.x);
                const projZ = ridgeStart.z + t * (ridgeEnd.z - ridgeStart.z);
                const distToRidge = Math.sqrt((x - projX)**2 + (z - projZ)**2);
                if (distToRidge < 3.0) {
                    y += Math.cos(distToRidge * 0.5) * 0.8;
                }
            }
        }
        
        if (hazards.water) {
            const dPond = Math.sqrt((x - pondCenter.x)**2 + (z - pondCenter.z)**2);
            if (dPond < pondRadius + 5) {
                 const hole = Math.max(0, (pondRadius + 5 - dPond) / (pondRadius + 5));
                 y -= hole * 3.5;
            }
        }
        return y;
    };

    const wData: WorldData = {
        getHeight: getWorldHeight,
        getTraction: (x, z) => {
            if (!hazards.water) return 1.0;
            const y = getWorldHeight(x, z);
            if (y < WATER_LEVEL) return 0.1; // Underwater
            if (y < WATER_LEVEL + 0.5) return 0.3; // Mud
            return 1.0; // Grass
        },
        getHazardType: (x, z) => {
            if (!hazards.water) return 'GROUND';
            const y = getWorldHeight(x, z);
            if (y < WATER_LEVEL) return 'WATER';
            return 'GROUND';
        },
        obstacles: obstacleList
    };

    // Water Geometry
    const wGeo = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    wGeo.rotateX(-Math.PI/2);
    wGeo.translate(0, WATER_LEVEL, 0);

    return { geometry: geo, worldData: wData, walls: wallsData, poles: polesData, rocks: rocksData, waterGeometry: wGeo };

  }, [worldSeed, hazards]);

  // Pass data up
  useEffect(() => {
    setWorldData(worldData);
  }, [worldData, setWorldData]);

  // Update Instances
  useEffect(() => {
    if (!grassRef.current) return;
    const dummy = new Object3D();
    const rng = new SeededRandom(worldSeed + 1); // Diff seed for grass

    // Filter valid grass spots
    let count = 0;
    for (let i = 0; i < GRASS_COUNT; i++) {
        const x = rng.range(-WORLD_SIZE/2, WORLD_SIZE/2);
        const z = rng.range(-WORLD_SIZE/2, WORLD_SIZE/2);
        const y = worldData.getHeight(x, z);
        
        if (hazards.water && y < WATER_LEVEL) continue; // No grass under water
        
        // Check walls
        let hitWall = false;
        for(const w of walls) {
             // Simple Box check
             if (Math.abs(x - w.position.x) < w.size.x/2 && Math.abs(z - w.position.z) < w.size.z/2) hitWall = true;
        }
        if (hitWall) continue;

        dummy.position.set(x, y, z);
        dummy.rotation.y = rng.range(0, Math.PI);
        dummy.scale.set(1, 0.5 + rng.next(), 1);
        dummy.updateMatrix();
        grassRef.current.setMatrixAt(count, dummy.matrix);
        count++;
    }
    grassRef.current.count = count;
    grassRef.current.instanceMatrix.needsUpdate = true;
  }, [worldData, walls, hazards.water]); // Added dependency

  // Update Rocks/Poles Instances
  useEffect(() => {
    if(rocksRef.current) {
        const dummy = new Object3D();
        const rocks = worldData.obstacles.filter(o => o.type === 'ROCK');
        rocks.forEach((r, i) => {
             const y = worldData.getHeight(r.position.x, r.position.z);
             dummy.position.set(r.position.x, y, r.position.z);
             dummy.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
             dummy.scale.setScalar(0.4 + Math.random()*0.4);
             dummy.updateMatrix();
             rocksRef.current!.setMatrixAt(i, dummy.matrix);
        });
        rocksRef.current.count = rocks.length;
        rocksRef.current.instanceMatrix.needsUpdate = true;
    }

    if(polesRef.current) {
        const dummy = new Object3D();
        const poles = worldData.obstacles.filter(o => o.type === 'POLE');
        poles.forEach((p, i) => {
             const y = worldData.getHeight(p.position.x, p.position.z);
             dummy.position.set(p.position.x, y + POLE_HEIGHT/2, p.position.z);
             dummy.scale.set(1, 1, 1);
             dummy.updateMatrix();
             polesRef.current!.setMatrixAt(i, dummy.matrix);
        });
        polesRef.current.count = poles.length;
        polesRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [worldData]);

  // Painting Logic (no changes, uses cutTexture)
  const robotPos = useStore(s => s.robotPosition);
  useFrame((state) => {
    if (grassRef.current) {
        (grassRef.current.material as ShaderMaterial).uniforms.time.value = state.clock.elapsedTime;
        (grassRef.current.material as ShaderMaterial).uniforms.cutMap.value = cutTexture;
    }
    if (meshRef.current) {
        (meshRef.current.material as ShaderMaterial).uniforms.cutMap.value = cutTexture;
    }
    (waterGeometry as any).uniforms = { time: { value: state.clock.elapsedTime } };

    const [rx, ry, rz] = robotPos;
    const u = Math.floor(((rx / WORLD_SIZE) + 0.5) * CUT_RES);
    const v = Math.floor(((rz / WORLD_SIZE) + 0.5) * CUT_RES); 
    const radius = 6;
    const data = cutTexture.image.data;
    let changed = false;
    for(let dy = -radius; dy <= radius; dy++) {
        for(let dx = -radius; dx <= radius; dx++) {
             if (dx*dx + dy*dy > radius*radius) continue;
             const tx = u + dx, ty = v + dy;
             if (tx >= 0 && tx < CUT_RES && ty >= 0 && ty < CUT_RES) {
                 const idx = ty * CUT_RES + tx;
                 if (data[idx] < 255) { data[idx] = 255; changed = true; }
             }
        }
    }
    if (changed) cutTexture.needsUpdate = true;
  });

  return (
    <group>
      {/* Terrain */}
      <mesh ref={meshRef} geometry={geometry} receiveShadow>
        <primitive object={TerrainShaderMaterial} attach="material" />
      </mesh>

      {/* Water Plane */}
      {hazards.water && (
        <mesh geometry={waterGeometry}>
            <primitive object={WaterShaderMaterial} attach="material" />
        </mesh>
      )}

      {/* Walls */}
      {walls.map((w, i) => (
         <mesh key={`wall-${i}`} position={w.position} castShadow receiveShadow>
            <boxGeometry args={[w.size.x, w.size.y, w.size.z]} />
            <meshStandardMaterial color="#555" roughness={0.8} />
         </mesh>
      ))}

      {/* Grass */}
      <instancedMesh ref={grassRef} args={[grassGeometry, undefined, GRASS_COUNT]} receiveShadow castShadow frustumCulled={false}>
        <primitive object={GrassShaderMaterial} attach="material" />
      </instancedMesh>

      {/* Rocks */}
      <instancedMesh ref={rocksRef} args={[undefined, undefined, 100]} castShadow receiveShadow frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#666" roughness={0.9} />
      </instancedMesh>

      {/* Poles */}
      <instancedMesh ref={polesRef} args={[undefined, undefined, 100]} castShadow receiveShadow frustumCulled={false}>
         <cylinderGeometry args={[0.05, 0.05, POLE_HEIGHT, 8]} />
         <meshStandardMaterial color="#888" metalness={0.8} roughness={0.2} />
      </instancedMesh>
    </group>
  );
};