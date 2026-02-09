
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, Group, PerspectiveCamera, MathUtils, MeshDepthMaterial, CanvasTexture, Quaternion } from 'three';
import { useStore } from '../store';
import { PerspectiveCamera as DreiPerspectiveCamera, useFBO, Text } from '@react-three/drei';
import { WorldData } from './Terrain';
import { BrainExecutor, BrainAPI } from '../utils/brain';
import { VehiclePhysics, VehicleInputs } from '../utils/physics';

const BOUNDS = 35;

interface RobotProps {
  worldData: WorldData | null;
  setRGB: (tex: any) => void;
  setDepth: (tex: any) => void;
  setCostMap: (tex: any) => void;
}

export const Robot = ({ worldData, setRGB, setDepth, setCostMap }: RobotProps) => {
  const group = useRef<Group>(null);
  const wheelsRef = useRef<Group>(null);
  
  // Store Hooks
  const { 
    autonomyEnabled, isPlaying, setRobotPosition, setRobotHeading, setCurrentTask,
    userCode, executionStatus, setExecutionStatus, setErrorLog, setRobotStats
  } = useStore();

  // Internal State
  const [debugText, setDebugText] = useState<{pos: Vector3, msg: string} | null>(null);

  // Brain Executor
  const executor = useMemo(() => new BrainExecutor(), []);
  const lastCodeRef = useRef<string>('');
  const safetyTimerRef = useRef<number>(0);

  // Physics Engine
  const physics = useMemo(() => {
     return new VehiclePhysics(new Vector3(-BOUNDS+5, 2, -BOUNDS+5), 0);
  }, []);

  // Compile Code on Change
  useEffect(() => {
    if (userCode !== lastCodeRef.current) {
        lastCodeRef.current = userCode;
        const res = executor.compile(userCode);
        if (!res.success) {
            setExecutionStatus('ERROR');
            setErrorLog(res.error || "Compilation Failed");
        }
    }
  }, [userCode, executor, setExecutionStatus, setErrorLog]);
  
  // Sensors
  const cameraRef = useRef<PerspectiveCamera>(null);
  const rgbTarget = useFBO(256, 144);
  const depthTarget = useFBO(256, 144); 
  
  useEffect(() => {
    setRGB(rgbTarget.texture);
    setDepth(depthTarget.texture);
  }, []);

  const depthMaterial = useMemo(() => new MeshDepthMaterial(), []);

  const [costCanvas] = useState(() => document.createElement('canvas'));
  const [costContext] = useState(() => costCanvas.getContext('2d'));
  const costTexture = useMemo(() => new CanvasTexture(costCanvas), [costCanvas]);

  useEffect(() => {
      costCanvas.width = 128;
      costCanvas.height = 128;
      setCostMap(costTexture);
  }, []);

  // Frame Loop
  useFrame((state, delta) => {
    if (!group.current || !worldData) return;
    
    // Physics Sub-stepping
    const dt = Math.min(delta, 0.05); 
    const now = state.clock.elapsedTime;
    
    let inputs: VehicleInputs = { throttle: 0, steer: 0, brake: 0 };

    if (isPlaying) {
        
        // --- BRAIN EXECUTION ---
        if (autonomyEnabled && executionStatus !== 'ERROR') {
            
            // 1. Build API
            const forward = new Vector3(0,0,1).applyQuaternion(physics.quaternion);
            
            const api: BrainAPI = {
                robot: {
                    pose: () => {
                        // Convert Quat to simple Heading (Yaw)
                        const heading = Math.atan2(forward.x, forward.z);
                        return { x: physics.position.x, y: physics.position.y, z: physics.position.z, heading };
                    },
                    velocity: () => ({ speed: physics.velocity.length(), steer: 0 }), // Helper, real steer is internal
                    setSpeed: (v: number) => { 
                        // Map desired speed (m/s) to throttle
                        const currentSpeed = physics.velocity.dot(forward);
                        const err = v - currentSpeed;
                        inputs.throttle = MathUtils.clamp(err * 0.5, -1, 1);
                        if (Math.abs(v) < 0.1 && Math.abs(currentSpeed) < 0.5) inputs.brake = 1.0;
                    },
                    setSteer: (r: number) => { 
                         // Map radians to -1..1 steering
                         inputs.steer = MathUtils.clamp(-r, -1, 1);
                    },
                    stop: () => { inputs.throttle = 0; inputs.brake = 1.0; }
                },
                world: {
                    time: () => now,
                    dt: () => dt,
                    boundary: () => ({ width: BOUNDS*2, depth: BOUNDS*2 })
                },
                sensors: {
                    frontDistance: () => {
                         // Simple Raycast
                         const rayStart = physics.position.clone().add(new Vector3(0, 0.5, 0));
                         let minDist = 10.0;
                         const caster = new Vector3(0,0,1).applyQuaternion(physics.quaternion);
                         for(const obs of worldData.obstacles) {
                             const toObs = obs.position.clone().sub(physics.position);
                             const dist = toObs.length();
                             if (dist < 10 && toObs.normalize().dot(caster) > 0.8) {
                                 minDist = Math.min(minDist, dist - 1.0);
                             }
                         }
                         return minDist;
                    },
                    groundType: () => worldData.getHazardType(physics.position.x, physics.position.z),
                    gps: () => ({ x: physics.position.x, z: physics.position.z })
                },
                nav: {
                    distanceTo: (x, z) => Math.sqrt((x-physics.position.x)**2 + (z-physics.position.z)**2)
                },
                console: {
                    log: (msg) => { /* console.log("[BRAIN]", msg) */ }
                },
                debug: {
                    text: (p, m) => setDebugText({ pos: new Vector3(p.x, p.y + 1, p.z), msg: m })
                }
            };

            // 2. Run Step
            if (!executor['hasInit']) {
                executor.init(api);
                executor['hasInit'] = true;
                safetyTimerRef.current = 0;
            }

            try {
                const t0 = performance.now();
                executor.step(dt);
                const dur = performance.now() - t0;
                if (dur > 5.0) throw new Error(`Timeout: ${dur.toFixed(1)}ms`);
                
                safetyTimerRef.current += dt;
                if (safetyTimerRef.current > 3.0 && executionStatus === 'RUNNING') {
                    setExecutionStatus('SAFE');
                }
            } catch (e: any) {
                setExecutionStatus('ERROR');
                setErrorLog(e.message || "Runtime Error");
                inputs.throttle = 0;
                inputs.brake = 1;
            }

        } else if (!autonomyEnabled) {
            // Manual Override (Just brakes)
            inputs.throttle = 0;
            inputs.brake = 0.5; // Parking brake
        }

        // --- PHYSICS UPDATE ---
        physics.update(dt, inputs, worldData);

        // --- SYNC VISUALS ---
        group.current.position.copy(physics.position);
        group.current.quaternion.copy(physics.quaternion);
        
        // Sync Wheel Visuals
        if (wheelsRef.current) {
             physics.wheels.forEach((w, i) => {
                 const mesh = wheelsRef.current!.children[i];
                 if (mesh) {
                     // Local position relative to chassis
                     const localPos = w.position.clone().applyMatrix4(physics.matrix.clone().invert());
                     mesh.position.copy(localPos);
                     
                     // Wheel Rotation logic
                     // 1. Steering (Y-axis rotation relative to car)
                     const isFront = i < 2;
                     const steerAngle = isFront ? inputs.steer * -physics.config.maxSteer : 0;
                     
                     // 2. Rolling (X-axis rotation)
                     // Accumulate rolling based on speed
                     // We store the rotation in userData or similar to persist it
                     const currentRot = mesh.userData.roll || 0;
                     const deltaRot = (physics.speed / 0.2) * dt * (physics.velocity.dot(new Vector3(0,0,1).applyQuaternion(physics.quaternion)) > 0 ? 1 : -1);
                     mesh.userData.roll = currentRot + deltaRot;
                     
                     mesh.rotation.set(mesh.userData.roll, steerAngle, 0, 'YXZ');
                 }
             });
        }
        
        // --- STORE UPDATES ---
        setRobotPosition([physics.position.x, physics.position.y, physics.position.z]);
        const forward = new Vector3(0,0,1).applyQuaternion(physics.quaternion);
        setRobotHeading(Math.atan2(forward.x, forward.z));
        
        // Pitch/Roll for UI
        // Extract local Up vs World Up for pitch/roll approx
        const localUp = new Vector3(0,1,0).applyQuaternion(physics.quaternion);
        const pitch = Math.asin(-forward.y);
        const roll = Math.atan2(localUp.x, localUp.y);
        
        setRobotStats({
            pitch,
            roll,
            isStuck: physics.isStuck,
            collision: physics.collisionImpact > 0.5
        });
    }

    // --- SENSOR RENDER (Legacy) ---
    // (Existing code for costmap/rgb render...)
    if (costContext) {
        // ... (Keep existing costmap drawing code, it's fine for visualization)
        const ctx = costContext;
        ctx.fillStyle = '#001100'; 
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(63, 63, 2, 2);
        
        const range = 12.0;
        const scale = 128 / (range * 2);
        
        const heading = Math.atan2(physics.matrix.elements[8], physics.matrix.elements[10]);
        const cos = Math.cos(-heading);
        const sin = Math.sin(-heading);
        
        const toMap = (wx: number, wz: number) => {
            const dx = wx - physics.position.x;
            const dz = wz - physics.position.z;
            const rx = dx * cos - dz * sin;
            const rz = dx * sin + dz * cos;
            return { x: 64 + rx * scale, y: 64 - rz * scale, dist: Math.sqrt(dx*dx+dz*dz) };
        };

        for (const obs of worldData.obstacles) {
            const p = toMap(obs.position.x, obs.position.z);
            if (p.dist > range) continue;
            ctx.fillStyle = obs.type === 'WALL' ? '#ff4444' : '#ccffcc';
            if (obs.type === 'WALL') {
                const w = Math.max(2, obs.size.x * scale);
                const h = Math.max(2, obs.size.z * scale);
                ctx.fillRect(p.x - w/2, p.y - h/2, w, h);
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, obs.type === 'POLE' ? 2 : 3, 0, Math.PI*2);
                ctx.fill();
            }
        }
        costTexture.needsUpdate = true;
    }

    if (cameraRef.current) {
        const gl = state.gl;
        const scene = state.scene;
        
        const wasVisible = group.current.visible;
        group.current.visible = false;

        gl.setRenderTarget(rgbTarget);
        gl.render(scene, cameraRef.current);

        scene.overrideMaterial = depthMaterial;
        gl.setRenderTarget(depthTarget);
        gl.render(scene, cameraRef.current);
        scene.overrideMaterial = null; 
        
        group.current.visible = wasVisible;
        gl.setRenderTarget(null);
    }
  });

  return (
    <group ref={group}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.4, 1.2]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.4} />
      </mesh>
      
      <mesh position={[0, 0.5, 0.3]}>
        <cylinderGeometry args={[0.15, 0.15, 0.2, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      
      {/* Wheels Group (Controlled by Physics) */}
      <group ref={wheelsRef}>
          <Wheel />
          <Wheel />
          <Wheel />
          <Wheel />
      </group>

      {/* Debug Text */}
      {debugText && (
         <Text 
           position={[0, 1.5, 0]} 
           fontSize={0.4} 
           color="white" 
           anchorX="center" 
           anchorY="middle"
           outlineWidth={0.02}
           outlineColor="black"
         >
           {debugText.msg}
         </Text>
      )}

      <DreiPerspectiveCamera 
        ref={cameraRef} 
        makeDefault={false} 
        position={[0, 0.5, 0.6]} 
        rotation={[-0.1, Math.PI, 0]} 
        fov={80} 
        near={0.1}
        far={60}
      />
    </group>
  );
};

const Wheel = (props: any) => (
  <group {...props}>
    {/* Rotate cylinder 90deg on Z so it rolls like a wheel, not a spinning coin */}
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.2, 0.2, 0.15, 16]} />
      <meshStandardMaterial color="#333" />
      <mesh position={[0, 0.1, 0]}>
         <boxGeometry args={[0.05, 0.05, 0.05]} />
         <meshStandardMaterial color="#666" />
      </mesh>
    </mesh>
  </group>
);
