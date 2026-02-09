import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { InstancedMesh, Object3D, PlaneGeometry, Vector3, DataTexture, RedFormat, LinearFilter, LinearMipmapLinearFilter, ShaderMaterial, MeshStandardMaterial, IcosahedronGeometry } from 'three';
import { GrassShaderMaterial, TerrainShaderMaterial } from '../utils/materials';
import { useStore } from '../store';

const WORLD_SIZE = 80;
const SEGMENTS = 128;
const GRASS_COUNT = 30000;
const CUT_RES = 512;
const ROCK_COUNT = 50;

// Simple pseudo-random noise
const noise = (x: number, z: number) => {
  const s1 = Math.sin(x * 0.15) * Math.cos(z * 0.15);
  const s2 = Math.sin(x * 0.05 + 10.0) * Math.cos(z * 0.05 + 3.0);
  return 0.25 * s1 + 0.75 * s2;
};

export const Terrain = ({ setObstacles }: { setObstacles: (obs: Vector3[]) => void }) => {
  const meshRef = useRef<any>(null);
  const grassRef = useRef<InstancedMesh>(null);
  const rocksRef = useRef<InstancedMesh>(null);
  const regenerateTrigger = useStore((s) => s.regenerateTrigger);
  
  // Cut Map Texture
  const cutTexture = useMemo(() => {
    const data = new Uint8Array(CUT_RES * CUT_RES);
    const tex = new DataTexture(data, CUT_RES, CUT_RES, RedFormat);
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false; // Manual updates, mipmaps might be slow
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Pre-generate grass geometry with offset
  const grassGeometry = useMemo(() => {
    const geo = new PlaneGeometry(0.05, 0.8, 1, 4);
    geo.translate(0, 0.4, 0); // Shift pivot to bottom
    return geo;
  }, []);

  // Geometry Generation
  const { geometry, rockPositions } = useMemo(() => {
    const geo = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = noise(x, z) * 1.5; // Bumps
      pos.setY(i, y);
    }
    geo.computeVertexNormals();

    // Rocks
    const rPos: Vector3[] = [];
    for(let i=0; i<ROCK_COUNT; i++) {
        const x = (Math.random() - 0.5) * (WORLD_SIZE * 0.8);
        const z = (Math.random() - 0.5) * (WORLD_SIZE * 0.8);
        const y = noise(x, z) * 1.5;
        rPos.push(new Vector3(x, y, z));
    }

    return { geometry: geo, rockPositions: rPos };
  }, [regenerateTrigger]);

  // Expose obstacles to parent
  useEffect(() => {
    setObstacles(rockPositions);
  }, [rockPositions, setObstacles]);

  // Update Grass Instances
  useEffect(() => {
    if (!grassRef.current || !rocksRef.current) return;
    
    const dummy = new Object3D();
    
    // Grass
    for (let i = 0; i < GRASS_COUNT; i++) {
      const x = (Math.random() - 0.5) * WORLD_SIZE;
      const z = (Math.random() - 0.5) * WORLD_SIZE;
      const y = noise(x, z) * 1.5;

      dummy.position.set(x, y, z);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.scale.set(1, 0.5 + Math.random() * 1.0, 1);
      dummy.updateMatrix();
      grassRef.current.setMatrixAt(i, dummy.matrix);
    }
    grassRef.current.instanceMatrix.needsUpdate = true;

    // Rocks
    for (let i = 0; i < ROCK_COUNT; i++) {
        const pos = rockPositions[i];
        dummy.position.copy(pos);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        dummy.scale.setScalar(0.3 + Math.random() * 0.5);
        dummy.updateMatrix();
        rocksRef.current.setMatrixAt(i, dummy.matrix);
    }
    rocksRef.current.instanceMatrix.needsUpdate = true;

  }, [geometry, rockPositions]);

  // Paint Cut Map Logic
  const robotPos = useStore(s => s.robotPosition);
  
  useFrame((state) => {
    // Update shader uniforms
    if (grassRef.current) {
        (grassRef.current.material as ShaderMaterial).uniforms.time.value = state.clock.elapsedTime;
        (grassRef.current.material as ShaderMaterial).uniforms.cutMap.value = cutTexture;
    }
    if (meshRef.current) {
        (meshRef.current.material as ShaderMaterial).uniforms.cutMap.value = cutTexture;
    }

    // Paint onto texture based on robot position
    const [rx, ry, rz] = robotPos;
    
    // Map world to texture coords (consistent with shader)
    // x/worldSize + 0.5
    const u = Math.floor(((rx / WORLD_SIZE) + 0.5) * CUT_RES);
    const v = Math.floor(((rz / WORLD_SIZE) + 0.5) * CUT_RES); 
    const radius = 6; // Pixels

    const data = cutTexture.image.data;
    let changed = false;

    // Simple circle painting
    for(let dy = -radius; dy <= radius; dy++) {
        for(let dx = -radius; dx <= radius; dx++) {
             if (dx*dx + dy*dy > radius*radius) continue;
             const tx = u + dx;
             const ty = v + dy;
             if (tx >= 0 && tx < CUT_RES && ty >= 0 && ty < CUT_RES) {
                 const idx = ty * CUT_RES + tx;
                 if (data[idx] < 255) {
                    data[idx] = 255;
                    changed = true;
                 }
             }
        }
    }

    if (changed) {
        cutTexture.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Terrain Mesh */}
      <mesh ref={meshRef} geometry={geometry} receiveShadow>
        <primitive object={TerrainShaderMaterial} attach="material" />
      </mesh>

      {/* Grass Instances - frustumCulled={false} prevents flickering */}
      <instancedMesh 
        ref={grassRef} 
        args={[grassGeometry, undefined, GRASS_COUNT]} 
        receiveShadow 
        castShadow
        frustumCulled={false}
      >
        <primitive object={GrassShaderMaterial} attach="material" />
      </instancedMesh>

      {/* Rocks - frustumCulled={false} ensures they appear in robot cameras */}
      <instancedMesh 
        ref={rocksRef} 
        args={[undefined, undefined, ROCK_COUNT]} 
        castShadow 
        receiveShadow
        frustumCulled={false}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#666" roughness={0.9} />
      </instancedMesh>
    </group>
  );
};