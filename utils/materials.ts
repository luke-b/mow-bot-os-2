
import { ShaderMaterial, DoubleSide, DataTexture, RedFormat, Vector3, GLSL3 } from 'three';

// Placeholder texture
const placeholderTexture = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
placeholderTexture.needsUpdate = true;

/**
 * GPGPU Simulation Shader
 * Manages the state of the grass field:
 * R: Bend Amount (0 = straight, 1 = flat)
 * G: Bend Direction (0..1 = 0..2PI)
 * B: Cut Height (0 = cut, 1 = full)
 * A: Recovery Velocity / Elasticity state
 */
export const SimulationMaterial = new ShaderMaterial({
  uniforms: {
    tPrev: { value: null }, // Previous frame
    uTime: { value: 0 },
    uDelta: { value: 0.016 },
    uInteractPos: { value: new Vector3(0, -100, 0) }, // Robot Position
    uInteractRadius: { value: 1.0 }, // Wheel/Chassis radius
    uIsCutting: { value: false },
    uWorldSize: { value: 80 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tPrev;
    uniform float uDelta;
    uniform vec3 uInteractPos;
    uniform float uInteractRadius;
    uniform bool uIsCutting;
    uniform float uWorldSize;
    
    varying vec2 vUv;

    const float PI = 3.14159265359;

    // Helper to get world position from UV
    vec2 uvToWorld(vec2 uv) {
      return (uv - 0.5) * uWorldSize;
    }

    void main() {
      vec4 data = texture2D(tPrev, vUv);
      
      float bend = data.r;
      float dir = data.g;
      float height = data.b; // 1.0 = full height, 0.05 = cut
      float elastic = data.a;

      // 1. Recovery Logic (Viscoelastic)
      // Grass springs back up if not cut
      float recoveryRate = 2.0;
      if (bend > 0.0) {
        bend -= recoveryRate * uDelta;
        bend = max(0.0, bend);
      }

      // 2. Interaction Logic
      vec2 worldPos = uvToWorld(vUv);
      vec2 interPos = uInteractPos.xz;
      
      float dist = distance(worldPos, interPos);
      
      if (dist < uInteractRadius) {
        // Force calculation
        float force = 1.0 - smoothstep(uInteractRadius * 0.5, uInteractRadius, dist);
        
        // Push grass away from center of collider
        vec2 pushDir = normalize(worldPos - interPos);
        float pushAngle = atan(pushDir.y, pushDir.x);
        
        // Normalize angle to 0..1
        float normAngle = (pushAngle + PI) / (2.0 * PI);
        
        // Apply Bend
        // Smooth blend between existing direction and new direction based on force
        if (force > 0.1) {
            bend = max(bend, force);
            dir = normAngle; 
        }

        // Cutting Logic
        if (uIsCutting) {
            // Permanent damage to height
            // Cut down to 10%
            height = min(height, 0.1);
        }
      }

      // Initialize height if first run (detected by 0 alpha/blue usually)
      if (height == 0.0) height = 1.0;

      gl_FragColor = vec4(bend, dir, height, elastic);
    }
  `
});

/**
 * 3D Procedural Blade Material
 * Uses vertex displacement to create volume and Bezier curves for bending.
 * UPDATED: Added Specular, Translucency, and Normal calculations for realism.
 */
export const GrassBladeMaterial = new ShaderMaterial({
  uniforms: {
    time: { value: 0 },
    tSim: { value: placeholderTexture }, // Simulation texture
    worldSize: { value: 80 },
    windSpeed: { value: 1.0 },
    tipColor: { value: new Vector3(0.5, 0.7, 0.1) },
    baseColor: { value: new Vector3(0.05, 0.2, 0.01) },
    sunPosition: { value: new Vector3(100, 50, 100) }, // Matches Sky
  },
  side: DoubleSide,
  vertexShader: `
    uniform float time;
    uniform sampler2D tSim;
    uniform float worldSize;
    uniform float windSpeed;

    attribute vec3 offset;    // Position of the instance
    attribute float scale;    // Height scale
    attribute float halfWidth; // Blade width
    attribute float rotation; // Random Y rotation

    varying float vHeight;
    varying float vCut;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;

    // Rotation Matrix Helper
    mat4 rotationMatrix(vec3 axis, float angle) {
        axis = normalize(axis);
        float s = sin(angle);
        float c = cos(angle);
        float oc = 1.0 - c;
        return mat4(oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                    oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                    oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                    0.0,                                0.0,                                0.0,                                1.0);
    }

    // Bezier Quadratic with Tangent output
    void bezierFunc(vec3 p0, vec3 p1, vec3 p2, float t, out vec3 pos, out vec3 tangent) {
        float oneMinusT = 1.0 - t;
        pos = oneMinusT * oneMinusT * p0 + 2.0 * oneMinusT * t * p1 + t * t * p2;
        // Derivative (Tangent)
        tangent = normalize(2.0 * oneMinusT * (p1 - p0) + 2.0 * t * (p2 - p1));
    }

    void main() {
      // 1. Sample Simulation Texture
      vec2 worldUv = vec2(offset.x / worldSize + 0.5, offset.z / worldSize + 0.5);
      vec4 simData = texture2D(tSim, worldUv);
      
      float bendAmt = simData.r;
      float bendDir = simData.g * 2.0 * 3.14159; 
      float cutHeight = simData.b;
      if (cutHeight == 0.0) cutHeight = 1.0;

      vCut = 1.0 - cutHeight; 

      // 2. Geometry Setup
      float t = position.y; // 0 at bottom, 1 at top
      
      // Taper width - Use parabolic curve for more natural leaf shape
      float taper = 1.0 - pow(t, 2.0); // Sharper tip
      float currentWidth = halfWidth * taper;
      
      // Initial Position (Billboard facing Z)
      vec3 pos = vec3(position.x * currentWidth, 0.0, 0.0);

      // 3. Wind Animation (Multi-frequency noise)
      float windFreq = 0.5;
      float windNoise = sin(time * windSpeed * 1.0 + offset.x * 0.5 + offset.z * 0.3) 
                      + 0.5 * sin(time * windSpeed * 2.3 + offset.x * 0.2 + offset.z * 0.8);
                      
      float globalBend = windNoise * 0.1 + 0.15; 
      
      // 4. Combine Physics Bend + Wind
      float totalBend = mix(globalBend, 2.0, bendAmt);
      
      // Direction: Mix random rotation with forced bend direction
      float interactAngle = -bendDir; 
      
      float height = scale * cutHeight;
      vHeight = t;

      vec3 p0 = vec3(0.0);
      
      // Rotate the bend vector into local space relative to the blade's rotation
      float localBendDir = interactAngle - rotation;
      vec3 bendVec = vec3(sin(localBendDir), 0.0, cos(localBendDir));
      
      // Bezier Control Points
      vec3 p1 = vec3(0.0, height * 0.6, 0.0) + bendVec * totalBend * height * 0.4;
      vec3 p2 = vec3(0.0, height, 0.0) + bendVec * totalBend * height * 1.2;
      
      // Compute Curve
      vec3 curvedPos, tangent;
      bezierFunc(p0, p1, p2, t, curvedPos, tangent);
      
      pos += curvedPos;

      // 5. Transform to World
      // Instance Rotation
      mat4 rotY = rotationMatrix(vec3(0.0, 1.0, 0.0), rotation);
      
      // Compute Normal
      // Base normal for a flat blade facing Z is (0,0,1)
      // Tangent is roughly Y-up (but curved). 
      // Binormal is local X (width direction).
      vec3 binormal = vec3(1.0, 0.0, 0.0);
      
      // Rotate Tangent and Binormal by Y-rotation
      vec3 worldTangent = (rotY * vec4(tangent, 0.0)).xyz;
      vec3 worldBinormal = (rotY * vec4(binormal, 0.0)).xyz;
      
      // Normal is cross of Tangent (Up-ish) and Binormal (Right)
      // Cross(Up, Right) -> Forward (Normal)
      vNormal = normalize(cross(worldTangent, worldBinormal));

      vec4 instancePos = vec4(pos, 1.0);
      instancePos = rotY * instancePos;
      
      // Add Offset
      instancePos.xyz += offset;
      
      vWorldPosition = instancePos.xyz;
      vec4 mvPosition = viewMatrix * instancePos;
      gl_Position = projectionMatrix * mvPosition;
      
      vViewPosition = -mvPosition.xyz;
    }
  `,
  fragmentShader: `
    varying float vHeight;
    varying float vCut;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    
    uniform vec3 tipColor;
    uniform vec3 baseColor;
    uniform vec3 sunPosition;

    void main() {
      // Normalize vectors
      vec3 viewDir = normalize(vViewPosition);
      vec3 normal = normalize(vNormal);
      vec3 lightDir = normalize(sunPosition);

      // Double-sided lighting fix
      if (!gl_FrontFacing) normal = -normal;

      // 1. Base Color Mixing
      // Add some subtle noise to color based on world position to break uniformity
      float noise = sin(vWorldPosition.x * 0.5) * cos(vWorldPosition.z * 0.5);
      vec3 localBase = baseColor + vec3(0.02, 0.05, 0.0) * noise;
      vec3 localTip = tipColor + vec3(0.05, 0.05, 0.0) * noise;
      
      vec3 albedo = mix(localBase, localTip, vHeight);
      
      // Cut grass (dried out tips)
      vec3 cutColor = vec3(0.6, 0.5, 0.3);
      albedo = mix(albedo, cutColor, vCut * 0.9);

      // 2. Lighting Model
      
      // Diffuse (Lambert)
      float diff = max(dot(normal, lightDir), 0.0);
      // Soften shadows (Ambient)
      float ambient = 0.3 + 0.2 * normal.y; // Sky light from top

      // Specular (Blinn-Phong) - Grass is waxy
      vec3 halfDir = normalize(lightDir + viewDir);
      float NdotH = max(dot(normal, halfDir), 0.0);
      float spec = pow(NdotH, 32.0) * 0.3; // Shiny waxy look

      // Translucency (Backlighting) - Key for realistic grass
      // When looking against the light, grass glows
      float VdotL = max(dot(viewDir, -lightDir), 0.0);
      float translucency = pow(VdotL, 4.0) * 1.5;
      
      // Mask translucency by thickness (thick at bottom, thin at top)
      // Actually thick at bottom blocks light more, but thin tips glow more.
      translucency *= smoothstep(0.0, 1.0, vHeight);
      
      // Translucency Color (Yellow-Green glow)
      vec3 transColor = vec3(0.7, 0.8, 0.2) * translucency;

      // 3. Combine
      vec3 finalColor = albedo * (diff + ambient) + transColor + vec3(spec);

      // Fake Ambient Occlusion at the roots
      float ao = smoothstep(0.0, 0.3, vHeight);
      finalColor *= (0.3 + 0.7 * ao);

      gl_FragColor = vec4(finalColor, 1.0);
    }
  `
});

export const TerrainShaderMaterial = new ShaderMaterial({
  uniforms: {
    tSim: { value: placeholderTexture },
    worldSize: { value: 80 },
  },
  vertexShader: `
    attribute vec3 color;
    varying vec2 vUv;
    varying vec3 vPos;
    varying vec3 vColor;
    
    void main() {
      vUv = uv;
      vPos = position;
      vColor = color; 
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tSim;
    uniform float worldSize;
    
    varying vec2 vUv;
    varying vec3 vPos;
    varying vec3 vColor;

    void main() {
      vec2 worldUv = vec2(vPos.x / worldSize + 0.5, vPos.z / worldSize + 0.5);
      vec4 sim = texture2D(tSim, worldUv);
      float cut = 1.0 - sim.b; // b is height (1=full), so cut is 1-height

      vec3 dryColor = vec3(0.2, 0.25, 0.1);
      vec3 mudColor = vec3(0.12, 0.1, 0.08);
      
      vec3 finalColor = mix(dryColor, mudColor, vColor.r);

      // Detail noise
      float noise = fract(sin(dot(vPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
      finalColor += (noise - 0.5) * 0.05;

      // Mower path visualization (Mowed strips look lighter/cleaner)
      // Cut areas reveal lighter soil/stalks
      vec3 cutBaseColor = vec3(0.25, 0.35, 0.15);
      finalColor = mix(finalColor, cutBaseColor, cut * 0.7); 

      gl_FragColor = vec4(finalColor, 1.0);
    }
  `,
  vertexColors: false,
});

export const WaterShaderMaterial = new ShaderMaterial({
  uniforms: {
    time: { value: 0 },
  },
  transparent: true,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    varying vec2 vUv;
    void main() {
      float alpha = 0.6;
      vec3 color = vec3(0.0, 0.3, 0.5);
      gl_FragColor = vec4(color, alpha);
    }
  `
});
