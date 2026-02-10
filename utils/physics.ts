
import { Vector3, Quaternion, Matrix4, MathUtils } from 'three';
import { WorldData, ObstacleData } from '../components/Terrain';

export interface VehicleConfig {
  mass: number;
  width: number;
  length: number;
  wheelRadius: number;
  suspensionRestLength: number;
  stiffness: number;
  damping: number;
  friction: number;
  maxSteer: number;
  maxSpeed: number;
}

export interface VehicleInputs {
  throttle: number; // -1 to 1
  steer: number;    // -1 to 1 (full left to full right)
  brake: number;    // 0 to 1
}

export interface WheelState {
  position: Vector3; // World pos
  compression: number; // 0 to 1 (1 is fully compressed)
  grounded: boolean;
  skid: number; // 0 to 1 intensity
}

export class VehiclePhysics {
  // Rigid Body State
  position = new Vector3();
  quaternion = new Quaternion();
  velocity = new Vector3();
  angularVelocity = new Vector3();

  // Derived / Temp
  matrix = new Matrix4();
  wheels: WheelState[] = [];
  
  // Accumulated forces
  force = new Vector3();
  torque = new Vector3();

  config: VehicleConfig;
  
  // Status
  speed = 0;
  isStuck = false;
  stuckTimer = 0;
  collisionImpact = 0;

  // Wheel mount points relative to center (FL, FR, RL, RR)
  private mountPoints: Vector3[];

