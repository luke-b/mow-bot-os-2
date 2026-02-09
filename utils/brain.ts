import { Vector3 } from 'three';

export interface BrainAPI {
  robot: {
    pose: () => { x: number; y: number; z: number; heading: number };
    velocity: () => { speed: number; steer: number };
    setSpeed: (v: number) => void;
    setSteer: (r: number) => void;
    stop: () => void;
  };
  world: {
    time: () => number;
    dt: () => number;
    boundary: () => { width: number; depth: number };
  };
  sensors: {
    frontDistance: () => number; // Raycast result
    groundType: () => 'GROUND' | 'WATER' | 'OBSTACLE';
    gps: () => { x: number; z: number };
  };
  nav: {
    // Placeholder for future nav helpers
    distanceTo: (x: number, z: number) => number;
  };
  console: {
    log: (msg: string) => void;
  };
  debug: {
    text: (pos: {x:number, y:number, z:number}, msg: string) => void;
  }
}

export class BrainExecutor {
  private initFn: ((api: BrainAPI) => void) | null = null;
  private stepFn: ((api: BrainAPI, dt: number) => void) | null = null;
  private api: BrainAPI | null = null;
  
  compile(code: string): { success: boolean; error?: string } {
    try {
      // Wrap code in a factory to isolate scope
      // We expect the user code to "return { init, step }" at the end
      const factory = new Function(code);
      const result = factory();
      
      if (!result || typeof result.step !== 'function') {
        return { success: false, error: "Code must return an object with a 'step' function." };
      }

      this.initFn = result.init || (() => {});
      this.stepFn = result.step;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.toString() };
    }
  }

  init(api: BrainAPI) {
    this.api = api;
    if (this.initFn) {
      try {
        this.initFn(this.api);
      } catch (e) {
        console.error("Brain Init Error", e);
      }
    }
  }

  step(dt: number) {
    if (this.stepFn && this.api) {
      this.stepFn(this.api, dt);
    }
  }
}