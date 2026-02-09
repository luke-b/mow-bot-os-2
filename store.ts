import { create } from 'zustand';
import { Vector3 } from 'three';

interface AppState {
  // Autonomy Settings
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  autonomyEnabled: boolean;
  toggleAutonomy: () => void;
  showSensors: boolean;
  toggleSensors: () => void;
  
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
  regenerateWorld: () => void;
}

export const useStore = create<AppState>((set) => ({
  isPlaying: true,
  setIsPlaying: (v) => set({ isPlaying: v }),
  autonomyEnabled: false,
  toggleAutonomy: () => set((state) => ({ autonomyEnabled: !state.autonomyEnabled })),
  showSensors: true,
  toggleSensors: () => set((state) => ({ showSensors: !state.showSensors })),

  robotPosition: [0, 0, 0],
  setRobotPosition: (pos) => set({ robotPosition: pos }),
  robotHeading: 0,
  setRobotHeading: (rad) => set({ robotHeading: rad }),
  currentTask: 'IDLE',
  setCurrentTask: (task) => set({ currentTask: task }),

  grassDensity: 0.8,
  setGrassDensity: (v) => set({ grassDensity: v }),
  regenerateTrigger: 0,
  regenerateWorld: () => set((state) => ({ regenerateTrigger: state.regenerateTrigger + 1 })),
}));
