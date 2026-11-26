# Chapter 3: Advanced Computer Graphics Algorithms

> **What makes this project advanced:**
> Most student Three.js projects simply assemble pre-made library components.
> This project dives straight into the **GPU fixed-function pipeline, linear algebra, and recursive rendering**.
> This chapter explains the three most sophisticated algorithms in the engine.

---

## 1. Algorithm 1: Eric Lengyel's Oblique Near-Plane Clipping (2004)

### 1.1 The Intervening Wall Problem
To understand why this algorithm is famous in game development, look at where the **Virtual Camera** is placed:

```
[Room Exterior (Behind Wall)]         |    [Room Interior]
                                      |
  (Virtual Camera)                    |
        |                             |
        v                             |
 [Decoy Red Occluder / Wall]          |
        |                             |
        v                             |
   [Portal B Doorway] ===============>|    (Target Scene: Props, Torus Knot, Floor)
```

- If you stand 2 meters in front of Portal A, the Virtual Camera must be placed **2 meters behind Portal B** to capture the correct perspective through the doorway.
- **The Catch:** Portal B is mounted on a wall! Furthermore, in a full game, there might be pillars, exterior building geometry, or terrain directly behind Portal B.
- Because that geometry sits directly between the Virtual Camera and the doorway, a standard camera would render that wall, **completely blocking the view into the room**!

---

### 1.2 Why Naive Solutions Fail
1. **Making the wall invisible:** If you hide the wall behind Portal B, you create a gaping hole where the rest of the room leaks out into the void.
2. **GLSL Fragment Shader Clipping (`discard;`):** You could pass clipping planes to every shader in your scene and call `discard;` on pixels behind the plane.
   - **Why this is bad:** It ruins GPU performance by disabling **Early-Z testing** (where the GPU rejects occluded pixels before running the expensive fragment shader). It also requires rewriting every material and shader in your entire game.
3. **Stencil Buffers:** Difficult to maintain across recursive portal-in-portal passes, prone to precision artifacts, and slow on tile-based mobile GPUs.

---

### 1.3 The Elegant Solution: Lengyel's Projection Matrix Modification
In 2004, graphics researcher Eric Lengyel published a seminal paper (*"Modifying the View Frustum for Oblique Near-Plane Clipping"* in *Game Programming Gems 5*).

He realized:
> **The GPU already possesses a lightning-fast hardware clipping unit.**
> Any vertex whose Normalized Device Coordinates (NDC) fall outside $-w \le z \le w$ is automatically discarded by the GPU fixed-function hardware before rasterization.

Normally, a camera's near clipping plane is a flat rectangle perpendicular to the camera's sightline.
Lengyel proved that you can **tilt the near plane to match any arbitrary 3D plane in the world** by modifying only the **3rd row (the depth row)** of the $4 \times 4$ projection matrix!

```
[Standard Camera Frustum]                  [Oblique Frustum (Tilted Near Plane)]

      /--------------/ (Far Plane)               /--------------/ (Far Plane)
     /              /                           /              /
    /              /                           /              /
   /--------------/ (Near Plane - Flat)       /--------------/ (Tilted Near Plane)
   \              /                           \   aligned with Portal doorway!
    \            /                             \            /
     \          /                               \          /
       (Camera)                                   (Camera)
```

---

### 1.4 How It Is Implemented (`src/portal/obliqueClipping.js`)

Here is the exact 5-step algorithm in our code:

