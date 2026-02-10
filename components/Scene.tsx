
import React, { useState, useRef, useMemo } from 'react';
import { Canvas, useThree, useFrame, createPortal } from '@react-three/fiber';
import { OrbitControls, Environment, Sky, Plane, PerspectiveCamera } from '@react-three/drei';
import { Scene as ThreeScene, OrthographicCamera as ThreeOrthographicCamera } from 'three';
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

  // Moved camera up significantly to avoid clipping into hills on load
  const initialCamPos: [number, number, number] = [-30, 15, -30];
  const initialTarget: [number, number, number] = [0, 0, 0];

  return (
    <div className="relative w-full h-screen bg-gray-900">
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

        {/* Camera Control - Bound to body to allow interaction through UI overlays */}
        {/* makeDefault ensures this is the global camera for R3F, used by OrbitControls */}
        <PerspectiveCamera makeDefault position={initialCamPos} fov={60} />
        
        {/* Removed domElement binding to allow R3F to handle events naturally from the canvas container */}
        <OrbitControls 
          makeDefault
          target={initialTarget} 
          minPolarAngle={0} 
          maxPolarAngle={Math.PI / 2.2} 
          enableZoom={true} 
          maxDistance={150}
          minDistance={1}
        />

        {/* Heads Up Display for Sensors */}
        {showSensors && rgbTex && (
          <HudRender rgbTex={rgbTex} depthTex={depthTex} costTex={costTex} />
        )}
      </Canvas>
      <Dashboard rgbTexture={rgbTex} />
    </div>
  );
};

// Manual HUD Implementation using explicit Portal and Render Loop
// This avoids the 'makeDefault' conflict between Drei HUD and OrbitControls
const HudRender = ({ rgbTex, depthTex, costTex }: { rgbTex: any, depthTex: any, costTex: any }) => {
    const { size, gl } = useThree();
    
    // Create separate scene and camera for HUD
    const [hudScene] = useState(() => new ThreeScene());
    const [hudCam] = useState(() => new ThreeOrthographicCamera(-1, 1, 1, -1, 0.1, 100));

    // Keep HUD camera synced with screen size
    useMemo(() => {
        hudCam.left = -size.width / 2;
        hudCam.right = size.width / 2;
        hudCam.top = size.height / 2;
        hudCam.bottom = -size.height / 2;
        hudCam.updateProjectionMatrix();
        hudCam.position.set(0, 0, 10);
    }, [size, hudCam]);

    // Priority 1: Runs AFTER the main scene render (Priority 0)
    useFrame(() => {
        gl.autoClear = false; // Don't wipe the main scene
        gl.clearDepth();      // Clear depth so HUD sits on top
        gl.render(hudScene, hudCam);
        gl.autoClear = true;  // Reset for next frame
    }, 1);

    const panelW = 256;
    const panelH = 160; 
    const gap = 16;
    const startX = 40 + panelW / 2; 
    const startY = 32 + panelH / 2; 
    const xBase = -size.width / 2;
    const yBase = -size.height / 2;

    return createPortal(
        <group>
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
        </group>,
        hudScene
    );
}
