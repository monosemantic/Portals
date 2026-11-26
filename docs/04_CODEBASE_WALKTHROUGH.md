# Chapter 4: Complete Codebase Walkthrough

> **Purpose of this chapter:**
> When your teacher asks, *"Walk me through your code—where does it start, and how do the pieces talk to each other?"*, this chapter gives you the exact answer.

---

## 1. High-Level Architecture & File Tree

The project is structured into clean, modular ES6 files with zero npm/webpack dependencies:

```
portals-poc/
├── index.html                 # Browser entry point (importmap for Three.js r128)
├── src/
│   ├── main.js                # Game loop & system wiring
│   ├── config.js              # Centralized tunable constants
│   ├── portal/
│   │   ├── Portal.js          # Portal entity, coordinate transforms & CCD
│   │   ├── PortalRenderer.js  # Recursive DFS rendering & target pooling
│   │   ├── obliqueClipping.js # Eric Lengyel's projection matrix modification
│   │   └── portalShader.js    # Screen-space GLSL vertex & fragment shaders
│   ├── player/
│   │   ├── Player.js          # First-person camera, kinematics & teleportation
│   │   └── Input.js           # Pointer drag & keyboard event management
│   ├── world/
│   │   ├── room.js            # Color-coded room shell, wall & divider clamping
│   │   ├── props.js           # Reusable prop & light builders
│   │   ├── chambers.js        # The 3 showcase chamber presets
│   │   └── ChamberManager.js  # Chamber loading/disposal & collision
│   ├── debug/
│   │   └── BirdsEyeView.js    # Overview camera, frustum helpers & inset
│   └── ui/
│       └── Hud.js             # On-screen diagnostics & chamber buttons
```

---

## 2. File-by-File Breakdown

### 2.1 `src/config.js` (Central Tunable Constants)
Centralizes all magic numbers so you never have to hunt through code to change values:
- `ROOM = 10`, `ROOM_H = 6`: Half-width of the square room (total room size is $20 \times 20$ units, ceiling 6 units).
- `PORTAL_W = 2.2`, `PORTAL_H = 3.2`: Portal doorway width and height.
- `PORTAL_WALL_OFFSET = 0.01`: Portals are nudged $1\text{ cm}$ out from the wall to prevent **Z-fighting** (visual flickering when two planes occupy the exact same coordinate).
- `DEFAULT_DEPTH = 3`, `MAX_LEVELS = 5`: Recursion limits.
- `OBLIQUE_BIAS = 0.003`: World-space distance the oblique near plane is pushed behind the exit portal, so geometry exactly at the threshold is not clipped. Must stay below `PORTAL_WALL_OFFSET`, otherwise the wall behind the portal would survive clipping.
- `PORTAL_MSAA_SAMPLES = 4`: Multisampled portal render targets (WebGL2) for antialiased portal interiors.
- `MAX_PIXEL_RATIO = 1.5`: Caps resolution on 4K/Retina displays to keep 60 FPS during multi-pass recursive rendering.
- `PLAYER`: Eye height ($1.6\text{ m}$), walk speed ($4.0\text{ m/s}$), mouse look sensitivity, and collision doorway tolerances. `doorwayMargin = -0.1` keeps the collision-free doorway zone strictly inside the teleportable opening, so the player cannot slip into the wall beside a frame.
- `DEFAULT_CHAMBER`, `BIRDS_EYE`: Start chamber and Bird's-Eye camera/helper settings.

---

### 2.2 `src/main.js` (The Engine Orchestrator)
1. **Initializes WebGLRenderer and Scene:** Sets black background, antialiasing, and attaches the canvas to the DOM.
2. **Creates Entities:**
   - Calls `createRoom(scene)` to build the shared textured room shell.
   - Instantiates `portalA` (cyan) and `portalB` (orange) and calls `Portal.link(portalA, portalB)`.
   - Creates the `ChamberManager`, which places the portals and builds props/lights per chamber.
   - Creates the `Player`, `Input`, `PortalRenderer`, `BirdsEyeView`, and `Hud`.
3. **Registers Keyboard Hotkeys:**
   - `C` (or the HUD buttons): Cycles the 3 showcase chambers and moves the player to that chamber's spawn.
   - `V`: Toggles the Bird's-Eye debug view.
   - `O`: Toggles oblique near-plane clipping on/off.
   - `1` through `5`: Changes portal recursion depth limit dynamically.
