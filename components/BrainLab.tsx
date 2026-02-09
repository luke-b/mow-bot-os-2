import React, { useState, useEffect } from 'react';
import { useStore } from '../store';

export const BrainLab = () => {
  const { 
    isBrainOpen, 
    toggleBrain, 
    userCode, 
    setUserCode, 
    executionStatus, 
    setExecutionStatus,
    errorLog,
    revisions,
    revertToSafe,
    addRevision,
    setErrorLog,
    toggleAutonomy
  } = useStore();

  const [activeTab, setActiveTab] = useState<'CODE' | 'API' | 'RUNS'>('CODE');
  const [tempCode, setTempCode] = useState(userCode);

  useEffect(() => {
    if (!isBrainOpen) {
       // When closing, maybe sync? 
       // For now, we sync on Run.
    } else {
        setTempCode(userCode);
    }
  }, [isBrainOpen, userCode]);

  const handleRun = () => {
    setUserCode(tempCode);
    setExecutionStatus('RUNNING');
    setErrorLog(null);
    
    // Create Revision
    addRevision({
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        code: tempCode,
        status: 'UNKNOWN' // Will be updated by Robot if it crashes or runs for X sec
    });

    // If autonomy isn't on, turn it on
    const state = useStore.getState();
    if (!state.autonomyEnabled) {
        toggleAutonomy();
    }
  };

  const handleStop = () => {
      setExecutionStatus('IDLE');
      const state = useStore.getState();
      if (state.autonomyEnabled) toggleAutonomy();
  };

  if (!isBrainOpen) return null;

  return (
    <div className="absolute bottom-0 left-0 w-full h-96 bg-[#111] border-t border-gray-700 flex flex-col shadow-2xl z-50 transition-transform duration-300">
      {/* Header */}
      <div className="h-10 bg-[#1a1a1a] border-b border-gray-700 flex items-center px-4 justify-between">
         <div className="flex items-center gap-4">
            <span className="font-bold text-amber-500 font-mono">BRAIN LAB</span>
            <div className="flex gap-1">
               {['CODE', 'API', 'RUNS'].map(tab => (
                 <button 
                   key={tab}
                   onClick={() => setActiveTab(tab as any)}
                   className={`px-3 py-1 text-xs font-mono rounded ${activeTab === tab ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                 >
                   {tab}
                 </button>
               ))}
            </div>
         </div>
         
         <div className="flex items-center gap-4">
             {executionStatus === 'RUNNING' && <span className="text-xs text-green-400 font-mono animate-pulse">● RUNNING</span>}
             {executionStatus === 'ERROR' && <span className="text-xs text-red-400 font-mono">● ERROR</span>}
             
             <button onClick={() => toggleBrain()} className="text-gray-400 hover:text-white">✕</button>
         </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Editor */}
        {activeTab === 'CODE' && (
            <div className="flex-1 flex flex-col">
                <div className="flex-1 relative">
                    <textarea
                        value={tempCode}
                        onChange={(e) => setTempCode(e.target.value)}
                        className="w-full h-full bg-[#0d0d0d] text-gray-300 font-mono text-sm p-4 resize-none focus:outline-none"
                        spellCheck={false}
                    />
                    {errorLog && (
                        <div className="absolute bottom-4 left-4 right-4 bg-red-900/90 text-red-200 p-3 rounded font-mono text-xs border border-red-700 shadow-lg">
                            <div className="font-bold mb-1">RUNTIME ERROR</div>
                            {errorLog}
                        </div>
                    )}
                </div>
                <div className="h-12 bg-[#1a1a1a] border-t border-gray-700 flex items-center px-4 gap-4">
                    <button 
                        onClick={handleRun}
                        className="px-6 py-1.5 bg-green-700 hover:bg-green-600 text-white font-mono text-xs font-bold rounded flex items-center gap-2"
                    >
                        <span>▶</span> DEPLOY & RUN
                    </button>
                    <button 
                        onClick={handleStop}
                        className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white font-mono text-xs font-bold rounded"
                    >
                        STOP
                    </button>
                    <div className="ml-auto text-xs text-gray-500 font-mono">
                        CPU Budget: 5ms/tick • Sandbox: Active
                    </div>
                </div>
            </div>
        )}

        {/* API Docs */}
        {activeTab === 'API' && (
            <div className="flex-1 bg-[#0d0d0d] text-gray-400 p-6 overflow-y-auto font-mono text-sm">
                <h3 className="text-white font-bold mb-4">MowBot High-Level API</h3>
                
                <div className="space-y-6">
                    <ApiSection title="robot" items={[
                        { sig: 'robot.pose()', desc: 'Returns { x, y, z, heading }' },
                        { sig: 'robot.setSpeed(v)', desc: 'Set forward speed in m/s' },
                        { sig: 'robot.setSteer(rad)', desc: 'Set steering angle in radians' },
                        { sig: 'robot.stop()', desc: 'Hard stop (speed = 0)' },
                    ]} />
                    
                    <ApiSection title="sensors" items={[
                        { sig: 'sensors.frontDistance()', desc: 'Raycast distance in meters (0-10)' },
                        { sig: 'sensors.groundType()', desc: 'Returns "GROUND", "WATER", or "OBSTACLE"' },
                        { sig: 'sensors.gps()', desc: 'Returns { x, z }' },
                    ]} />
                    
                    <ApiSection title="world" items={[
                        { sig: 'world.time()', desc: 'Elapsed simulation time (s)' },
                        { sig: 'world.dt()', desc: 'Delta time since last frame (s)' },
                        { sig: 'world.boundary()', desc: 'Field dimensions' },
                    ]} />

                    <ApiSection title="debug" items={[
                         { sig: 'debug.text(pos, msg)', desc: 'Draw 3D text at position' },
                         { sig: 'console.log(msg)', desc: 'Log to console' },
                    ]} />
                </div>
            </div>
        )}

        {/* Runs History */}
        {activeTab === 'RUNS' && (
            <div className="flex-1 bg-[#0d0d0d] p-6 overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-white font-bold">Revision History</h3>
                    <button 
                        onClick={revertToSafe}
                        className="px-3 py-1 bg-amber-700 hover:bg-amber-600 text-white text-xs font-mono rounded"
                    >
                        ⏪ REVERT TO LAST SAFE
                    </button>
                </div>
                
                <div className="space-y-2">
                    {revisions.map((rev) => (
                        <div key={rev.id} className="bg-[#1a1a1a] p-3 rounded border border-gray-800 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${
                                        rev.status === 'SAFE' ? 'bg-green-500' : 
                                        rev.status === 'ERROR' ? 'bg-red-500' : 'bg-gray-500'
                                    }`} />
                                    <span className="text-gray-300 font-mono text-xs">Rev #{rev.id}</span>
                                    <span className="text-gray-600 text-[10px]">{new Date(rev.timestamp).toLocaleTimeString()}</span>
                                </div>
                            </div>
                            <button 
                                onClick={() => { setUserCode(rev.code); setTempCode(rev.code); setActiveTab('CODE'); }}
                                className="text-blue-500 hover:text-blue-400 text-xs font-mono"
                            >
                                LOAD
                            </button>
                        </div>
                    ))}
                    {revisions.length === 0 && <div className="text-gray-600 text-sm italic">No runs yet.</div>}
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

const ApiSection = ({ title, items }: { title: string, items: any[] }) => (
    <div>
        <h4 className="text-amber-500 border-b border-gray-800 pb-1 mb-2">{title}</h4>
        <ul className="space-y-2">
            {items.map((item, i) => (
                <li key={i}>
                    <code className="text-gray-200 bg-gray-900 px-1 rounded">{item.sig}</code>
                    <p className="text-gray-500 text-xs mt-0.5 ml-2">{item.desc}</p>
                </li>
            ))}
        </ul>
    </div>
);