import React, { useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Sky, Hud, OrthographicCamera, Plane, PerspectiveCamera } from '@react-three/drei';
import { Terrain, WorldData } from './Terrain';
import { Robot } from './Robot';
import { Dashboard } from './Dashboard';
import { useStore } from '../store';

export const Scene = () => {
  // World Data now holds the interface for the Robot to query physics
  const [worldData, setWorldData] = useState<WorldData | null>(null);
  
  const [rgbTex, setRgbTex] = useState<any>(null);
  const [depthTex, setDepthTex] = useState<any>(null);
  const [costTex, setCostTex] = useState<any>(null);
  
  const showSensors = useStore(s => s.showSensors);

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

        {/* World Generation */}
        <Terrain setWorldData={setWorldData} />
        
        {/* Robot Entity */}
        <Robot 
          worldData={worldData} 
          setRGB={setRgbTex} 
          setDepth={setDepthTex} 
          setCostMap={setCostTex}
        />

        {/* Camera Control */}
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
    const panelW = 256;
    const panelH = 160; 
    const gap = 16;
    const startX = 40 + panelW / 2; 
    const startY = 32 + panelH / 2; 
    const xBase = -size.width / 2;
    const yBase = -size.height / 2;

    return (
        <Hud renderPriority={1}>
             <OrthographicCamera 
                makeDefault 
                position={[0, 0, 10]} 
                left={-size.width / 2} 
                right={size.width / 2} 
                top={size.height / 2} 
                bottom={-size.height / 2}
             />
             <group position={[xBase + startX, yBase + startY, 0]}>
                <Plane args={[panelW, panelH]}> 
                    <meshBasicMaterial map={rgbTex} />
                </Plane>
             </group>
             <group position={[xBase + startX + panelW + gap, yBase + startY, 0]}>
                {depthTex && (
                    <Plane args={[panelW, panelH]}> 
                        <meshBasicMaterial map={depthTex} />
                    </Plane>
                )}
             </group>
             <group position={[xBase + startX + (panelW + gap) * 2, yBase + startY, 0]}>
                {costTex && (
                    <Plane args={[panelW, panelH]}> 
                        <meshBasicMaterial map={costTex} />
                    </Plane>
                )}
                <Plane args={[panelW - 4, panelH - 4]} position={[0,0,0.01]}>
                    <meshBasicMaterial color="#004400" wireframe transparent opacity={0.3} />
                </Plane>
             </group>
        </Hud>
    );
}