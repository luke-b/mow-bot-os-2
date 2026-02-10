
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, Group, PerspectiveCamera, MathUtils, MeshDepthMaterial, CanvasTexture, Quaternion, ShaderMaterial, DoubleSide, Color } from 'three';
import { useStore } from '../store';
import { PerspectiveCamera as DreiPerspectiveCamera, useFBO, Text, Line } from '@react-three/drei';
import { WorldData } from './Terrain';
import { BrainExecutor, BrainAPI } from '../utils/brain';
import { VehiclePhysics, VehicleInputs } from '../utils/physics';

const BOUNDS = 35;
const MOWER_WIDTH = 0.8; // Meters

interface RobotProps {
  worldData: WorldData | null;
  setRGB: (tex: any) => void;
  setDepth: (tex: any) => void;
  setCostMap: (tex: any) => void;
}

// Calculate polygon area using Shoelace formula
function calculatePolygonArea(points: {x:number, z:number}[]) {
    let area = 0;
    const n = points.length;
    for(let i=0; i<n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].z;
        area -= points[j].x * points[i].z;
    }
    return Math.abs(area) / 2.0;
}

export const Robot = ({ worldData, setRGB, setDepth, setCostMap }: RobotProps) => {
  const group = useRef<Group>(null);
  const wheelsRef = useRef<Group>(null);
  
  // Store Hooks
  const { 
    autonomyEnabled, isPlaying, setRobotPosition, setRobotHeading, setCurrentTask,
    userCode, executionStatus, setExecutionStatus, setErrorLog, setRobotStats,
    addTelemetryFrame, clearTelemetry, regenerateTrigger,
    setKpiStats, resetKpi, setCustomWatch, addAiLog, clearAiLogs
  } = useStore();

  // Internal State
  const [debugText, setDebugText] = useState<{pos: Vector3, msg: string} | null>(null);
  const [visualPath, setVisualPath] = useState<Vector3[]>([]);
  const pathRef = useRef<Vector3[]>([]);
  
  // KPI Accumulators (Refs to avoid re-renders during high freq updates)
  const kpiRef = useRef({ area: 0, startTime: 0 });
  const aiLogTimerRef = useRef(0);
  
  // Dynamic Zone State
  const zoneRef = useRef<{x: number, z: number}[]>([]);
  const [zone, setZone] = useState<{x: number, z: number}[]>([]);

  // Brain Executor
  const executor = useMemo(() => new BrainExecutor(), []);
  const lastCodeRef = useRef<string>('');
  const safetyTimerRef = useRef<number>(0);

  // Physics Engine
  const physics = useMemo(() => {
     // Initial default, will be teleported when worldData loads
     return new VehiclePhysics(new Vector3(0, 5, 0), 0);
  }, []);

  // --- Dynamic Zone Generation & Reset ---
  useEffect(() => {
    if (!worldData) return;

    const attemptGenerate = () => {
        // Try to find a valid zone 
        for(let i=0; i<200; i++) {
            const cx = (Math.random() - 0.5) * 60; // Keep within +/- 30
            const cz = (Math.random() - 0.5) * 60;
            
            // Initial center check
            if (worldData.getHazardType(cx, cz) !== 'GROUND') continue;
            
            const radius = 8 + Math.random() * 8; // 8m to 16m radius
            const points: {x:number, z:number}[] = [];
            let valid = true;
            
            // Generate 5-7 vertices
            const vertCount = 5 + Math.floor(Math.random() * 3);
            for(let j=0; j<vertCount; j++) {
                const angle = (j / vertCount) * Math.PI * 2;
                const r = radius * (0.7 + Math.random() * 0.6); // Irregularity
                const px = cx + Math.cos(angle) * r;
                const pz = cz + Math.sin(angle) * r;
                
                // Bounds check
                if (Math.abs(px) > BOUNDS || Math.abs(pz) > BOUNDS) { valid = false; break; }
                
                // Hazard check (Sample point)
                if (worldData.getHazardType(px, pz) !== 'GROUND') { valid = false; break; }
                
                // Obstacle proximity check
                for(const obs of worldData.obstacles) {
                    const dist = Math.sqrt((px - obs.position.x)**2 + (pz - obs.position.z)**2);
                    const safeDist = Math.max(obs.size.x, obs.size.z) * 0.5 + 2.0;
                    if (dist < safeDist) { valid = false; break; }
                }
                if (!valid) break;
                
                points.push({x: px, z: pz});
            }
            
            if (valid && points.length >= 5) {
                // Success!
                zoneRef.current = points;
                setZone(points);
                
                // Calculate Area
                const area = calculatePolygonArea(points);
                setKpiStats({ totalTargetArea: area });
                
                // Teleport Robot to Center
                const y = worldData.getHeight(cx, cz) + 0.5;
                physics.teleport(new Vector3(cx, y, cz), Math.random() * Math.PI * 2);
                
                // Clear state
                setExecutionStatus('IDLE');
                executor['hasInit'] = false; // Force re-init of brain
                resetKpi();
                clearAiLogs();
                kpiRef.current = { area: 0, startTime: 0 };
                aiLogTimerRef.current = 0;
                return;
            }
        }
        
        // Fallback if super crowded
        const fb = [{x: -5, z: -5}, {x: 5, z: -5}, {x: 5, z: 5}, {x: -5, z: 5}];
        zoneRef.current = fb;
        setZone(fb);
        const area = calculatePolygonArea(fb);
        setKpiStats({ totalTargetArea: area });
        
        const y = worldData.getHeight(0, 0) + 0.5;
        physics.teleport(new Vector3(0, y, 0), 0);
    };

    attemptGenerate();

  }, [worldData, physics, executor, setExecutionStatus, regenerateTrigger]);

  // Compile Code on Change
  useEffect(() => {
    if (userCode !== lastCodeRef.current) {
        lastCodeRef.current = userCode;
        const res = executor.compile(userCode);
        if (!res.success) {
            setExecutionStatus('ERROR');
            const errorMsg = res.error || "Compilation Failed";
            setErrorLog(errorMsg);
            
            // Log Compilation Failure to AI Agent
            addAiLog({
                timestamp: Date.now(),
                event: 'ALERT',
                kpi: useStore.getState().kpiStats,
                robotState: useStore.getState().robotStats,
                watches: useStore.getState().customWatches,
                message: `COMPILATION ERROR: ${errorMsg}. Requires immediate syntax refinement.`
            });
            
        } else {
            // If code changed, force re-init to pick up potentially new zone
            executor['hasInit'] = false; 
            clearTelemetry();
        }
    }
  }, [userCode, executor, setExecutionStatus, setErrorLog, clearTelemetry]);
  
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

  // Reset KPI when autonomy toggles
  useEffect(() => {
      if (autonomyEnabled && executionStatus === 'IDLE') {
          // Starting fresh
          resetKpi();
          clearAiLogs();
          kpiRef.current = { area: 0, startTime: 0 };
          aiLogTimerRef.current = 0;
      }
  }, [autonomyEnabled]);

  // Frame Loop
  useFrame((state, delta) => {
    if (!group.current || !worldData) return;
    
    const dt = Math.min(delta, 0.05); 
    const now = state.clock.elapsedTime;
    let inputs: VehicleInputs = { throttle: 0, steer: 0, brake: 0 };
    let frameLogs: Record<string, number> = {};

    if (isPlaying) {
        if (autonomyEnabled && executionStatus !== 'ERROR') {
            const forward = new Vector3(0,0,1).applyQuaternion(physics.quaternion);
            const api: BrainAPI = {
                robot: {
                    pose: () => {
                        const heading = Math.atan2(forward.x, forward.z);
                        return { x: physics.position.x, y: physics.position.y, z: physics.position.z, heading };
                    },
                    velocity: () => ({ speed: physics.velocity.length(), steer: 0 }),
                    setSpeed: (v: number) => { 
                        const currentSpeed = physics.velocity.dot(forward);
                        const err = v - currentSpeed;
                        inputs.throttle = MathUtils.clamp(err * 0.5, -1, 1);
                        if (Math.abs(v) < 0.1 && Math.abs(currentSpeed) < 0.5) inputs.brake = 1.0;
                    },
                    setSteer: (r: number) => { inputs.steer = MathUtils.clamp(-r, -1, 1); },
                    stop: () => { inputs.throttle = 0; inputs.brake = 1.0; }
                },
                world: {
                    time: () => now,
                    dt: () => dt,
                    boundary: () => ({ width: BOUNDS*2, depth: BOUNDS*2 }),
                    getMowingZone: () => zoneRef.current
                },
                sensors: {
                    frontDistance: () => {
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
                    distanceTo: (x, z) => Math.sqrt((x-physics.position.x)**2 + (z-physics.position.z)**2),
                    planCoverage: () => [] // Placeholder
                },
                telemetry: { 
                    log: (key, value) => { if (typeof value === 'number') frameLogs[key] = value; },
                    watch: (key, value) => setCustomWatch(key, value)
                },
                console: { log: (msg) => { } },
                debug: {
                    text: (p, m) => setDebugText({ pos: new Vector3(p.x, p.y + 1, p.z), msg: m }),
                    path: (points) => {
                        const vecPoints = points.map(p => {
                            const y = worldData.getHeight(p.x, p.z);
                            return new Vector3(p.x, y + 0.5, p.z);
                        });
                        pathRef.current = vecPoints;
                        // Debounce visual updates slightly to prevent thrashing
                        if (Math.random() > 0.5) setVisualPath(vecPoints); 
                    }
                }
            };

            if (!executor['hasInit']) { executor.init(api); executor['hasInit'] = true; safetyTimerRef.current = 0; }

            try {
                const t0 = performance.now();
                executor.step(dt);
                if (performance.now() - t0 > 5.0) throw new Error(`CPU Budget Exceeded (5ms)`);
                
                safetyTimerRef.current += dt;
                if (safetyTimerRef.current > 3.0 && executionStatus === 'RUNNING') setExecutionStatus('SAFE');
            } catch (e: any) {
                setExecutionStatus('ERROR');
                const errorMsg = e.message || "Runtime Error";
                setErrorLog(errorMsg);
                inputs.throttle = 0; inputs.brake = 1;

                // Log Runtime Failure to AI Agent context to trigger refinement
                addAiLog({
                    timestamp: Date.now(),
                    event: 'STOP',
                    kpi: { 
                        startTime: kpiRef.current.startTime,
                        elapsedTime: now - kpiRef.current.startTime, 
                        areaMowed: kpiRef.current.area, 
                        totalTargetArea: useStore.getState().kpiStats.totalTargetArea,
                        efficiency: (kpiRef.current.area / Math.max(1, now - kpiRef.current.startTime)) * 60
                    },
                    robotState: useStore.getState().robotStats,
                    watches: useStore.getState().customWatches,
                    message: `CRITICAL FAILURE: ${errorMsg}. Triggers automated refinement loop.`
                });
            }

        } else if (!autonomyEnabled) {
            inputs.throttle = 0; inputs.brake = 0.5;
        }

        physics.update(dt, inputs, worldData);
        
        // --- KPI & Logging Updates ---
        if (autonomyEnabled && executionStatus !== 'ERROR') {
            addTelemetryFrame({ time: now, ...frameLogs, sys_throttle: inputs.throttle, sys_steer: inputs.steer });
            
            // Start Timer if not started
            if (kpiRef.current.startTime === 0) kpiRef.current.startTime = now;
            
            // Approximate Area Coverage: Speed * Width * dt
            // Only count if moving forward
            const fwdSpeed = physics.velocity.dot(new Vector3(0,0,1).applyQuaternion(physics.quaternion));
            if (fwdSpeed > 0.1) {
                kpiRef.current.area += fwdSpeed * MOWER_WIDTH * dt;
            }
            
            const elapsedTime = now - kpiRef.current.startTime;
            const efficiency = (kpiRef.current.area / Math.max(1, elapsedTime)) * 60;
            
            setKpiStats({ 
                startTime: kpiRef.current.startTime,
                elapsedTime: elapsedTime, 
                areaMowed: kpiRef.current.area,
                efficiency: efficiency
            });
            
            // --- AI Agent Periodic Log (Every 30s) ---
            aiLogTimerRef.current += dt;
            if (aiLogTimerRef.current >= 30.0) {
                aiLogTimerRef.current = 0;
                addAiLog({
                    timestamp: Date.now(),
                    event: 'PERIODIC',
                    kpi: { 
                        startTime: kpiRef.current.startTime,
                        elapsedTime: elapsedTime, 
                        areaMowed: kpiRef.current.area, 
                        totalTargetArea: useStore.getState().kpiStats.totalTargetArea,
                        efficiency 
                    },
                    robotState: useStore.getState().robotStats,
                    watches: useStore.getState().customWatches
                });
            }
        }

        group.current.position.copy(physics.position);
        group.current.quaternion.copy(physics.quaternion);
        
        if (wheelsRef.current) {
             physics.wheels.forEach((w, i) => {
                 const mesh = wheelsRef.current!.children[i];
                 if (mesh) {
                     const localPos = w.position.clone().applyMatrix4(physics.matrix.clone().invert());
                     mesh.position.copy(localPos);
                     const isFront = i < 2;
                     const steerAngle = isFront ? inputs.steer * -physics.config.maxSteer : 0;
                     const currentRot = mesh.userData.roll || 0;
                     const deltaRot = (physics.speed / 0.2) * dt * (physics.velocity.dot(new Vector3(0,0,1).applyQuaternion(physics.quaternion)) > 0 ? 1 : -1);
                     mesh.userData.roll = currentRot + deltaRot;
                     mesh.rotation.set(mesh.userData.roll, steerAngle, 0, 'YXZ');
                 }
             });
        }
        
        setRobotPosition([physics.position.x, physics.position.y, physics.position.z]);
        const forward = new Vector3(0,0,1).applyQuaternion(physics.quaternion);
        setRobotHeading(Math.atan2(forward.x, forward.z));
        
        const localUp = new Vector3(0,1,0).applyQuaternion(physics.quaternion);
        const pitch = Math.asin(-forward.y);
        const roll = Math.atan2(localUp.x, localUp.y);
        
        setRobotStats({ pitch, roll, isStuck: physics.isStuck, collision: physics.collisionImpact > 0.5 });
    }

    if (costContext) {
        const ctx = costContext;
        ctx.fillStyle = '#001100'; ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#00ff00'; ctx.fillRect(63, 63, 2, 2);
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

        if (pathRef.current.length > 1) {
             ctx.strokeStyle = '#00ffff'; 
             ctx.lineWidth = 2;
             ctx.beginPath();
             const start = toMap(pathRef.current[0].x, pathRef.current[0].z);
             ctx.moveTo(start.x, start.y);
             for(let i=1; i<pathRef.current.length; i++) {
                 const p = toMap(pathRef.current[i].x, pathRef.current[i].z);
                 if (p.dist < range + 2) ctx.lineTo(p.x, p.y);
             }
             ctx.stroke();
        }

        for (const obs of worldData.obstacles) {
            const p = toMap(obs.position.x, obs.position.z);
            if (p.dist > range) continue;
            ctx.fillStyle = obs.type === 'WALL' ? '#ff4444' : '#ccffcc';
            if (obs.type === 'WALL') {
                const w = Math.max(2, obs.size.x * scale);
                const h = Math.max(2, obs.size.z * scale);
                ctx.fillRect(p.x - w/2, p.y - h/2, w, h);
            } else {
                ctx.beginPath(); ctx.arc(p.x, p.y, obs.type === 'POLE' ? 2 : 3, 0, Math.PI*2); ctx.fill();
            }
        }
        costTexture.needsUpdate = true;
    }

    if (cameraRef.current) {
        const gl = state.gl;
        const scene = state.scene;
        const wasVisible = group.current.visible;
        group.current.visible = false;
        try {
            gl.setRenderTarget(rgbTarget); gl.render(scene, cameraRef.current);
            scene.overrideMaterial = depthMaterial;
            gl.setRenderTarget(depthTarget); gl.render(scene, cameraRef.current);
        } finally {
            scene.overrideMaterial = null; group.current.visible = wasVisible; gl.setRenderTarget(null);
        }
    }
  }, -1); 

  return (
    <>
        {/* World Space Visuals */}
        {visualPath.length > 1 && (
            <Line points={visualPath} color="#00ffff" lineWidth={3} transparent opacity={0.8} />
        )}

        {/* Fancy Zone Visualization */}
        {zone.length > 0 && worldData && <ZoneVisuals zone={zone} worldData={worldData} />}

        {debugText && (
             <Text 
               position={[debugText.pos.x, debugText.pos.y, debugText.pos.z]} 
               fontSize={0.4} color="white" anchorX="center" anchorY="middle"
               outlineWidth={0.02} outlineColor="black"
             >
               {debugText.msg}
             </Text>
        )}

        {/* Local Space Robot Chassis */}
        <group ref={group}>
            <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.9, 0.4, 1.2]} />
                <meshStandardMaterial color="#f59e0b" roughness={0.4} />
            </mesh>
            
            <mesh position={[0, 0.5, 0.3]}>
                <cylinderGeometry args={[0.15, 0.15, 0.2, 16]} />
                <meshStandardMaterial color="#111" />
            </mesh>
            
            <group ref={wheelsRef}>
                <Wheel /> <Wheel /> <Wheel /> <Wheel />
            </group>

            <DreiPerspectiveCamera 
                ref={cameraRef} makeDefault={false} position={[0, 0.5, 0.6]} 
                rotation={[-0.1, Math.PI, 0]} fov={80} near={0.1} far={60}
            />
        </group>
    </>
  );
};

