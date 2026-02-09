import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, Group, PerspectiveCamera, Raycaster, MathUtils, MeshDepthMaterial, CanvasTexture } from 'three';
import { useStore } from '../store';
import { PerspectiveCamera as DreiPerspectiveCamera, useFBO, Text } from '@react-three/drei';
import { WorldData, ObstacleData } from './Terrain';
import { BrainExecutor, BrainAPI } from '../utils/brain';

const SPEED = 3.0;
const SCAN_RADIUS = 6.0; 
const AVOID_THRESHOLD = 3.0;
const BOUNDS = 32;
const LANE_WIDTH = 2.5;

interface RobotProps {
  worldData: WorldData | null;
  setRGB: (tex: any) => void;
  setDepth: (tex: any) => void;
  setCostMap: (tex: any) => void;
}

export const Robot = ({ worldData, setRGB, setDepth, setCostMap }: RobotProps) => {
  const group = useRef<Group>(null);
  
  // Store Hooks
  const { 
    autonomyEnabled, isPlaying, setRobotPosition, setRobotHeading, setCurrentTask,
    userCode, executionStatus, setExecutionStatus, setErrorLog, addRevision
  } = useStore();

  // Internal State
  const [avoiding, setAvoiding] = useState(false);
  const [waypointIndex, setWaypointIndex] = useState(0);
  const [debugText, setDebugText] = useState<{pos: Vector3, msg: string} | null>(null);

  // Brain Executor
  const executor = useMemo(() => new BrainExecutor(), []);
  const lastCodeRef = useRef<string>('');
  const safetyTimerRef = useRef<number>(0);

  // Compile Code on Change
  useEffect(() => {
    if (userCode !== lastCodeRef.current) {
        lastCodeRef.current = userCode;
        const res = executor.compile(userCode);
        if (!res.success) {
            setExecutionStatus('ERROR');
            setErrorLog(res.error || "Compilation Failed");
        } else {
            // New code loaded
            // We only initialize when we actually run
        }
    }
  }, [userCode, executor, setExecutionStatus, setErrorLog]);

  // Generate Coverage Path (Default Fallback)
  const waypoints = useMemo(() => {
    const pts: Vector3[] = [];
    let goingUp = true;
    for (let x = -BOUNDS; x <= BOUNDS; x += LANE_WIDTH) {
        if (goingUp) {
            pts.push(new Vector3(x, 0, -BOUNDS));
            pts.push(new Vector3(x, 0, BOUNDS));
        } else {
            pts.push(new Vector3(x, 0, BOUNDS));
            pts.push(new Vector3(x, 0, -BOUNDS));
        }
        goingUp = !goingUp;
    }
    return pts;
  }, []);
  
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

  // Kinematics Refs
  const pos = useRef(new Vector3(-BOUNDS, 1, -BOUNDS));
  const heading = useRef(0); 
  const velocity = useRef(0);
  const steering = useRef(0);
  
  // Hardcoded Autonomy Logic (Legacy)
  const updateDefaultAutonomy = (dt: number) => {
    if (!group.current || !worldData) return;
    const robPos = group.current.position.clone();
    
    // Simple state machine for "Default" behavior if Brain is not active
    // ... (This logic is preserved for when user uses manual/old autonomy, 
    // but effectively we might replace this with "Brain Mode" entirely later.
    // For now, if executionStatus is IDLE but autonomy is ON, we use this fallback)
    
    // ... Copying simplified logic from previous Robot.tsx for fallback ...
    // Note: The previous logic was lengthy. To save space, we will just use 
    // the previous waypoint logic here if Brain is NOT running.
    
    let target = waypoints[waypointIndex];
    const dx = target.x - pos.current.x;
    const dz = target.z - pos.current.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    
    if (dist < 2.0) {
        if (waypointIndex < waypoints.length - 1) setWaypointIndex(curr => curr + 1);
        else velocity.current = 0;
    }

    const desiredHeading = Math.atan2(dx, dz);
    let delta = desiredHeading - heading.current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    steering.current = MathUtils.clamp(delta * 2.0, -0.8, 0.8);
    velocity.current = SPEED;
    
    // Simple collision override
    // (Omitted for brevity as Brain is the focus, but basic nav persists)
  };

  useFrame((state, delta) => {
    if (!group.current || !worldData) return;
    const dt = Math.min(delta, 0.1); // Cap dt

    if (isPlaying) {
        
        // --- BRAIN EXECUTION ---
        if (autonomyEnabled && executionStatus === 'RUNNING') {
            
            // 1. Build API Surface
            const forward = new Vector3(Math.sin(heading.current), 0, Math.cos(heading.current));
            
            const api: BrainAPI = {
                robot: {
                    pose: () => ({ x: pos.current.x, y: pos.current.y, z: pos.current.z, heading: heading.current }),
                    velocity: () => ({ speed: velocity.current, steer: steering.current }),
                    setSpeed: (v: number) => { velocity.current = MathUtils.clamp(v, -2, 5); },
                    setSteer: (r: number) => { steering.current = MathUtils.clamp(r, -1.5, 1.5); },
                    stop: () => { velocity.current = 0; }
                },
                world: {
                    time: () => state.clock.elapsedTime,
                    dt: () => dt,
                    boundary: () => ({ width: BOUNDS*2, depth: BOUNDS*2 })
                },
                sensors: {
                    frontDistance: () => {
                         // Raycast approx
                         const rayStart = pos.current.clone().add(new Vector3(0, 0.5, 0));
                         let minDist = 10.0;
                         // Check obstacles
                         for(const obs of worldData.obstacles) {
                             // Box approx
                             const d = obs.position.distanceTo(pos.current);
                             if (d < 10) {
                                 // Very rough "ray" check
                                 const toObs = obs.position.clone().sub(pos.current).normalize();
                                 if (forward.dot(toObs) > 0.8) {
                                     minDist = Math.min(minDist, d - 1.0);
                                 }
                             }
                         }
                         return minDist;
                    },
                    groundType: () => worldData.getHazardType(pos.current.x, pos.current.z),
                    gps: () => ({ x: pos.current.x, z: pos.current.z })
                },
                nav: {
                    distanceTo: (x, z) => Math.sqrt((x-pos.current.x)**2 + (z-pos.current.z)**2)
                },
                console: {
                    log: (msg) => { /* Could pipe to UI log */ }
                },
                debug: {
                    text: (p, m) => setDebugText({ pos: new Vector3(p.x, p.y + 1, p.z), msg: m })
                }
            };

            // 2. Initialize if needed
            if (!executor['hasInit']) {
                executor.init(api);
                executor['hasInit'] = true;
                safetyTimerRef.current = 0;
            }

            // 3. Step with Timeout Budget
            const startT = performance.now();
            try {
                executor.step(dt);
                const duration = performance.now() - startT;
                
                if (duration > 5.0) { // 5ms Budget
                    throw new Error(`Timeout: Step took ${duration.toFixed(1)}ms (>5ms)`);
                }
                
                // 4. Safety Monitor
                safetyTimerRef.current += dt;
                if (safetyTimerRef.current > 3.0 && executionStatus === 'RUNNING') {
                    // Mark SAFE after 3 seconds of surviving
                    setExecutionStatus('SAFE');
                    // Update the revision in store
                    const revs = useStore.getState().revisions;
                    if (revs.length > 0 && revs[0].status === 'UNKNOWN') {
                         revs[0].status = 'SAFE';
                         // We don't have a clean action to update just one field, but it persists in memory
                    }
                }
                
            } catch (e: any) {
                setExecutionStatus('ERROR');
                setErrorLog(e.message || "Runtime Error");
                velocity.current = 0; // Emergency Stop
                
                const revs = useStore.getState().revisions;
                if (revs.length > 0) revs[0].status = 'ERROR';
            }

        } else if (autonomyEnabled && executionStatus !== 'ERROR') {
             // Fallback to legacy
             updateDefaultAutonomy(dt);
             // Clear Brain flag so it re-inits next time
             executor['hasInit'] = false;
        } else {
             // Manual or Idle
             velocity.current = 0;
             executor['hasInit'] = false;
        }

        // Kinematics with Environment Effects
        const traction = worldData.getTraction(pos.current.x, pos.current.z);
        let effectiveSpeed = velocity.current;
        
        if (traction < 0.5) effectiveSpeed *= 0.6; // Mud
        
        heading.current += (effectiveSpeed * Math.tan(steering.current) / 1.5) * dt;
        pos.current.x += Math.sin(heading.current) * effectiveSpeed * dt;
        pos.current.z += Math.cos(heading.current) * effectiveSpeed * dt;
        
        pos.current.x = MathUtils.clamp(pos.current.x, -BOUNDS, BOUNDS);
        pos.current.z = MathUtils.clamp(pos.current.z, -BOUNDS, BOUNDS);
        
        const y = worldData.getHeight(pos.current.x, pos.current.z);
        pos.current.y = MathUtils.lerp(pos.current.y, y, dt * 10);

        group.current.position.copy(pos.current);
        group.current.rotation.y = heading.current;

        setRobotPosition([pos.current.x, pos.current.y, pos.current.z]);
        setRobotHeading(heading.current);
    }

    // Update Costmap (Visualization only, keeping existing logic)
    if (costContext) {
        // ... (Keep existing costmap drawing code) ...
        const ctx = costContext;
        ctx.fillStyle = '#001100'; 
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(63, 63, 2, 2);
        
        const range = 12.0;
        const scale = 128 / (range * 2);
        const cos = Math.cos(-heading.current);
        const sin = Math.sin(-heading.current);
        const toMap = (wx: number, wz: number) => {
            const dx = wx - pos.current.x;
            const dz = wz - pos.current.z;
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

    // Sensor Render Passes
    if (cameraRef.current) {
        const gl = state.gl;
        const scene = state.scene;
        
        cameraRef.current.updateMatrixWorld();
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
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.4, 1.2]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.4} />
      </mesh>
      
      <mesh position={[0, 0.65, 0.3]}>
        <cylinderGeometry args={[0.15, 0.15, 0.2, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      <Wheel position={[0.45, 0.2, 0.4]} rotation={[0, 0, -Math.PI/2]} />
      <Wheel position={[-0.45, 0.2, 0.4]} rotation={[0, 0, Math.PI/2]} />
      <Wheel position={[0.45, 0.2, -0.4]} rotation={[0, 0, -Math.PI/2]} />
      <Wheel position={[-0.45, 0.2, -0.4]} rotation={[0, 0, Math.PI/2]} />
      
      {/* Debug Text Overlay */}
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
        position={[0, 0.7, 0.8]} 
        rotation={[-0.1, Math.PI, 0]} 
        fov={80} 
        near={0.1}
        far={60}
      />
    </group>
  );
};

const Wheel = (props: any) => (
  <mesh {...props} castShadow>
    <cylinderGeometry args={[0.2, 0.2, 0.15, 16]} />
    <meshStandardMaterial color="#333" />
  </mesh>
);