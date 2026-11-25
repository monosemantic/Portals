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
│   │   ├── Player.js          # 1st/3rd-person camera, kinematics & teleportation
│   │   ├── Avatar.js          # 3D capsule character mesh with visor & backpack
│   │   └── Input.js           # Pointer drag & keyboard event management
│   ├── world/
│   │   └── room.js            # Color-coded room shell, props & boundary clamping
│   └── ui/
│       └── Hud.js             # On-screen performance & diagnostic display
```

---

## 2. File-by-File Breakdown

### 2.1 `src/config.js` (Central Tunable Constants)
Centralizes all magic numbers so you never have to hunt through code to change values:
- `ROOM = 10`, `ROOM_H = 6`: Half-width of the square room (total room size is $20 \times 20$ units, ceiling 6 units).
- `PORTAL_W = 2.2`, `PORTAL_H = 3.2`: Portal doorway width and height.
- `PORTAL_WALL_OFFSET = 0.01`: Portals are nudged $1\text{ cm}$ out from the wall to prevent **Z-fighting** (visual flickering when two planes occupy the exact same coordinate).
- `DEFAULT_DEPTH = 3`, `MAX_LEVELS = 5`: Recursion limits.
- `OBLIQUE_BIAS = 0.003`: Tiny offset on the oblique near plane so the portal quad does not accidentally clip its own frame.
- `MAX_PIXEL_RATIO = 1.5`: Caps resolution on 4K/Retina displays to keep 60 FPS during multi-pass recursive rendering.
- `PLAYER`: Eye height ($1.6\text{ m}$), walk speed ($4.0\text{ m/s}$), mouse look sensitivity, and collision doorway tolerances.

---

### 2.2 `src/main.js` (The Engine Orchestrator)
1. **Initializes WebGLRenderer and Scene:** Sets black background, antialiasing, and attaches the canvas to the DOM.
2. **Creates Entities:**
   - Calls `createRoom(scene)` to build the textured walls, lighting, and rotating torus knot.
   - Instantiates `portalA` (cyan, placed on North wall) and `portalB` (orange, placed on East wall).
   - Calls `Portal.link(portalA, portalB)` to bind them bidirectionally.
   - Creates the `Player`, `Input`, `Hud`, and `PortalRenderer`.
3. **Registers Keyboard Hotkeys:**
   - `V`: Toggles 1st-person vs. 3rd-person view (`player.toggleThirdPerson()`).
   - `O`: Toggles oblique near-plane clipping on/off.
   - `1` through `5`: Changes portal recursion depth limit dynamically.
4. **The `animationFrame()` Loop:** Runs 60 times a second, updating player kinematics, rotating room props, executing recursive portal rendering, and updating the HUD.

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
- **`render(camera)`:** Starts recursion at Level 0 (rendering to the canvas screen).
- **`_isPortalVisible(portal, cam)`:** Frustum culling check. Discards portals that are behind the camera or outside the screen.
- **`_placeVirtualCamera(virtualCam, sourceCam, portal)`:** Positions the virtual camera behind the exit portal using `portal.mapMatrix` and applies oblique clipping.
- **`_renderView(cam, level, target)`:** Depth-First Search function:
  1. Finds all visible portals.
  2. If `level < maxDepth`, recursively calls `_renderView` for each portal into an off-screen `WebGLRenderTarget`.
  3. Binds the resulting textures to the portal surface materials.
  4. Renders the 3D scene from the current camera into the current target.
- **`_getRenderTarget(portal, level)`:** Pools and caches off-screen textures so different recursion levels don't overwrite each other.

---

### 2.5 `src/portal/obliqueClipping.js` (Projection Matrix Modification)
- **`applyObliqueNearPlane(camera, destinationPortal, bias)`:**
  1. Transforms the exit portal's 3D plane into camera view space.
  2. Finds the frustum corner most opposite the plane in NDC coordinates.
  3. Scales the clip plane equation.
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

---

### 2.7 `src/player/Player.js` (Kinematics & Teleportation)
- Manages `this.position`, `this.yaw` (horizontal angle), and `this.pitch` (vertical angle).
- In first-person: Camera sits at `(position.x, eyeHeight, position.z)`.
- In third-person: Camera orbits behind and above the player avatar.
- **`prepareForRender(camera, isRootCamera)`:**
  - In 1st-person root view, hides the avatar's head dome so it doesn't clip into the camera, but leaves the body visible when looking down.
  - In 3rd-person and inside all portal reflections, shows the complete avatar.
- **`teleport(entrancePortal)`:**
  - Transforms player pose matrix using `entrancePortal.mapMatrix`.
  - Decomposes matrix into new position and quaternion.
  - Extracts updated yaw and pitch using Euler order `'YXZ'`.

---

### 2.8 `src/player/Avatar.js` (3D Capsule Character Mesh)
- Procedural 3D model representing the player:
  - Cyan-teal pill body (cylinder + sphere base).
  - Dark trim belt and rear backpack (makes front vs. back immediately clear).
  - Spherical head dome with glossy dark visor facing forward.
- Organized into `bodyGroup` and `headGroup` for independent visibility control.

---

### 2.9 `src/player/Input.js` (Pointer Drag & Key Capture)
- Captures pointer drag (`pointerdown`, `pointermove`, `setPointerCapture`) for smooth camera look without needing Pointer Lock API.
- Aggregates WASD keys into normalized `forward` and `strafe` axes.
- Exposes `onPress(code, callback)` for one-shot hotkeys.

---

### 2.10 `src/world/room.js` (Environment & Fixtures)
- Generates procedural checkerboard grid textures on HTML5 2D canvases (no external image files required).
- Builds color-coded walls:
  - **North (Z = -ROOM):** Red
  - **South (Z = +ROOM):** Green
  - **East (X = +ROOM):** Blue
  - **West (X = -ROOM):** Yellow
- Adds a continuously spinning orange torus knot prop in the center.
- `addDecoyOccluders()`: Places large dark red slabs behind the portal walls to demonstrate oblique clipping.
- `clampToRoom()`: Constrains the player inside the room, temporarily relaxing boundaries when inside a portal doorway.

---

### 2.11 `src/ui/Hud.js` (Diagnostic Overlay)
- Updates a lightweight HTML overlay displaying:
  - Current view mode (1st vs. 3rd Person).
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
   - clampToRoom() prevents walking through normal walls
   - portal.crossed(oldPos, newPos) tests continuous line segment
   - If crossed: player.teleport() transforms pose matrix & Euler angles
   - Avatar & camera matrices updated
   |
4. room.update(dt):
   - Torus knot rotates on X and Y axes
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
