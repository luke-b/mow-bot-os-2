
import { create } from 'zustand';

export type HazardType = 'water' | 'walls' | 'poles' | 'ridges' | 'rocks';

export interface Revision {
  id: string;
  timestamp: number;
  code: string;
  status: 'SAFE' | 'ERROR' | 'UNKNOWN';
  note?: string;
}

interface RobotStats {
    pitch: number;
    roll: number;
    isStuck: boolean;
    collision: boolean;
}

interface KpiStats {
    startTime: number;
    elapsedTime: number; // seconds
    areaMowed: number; // m^2
    totalTargetArea: number; // m^2
    efficiency: number; // m^2 per min
}

interface TelemetryFrame {
    time: number;
    [key: string]: number;
}

export interface AiLogEntry {
    timestamp: number;
    event: 'PERIODIC' | 'ALERT' | 'STOP';
    kpi: KpiStats;
    watches: Record<string, string | number>;
    robotState: RobotStats;
    message?: string;
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

  // Telemetry
  telemetryHistory: TelemetryFrame[];
  addTelemetryFrame: (frame: TelemetryFrame) => void;
  clearTelemetry: () => void;
  
  // AI Agent Context
  customWatches: Record<string, string | number>;
  setCustomWatch: (key: string, value: string | number) => void;
  aiLogs: AiLogEntry[];
  addAiLog: (entry: AiLogEntry) => void;
  clearAiLogs: () => void;

  // Robot State (for UI updates)
  robotPosition: [number, number, number];
  setRobotPosition: (pos: [number, number, number]) => void;
  robotHeading: number;
  setRobotHeading: (rad: number) => void;
  currentTask: string;
  setCurrentTask: (task: string) => void;
  
  robotStats: RobotStats;
  setRobotStats: (stats: RobotStats) => void;
  
  kpiStats: KpiStats;
  setKpiStats: (stats: Partial<KpiStats>) => void;
  resetKpi: () => void;

  // World Settings
  grassDensity: number;
  setGrassDensity: (v: number) => void;
  terrainRoughness: number;
  setTerrainRoughness: (v: number) => void;
  regenerateTrigger: number;
  worldSeed: number;
  regenerateWorld: () => void;
  
  // Hazards
  hazards: Record<HazardType, boolean>;
  toggleHazard: (type: HazardType) => void;
}

