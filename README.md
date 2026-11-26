# WebGL Portals POC (Three.js)

A real-time, non-Euclidean portal rendering engine built with **Three.js** and **WebGL**.

Features recursive portal-in-portal rendering, custom screen-space GLSL shaders, Eric Lengyel's oblique near-plane clipping algorithm, and continuous-collision player teleportation.

---

## Quick Start

No package manager or build step required. Because ES modules require HTTP/HTTPS to load, serve the folder with any static web server:

```bash
# Using Python:
python -m http.server 8000

# Or using npx:
npx serve .
```

Then open `http://localhost:8000` in your browser.

---

## Controls

| Key / Action | Function |
| :--- | :--- |
| **W, A, S, D** / Arrows | Move forward, backward, and strafe left/right |
| **Mouse Click + Drag** | Look around (FPS camera) |
| **O** | Toggle **Oblique Near-Plane Clipping** (watch the red occluders behind walls!) |
| **1 – 5** | Change **Portal Recursion Depth** (1 = single view, 5 = deep reflections) |
| **C** / HUD buttons | Cycle the 3 showcase **chambers** (Oblique Lab, Infinite Mirror Hallway, Split Glass) |
| **V** | Toggle the **Bird's-Eye Debug View** (player + virtual camera frustums, first-person inset) |
| **Q / E**, Mouse Wheel | Orbit / zoom the Bird's-Eye camera (WASD and drag still drive the player) |
| **R** | Respawn at the current chamber's start position |
| **L** | Toggle **recursion level colors** (level 1 blue, 2 green, 3 yellow, 4 magenta, 5 red) |
| **B** | Toggle **see yourself**: your body is visible through portals (never in your own view) |
| **M** | Toggle the live **projection matrix readout** (row 3, standard vs. oblique) |
| **H** | Hide / show the HUD |
| `?chamber=1..3` | URL parameter to start in a specific chamber (e.g. `http://localhost:8000/?chamber=3`) |
| **F12 / Console** | Inspect `window.game` (scene, portals, player, renderer) |

---

## Architecture & Code Layout

```
src/
├── main.js                  # Engine entry point, animation loop & system wiring
├── config.js                # Centralized game constants & tunable parameters
├── portal/
│   ├── Portal.js            # Portal entity, coordinate transformations & crossing detection
│   ├── PortalRenderer.js    # Recursive Depth-First rendering & RenderTarget pooling
│   ├── obliqueClipping.js   # Eric Lengyel's projection matrix modification algorithm
│   └── portalShader.js      # Screen-space sampling GLSL vertex & fragment shaders
├── player/
│   ├── Player.js            # First-person camera, kinematics & seamless teleportation
│   ├── Avatar.js            # Player body (seen through portals and in Bird's-Eye view)
│   └── Input.js             # Keyboard and mouse pointer event handling
├── world/
│   ├── room.js              # Color-coded room shell, wall & glass-divider collision
│   ├── props.js             # Reusable prop/light builders (knot, cubes, decoys, glass)
│   ├── chambers.js          # The 3 showcase chamber presets (data + build functions)
│   └── ChamberManager.js    # Chamber loading/disposal, portal placement, collision
├── debug/
│   ├── BirdsEyeView.js      # Overview camera, frustum gizmos & first-person inset
│   ├── FrustumGizmo.js      # Frustum wireframe cut by the oblique clip plane
│   └── ProjectionReadout.js # Live HUD readout of projection matrix row 3
└── ui/
    └── Hud.js               # Diagnostic HUD overlay & chamber buttons
```

---

## Key Technical Highlights

1. **Change-of-Basis Matrix Math (`Portal.mapMatrix`)**
   Transforms virtual cameras and players through the portal doorway using:
   $$\mathbf{M}_{\text{out}} = \mathbf{M}_{\text{exit}} \cdot \mathbf{R}_Y(180^\circ) \cdot \mathbf{M}_{\text{entrance}}^{-1} \cdot \mathbf{M}_{\text{in}}$$
   The $180^\circ$ rotation ensures forward momentum and view direction are preserved when exiting.

2. **Screen-Space Quad Shader (`portalShader.js`)**
   Because the virtual camera uses the exact same field-of-view and aspect ratio as the player camera, sampling the rendered texture at `gl_FragCoord.xy / resolution` produces a perspective-correct window into the target room without UV distortion.

3. **Oblique Near-Plane Clipping (`obliqueClipping.js`)**
   Modifies the third row of the virtual camera's $4 \times 4$ projection matrix to tilt the near clipping plane to match the destination portal plane. Any geometry between the virtual camera and the portal is clipped by GPU hardware before rasterization.

4. **Continuous Collision Detection (`Portal.crossed`)**
   Tests the line segment between the player's previous and current positions against the portal plane ($Z = 0$). Computes the exact intersection fraction $t$ to prevent tunneling at high speeds.

5. **No Near-Plane Flash When Stepping Through (`Portal.js`, `room.js`)**
   Within $5\text{ cm}$ of a portal the camera's near plane would clip the portal quad and reveal the wall behind it. The portal surface is therefore a shallow box reaching $15\text{ cm}$ behind the doorway, and the walls have real openings behind every portal. Because the shader samples in screen space, every face of the box shows the same image.
