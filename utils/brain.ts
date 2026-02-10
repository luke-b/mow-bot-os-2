
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
    getMowingZone: () => {x: number, z: number}[];
  };
  sensors: {
    frontDistance: () => number; // Raycast result
    groundType: () => 'GROUND' | 'WATER' | 'OBSTACLE';
    gps: () => { x: number; z: number };
  };
  nav: {
    distanceTo: (x: number, z: number) => number;
    /**
     * Generates a lawnmower pattern path inside a polygon.
     * @param polygon Array of {x, z} vertices
     * @param toolWidth Width between passes (meters)
     */
    planCoverage: (polygon: {x:number, z:number}[], toolWidth: number) => {x:number, z:number}[];
  };
  telemetry: {
    log: (key: string, value: number) => void;
    /**
     * Add a custom metric to the KPI Dashboard and AI Log.
     * @param key Label for the metric
     * @param value Value to display
     */
    watch: (key: string, value: string | number) => void;
  };
  console: {
    log: (msg: string) => void;
  };
  debug: {
    text: (pos: {x:number, y:number, z:number}, msg: string) => void;
    /**
     * Draw a path line in the world and on the costmap.
     * @param points Array of {x, z} world coordinates
     */
    path: (points: {x:number, z:number}[]) => void;
  }
}

// Geometry Helpers
function getPolygonBounds(poly: {x:number, z:number}[]) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    poly.forEach(p => {
        if(p.x < minX) minX = p.x;
        if(p.x > maxX) maxX = p.x;
        if(p.z < minZ) minZ = p.z;
        if(p.z > maxZ) maxZ = p.z;
    });
    return { minX, maxX, minZ, maxZ };
}

function intersectLine(zLine: number, p1: {x:number, z:number}, p2: {x:number, z:number}): number | null {
    if ((p1.z > zLine && p2.z > zLine) || (p1.z < zLine && p2.z < zLine)) return null;
    if (p1.z === p2.z) return null; // Parallel to scan line
    const t = (zLine - p1.z) / (p2.z - p1.z);
    return p1.x + t * (p2.x - p1.x);
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
    // Inject geometric planner logic
    this.api.nav.planCoverage = (polygon, width) => {
        if (!polygon || polygon.length < 3) return [];
        
        const bounds = getPolygonBounds(polygon);
        const path: {x:number, z:number}[] = [];
        let movingRight = true;

        // Scan along Z axis
        for (let z = bounds.minZ + width/2; z < bounds.maxZ; z += width) {
            const intersections: number[] = [];
            
            // Check all edges
            for (let i = 0; i < polygon.length; i++) {
                const p1 = polygon[i];
                const p2 = polygon[(i + 1) % polygon.length];
                const x = intersectLine(z, p1, p2);
                if (x !== null) intersections.push(x);
            }
            
            intersections.sort((a, b) => a - b);

            // Add pairs of points
            for (let i = 0; i < intersections.length; i += 2) {
                if (i + 1 >= intersections.length) break;
                const x1 = intersections[i];
                const x2 = intersections[i+1];
                
                if (movingRight) {
                    path.push({ x: x1, z: z });
                    path.push({ x: x2, z: z });
                } else {
                    path.push({ x: x2, z: z });
                    path.push({ x: x1, z: z });
                }
            }
            movingRight = !movingRight;
        }
        return path;
    };

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