4. **The `animationFrame()` Loop:** Runs 60 times a second, updating player kinematics, animating chamber props and portal rims, executing recursive portal rendering (or the Bird's-Eye frame), and updating the HUD.

---

### 2.3 `src/portal/Portal.js` (Spatial Transforms & Crossing Physics)
- **Class `Portal`:**
  - Holds a `THREE.Group` containing the flat portal surface quad (`THREE.PlaneGeometry`) and the 3-piece wooden/metal visual border (`_buildFrame`).
  - Sets up the `THREE.ShaderMaterial` with uniforms (`map`, `uRes`, `uFlat`, `uTint`).
- **`place(x, z, rotY)`:** Positions and rotates the portal, caching its world matrix, inverse world matrix (`worldInverse`), and normal direction vector.
- **`mapMatrix(outMatrix, sourceMatrix)`:** The core change-of-basis engine:
  $$M_{\text{out}} = M_{\text{exit}} \cdot R_Y(180^\circ) \cdot M_{\text{entrance}}^{-1} \cdot M_{\text{source}}$$
- **`crossed(oldPos, newPos)`:** Continuous Collision Detection (CCD). Determines if the player's path intersected the portal plane this frame using parametric ray-plane intersection.
- **`isInDoorway(worldPoint, marginX, depth)`:** Checks if the player is currently stepping through the portal frame, temporarily disabling room wall collision.

---

### 2.4 `src/portal/PortalRenderer.js` (Recursive DFS Pipeline)
- **`render(camera, target = null)`:** Starts recursion at Level 0, rendering to the screen (or to `target`, used by the Bird's-Eye inset).
- **`_isPortalVisible(portal, cam)`:** Frustum culling check. Discards portals that are behind the camera or outside the screen.
- **`placeVirtualCamera(virtualCam, sourceCam, portal, baseProjection)`:** Positions the virtual camera behind the exit portal using `portal.mapMatrix`, applies oblique clipping, and refreshes `projectionMatrixInverse`. Public so the Bird's-Eye view can reproduce the exact level-1 camera.
- **`_renderView(cam, level, target, excludePortal)`:** Depth-First Search function:
  1. Finds all visible portals, skipping `excludePortal` (the portal this camera looks out of).
  2. If `level < maxDepth`, recursively calls `_renderView` for each portal into an off-screen `WebGLRenderTarget`.
  3. Binds the resulting textures to the portal surface materials.
  4. Renders the 3D scene from the current camera into the current target.
- **`_getRenderTarget(portal, level)`:** Pools and caches off-screen textures so different recursion levels don't overwrite each other.

---

### 2.5 `src/portal/obliqueClipping.js` (Projection Matrix Modification)
- **`applyObliqueNearPlane(camera, destinationPortal, bias)`:**
  1. Builds the exit portal's plane, shifts it `bias` units behind the portal in world space, and transforms it into camera view space.
  2. Finds the frustum corner most opposite the plane in NDC coordinates.
  3. Scales the clip plane equation (returns early, keeping the standard projection, if $|C \cdot Q| < 10^{-4}$ at grazing angles).
  4. Directly overwrites row 3 (indices 2, 6, 10, 14) of Three.js's column-major `projectionMatrix.elements`.
  5. The GPU hardware clipper immediately discards any walls or objects between the virtual camera and the doorway.

---

### 2.6 `src/portal/portalShader.js` (GLSL Screen-Space Shaders)
- **`portalVertexShader`:** Transforms quad vertices into clip space (`gl_Position`).
- **`portalFragmentShader`:**
  - Converts screen coordinates to normalized UVs: `screenUV = gl_FragCoord.xy / uRes`.
  - Samples the virtual camera's render target: `texture2D(map, screenUV)`.
  - Blends a 6% frame color tint (`mix(sceneColor, uTint, 0.06)`).
  - Handles the `uFlat` recursion limit base case.
  - Adds a pulsing energy rim along the left, right, and top edges (`vUv`, `uTime`, `uSize`).

---

### 2.7 `src/player/Player.js` (Kinematics & Teleportation)
- The player and camera share one transform: `camera.position` is the eye position, rotation uses Euler order `'YXZ'` (yaw, then pitch, no roll).
- **`setPose({x, z, yaw})`:** Instantly moves the player (used for chamber spawn points).
- **`update(dt, input)`:** Applies mouse look and WASD movement, calls the collision callback with `(position, previousPosition)`, then tests `portal.crossed()` on the segment travelled this frame.
- **`teleport(entrancePortal)`:**
  - Transforms the camera matrix using `entrancePortal.mapMatrix`.
  - Decomposes the matrix into new position and quaternion.
  - Extracts updated yaw and pitch using Euler order `'YXZ'`.

---

### 2.8 `src/debug/BirdsEyeView.js` (Bird's-Eye Debug View)
- Elevated overview camera (orbit with Q / E, zoom with the wheel) while WASD and drag keep driving the player.
- Player marker plus `THREE.CameraHelper` frustums for the player camera (white) and the level-1 virtual camera of each visible portal (portal color).
- The virtual camera proxies are built with `portalRenderer.placeVirtualCamera()`, so the helper shows the real oblique near plane. Because the projection matrix is edited directly, `projectionMatrixInverse` must be refreshed before `helper.update()`.
- Frame order: portal pipeline first (debug objects hidden so they never appear in portal textures, final player view rendered into an inset target), then the overview pass with the ceiling hidden, then the first-person inset composited in the corner.

---

### 2.9 `src/player/Input.js` (Pointer Drag & Key Capture)
- Captures pointer drag (`pointerdown`, `pointermove`, `setPointerCapture`) for smooth camera look without needing Pointer Lock API.
- Aggregates WASD keys into normalized `forward` and `strafe` axes.
- Exposes `onPress(code, callback)` for one-shot hotkeys.

---

### 2.10 `src/world/` (Room Shell, Props & Chambers)
- **`room.js`:** Shared room shell plus collision (`clampToRoom()`, `clampToDivider()`).
- **`props.js`:** Builders for lights, the torus knot, cubes, columns, red decoys (placed behind any portal wall from its placement), and the glass divider.
- **`chambers.js`:** Three presets: *Oblique Clipping Lab* (North + East portals), *Infinite Mirror Hallway* (North and South portals facing each other), *Split Glass Chamber* (glass wall at x = 0, both portals on the North wall).
- **`ChamberManager.js`:** Loads a preset into its own group, disposes the previous one, re-places the portal pair, and combines room + divider collision.
- Generates procedural checkerboard grid textures on HTML5 2D canvases (no external image files required).
- Builds color-coded walls:
  - **North (Z = -ROOM):** Red
  - **South (Z = +ROOM):** Green
  - **East (X = +ROOM):** Blue
  - **West (X = -ROOM):** Yellow
- `clampToRoom()`: Constrains the player inside the room, temporarily relaxing boundaries when inside a portal doorway.
- `clampToDivider()`: Keeps the player on the side of the glass divider they came from (decided by the previous position).

---

### 2.11 `src/ui/Hud.js` (Diagnostic Overlay)
- Updates a lightweight HTML overlay displaying:
  - Active chamber and Bird's-Eye status, plus clickable chamber buttons.
  - Oblique clipping status (ON / OFF).
  - Current recursion depth limit (1 to 5).
  - Number of active scene passes per frame and real-time FPS.

---

## 3. The Lifecycle of a Single Frame (Step-by-Step)

What happens during a single 16.6 millisecond tick of `requestAnimationFrame`:

```
1. requestAnimationFrame(animationFrame) triggers
   |
2. dt = clock.getDelta() (capped at MAX_DT)
   |
3. player.update(dt, input):
   - Mouse look deltas update yaw and pitch
   - WASD inputs calculate new position
   - chambers.constrain() prevents walking through walls (and the glass divider)
   - portal.crossed(oldPos, newPos) tests continuous line segment
   - If crossed: player.teleport() transforms pose matrix & Euler angles
   |
4. chambers.update(dt) + portal.tick(elapsed):
   - Torus knot rotates, portal energy rims pulse
   |
5. portalRenderer.render(camera):
   - Syncs offscreen RenderTarget sizes to window drawing buffer
   - Recursively executes Depth-First Search passes into FBO textures
   - Slices intervening geometry using applyObliqueNearPlane()
   - Binds textures to portal materials
   - Renders final scene to screen canvas
   |
6. hud.set(...):
   - Computes FPS and pass count, updates HTML text
```

---

## 4. Performance & Memory Engineering: Zero Garbage Collection

In JavaScript, executing `new THREE.Vector3()` or `new THREE.Matrix4()` inside `requestAnimationFrame` creates thousands of temporary objects every second.
Eventually, the browser's **Garbage Collector (GC)** pauses the JavaScript engine for 10–50 ms to clean them up, causing noticeable frame drops and micro-stutter.

### Our Solution:
Every single file (`Portal.js`, `Player.js`, `PortalRenderer.js`, `obliqueClipping.js`) pre-allocates module-scoped scratch variables at startup:

```javascript
// Pre-allocated scratch objects (reused indefinitely):
const _scratchA = new THREE.Vector3();
const _scratchB = new THREE.Vector3();
const _transformMatrix = new THREE.Matrix4();
const _poseMatrix = new THREE.Matrix4();
```

Inside per-frame functions, we never call `new`. Instead, we mutate these objects using `.copy()`, `.set()`, and `.applyMatrix4()`.
**Result:** Virtually **0 bytes of runtime memory allocation per frame**, guaranteeing a rock-solid 60 FPS!
