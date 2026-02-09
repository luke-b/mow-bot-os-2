import { ShaderMaterial, Color, DoubleSide, Texture } from 'three';

export const GrassShaderMaterial = new ShaderMaterial({
  uniforms: {
    time: { value: 0 },
    cutMap: { value: null },
    worldSize: { value: 80 },
    windSpeed: { value: 1.0 },
  },
  vertexShader: `
    uniform float time;
    uniform sampler2D cutMap;
    uniform float worldSize;
    uniform float windSpeed;

    varying float vCut;
    varying float vTip;
    varying vec2 vUv;

    void main() {
      vUv = uv;
      vec3 pos = position;

      // World position of blade root (from instance matrix)
      vec3 root = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

      // Sample cut map in XZ world space (Simple 0..1 mapping)
      // root.x/z are +/- worldSize/2
      vec2 worldUv = vec2(root.x / worldSize + 0.5, root.z / worldSize + 0.5);
      
      float cut = texture2D(cutMap, worldUv).r; // 0..1
      vCut = cut;

      // Shorten blades where cut; 
      // mix(1.0, 0.05, cut) means fully cut grass is 5% original height
      float stubble = mix(1.0, 0.05, cut);
      pos.y *= stubble;

      // Wind sway stronger near tip
      float tip = clamp(pos.y, 0.0, 1.0);
      vTip = tip;
      
      float swayPhase = root.x * 0.5 + root.z * 0.3;
      float sway = sin(time * windSpeed + swayPhase) * 0.1;
      float sway2 = cos(time * windSpeed * 0.7 + swayPhase) * 0.05;
      
      // Reduce sway if cut (stiffer look)
      float swayFactor = mix(1.0, 0.1, cut);
      
      pos.x += sway * tip * swayFactor;
      pos.z += sway2 * tip * swayFactor;

      // Apply instance transform
      vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    varying float vCut;
    varying float vTip;

    void main() {
      // Base grass color gradient
      vec3 bottomColor = vec3(0.15, 0.35, 0.1);
      vec3 topColor = vec3(0.4, 0.7, 0.2);
      
      // Cut grass looks a bit more yellow/dry/flat
      vec3 cutColor = vec3(0.25, 0.4, 0.15);

      vec3 color = mix(bottomColor, topColor, vTip);
      
      // Apply cut tint heavily
      color = mix(color, cutColor, vCut);
      
      // Fake ambient occlusion at bottom
      color *= mix(0.5, 1.0, vTip);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
  side: DoubleSide,
});

export const TerrainShaderMaterial = new ShaderMaterial({
  uniforms: {
    cutMap: { value: null },
    worldSize: { value: 80 },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vPos;
    varying vec3 vColor;
    
    void main() {
      vUv = uv;
      vPos = position;
      vColor = color; // From BufferAttribute
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D cutMap;
    uniform float worldSize;
    
    varying vec2 vUv;
    varying vec3 vPos;
    varying vec3 vColor;

    void main() {
      // Map world position to 0..1 UV for cut map
      vec2 worldUv = vec2(vPos.x / worldSize + 0.5, vPos.z / worldSize + 0.5);
      float cut = texture2D(cutMap, worldUv).r;

      // vColor mapping:
      // R: Wetness/Mud (Darker, smoother)
      // G: Base Ground (Brown/Green mix)
      // B: Obstruction/Hazard highlight (optional)

      vec3 dryColor = vec3(0.25, 0.3, 0.15); // Grassy soil
      vec3 mudColor = vec3(0.15, 0.1, 0.05); // Dark mud
      
      // Base mix based on "Mud" channel (R)
      vec3 finalColor = mix(dryColor, mudColor, vColor.r);

      // Noise-like variation
      float noise = fract(sin(dot(vPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
      finalColor += (noise - 0.5) * 0.05;

      // Mower path visualization
      vec3 cutBaseColor = vec3(0.22, 0.42, 0.18);
      finalColor = mix(finalColor, cutBaseColor, cut * 0.5); 

      gl_FragColor = vec4(finalColor, 1.0);
    }
  `,
  vertexColors: true,
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
      // Simple animated blue
      float alpha = 0.6;
      vec3 color = vec3(0.0, 0.3, 0.5);
      gl_FragColor = vec4(color, alpha);
    }
  `
});