const DEFAULT_CODE = `// 🧠 Dynamic Polygon Mowing Pattern
// 5ms CPU Budget per tick.

let state = {
  path: [],
  pathIndex: 0,
  finished: false,
  status: "INIT",
  zone: []
};

function init(api) {
  api.console.log("Reading Field Data...");
  
  // Fetch dynamic zone from world
  const zone = api.world.getMowingZone();
  state.zone = zone;
  
  if (!zone || zone.length < 3) {
      api.console.log("No valid zone found!");
      state.finished = true;
      return;
  }

  // Generate Coverage Path (0.8m width)
  api.console.log("Planning coverage for " + zone.length + " vertex polygon...");
  state.path = api.nav.planCoverage(zone, 0.8);
  state.pathIndex = 0;
  state.finished = false;
  state.status = "MOWING";
  
  // Set a custom watch for the dashboard
  api.telemetry.watch("Zone Vertices", zone.length);
}

function step(api, dt) {
  const { robot, nav, debug, telemetry } = api;
  const pose = robot.pose();

  // 1. Visualization
  // Draw the calculated mowing path
  if (state.path.length > 0) {
      debug.path(state.path); 
  } else if (state.zone.length > 0) {
      // Fallback to zone if path generation failed
      debug.path([...state.zone, state.zone[0]]);
  }
  
  if (state.finished) {
      robot.stop();
      debug.text(pose, "JOB DONE");
      telemetry.watch("Status", "DONE");
      return;
  }
  
  telemetry.watch("Status", "MOWING");

  // 2. Path Following Logic (Pure Pursuit)
  const target = state.path[state.pathIndex];
  if (!target) {
      state.finished = true;
      return;
  }

  // Distance to current waypoint
  const dist = Math.sqrt((target.x - pose.x)**2 + (target.z - pose.z)**2);
  
  // Custom Watch: Distance to next point
  telemetry.watch("WP Dist", dist.toFixed(2) + "m");
  
  // Check if we reached the waypoint (0.6m tolerance)
  if (dist < 0.6) {
      state.pathIndex++;
      if (state.pathIndex >= state.path.length) {
          state.finished = true;
      }
  }

  // Calculate Steering
  const dx = target.x - pose.x;
  const dz = target.z - pose.z;
  const desiredHeading = Math.atan2(dx, dz);
  
  // Error (-PI to PI)
  let headingErr = desiredHeading - pose.heading;
  while (headingErr > Math.PI) headingErr -= 2*Math.PI;
  while (headingErr < -Math.PI) headingErr += 2*Math.PI;
  
  // P-Controller
  const steer = headingErr * 2.0;
  const speed = 3.0;
  
  // Simple Obstacle Avoidance Override
  const frontDist = api.sensors.frontDistance();
  
  // Watch sensor data
  telemetry.watch("Front Sensor", frontDist.toFixed(1) + "m");
  
  if (frontDist < 1.5) {
      // Something in front! Turn away
      robot.setSpeed(-1.0); // Back up slightly
      robot.setSteer(headingErr > 0 ? -1.0 : 1.0); // Turn away from target temporarily
      telemetry.watch("Mode", "AVOIDANCE");
  } else {
      // 3. Actuate
      robot.setSpeed(speed);
      robot.setSteer(steer);
      telemetry.watch("Mode", "CRUISE");
  }
  
  // 4. Telemetry
  debug.text(pose, \`WP \${state.pathIndex}/\${state.path.length}\`);
  telemetry.log('heading_error', headingErr);
  telemetry.log('dist_to_wp', dist);
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

  // Telemetry
  telemetryHistory: [],
  addTelemetryFrame: (frame: TelemetryFrame) => set((state) => {
      const history = state.telemetryHistory;
      // Keep last 600 frames (~10 seconds at 60fps)
      if (history.length > 600) {
          return { telemetryHistory: [...history.slice(1), frame] };
      }
      return { telemetryHistory: [...history, frame] };
  }),
  clearTelemetry: () => set({ telemetryHistory: [] }),
  
  // AI Agent & Watches
  customWatches: {},
  setCustomWatch: (key, value) => set(state => ({ customWatches: { ...state.customWatches, [key]: value } })),
  aiLogs: [],
  addAiLog: (entry) => set(state => ({ aiLogs: [entry, ...state.aiLogs].slice(0, 50) })), // Keep last 50 logs
  clearAiLogs: () => set({ aiLogs: [] }),

  robotPosition: [0, 0, 0],
  setRobotPosition: (pos) => set({ robotPosition: pos }),
  robotHeading: 0,
  setRobotHeading: (rad) => set({ robotHeading: rad }),
  currentTask: 'IDLE',
  setCurrentTask: (task) => set({ currentTask: task }),
  
  robotStats: { pitch: 0, roll: 0, isStuck: false, collision: false },
  setRobotStats: (stats) => set({ robotStats: stats }),

  kpiStats: { startTime: 0, elapsedTime: 0, areaMowed: 0, totalTargetArea: 1, efficiency: 0 },
  setKpiStats: (stats) => set((state) => ({ kpiStats: { ...state.kpiStats, ...stats } })),
  resetKpi: () => set((state) => ({ 
      kpiStats: { ...state.kpiStats, startTime: 0, elapsedTime: 0, areaMowed: 0, efficiency: 0 },
      customWatches: {} // Also reset watches on new run
  })),

  grassDensity: 0.8,
  setGrassDensity: (v) => set({ grassDensity: v }),
  terrainRoughness: 1.0,
  setTerrainRoughness: (v) => set({ terrainRoughness: v }),
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
