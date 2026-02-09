import React, { useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Sky, Hud, OrthographicCamera, Plane, PerspectiveCamera } from '@react-three/drei';
import { Terrain } from './Terrain';
import { Robot } from './Robot';
import { Dashboard } from './Dashboard';
import { Vector3, NearestFilter } from 'three';
import { useStore } from '../store';

export const Scene = () => {
  const [obstacles, setObstacles] = useState<Vector3[]>([]);
  const [rgbTex, setRgbTex] = useState<any>(null);
  const [depthTex, setDepthTex] = useState<any>(null);
  const [costTex, setCostTex] = useState<any>(null);
  
  const showSensors = useStore(s => s.showSensors);

  // Initial values matching Robot.tsx start position (-32, 1, -32)
  // Behind (-Z) by 2m -> -34
  // Above (+Y) by 2m -> 3
  const initialCamPos: [number, number, number] = [-32, 3, -34];
  const initialTarget: [number, number, number] = [-32, 1, -32];

  return (
    <div className="w-full h-screen bg-gray-900">
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
        {/* Environment */}
        <Sky sunPosition={[100, 20, 100]} />
        <ambientLight intensity={0.3} />
        <directionalLight 
          position={[50, 50, 25]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize={[2048, 2048]} 
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
        />
        <Environment preset="park" />

        {/* World */}
        <Terrain setObstacles={setObstacles} />
        <Robot 
          obstacles={obstacles} 
          setRGB={setRgbTex} 
          setDepth={setDepthTex} 
          setCostMap={setCostTex}
        />

        {/* Camera Control - Aligned to Robot Start */}
        <PerspectiveCamera makeDefault position={initialCamPos} fov={60} />
        <OrbitControls makeDefault target={initialTarget} minPolarAngle={0} maxPolarAngle={Math.PI / 2.2} />

        {/* Heads Up Display for Sensors */}
        {showSensors && rgbTex && (
          <HudRender rgbTex={rgbTex} depthTex={depthTex} costTex={costTex} />
        )}
      </Canvas>
      <Dashboard rgbTexture={rgbTex} />
    </div>
  );
};

// Extracted HUD component to access useThree
const HudRender = ({ rgbTex, depthTex, costTex }: { rgbTex: any, depthTex: any, costTex: any }) => {
    const { size } = useThree();
    
    // Panel Dimensions (matched to texture aspect 16:9)
    // Dashboard w-64 is 256px (approx 16rem = 256px)
    const panelW = 256;
    const panelH = 160; // h-40 is 10rem = 160px
    const gap = 16;
    
    // We add left padding to match the dashboard's "pl-4" (16px) + "p-6" (24px)
    // Actually Dashboard has p-6 (24px) on parent, then flex gap-4 (16px), and pl-4.
    // Let's approximate starting X at around 40px from edge.
    const startX = 40 + panelW / 2; 
    
    // Bottom padding is p-6 (24px) + pb-2 (8px) approx 32px
    const startY = 32 + panelH / 2; 
    
    const xBase = -size.width / 2;
    const yBase = -size.height / 2;

    return (
        <Hud renderPriority={1}>
             {/* Pixel-perfect Orthographic Camera */}
             <OrthographicCamera 
                makeDefault 
                position={[0, 0, 10]} 
                left={-size.width / 2} 
                right={size.width / 2} 
                top={size.height / 2} 
                bottom={-size.height / 2}
             />
             
             {/* RGB Panel (Left) */}
             <group position={[xBase + startX, yBase + startY, 0]}>
                <Plane args={[panelW, panelH]}> 
                    <meshBasicMaterial map={rgbTex} />
                </Plane>
             </group>
             
             {/* Depth Panel (Middle) */}
             <group position={[xBase + startX + panelW + gap, yBase + startY, 0]}>
                {depthTex && (
                    <Plane args={[panelW, panelH]}> 
                        <meshBasicMaterial map={depthTex} />
                    </Plane>
                )}
             </group>
             
             {/* Costmap Panel (Right) */}
             <group position={[xBase + startX + (panelW + gap) * 2, yBase + startY, 0]}>
                {costTex && (
                    <Plane args={[panelW, panelH]}> 
                        <meshBasicMaterial map={costTex} />
                    </Plane>
                )}
                {/* Overlay grid lines for cool effect */}
                <Plane args={[panelW - 4, panelH - 4]} position={[0,0,0.01]}>
                    <meshBasicMaterial color="#004400" wireframe transparent opacity={0.3} />
                </Plane>
             </group>
        </Hud>
    );
}