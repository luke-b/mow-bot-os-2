import React, { useRef, useEffect } from 'react';
import { useStore } from '../store';
import { Canvas } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';

// This component lives outside the Canvas, overlaying HTML
export const Dashboard = ({ rgbTexture }: { rgbTexture: any }) => {
  const { 
    robotPosition, 
    robotHeading, 
    currentTask, 
    autonomyEnabled, 
    toggleAutonomy, 
    regenerateWorld,
    showSensors,
    toggleSensors
  } = useStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none flex flex-col justify-between p-6">
      
      {/* Top Header */}
      <div className="flex justify-between items-start pointer-events-auto">
        <div className="bg-black/80 backdrop-blur-md p-4 rounded-lg border border-gray-700 shadow-xl">
          <h1 className="text-xl font-bold text-amber-500 font-mono tracking-tighter">MOW-BOT OS v2.1</h1>
          <div className="flex gap-4 mt-2 text-xs font-mono text-gray-400">
            <div>
              <span className="block text-gray-600">POS X</span>
              {robotPosition[0].toFixed(2)}
            </div>
            <div>
              <span className="block text-gray-600">POS Z</span>
              {robotPosition[2].toFixed(2)}
            </div>
            <div>
              <span className="block text-gray-600">HEADING</span>
              {(robotHeading * 180 / Math.PI).toFixed(1)}°
            </div>
          </div>
        </div>

        <div className="bg-black/80 backdrop-blur-md p-4 rounded-lg border border-gray-700 flex flex-col gap-2">
           <div className="flex items-center justify-between gap-4">
             <span className="text-sm font-bold text-gray-300">SYSTEM STATUS</span>
             <span className={`text-xs px-2 py-1 rounded font-bold ${autonomyEnabled ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                {autonomyEnabled ? 'AUTO' : 'MANUAL'}
             </span>
           </div>
           <div className="mt-2 text-xs font-mono">
             TASK: <span className="text-blue-400 animate-pulse">{currentTask}</span>
           </div>
           
           <button 
             onClick={toggleAutonomy}
             className={`mt-2 pointer-events-auto px-4 py-2 rounded text-sm font-bold transition-all ${
               autonomyEnabled 
                 ? 'bg-red-600 hover:bg-red-500 text-white' 
                 : 'bg-green-600 hover:bg-green-500 text-white'
             }`}
           >
             {autonomyEnabled ? 'STOP AUTONOMY' : 'ENGAGE AUTONOMY'}
           </button>
           
           <button 
             onClick={regenerateWorld}
             className="pointer-events-auto px-4 py-2 mt-1 rounded text-sm font-bold bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
           >
             REGEN WORLD
           </button>

           <div className="h-px bg-gray-700 my-2"></div>
           
           <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer pointer-events-auto">
             <input type="checkbox" checked={showSensors} onChange={toggleSensors} />
             SHOW SENSOR FEED
           </label>
        </div>
      </div>

      {/* Bottom Sensor Array (The "Cute" UI part) */}
      {showSensors && (
         <div className="pointer-events-auto flex gap-4 mt-auto overflow-x-auto pb-2 pl-4">
            {/* 
                The 3D HUD renders BEHIND these divs. 
                We keep the borders and labels, but make the background TRANSPARENT 
                so we can see the 3D render.
            */}
            
            <div className="border-2 border-gray-700/50 rounded w-64 h-40 flex items-center justify-center text-gray-600 font-mono text-xs relative bg-transparent pointer-events-none">
                <span className="absolute top-2 left-2 text-white bg-black/50 px-1 text-[10px]">RGB_CAM_01</span>
                {/* Visual guide only, actual content is 3D */}
            </div>

            <div className="border-2 border-gray-700/50 rounded w-64 h-40 flex items-center justify-center text-gray-600 font-mono text-xs relative bg-transparent pointer-events-none">
                <span className="absolute top-2 left-2 text-purple-400 bg-black/50 px-1 text-[10px]">DEPTH_SENSE</span>
            </div>

            <div className="border-2 border-gray-700/50 rounded w-64 h-40 flex items-center justify-center text-gray-600 font-mono text-xs relative bg-transparent pointer-events-none">
                 <span className="absolute top-2 left-2 text-green-400 bg-black/50 px-1 text-[10px]">COSTMAP_2D</span>
            </div>
         </div>
      )}
    </div>
  );
};