  constructor(startPos: Vector3, startHeading: number) {
    this.position.copy(startPos);
    this.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), startHeading);
    
    // Tuned for ~50kg mower
    this.config = {
      mass: 50,
      width: 0.9,
      length: 1.0,
      wheelRadius: 0.2,
      suspensionRestLength: 0.25,
      stiffness: 3000, 
      damping: 300,    
      friction: 6.0,   
      maxSteer: 0.6,   
      maxSpeed: 4.0,   
    };

    const w = this.config.width / 2;
    const l = this.config.length / 2;
    const h = 0.1; // Mount height offset

    this.mountPoints = [
      new Vector3(-w, h, -l), // FL
      new Vector3( w, h, -l), // FR
      new Vector3(-w, h,  l), // RL
      new Vector3( w, h,  l), // RR
    ];

    // Init wheel states
    for(let i=0; i<4; i++) {
      this.wheels.push({ position: new Vector3(), compression: 0, grounded: false, skid: 0 });
    }
  }

  teleport(pos: Vector3, heading: number) {
      this.position.copy(pos);
      this.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), heading);
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.speed = 0;
      this.isStuck = false;
  }

  update(dt: number, inputs: VehicleInputs, world: WorldData) {
    this.force.set(0, -9.81 * this.config.mass, 0); // Reset forces to Gravity
    this.torque.set(0, 0, 0);

    this.matrix.makeRotationFromQuaternion(this.quaternion);
    this.matrix.setPosition(this.position);

    const chassisForward = new Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    const chassisRight = new Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const chassisUp = new Vector3(0, 1, 0).applyQuaternion(this.quaternion);

    let groundedCount = 0;

    // 1. Suspension & Traction Forces
    this.mountPoints.forEach((localMount, i) => {
      // Calc world position of mount
      const mountPos = localMount.clone().applyMatrix4(this.matrix);
      
      // Raycast down
      const rayDir = chassisUp.clone().negate();
      const maxDist = this.config.suspensionRestLength + this.config.wheelRadius;
      
      // Sample Terrain Height
      const terrainY = world.getHeight(mountPos.x, mountPos.z);
      const distToGround = mountPos.y - terrainY;

      // Wheel visual position
      const wheelState = this.wheels[i];
      
      if (distToGround < maxDist) { // Grounded
        wheelState.grounded = true;
        groundedCount++;
        
        const compressionDist = maxDist - distToGround;
        
        // Visual Compression (0..1)
        wheelState.compression = MathUtils.clamp(compressionDist / this.config.suspensionRestLength, 0, 1);

        // Spring Force: k * x
        const springForceMag = this.config.stiffness * compressionDist;
        
        // Damping Force: -c * v_up
        // Get velocity of the mount point
        const pointVel = this.velocity.clone().add(this.angularVelocity.clone().cross(localMount.clone().applyQuaternion(this.quaternion)));
        
        // Project velocity onto the Up vector (Suspension Axis)
        const velUp = pointVel.dot(chassisUp);
        const dampForceMag = -this.config.damping * velUp;

        const totalSuspensionForce = Math.max(0, springForceMag + dampForceMag); 
        const forceVec = chassisUp.clone().multiplyScalar(totalSuspensionForce);

        // Apply Suspension
        this.applyForce(forceVec, mountPos);

        // --- Traction ---
        // Get local surface properties
        const tractionFactor = world.getTraction(mountPos.x, mountPos.z);
        
        // Steering
        const isFront = i < 2;
        const steerAngle = isFront ? inputs.steer * -this.config.maxSteer : 0;
        
        // Calc Wheel Direction Vectors
        // Rotate chassis forward/right by steer angle
        const steerRot = new Quaternion().setFromAxisAngle(chassisUp, steerAngle);
        const wheelForward = chassisForward.clone().applyQuaternion(steerRot);
        const wheelRight = chassisRight.clone().applyQuaternion(steerRot);

        // Velocity at contact point
        const tireVel = pointVel.clone();
        
        // Lateral Friction
        const velRight = tireVel.dot(wheelRight);
        const sideForceMag = -velRight * this.config.friction * (this.config.mass / 4) * tractionFactor;
        
        const contactPos = mountPos.clone().sub(chassisUp.clone().multiplyScalar(this.config.wheelRadius));
        this.applyForce(wheelRight.multiplyScalar(sideForceMag), contactPos);

        // Longitudinal Force (Drive/Brake)
        const velForward = tireVel.dot(wheelForward);
        let driveForceMag = 0;
        
        if (inputs.throttle !== 0) {
           const maxDrive = this.config.mass * 8.0 * tractionFactor; 
           driveForceMag = inputs.throttle * maxDrive;
           
           // Simple speed limit
           if (velForward > this.config.maxSpeed && driveForceMag > 0) driveForceMag = 0;
           if (velForward < -this.config.maxSpeed && driveForceMag < 0) driveForceMag = 0;
        }

        // Brakes
        if (inputs.throttle === 0 || inputs.brake > 0) {
             const brakeIntensity = inputs.brake > 0 ? inputs.brake * 30 : 2.0;
             driveForceMag = -velForward * brakeIntensity * (this.config.mass/4);
        }

        this.applyForce(wheelForward.multiplyScalar(driveForceMag), contactPos);
        
        wheelState.skid = Math.min(1, (Math.abs(velRight) + Math.abs(driveForceMag/500)) / 5);

        // Visual Wheel Position
        wheelState.position.copy(mountPos).add(rayDir.multiplyScalar(distToGround - this.config.wheelRadius));
        
      } else {
        // Air
        wheelState.grounded = false;
        wheelState.compression = 0;
        wheelState.skid = 0;
        wheelState.position.copy(mountPos).add(rayDir.multiplyScalar(this.config.suspensionRestLength));
      }
    });

    // 2. Vegetable Drag (Grass Resistance)
    // Fd = Cd * Density * H^2 * v
    if (groundedCount > 0) {
        // Check center of robot for grass height
        const grassH = world.getGrassHeight ? world.getGrassHeight(this.position.x, this.position.z) : 1.0;
        // Cd constant tuned for feel
        const dragCoeff = 10.0; 
        const speed = this.velocity.length();
        
        if (speed > 0.1 && grassH > 0.1) {
            const dragMag = dragCoeff * (grassH * grassH) * speed;
            const dragForce = this.velocity.clone().normalize().multiplyScalar(-dragMag);
            this.force.add(dragForce);
        }
    }

    // 3. Obstacle Collision
    this.collisionImpact *= 0.9;
    world.obstacles.forEach(obs => {
        const toObs = this.position.clone().sub(obs.position);
        const myRadius = 0.6; 
        
        if (obs.type === 'WALL') {
            const localP = this.position.clone().sub(obs.position);
            const limitX = obs.size.x/2 + myRadius;
            const limitZ = obs.size.z/2 + myRadius;
            
            if (Math.abs(localP.x) < limitX && Math.abs(localP.z) < limitZ) {
                 const pushX = Math.abs(localP.x) / limitX;
                 const pushZ = Math.abs(localP.z) / limitZ;
                 
                 const normal = new Vector3();
                 if (pushX > pushZ) normal.set(Math.sign(localP.x), 0, 0);
                 else normal.set(0, 0, Math.sign(localP.z));
                 
                 this.resolveCollision(normal, 0.2);
            }
        } else {
            const obsRadius = Math.max(obs.size.x, obs.size.z) * 0.5 + 0.2;
            const dist = new Vector3(toObs.x, 0, toObs.z).length();
            if (dist < myRadius + obsRadius) {
                const normal = toObs.clone().normalize();
                normal.y = 0; 
                this.resolveCollision(normal, 0.5);
            }
        }
    });

    // 4. Integration
    const accel = this.force.divideScalar(this.config.mass);
    this.velocity.add(accel.multiplyScalar(dt));
    
    // Angular
    // Simple box inertia
    const inertia = this.config.mass * (this.config.width**2 + this.config.length**2) / 12;
    const angAccel = this.torque.divideScalar(inertia);
    this.angularVelocity.add(angAccel.multiplyScalar(dt));

    // Damping
    this.velocity.multiplyScalar(0.998);
    this.angularVelocity.multiplyScalar(0.95);

    this.position.add(this.velocity.clone().multiplyScalar(dt));
    
    // Rotation Update
    const axis = this.angularVelocity.clone().normalize();
    const angle = this.angularVelocity.length() * dt;
    if (angle > 0.000001) {
        const dq = new Quaternion().setFromAxisAngle(axis, angle);
        this.quaternion.multiply(dq).normalize();
    }
    
    // Belly Constraint
    const groundY = world.getHeight(this.position.x, this.position.z);
    if (this.position.y < groundY + 0.15) {
        const pen = (groundY + 0.15) - this.position.y;
        this.velocity.y += pen * 5.0 * dt; 
        this.velocity.multiplyScalar(0.9); 
        this.position.y += pen * 0.1; 
        
        if (this.velocity.y < 0) this.velocity.y = 0; 
    }

    this.speed = this.velocity.length();
    
    // Stuck Logic
    if (Math.abs(inputs.throttle) > 0.5 && this.speed < 0.2) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 2.0) this.isStuck = true;
    } else {
        this.stuckTimer = 0;
        this.isStuck = false;
    }
  }

  private applyForce(force: Vector3, pos: Vector3) {
    this.force.add(force);
    const arm = pos.clone().sub(this.position);
    this.torque.add(arm.cross(force));
  }

  private resolveCollision(normal: Vector3, restitution: number) {
     const vRel = this.velocity.dot(normal);
     if (vRel < 0) {
         const j = -(1 + restitution) * vRel;
         this.velocity.add(normal.multiplyScalar(j));
         this.collisionImpact = Math.abs(j);
         this.position.add(normal.multiplyScalar(0.02));
     }
  }

  getTransform() {
      return { position: this.position, quaternion: this.quaternion };
  }
}