const Wheel = (props: any) => (
  <group {...props}>
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

// --- VISUALIZATION COMPONENTS ---

const FlagMaterial = new ShaderMaterial({
  uniforms: { time: { value: 0 }, color: { value: new Color('#ff3333') } },
  side: DoubleSide,
  vertexShader: `
    uniform float time;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec3 pos = position;
      // Displace Z based on UV.x to simulate flapping
      // UV.x = 0 is attached to pole (no movement), UV.x = 1 is tip (max movement)
      pos.z += sin(uv.x * 8.0 - time * 8.0) * 0.15 * uv.x; 
      pos.y += sin(uv.x * 5.0 - time * 3.0) * 0.05 * uv.x; 
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    varying vec2 vUv;
    void main() {
      vec3 col = color;
      // Add some fake shadows in the folds
      col *= 0.8 + 0.4 * sin(vUv.x * 8.0 + 1.0); 
      gl_FragColor = vec4(col, 1.0);
    }
  `
});

const ZoneVisuals = ({ zone, worldData }: { zone: {x:number, z:number}[], worldData: WorldData }) => {
    const lineRef = useRef<any>(null);
    
    // Animate the dashed line
    useFrame((state, delta) => {
        if (lineRef.current && lineRef.current.material) {
            // Speed = 1.0
            lineRef.current.material.dashOffset -= delta * 1.0;
        }
    });

    const points = useMemo(() => {
        const pts = zone.map(p => {
             const y = worldData.getHeight(p.x, p.z);
             return new Vector3(p.x, y + 1.5, p.z);
        });
        pts.push(pts[0]); // Close the loop
        return pts;
    }, [zone, worldData]);

    return (
        <group>
            {/* Animated Dashed Boundary */}
            <Line 
                ref={lineRef}
                points={points} 
                color="#ff8800" 
                lineWidth={3} 
                dashed 
                dashScale={1.5}
                dashSize={0.4}
                gapSize={0.2}
                opacity={0.9}
                transparent
            />
            
            {/* Vertices Poles */}
            {zone.map((p, i) => {
                const y = worldData.getHeight(p.x, p.z);
                return <ZonePole key={i} position={[p.x, y, p.z]} />;
            })}
        </group>
    )
}

const ZonePole: React.FC<{ position: [number, number, number] }> = ({ position }) => {
    const matRef = useRef<ShaderMaterial>(null);
    
    // Animate flag material
    useFrame((state) => {
        if(matRef.current) matRef.current.uniforms.time.value = state.clock.elapsedTime;
    });

    return (
        <group position={position}>
            {/* Pole */}
            <mesh position={[0, 1, 0]} castShadow>
                <cylinderGeometry args={[0.04, 0.04, 2, 8]} />
                <meshStandardMaterial color="#aa0000" metalness={0.2} roughness={0.8} />
            </mesh>
            
            {/* Flag (Plane) attached to top */}
            <mesh position={[0.3, 1.8, 0]}>
                <planeGeometry args={[0.6, 0.4, 10, 5]} />
                {/* Clone material to avoid conflicts if we add more colored flags later */}
                <primitive object={FlagMaterial.clone()} ref={matRef} attach="material" />
            </mesh>
            
            {/* Base Glow Ring */}
             <mesh position={[0, 0.05, 0]} rotation={[-Math.PI/2, 0, 0]}>
                <ringGeometry args={[0.1, 0.4, 16]} />
                <meshBasicMaterial color="#ff4400" transparent opacity={0.6} />
            </mesh>
        </group>
    )
}
