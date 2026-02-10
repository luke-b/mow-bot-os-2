
import React, { useState, useEffect, useRef } from 'react';
import { useStore, AiLogEntry } from '../store';

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
    toggleAutonomy,
    telemetryHistory,
    aiLogs,
    clearAiLogs
  } = useStore();

  const [activeTab, setActiveTab] = useState<'CODE' | 'API' | 'TELEMETRY' | 'AI AGENT' | 'RUNS'>('CODE');
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
               {['CODE', 'API', 'TELEMETRY', 'AI AGENT', 'RUNS'].map(tab => (
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

                    <ApiSection title="telemetry" items={[
                        { sig: 'telemetry.log(key, val)', desc: 'Plot numeric data in Telemetry tab. E.g. log("error", 0.5)' },
                        { sig: 'telemetry.watch(key, val)', desc: 'Add/Update custom metric on Dashboard and AI Logs' },
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

        {/* Telemetry Graph */}
        {activeTab === 'TELEMETRY' && (
            <div className="flex-1 bg-[#0d0d0d] p-4 flex flex-col">
                <TelemetryGraph history={telemetryHistory} />
            </div>
        )}

        {/* AI Agent Console */}
        {activeTab === 'AI AGENT' && (
             <div className="flex-1 bg-[#0d0d0d] flex flex-col">
                 <div className="h-10 bg-[#111] border-b border-gray-800 flex items-center justify-between px-4">
                     <span className="text-xs font-mono text-gray-400">CONTEXT LOG (UPDATES EVERY 30S)</span>
                     <div className="flex gap-2">
                         <button onClick={clearAiLogs} className="text-[10px] text-gray-500 hover:text-white">CLEAR LOGS</button>
                         <button onClick={handleStop} className="px-2 py-0.5 bg-red-900/50 text-red-200 text-[10px] border border-red-800 rounded">FORCE STOP MISSION</button>
                     </div>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
                     {aiLogs.length === 0 && <div className="text-gray-600 italic">Waiting for mission data...</div>}
                     {aiLogs.map((log, i) => (
                         <div key={i} className="bg-[#050505] border border-gray-800 rounded p-3 relative group">
                             <div className="text-gray-500 mb-2 flex justify-between">
                                 <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                                 <span className="text-amber-600">[{log.event}]</span>
                             </div>
                             <pre className="text-green-500 overflow-x-auto whitespace-pre-wrap font-[inherit]">
                                 {JSON.stringify({ 
                                     kpi: log.kpi, 
                                     robot: { isStuck: log.robotState.isStuck, collision: log.robotState.collision },
                                     watches: log.watches
                                 }, null, 2)}
                             </pre>
                         </div>
                     ))}
                 </div>
                 <div className="bg-[#1a1a1a] p-2 border-t border-gray-800 text-[10px] text-gray-500 flex justify-between">
                    <span>AI AGENT STATUS: <span className="text-green-500">LISTENING</span></span>
                    <span>Use 'telemetry.watch()' to add custom context fields.</span>
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

// Canvas based simple line chart
const TelemetryGraph = ({ history }: { history: any[] }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        // Clear
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, w, h);

        if (history.length < 2) {
            ctx.fillStyle = '#444';
            ctx.font = '12px monospace';
            ctx.fillText("WAITING FOR DATA...", w/2 - 50, h/2);
            return;
        }

        // Identify keys (exclude time)
        const keys = Object.keys(history[history.length - 1]).filter(k => k !== 'time');
        
        // Setup colors
        const colors = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];
        
        // Find min/max for scaling per key (simple normalization)
        // Actually, to keep it readable, let's group widely different scales?
        // For simple debugging, mapping everything to 0..1 relative to its own min/max is confusing.
        // Let's just fit all visible data into the window, but draw them separately? No, messy.
        // Let's normalize each series to the height of the canvas so they overlay.
        
        const ranges: Record<string, {min: number, max: number}> = {};
        keys.forEach(k => {
            let min = Infinity, max = -Infinity;
            for(let i=0; i<history.length; i++) {
                const v = history[i][k];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (min === max) { min -= 1; max += 1; }
            ranges[k] = { min, max };
        });

        // Draw Grid
        ctx.strokeStyle = '#222';
        ctx.beginPath();
        for(let i=0; i<w; i+=50) { ctx.moveTo(i, 0); ctx.lineTo(i, h); }
        for(let i=0; i<h; i+=50) { ctx.moveTo(0, i); ctx.lineTo(w, i); }
        ctx.stroke();

        // Draw Lines
        keys.forEach((key, idx) => {
            const color = colors[idx % colors.length];
            const range = ranges[key];
            const span = range.max - range.min;

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            history.forEach((frame, i) => {
                const x = (i / (history.length - 1)) * w;
                // Normalize y to 10% padding top/bottom
                const normVal = (frame[key] - range.min) / span;
                const y = h - (h * 0.1) - (normVal * (h * 0.8));
                
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        });

    }, [history]);

    // Render Legend
    const keys = history.length > 0 ? Object.keys(history[history.length - 1]).filter(k => k !== 'time') : [];
    const colors = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

    return (
        <div className="flex-1 flex flex-col h-full">
            <div className="flex flex-wrap gap-4 mb-2 text-xs font-mono border-b border-gray-800 pb-2">
                {keys.map((k, i) => {
                   const color = colors[i % colors.length];
                   const val = history[history.length-1][k].toFixed(2);
                   return (
                       <div key={k} className="flex items-center gap-1.5">
                           <span className="w-2 h-2 rounded-full" style={{background: color}}></span>
                           <span className="text-gray-400 uppercase">{k}</span>
                           <span className="text-white font-bold">{val}</span>
                       </div>
                   );
                })}
                {keys.length === 0 && <span className="text-gray-500">Run code to see telemetry...</span>}
            </div>
            <div className="flex-1 bg-[#050505] rounded border border-gray-800 relative overflow-hidden">
                <canvas ref={canvasRef} width={800} height={300} className="w-full h-full object-contain" />
            </div>
        </div>
    );
}
