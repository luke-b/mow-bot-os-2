import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, Group, PerspectiveCamera, Raycaster, MathUtils, MeshDepthMaterial, CanvasTexture } from 'three';
import { useStore } from '../store';
import { PerspectiveCamera as DreiPerspectiveCamera, useFBO } from '@react-three/drei';

const SPEED = 3.0;
const SCAN_RADIUS = 5.0; 
const AVOID_THRESHOLD = 3.0;
const BOUNDS = 32;
const LANE_WIDTH = 2.5;

interface RobotProps {
  obstacles: Vector3[];
  setRGB: (tex: any) => void;
  setDepth: (tex: any) => void;
  setCostMap: (tex: any) => void;
}

export const Robot = ({ obstacles, setRGB, setDepth, setCostMap }: RobotProps) => {
  const group = useRef<Group>(null);
  const autonomyEnabled = useStore((s) => s.autonomyEnabled);
  const isPlaying = useStore((s) => s.isPlaying);
  const setRobotPosition = useStore((s) => s.setRobotPosition);
  const setRobotHeading = useStore((s) => s.setRobotHeading);
  const setCurrentTask = useStore((s) => s.setCurrentTask);

  // Autonomy State
  const [avoiding, setAvoiding] = useState(false);
  const [waypointIndex, setWaypointIndex] = useState(0);

  // Generate Coverage Path (Boustrophedon / Lawnmower pattern)
  const waypoints = useMemo(() => {
    const pts: Vector3[] = [];
    let goingUp = true; // Z-direction toggle
    // Start from top-leftish
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
  const depthTarget = useFBO(256, 144); // Color texture for visualization
  
  // Pass textures up
  useEffect(() => {
    setRGB(rgbTarget.texture);
    setDepth(depthTarget.texture);
  }, []);

  // Material for depth pass
  const depthMaterial = useMemo(() => new MeshDepthMaterial(), []);

  // Costmap Canvas Texture (Procedural LIDAR-like view)
  const [costCanvas] = useState(() => document.createElement('canvas'));
  const [costContext] = useState(() => costCanvas.getContext('2d'));
  const costTexture = useMemo(() => new CanvasTexture(costCanvas), [costCanvas]);

  useEffect(() => {
      costCanvas.width = 128;
      costCanvas.height = 128;
      setCostMap(costTexture);
  }, []);

  // Kinematics Refs
  const pos = useRef(new Vector3(-BOUNDS, 1, -BOUNDS)); // Start at corner
  const heading = useRef(0); 
  const velocity = useRef(0);
  const steering = useRef(0);
  
  // Reset logic when autonomy is toggled
  useEffect(() => {
    if (autonomyEnabled) {
        // Find closest waypoint to resume/start
        let closestIdx = 0;
        let closestDist = Infinity;
        waypoints.forEach((wp, i) => {
            const d = wp.distanceTo(pos.current);
            // Only jump to future waypoints or close ones
            if (d < closestDist) {
                closestDist = d;
                closestIdx = i;
            }
        });
        setWaypointIndex(closestIdx);
    }
  }, [autonomyEnabled, waypoints]);

  const updateAutonomy = () => {
    if (!group.current) return;

    // 1. Obstacle Check
    const forward = new Vector3(Math.sin(heading.current), 0, Math.cos(heading.current));
    const robPos = group.current.position.clone();
    robPos.y += 0.5;
    
    let closestObs: Vector3 | null = null;
    let closestDist = Infinity;

    for(const obs of obstacles) {
        const d = robPos.distanceTo(obs);
        if (d < SCAN_RADIUS) {
            const dirToObs = obs.clone().sub(robPos).normalize();
            const angle = forward.angleTo(dirToObs);
            if (angle < Math.PI / 2.5) {
                if (d < closestDist) {
                    closestDist = d;
                    closestObs = obs;
                }
            }
        }
    }

    // 2. State Machine
    if (closestObs && closestDist < AVOID_THRESHOLD) {
        setAvoiding(true);
        setCurrentTask('AVOIDING');
        
        // Determine steer direction
        const dirToObs = closestObs.clone().sub(robPos).normalize();
        const crossY = forward.z * dirToObs.x - forward.x * dirToObs.z;
        const steerDir = crossY > 0 ? -1 : 1; // Steer away
        
        const urgency = MathUtils.mapLinear(closestDist, 0.5, AVOID_THRESHOLD, 1.2, 0.5);
        steering.current = steerDir * urgency;
        velocity.current = SPEED * 0.4; 

    } else {
        if (avoiding && closestDist > AVOID_THRESHOLD + 1.0) {
            setAvoiding(false);
        }
        
        if (!avoiding) {
            setCurrentTask(`MOWING LANE ${Math.floor(waypointIndex/2)}`);
            
            // Target Logic
            const target = waypoints[waypointIndex];
            
            // Distance to target
            const dx = target.x - pos.current.x;
            const dz = target.z - pos.current.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            
            // Waypoint switching
            if (dist < 2.0) {
                if (waypointIndex < waypoints.length - 1) {
                    setWaypointIndex(curr => curr + 1);
                } else {
                    setCurrentTask('FINISHED');
                    velocity.current = 0;
                    return;
                }
            }

            // Pure Pursuit
            const desiredHeading = Math.atan2(dx, dz);
            let delta = desiredHeading - heading.current;
            
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            
            steering.current = MathUtils.clamp(delta * 2.0, -0.8, 0.8);
            velocity.current = SPEED;
        }
    }
  };

  useFrame((state, delta) => {
    if (!group.current) return;
    const dt = delta;

    if (isPlaying && autonomyEnabled) {
        updateAutonomy();
    } else if (isPlaying && !autonomyEnabled) {
         velocity.current = 0;
         setCurrentTask('MANUAL');
    }

    // Kinematics
    if (isPlaying) {
        heading.current += (velocity.current * Math.tan(steering.current) / 1.5) * dt;
        pos.current.x += Math.sin(heading.current) * velocity.current * dt;
        pos.current.z += Math.cos(heading.current) * velocity.current * dt;
        
        // Boundary Clamping
        pos.current.x = MathUtils.clamp(pos.current.x, -BOUNDS, BOUNDS);
        pos.current.z = MathUtils.clamp(pos.current.z, -BOUNDS, BOUNDS);
        
        // Simple Terrain follow
        const s1 = Math.sin(pos.current.x * 0.15) * Math.cos(pos.current.z * 0.15);
        const s2 = Math.sin(pos.current.x * 0.05 + 10.0) * Math.cos(pos.current.z * 0.05 + 3.0);
        const y = (0.25 * s1 + 0.75 * s2) * 1.5;
        
        pos.current.y = y;

        group.current.position.copy(pos.current);
        group.current.rotation.y = heading.current;

        setRobotPosition([pos.current.x, pos.current.y, pos.current.z]);
        setRobotHeading(heading.current);
    }

    // --- Update Costmap (Procedural) ---
    if (costContext) {
        const ctx = costContext;
        ctx.fillStyle = '#001100'; // Dark green/black background
        ctx.fillRect(0, 0, 128, 128);
        
        // Draw Robot Center
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(63, 63, 2, 2);
        
        // Draw Obstacles relative to robot
        ctx.fillStyle = '#ccffcc';
        const range = 12.0; // View range meters
        const scale = 128 / (range * 2);
        
        // Transform: Translate then Rotate
        // Rotation: We want the world relative to robot heading.
        // If robot heading is 0 (+Z), obstacle at +Z should be Up on map (-Y in canvas).
        // Angle to rotate = -heading.current
        const cos = Math.cos(-heading.current);
        const sin = Math.sin(-heading.current);

        for (const obs of obstacles) {
            const dx = obs.x - pos.current.x;
            const dz = obs.z - pos.current.z;
            
            // Check rough dist
            if (Math.abs(dx) > range || Math.abs(dz) > range) continue;

            // Rotate
            // x' = x cos - z sin
            // z' = x sin + z cos
            const rx = dx * cos - dz * sin;
            const rz = dx * sin + dz * cos;
            
            // Canvas Coords: Center is 64,64.
            // +rx (Right) -> +CanvasX
            // +rz (Forward) -> -CanvasY
            const cx = 64 + rx * scale;
            const cy = 64 - rz * scale;
            
            if (cx >= 0 && cx < 128 && cy >= 0 && cy < 128) {
                // Draw pseudo-lidar blob
                ctx.beginPath();
                ctx.arc(cx, cy, 2, 0, Math.PI*2);
                ctx.fill();
            }
        }
        costTexture.needsUpdate = true;
    }

    // --- Sensor Render Passes ---
    if (cameraRef.current) {
        const gl = state.gl;
        const scene = state.scene;
        
        // Update Internal Camera
        cameraRef.current.updateMatrixWorld();
        
        // Hide Robot Body for Self-View
        const wasVisible = group.current.visible;
        group.current.visible = false;

        // 1. Render RGB
        gl.setRenderTarget(rgbTarget);
        gl.render(scene, cameraRef.current);

        // 2. Render Depth (Override Material)
        scene.overrideMaterial = depthMaterial;
        gl.setRenderTarget(depthTarget);
        gl.render(scene, cameraRef.current);
        scene.overrideMaterial = null; // Reset
        
        // Restore Visibility
        group.current.visible = wasVisible;
        
        gl.setRenderTarget(null);
    }
  });

  return (
    <group ref={group}>
      {/* Chassis */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.4, 1.2]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.4} />
      </mesh>
      
      {/* Sensor Dome */}
      <mesh position={[0, 0.65, 0.3]}>
        <cylinderGeometry args={[0.15, 0.15, 0.2, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      {/* Wheels */}
      <Wheel position={[0.45, 0.2, 0.4]} rotation={[0, 0, -Math.PI/2]} />
      <Wheel position={[-0.45, 0.2, 0.4]} rotation={[0, 0, Math.PI/2]} />
      <Wheel position={[0.45, 0.2, -0.4]} rotation={[0, 0, -Math.PI/2]} />
      <Wheel position={[-0.45, 0.2, -0.4]} rotation={[0, 0, Math.PI/2]} />

      {/* 
        Robot Camera 
        Positioned at front nose (z=0.8), slightly up (y=0.7).
        Rotated 180 (Math.PI) around Y because Camera looks down -Z, 
        but our robot moves along +Z.
      */}
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