```javascript
export function applyObliqueNearPlane(camera, destinationPortal, bias = OBLIQUE_BIAS) {
  // Step 1: Define the destination portal's plane in world space
  clipPlaneWorld.setFromNormalAndCoplanarPoint(
    destinationPortal.normal,
    destinationPortal.origin
  );

  // Step 2: Transform the clipping plane into Camera View Space
  clipPlaneWorld.applyMatrix4(camera.matrixWorldInverse);
  clipPlaneView.set(
    clipPlaneWorld.normal.x,
    clipPlaneWorld.normal.y,
    clipPlaneWorld.normal.z,
    clipPlaneWorld.constant
  );

  const e = camera.projectionMatrix.elements; // Column-major array

  // Step 3: Find the frustum corner most opposite to the clipping plane in NDC,
  // then unproject it back into View Space
  frustumCorner.x = (Math.sign(clipPlaneView.x) + e[8]) / e[0];
  frustumCorner.y = (Math.sign(clipPlaneView.y) + e[9]) / e[5];
  frustumCorner.z = -1.0;
  frustumCorner.w = (1.0 + e[10]) / e[14];

  // Step 4: Scale the clip plane vector so the near plane passes through the portal
  const dotProduct = clipPlaneView.dot(frustumCorner);
  const projectionScale = 2.0 / dotProduct;
  clipPlaneView.multiplyScalar(projectionScale);

  // Step 5: Overwrite Row 3 of the 4x4 Projection Matrix
  e[2] = clipPlaneView.x;
  e[6] = clipPlaneView.y;
  e[10] = clipPlaneView.z + 1.0 - bias; // Tiny bias prevents self-clipping z-fighting
  e[14] = clipPlaneView.w;
}
```

> [!TIP]
> **The Live Demo Test (The 'O' Key):**
> In `src/world/room.js`, we placed large dark red slabs (`addDecoyOccluders`) directly behind the portal walls.
> - Press **`O`** in the running project to toggle oblique clipping OFF: **the portal view instantly turns solid red** because the decoy wall blocks the view!
> - Press **`O`** again to toggle it ON: the red wall vanishes as the GPU hardware clipper slices it away with zero performance cost!

---

## 2. Algorithm 2: Recursive Depth-First Scene Rendering (DFS)

### 2.1 The Hallway of Mirrors (Portals within Portals)
When Portal A faces Portal B, looking into Portal A reveals Portal B, which in turn reflects Portal A, creating an infinite corridor effect.

How does the engine render this without crashing or freezing the GPU?

```
Level 0: Main Screen View (Camera looking at Portal A)
    |
    +---> Level 1: Virtual Camera looking at Portal B
            |
            +---> Level 2: Virtual Camera looking at Portal A
                    |
                    +---> Level 3 (Max Depth): Base case reached! Render flat tint.
```

---

### 2.2 The Algorithm (`src/portal/PortalRenderer.js`)

Our engine uses a **Post-Order Depth-First Search (DFS)** traversal:

1. **Frustum & Facing Culling (`_isPortalVisible`):**
   - Is the camera in front of the portal plane? (`portal.isInFront(camPos)`). If behind, skip!
   - Does the portal rectangle intersect the camera's view frustum? (`frustum.intersectsObject(portal.surface)`). If off-screen, skip!
   - **Optimization:** If a portal isn't visible, we do **zero** draw calls for it!

2. **Recursive Descent (`_renderView`):**
   - For every visible portal:
     - Position the virtual camera at the linked exit.
     - Apply oblique clipping.
     - Call `_renderView(virtualCam, level + 1, renderTarget, portal.link)` (the exit portal is excluded from the child pass, so a virtual camera never renders a view of itself).
     - Store the resulting texture in a map.

3. **Base Case (`level >= maxDepth`):**
   - When the recursion depth limit is reached (tunable with keys `1`–`5`), the engine stops recursing.
   - The portal shader sets `uFlat = 1.0`, rendering a subtle dark tint instead of an infinite black void or memory crash.

4. **RenderTarget Pooling:**
   - In WebGL, **you cannot read from a texture that the GPU is actively writing to** (called a framebuffer feedback loop, resulting in a black texture or WebGL warning).
   - `PortalRenderer` maintains a pool of dedicated `WebGLRenderTarget` objects indexed by `[portal][recursion_level]`. Level 1 writes to Texture 1; Level 2 writes to Texture 2. They never collide.

