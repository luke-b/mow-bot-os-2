
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
    robotStats,
    terrainRoughness,
    setTerrainRoughness,
    kpiStats,
    customWatches
  } = useStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Benchmark Target: ~3m/s * 0.8m width = 2.4 m^2/s = 144 m^2/min
  const BENCHMARK_EFFICIENCY = 140; 
  
  const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent = Math.min(100, (kpiStats.areaMowed / kpiStats.totalTargetArea) * 100);

  return (
    <>
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none flex flex-col justify-between p-6 z-10 select-none">
      
      {/* Top Header */}
      <div className="flex justify-between items-start pointer-events-auto">
        <div className="bg-black/90 backdrop-blur-md p-4 rounded-lg border border-gray-700 shadow-xl w-72">
          <div className="flex items-center justify-between mb-3 border-b border-gray-800 pb-2">
             <h1 className="text-xl font-bold text-amber-500 font-mono tracking-tighter">MOW-BOT OS</h1>
             <span className={`text-xs px-2 py-0.5 rounded font-bold font-mono animate-pulse ${autonomyEnabled ? 'bg-green-900 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                {autonomyEnabled ? '● AUTO' : '○ IDLE'}
             </span>
          </div>

          {/* ALERTS SECTION */}
          {(robotStats.isStuck || robotStats.collision) && (
             <div className="mb-4 space-y-2">
                {robotStats.isStuck && (
                    <div className="bg-red-900/90 text-white text-center text-sm font-bold py-2 rounded animate-pulse border border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                        ⚠ TRACTION LOSS DETECTED
                    </div>
                )}
                {robotStats.collision && (
                    <div className="bg-orange-600 text-white text-center text-sm font-bold py-2 rounded animate-bounce border border-orange-400">
                        💥 COLLISION ALERT
                    </div>
                )}
             </div>
          )}

          {/* KPI DASHBOARD */}
          <div className="space-y-4">
              {/* Progress */}
              <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1 font-mono">
                      <span>PROGRESS</span>
                      <span>{progressPercent.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className="bg-amber-500 h-2.5 rounded-full transition-all duration-300 ease-out" 
                        style={{ width: `${progressPercent}%` }}
                      ></div>
                  </div>
              </div>

              {/* Grid Stats */}
              <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-800/50 p-2 rounded border border-gray-700">
                      <div className="text-[10px] text-gray-500 font-mono uppercase">Work Done</div>
                      <div className="text-lg font-bold text-white font-mono leading-none mt-1">
                          {kpiStats.areaMowed.toFixed(0)} <span className="text-xs text-gray-500 font-sans">m²</span>
                      </div>
                  </div>
                   <div className="bg-gray-800/50 p-2 rounded border border-gray-700">
                      <div className="text-[10px] text-gray-500 font-mono uppercase">Elapsed</div>
                      <div className="text-lg font-bold text-white font-mono leading-none mt-1">
                          {formatTime(kpiStats.elapsedTime)}
                      </div>
                  </div>
              </div>

              {/* Efficiency Benchmark */}
              <div className="bg-gray-800/50 p-3 rounded border border-gray-700">
                  <div className="flex justify-between items-end mb-1">
                      <div className="text-[10px] text-gray-500 font-mono uppercase">Efficiency</div>
                      <div className="text-right">
                          <span className={`text-sm font-bold font-mono ${kpiStats.efficiency > BENCHMARK_EFFICIENCY * 0.8 ? 'text-green-400' : 'text-yellow-400'}`}>
                              {kpiStats.efficiency.toFixed(0)}
                          </span>
                          <span className="text-[10px] text-gray-500 ml-1">m²/min</span>
                      </div>
                  </div>
                  {/* Visual Bar vs Benchmark */}
                  <div className="relative h-1.5 w-full bg-gray-700 rounded-full mt-2">
                      {/* Marker for Benchmark */}
                      <div className="absolute top-0 bottom-0 w-0.5 bg-white/30 z-10" style={{ left: '80%' }}></div>
                      {/* Actual Bar */}
                      <div 
                        className={`absolute top-0 left-0 bottom-0 rounded-full transition-all duration-500 ${kpiStats.efficiency > BENCHMARK_EFFICIENCY ? 'bg-green-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(100, (kpiStats.efficiency / (BENCHMARK_EFFICIENCY * 1.2)) * 100)}%` }}
                      ></div>
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-600 mt-1 font-mono">
                      <span>0</span>
                      <span>TARGET: {BENCHMARK_EFFICIENCY}</span>
                  </div>
              </div>
          </div>
          
          {/* Custom Watches Section */}
          {Object.keys(customWatches).length > 0 && (
              <div className="mt-4 pt-2 border-t border-gray-800">
                  <div className="text-[10px] text-amber-500/80 font-bold font-mono mb-2 uppercase tracking-widest">Live Telemetry</div>
                  <div className="space-y-1">
                      {Object.entries(customWatches).map(([key, val]) => (
                          <div key={key} className="flex justify-between text-xs font-mono">
                              <span className="text-gray-400 uppercase">{key}</span>
                              <span className="text-white font-bold">{val}</span>
                          </div>
                      ))}
                  </div>
              </div>
          )}
          
          {/* Collapse/Expand Technical Details */}
          <div className="mt-4 pt-4 border-t border-gray-800">
             <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono text-gray-500">
                <div className="flex justify-between"><span>PITCH</span> <span className="text-gray-300">{(robotStats.pitch * 180 / Math.PI).toFixed(1)}°</span></div>
                <div className="flex justify-between"><span>ROLL</span> <span className="text-gray-300">{(robotStats.roll * 180 / Math.PI).toFixed(1)}°</span></div>
                <div className="flex justify-between"><span>POS X</span> <span className="text-gray-300">{robotPosition[0].toFixed(1)}</span></div>
                <div className="flex justify-between"><span>POS Z</span> <span className="text-gray-300">{robotPosition[2].toFixed(1)}</span></div>
             </div>
          </div>

        </div>

        {/* Right Panel: Controls */}
        <div className="bg-black/80 backdrop-blur-md p-4 rounded-lg border border-gray-700 flex flex-col gap-2 w-64">
           <div className="text-xs font-bold text-gray-400 border-b border-gray-700 pb-1 mb-1">CONTROLS</div>
           
           <button 
             onClick={toggleAutonomy}
             className={`pointer-events-auto px-4 py-3 rounded text-sm font-bold transition-all shadow-lg ${
               autonomyEnabled 
                 ? 'bg-red-600 hover:bg-red-500 text-white' 
                 : 'bg-green-600 hover:bg-green-500 text-white'
             }`}
           >
             {autonomyEnabled ? '🛑 STOP MISSION' : '🚀 START MISSION'}
           </button>
           
           <div className="mt-2 text-xs font-mono">
             CURRENT TASK: <span className="text-blue-400">{currentTask}</span>
           </div>
           
           <div className="h-px bg-gray-700 my-2"></div>
           
           <span className="text-xs font-bold text-gray-400">ENVIRONMENT</span>
           <div className="grid grid-cols-2 gap-2 mt-1">
             {(['water', 'walls', 'poles', 'ridges', 'rocks'] as HazardType[]).map(t => (
               <label key={t} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer pointer-events-auto hover:text-white transition-colors">
                 <input 
                   type="checkbox" 
                   checked={hazards[t]} 
                   onChange={() => toggleHazard(t)}
                   className="accent-amber-500"
                 />
                 {t.toUpperCase()}
               </label>
             ))}
           </div>
           
           <div className="mt-3">
             <div className="flex justify-between text-xs font-bold text-gray-400 mb-1">
                <span>TERRAIN ROUGHNESS</span>
                <span>{terrainRoughness.toFixed(1)}</span>
             </div>
             <input 
                type="range" min="0" max="2" step="0.1" 
                value={terrainRoughness} 
                onChange={(e) => setTerrainRoughness(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer pointer-events-auto accent-amber-500"
             />
           </div>

           <button 
             onClick={regenerateWorld}
             className="pointer-events-auto px-4 py-2 mt-4 rounded text-xs font-bold bg-gray-800 hover:bg-gray-700 text-white border border-gray-600 transition-all"
           >
             ♻ REGENERATE WORLD SEED
           </button>

           <div className="h-px bg-gray-700 my-2"></div>

           <button 
             onClick={toggleBrain}
             className={`pointer-events-auto px-4 py-2 mt-2 rounded text-xs font-bold border ${isBrainOpen ? 'bg-amber-600 text-white border-amber-500' : 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'}`}
           >
             {isBrainOpen ? 'CLOSE BRAIN LAB' : '🛠 OPEN BRAIN LAB'}
           </button>
           
           <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer pointer-events-auto mt-2 hover:text-white">
             <input type="checkbox" checked={showSensors} onChange={toggleSensors} className="accent-amber-500" />
             SHOW SENSOR FEEDS
           </label>
        </div>
      </div>

      {/* Bottom Sensor Array */}
      {showSensors && !isBrainOpen && (
         <div className="pointer-events-auto flex gap-4 mt-auto overflow-x-auto pb-2 pl-4">
            <div className="border-2 border-gray-700/50 rounded w-64 h-40 flex items-center justify-center text-gray-600 font-mono text-xs relative bg-transparent pointer-events-none shadow-lg backdrop-blur-sm">
                <span className="absolute top-2 left-2 text-white bg-black/50 px-1 text-[10px]">RGB_CAM_01</span>
            </div>

            <div className="border-2 border-gray-700/50 rounded w-64 h-40 flex items-center justify-center text-gray-600 font-mono text-xs relative bg-transparent pointer-events-none shadow-lg backdrop-blur-sm">
                <span className="absolute top-2 left-2 text-purple-400 bg-black/50 px-1 text-[10px]">DEPTH_SENSE</span>
            </div>

            <div className="border-2 border-gray-700/50 rounded w-64 h-40 flex items-center justify-center text-gray-600 font-mono text-xs relative bg-transparent pointer-events-none shadow-lg backdrop-blur-sm">
                 <span className="absolute top-2 left-2 text-green-400 bg-black/50 px-1 text-[10px]">COSTMAP_2D</span>
            </div>
         </div>
      )}
    </div>
    
    <BrainLab />
    </>
  );
};
