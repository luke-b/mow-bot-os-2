
import React, { useRef, useEffect } from 'react';
import { useStore, HazardType } from '../store';
import { BrainLab } from './BrainLab';

export const Dashboard = ({ rgbTexture }: { rgbTexture: any }) => {
  const { 
    robotPosition, 
    robotHeading, 
    currentTask, 
    autonomyEnabled, 
    toggleAutonomy, 
    regenerateWorld,
    showSensors,
    toggleSensors,
    hazards,
    toggleHazard,
    toggleBrain,
    isBrainOpen,
    robotStats
  } = useStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  return (
    <>
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none flex flex-col justify-between p-6 z-10">
      
      {/* Top Header */}
      <div className="flex justify-between items-start pointer-events-auto">
        <div className="bg-black/80 backdrop-blur-md p-4 rounded-lg border border-gray-700 shadow-xl w-64">
          <h1 className="text-xl font-bold text-amber-500 font-mono tracking-tighter">MOW-BOT OS v2.2</h1>
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
          
          <div className="grid grid-cols-2 gap-2 mt-4 text-xs font-mono">
              <div className="bg-gray-800 p-2 rounded flex flex-col items-center">
                  <span className="text-gray-500 mb-1">PITCH</span>
                  <span className={Math.abs(robotStats.pitch) > 0.3 ? "text-red-400" : "text-white"}>
                      {(robotStats.pitch * 180 / Math.PI).toFixed(1)}°
                  </span>
              </div>
              <div className="bg-gray-800 p-2 rounded flex flex-col items-center">
                  <span className="text-gray-500 mb-1">ROLL</span>
                  <span className={Math.abs(robotStats.roll) > 0.3 ? "text-red-400" : "text-white"}>
                      {(robotStats.roll * 180 / Math.PI).toFixed(1)}°
                  </span>
              </div>
          </div>
          
          {robotStats.isStuck && (
              <div className="mt-2 bg-red-900/80 text-red-200 text-center text-xs font-bold py-1 rounded animate-pulse">
                  ⚠ WARNING: STUCK DETECTED
              </div>
          )}
          {robotStats.collision && (
              <div className="mt-2 bg-orange-900/80 text-orange-200 text-center text-xs font-bold py-1 rounded">
                  ⚠ COLLISION
              </div>
          )}
        </div>

        <div className="bg-black/80 backdrop-blur-md p-4 rounded-lg border border-gray-700 flex flex-col gap-2 w-64">
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
           
           <div className="h-px bg-gray-700 my-2"></div>
           
           <span className="text-xs font-bold text-gray-400">HAZARDS (REGEN REQUIRED)</span>
           <div className="grid grid-cols-2 gap-2 mt-1">
             {(['water', 'walls', 'poles', 'ridges', 'rocks'] as HazardType[]).map(t => (
               <label key={t} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer pointer-events-auto">
                 <input 
                   type="checkbox" 
                   checked={hazards[t]} 
                   onChange={() => toggleHazard(t)}
                 />
                 {t.toUpperCase()}
               </label>
             ))}
           </div>

           <button 
             onClick={regenerateWorld}
             className="pointer-events-auto px-4 py-2 mt-2 rounded text-sm font-bold bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
           >
             REGEN WORLD
           </button>

           <div className="h-px bg-gray-700 my-2"></div>

           <button 
             onClick={toggleBrain}
             className={`pointer-events-auto px-4 py-2 mt-2 rounded text-sm font-bold border ${isBrainOpen ? 'bg-amber-600 text-white border-amber-500' : 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'}`}
           >
             {isBrainOpen ? 'CLOSE BRAIN LAB' : 'OPEN BRAIN LAB'}
           </button>
           
           <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer pointer-events-auto mt-2">
             <input type="checkbox" checked={showSensors} onChange={toggleSensors} />
             SHOW SENSOR FEED
           </label>
        </div>
      </div>

      {/* Bottom Sensor Array */}
      {showSensors && !isBrainOpen && (
         <div className="pointer-events-auto flex gap-4 mt-auto overflow-x-auto pb-2 pl-4">
            <div className="border-2 border-gray-700/50 rounded w-64 h-40 flex items-center justify-center text-gray-600 font-mono text-xs relative bg-transparent pointer-events-none">
                <span className="absolute top-2 left-2 text-white bg-black/50 px-1 text-[10px]">RGB_CAM_01</span>
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
    
    <BrainLab />
    </>
  );
};