---

## 3. Algorithm 3: Continuous Collision Detection (CCD) & Teleportation

### 3.1 The Tunneling Problem
In simple games, collision is tested discretely:
```javascript
// NAIVE DISCRETE CHECK:
if (player.position.distanceTo(portal.position) < 0.5) {
  teleport();
}
```

**Why this breaks in practice:**
At 60 FPS and high movement speed, the player might be at $Z = +0.2$ on frame 1, and at $Z = -0.3$ on frame 2.
The player jumped completely over the portal plane in a single step! This is called **tunneling**. The player walks right through the portal into the void or hits the back wall.

```
Frame 1: Player at Z = +0.2 (In front)
                 |
  [MOVEMENT STEP TAKEN OVER 1 FRAME]
                 |
                 v
Frame 2: Player at Z = -0.3 (Behind!)
                 
       Plane was at Z = 0.0 (The player never landed ON the plane!)
```

---

### 3.2 The Parametric Line-Plane Intersection Solution
In `src/portal/Portal.js` $\to$ `crossed(oldPos, newPos)`:

1. Convert both `oldPos` and `newPos` from world space into the portal's **local space**:
   ```javascript
   const localStart = this.toLocal(_scratchA, oldPos);
   const localEnd = this.toLocal(_scratchB, newPos);
   ```

2. Check if the line segment pierced the threshold from front to back:
   ```javascript
   if (!(localStart.z >= 0 && localEnd.z < 0)) return false;
   ```

3. Calculate the exact parametric intersection fraction $t \in [0, 1]$ where $Z = 0$:
   $$\text{start}_z + t \cdot (\text{end}_z - \text{start}_z) = 0 \implies t = \frac{\text{start}_z}{\text{start}_z - \text{end}_z}$$

4. Compute the exact $(X, Y)$ coordinate where the path crossed the doorway plane:
   $$\text{hit}_x = \text{start}_x + t \cdot (\text{end}_x - \text{start}_x)$$
   $$\text{hit}_y = \text{start}_y + t \cdot (\text{end}_y - \text{start}_y)$$

5. Check if the crossing point is inside the doorway rectangle:
   $$|\text{hit}_x| < \frac{\text{width}}{2} \quad \text{and} \quad 0 < \text{hit}_y < \text{height}$$

---

### 3.3 Seamless Teleportation Execution (`src/player/Player.js`)
When a valid crossing is detected:
1. We construct a 3D pose matrix for the player combining their position and view angles.
2. We transform that matrix through `entrancePortal.mapMatrix(_transformMatrix, _poseMatrix)`.
3. We decompose the result into the new world position and an orientation quaternion.
4. We extract the new **yaw** and **pitch** angles using Euler order `'YXZ'`:
   - `'YXZ'` order ensures horizontal rotation (yaw) and vertical look (pitch) remain clean and independent without gimbal lock.
5. The player emerges from Portal B with their exact relative momentum and gaze direction preserved—**zero visual stutter, zero camera jumping!**

---

## 4. Summary of Chapter 3

| Algorithm | Problem It Solves | Key Code Location |
| :--- | :--- | :--- |
| **Oblique Near-Plane Clipping** | Prevents walls behind the exit portal from blocking the view | `src/portal/obliqueClipping.js` |
| **Depth-First Search (DFS)** | Handles multi-level portal-in-portal reflections cleanly | `src/portal/PortalRenderer.js` |
| **RenderTarget Pooling** | Prevents GPU framebuffer feedback loops across recursion | `PortalRenderer._getRenderTarget()` |
| **Continuous Collision Detection** | Prevents high-speed tunneling through portal doors | `src/portal/Portal.crossed()` |
| **Euler 'YXZ' Pose Decomposition** | Preserves smooth camera orientation upon teleporting | `src/player/Player.teleport()` |
