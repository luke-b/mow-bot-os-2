import { create } from 'zustand';
import { Vector3 } from 'three';

export type HazardType = 'water' | 'walls' | 'poles' | 'ridges' | 'rocks';

export interface Revision {
  id: string;
  timestamp: number;
  code: string;
  status: 'SAFE' | 'ERROR' | 'UNKNOWN';
  note?: string;
}

interface AppState {
  // Autonomy Settings
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  autonomyEnabled: boolean;
  toggleAutonomy: () => void;
  showSensors: boolean;
  toggleSensors: () => void;
  
  // Brain Lab State
  isBrainOpen: boolean;
  toggleBrain: () => void;
  userCode: string;
  setUserCode: (code: string) => void;
  executionStatus: 'IDLE' | 'RUNNING' | 'ERROR' | 'SAFE';
  setExecutionStatus: (s: 'IDLE' | 'RUNNING' | 'ERROR' | 'SAFE') => void;
  errorLog: string | null;
  setErrorLog: (s: string | null) => void;
  revisions: Revision[];
  addRevision: (rev: Revision) => void;
  revertToSafe: () => void;

  // Robot State (for UI updates)
  robotPosition: [number, number, number];
  setRobotPosition: (pos: [number, number, number]) => void;
  robotHeading: number;
  setRobotHeading: (rad: number) => void;
  currentTask: string;
  setCurrentTask: (task: string) => void;

  // World Settings
  grassDensity: number;
  setGrassDensity: (v: number) => void;
  regenerateTrigger: number;
  worldSeed: number;
  regenerateWorld: () => void;
  
  // Hazards
  hazards: Record<HazardType, boolean>;
  toggleHazard: (type: HazardType) => void;
}

const DEFAULT_CODE = `// 🧠 Robot Brain Script
// You have 5ms per tick. Go!

let state = {
  mode: 'CRUISE',
  stuckTimer: 0
};

function init(api) {
  api.console.log("Brain online. Systems nominal.");
  state.mode = 'CRUISE';
}

function step(api, dt) {
  const { robot, sensors, nav } = api;
  const t = api.world.time();
  
  // 1. Read Sensors
  const dist = sensors.frontDistance();
  const hazard = sensors.groundType();
  
  // 2. Obstacle Avoidance
  if (dist < 4.0) {
    state.mode = 'AVOID';
    api.console.log("Obstacle detected! " + dist.toFixed(1) + "m");
  } else if (dist > 6.0 && state.mode === 'AVOID') {
    state.mode = 'CRUISE';
  }
  
  // 3. Act based on mode
  if (state.mode === 'AVOID') {
    robot.setSpeed(1.0);
    // Simple bang-bang steering away
    robot.setSteer(-0.8); 
  } else {
    // Cruise behavior: Sine wave wander
    robot.setSpeed(3.0);
    robot.setSteer(Math.sin(t * 0.5) * 0.2);
  }
  
  // 4. Safety Check (Water)
  if (hazard === 'WATER') {
     robot.stop();
     api.console.log("EMERGENCY STOP: Water!");
  }
  
  // Debug visualization
  api.debug.text(robot.pose(), state.mode);
}

return { init, step };`;

export const useStore = create<AppState>((set, get) => ({
  isPlaying: true,
  setIsPlaying: (v) => set({ isPlaying: v }),
  autonomyEnabled: false,
  toggleAutonomy: () => set((state) => ({ autonomyEnabled: !state.autonomyEnabled })),
  showSensors: true,
  toggleSensors: () => set((state) => ({ showSensors: !state.showSensors })),

  // Brain Lab
  isBrainOpen: false,
  toggleBrain: () => set((state) => ({ isBrainOpen: !state.isBrainOpen })),
  userCode: DEFAULT_CODE,
  setUserCode: (code) => set({ userCode: code }),
  executionStatus: 'IDLE',
  setExecutionStatus: (s) => set({ executionStatus: s }),
  errorLog: null,
  setErrorLog: (s) => set({ errorLog: s }),
  revisions: [],
  addRevision: (rev) => set((state) => ({ revisions: [rev, ...state.revisions].slice(0, 50) })),
  revertToSafe: () => {
    const safe = get().revisions.find(r => r.status === 'SAFE');
    if (safe) {
      set({ userCode: safe.code, executionStatus: 'IDLE', errorLog: null });
    }
  },

  robotPosition: [0, 0, 0],
  setRobotPosition: (pos) => set({ robotPosition: pos }),
  robotHeading: 0,
  setRobotHeading: (rad) => set({ robotHeading: rad }),
  currentTask: 'IDLE',
  setCurrentTask: (task) => set({ currentTask: task }),

  grassDensity: 0.8,
  setGrassDensity: (v) => set({ grassDensity: v }),
  regenerateTrigger: 0,
  worldSeed: 12345,
  regenerateWorld: () => set((state) => ({ 
    regenerateTrigger: state.regenerateTrigger + 1,
    worldSeed: Math.floor(Math.random() * 100000)
  })),

  hazards: {
    water: true,
    walls: true,
    poles: true,
    ridges: true,
    rocks: true,
  },
  toggleHazard: (type) => set((state) => ({
    hazards: { ...state.hazards, [type]: !state.hazards[type] }
  })),
}));