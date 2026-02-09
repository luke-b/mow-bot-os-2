# 🚜 MowBot Autonomous Simulator

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.1-green.svg)
![Tech](https://img.shields.io/badge/tech-React%20%7C%20Three.js%20%7C%20R3F-orange.svg)

**MowBot Sim** is a lightweight, browser-based robotics simulator designed to prototype autonomous navigation logic in a procedural outdoor environment. It features realistic grass rendering, physics-based terrain interaction, simulated perception sensors, and an in-browser IDE ("Brain Lab") for writing custom control algorithms.

---

## ✨ Key Features

### 🌍 Procedural World
*   **Dynamic Terrain**: Generates infinite variations of rolling hills, ridges, and slopes using noise algorithms.
*   **Hazards System**: Toggleable environmental challenges including:
    *   💧 **Water/Ponds**: Deep depressions that cause the robot to sink/stall.
    *   🧱 **Walls**: Static obstacles for lidar testing.
    *   ⚡ **Poles**: Thin obstacles requiring precise avoidance.
    *   🪨 **Rocks**: Scattered debris.
*   **Interactive Grass**: Hundreds of thousands of instanced grass blades that react to wind and can be permanently "cut" by the mower.

### 🤖 Robot Simulation
*   **Kinematics**: Ackermann-like steering model with traction loss on mud/water.
*   **Perception Suite**:
    *   **RGB Camera**: Front-facing visual feed.
    *   **Depth Camera**: Depth-buffer visualization.
    *   **Costmap**: Top-down 2D occupancy grid generated from simulated lidar/proximity data.
*   **Physics**: Simple raycast suspension and surface normal alignment.

### 🧠 The Brain Lab (IDE)
*   **Live Coding**: Write JavaScript control logic directly in the browser.
*   **Hot-Reloading**: Deploy code changes instantly without reloading the scene.
*   **Safety Sandbox**: Execution is monitored; if your code crashes or times out (>5ms/tick), the simulated safety system halts the robot.
*   **Revision History**: Automatically saves runs and lets you revert to the last known "Safe" state.

---

## 🚀 Quick Start

### Prerequisites
*   Node.js (v16+)
*   npm or yarn

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-username/mowbot-sim.git
    cd mowbot-sim
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Run the development server**
    ```bash
    npm run dev
    ```

4.  Open `http://localhost:5173` in your browser.

---

## 🎮 User Guide

### Dashboard Controls
*   **Engage/Stop Autonomy**: Toggles the active control script.
*   **Regen World**: Generates a new random seed for terrain and obstacle placement.
*   **Hazards**: Toggle specific environmental features (Water, Walls, etc.) to test robustness.
*   **Show Sensor Feed**: Displays the raw RGB, Depth, and Costmap textures in a HUD.

### Camera Controls
*   **Left Click + Drag**: Rotate camera.
*   **Right Click + Drag**: Pan camera.
*   **Scroll**: Zoom in/out.

### Using the Brain Lab
1.  Click **OPEN BRAIN LAB** in the bottom right.
2.  The editor opens with a default "Cruise" script.
3.  Modify the `step(api, dt)` function to change behavior.
4.  Click **▶ DEPLOY & RUN** to upload the code to the robot.
5.  Check the **API** tab for documentation on available sensors and actuators.

---

## 💻 Developer Guide

### Project Structure
```
src/
├── components/
│   ├── BrainLab.tsx      # The IDE UI and logic
│   ├── Dashboard.tsx     # Overlay UI (HUD, Buttons)
│   ├── Robot.tsx         # Robot mesh, physics, and sensor rendering
│   ├── Scene.tsx         # Main R3F Canvas setup
│   └── Terrain.tsx       # Procedural generation & grass logic
├── utils/
│   ├── brain.ts          # Safe code execution wrapper (Sandbox)
│   └── materials.ts      # Custom shaders (Grass, Terrain)
├── store.ts              # Global state (Zustand)
└── App.tsx               # Entry point
```

### Architecture Overview

#### 1. Terrain & Grass System (`Terrain.tsx`, `materials.ts`)
*   **Heightfield**: Generated using Perlin-like noise.
*   **Grass Instancing**: We use `THREE.InstancedMesh` for performance.
*   **The "Cut Map"**: A global `DataTexture` (Red channel) represents the mowed state of the field.
    *   The Robot updates this texture based on its position.
    *   The `GrassShaderMaterial` reads this texture in the vertex shader to scale down grass blades (y-axis) at specific UV coordinates.

#### 2. Robot Perception (`Robot.tsx`)
*   **Sensors**: We use `useFBO` (Frame Buffer Objects) to render the scene from the robot's perspective into textures.
    *   *RGB*: Standard render.
    *   *Depth*: Renders scene with `MeshDepthMaterial`.
*   **Costmap**: Generated dynamically on a 2D HTML Canvas by projecting known obstacle positions relative to the robot's heading, then used as a texture.

#### 3. Brain Execution (`utils/brain.ts`)
*   User code is wrapped in a `Function` constructor to isolate scope.
*   We enforce a strict interface (`BrainAPI`) to prevent access to the DOM or React internals.
*   Execution is time-boxed; if `step()` takes >5ms, the simulator throws a timeout error to maintain frame rate.

### Customizing the API
To expose new sensors to the Brain Lab:
1.  Update `BrainAPI` interface in `utils/brain.ts`.
2.  Implement the logic in `Robot.tsx` inside the `api` object construction.
3.  Update the documentation in `BrainLab.tsx` (API tab).

---

## 📚 Brain API Reference

Your script must return an object `{ init, step }`.

### `init(api)`
Called once when the script is deployed. Use this to reset state variables.

### `step(api, dt)`
Called every physics frame (approx. 60Hz).

| Namespace | Method | Description |
|-----------|--------|-------------|
| **robot** | `pose()` | Returns `{x, y, z, heading}` |
| | `setSpeed(v)` | Set target speed (m/s) |
| | `setSteer(rad)` | Set steering angle (radians) |
| **sensors** | `frontDistance()` | Raycast distance in meters (0-10m) |
| | `groundType()` | Returns `'GROUND'`, `'WATER'`, or `'OBSTACLE'` |
| | `gps()` | Returns `{x, z}` (Noisy simulated GPS) |
| **world** | `time()` | Total simulation time |
| **debug** | `text(pos, msg)` | Draw 3D text in the world |
| | `console.log(msg)` | Print to internal log |

---

## 📄 License

This project is open-source and available under the **MIT License**.
