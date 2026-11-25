# Chapter 1: The Essential Prerequisites (Math, Graphics & WebGL)

> **Who this is for:** Anyone taking a 3D Graphics / Three.js / WebGL class who feels overwhelmed by the math, shaders, and terminology.
> **Our goal:** Build an intuitive, crystal-clear understanding from absolute zero—no jargon without an immediate everyday analogy.

---

## 1. 3D Space & Coordinates (From Scratch)

### 1.1 The 3D Coordinate System
In 2D (like a piece of paper or a standard web page), you only have two axes:
- **X**: Horizontal (Left $\leftrightarrow$ Right)
- **Y**: Vertical (Up $\updownarrow$ Down)

In 3D graphics (and Three.js specifically), we add a third axis:
- **Z**: Depth (Towards you $\leftrightarrow$ Away from you)

```
        +Y (Up)
         |
         |   +Z (Towards you / Out of screen)
         |  /
         | /
---------+---------> +X (Right)
        /|
       / |
```

> [!NOTE]
> **Three.js uses a Right-Handed Coordinate System:**
> If you make an "L" shape with your right hand's thumb (pointing right: $+X$) and index finger (pointing up: $+Y$), your middle finger points toward your chest ($+Z$).
> - $+X$ is **Right**, $-X$ is **Left**
> - $+Y$ is **Up**, $-Y$ is **Down**
> - $+Z$ is **Backward (towards your eyes)**, $-Z$ is **Forward (into the screen)**

---

### 1.2 What is a Vector?
A vector is simply a list of numbers. In 3D, a `Vector3` has three numbers: $(x, y, z)$.

Vectors serve two completely different purposes depending on how you use them:

1. **A Position (Point in Space):**
   - Example: $(0, 1.6, 6)$ means "Stand at $X=0$, at eye height $Y=1.6$, and $6$ units back along $Z$."
2. **A Direction & Magnitude (An Arrow):**
   - Example: $(0, 0, -1)$ means "Point straight forward into the screen with a length of 1 unit."

#### Key Vector Concepts You Need to Know:
- **Magnitude (Length):** How long the arrow is:
  $$\text{Length} = \sqrt{x^2 + y^2 + z^2}$$
- **Normalization (Unit Vector):** Scaling a direction vector so its length is exactly $1.0$. This is crucial in graphics because direction arrows shouldn't stretch or distort objects.
- **The Dot Product ($\mathbf{A} \cdot \mathbf{B}$):**
  $$\mathbf{A} \cdot \mathbf{B} = A_x B_x + A_y B_y + A_z B_z = |\mathbf{A}| |\mathbf{B}| \cos(\theta)$$
  **What it tells you in plain English:**
  - If $\mathbf{A} \cdot \mathbf{B} > 0$: The two vectors point in the *same general direction* (angle $< 90^\circ$).
  - If $\mathbf{A} \cdot \mathbf{B} = 0$: The two vectors are *perpendicular* ($90^\circ$).
  - If $\mathbf{A} \cdot \mathbf{B} < 0$: The two vectors point *away from each other* (angle $> 90^\circ$).
  > **In our project:** We use the dot product to test if the player or camera is facing the portal or facing away from it!

---

### 1.3 Coordinate Spaces: "Where Am I?"
In 3D graphics, a single object has different coordinates depending on who is asking. Understanding **coordinate spaces** is the #1 secret to understanding portals.

```
+--------------------------------------------------------------------------+
| 1. Model / Local Space: Coordinates relative to the object itself        |
|    (e.g., your nose is at (0, 0, +0.1) relative to your head)            |
+--------------------------------------------------------------------------+
                                     |
                          [Model Matrix (Position/Rotation)]
                                     v
+--------------------------------------------------------------------------+
| 2. World Space: Coordinates relative to the entire room / universe       |
|    (e.g., you are at (3, 0, 5) inside the room)                          |
+--------------------------------------------------------------------------+
                                     |
                          [View Matrix (Camera Inverse)]
                                     v
+--------------------------------------------------------------------------+
| 3. View / Eye Space: Coordinates relative to the camera's eyes           |
|    (e.g., the chair is 2 meters directly in front of the lens)           |
+--------------------------------------------------------------------------+
                                     |
                          [Projection Matrix (FOV & Perspective)]
                                     v
+--------------------------------------------------------------------------+
| 4. Clip Space / NDC: Normalized coordinates between -1.0 and +1.0        |
|    (used by the GPU hardware to clip what's off-screen)                  |
+--------------------------------------------------------------------------+
                                     |
                          [Viewport Transform]
                                     v
+--------------------------------------------------------------------------+
| 5. Screen Space: Exact pixel coordinates on your physical monitor        |
|    (e.g., pixel at x = 1280, y = 720)                                    |
+--------------------------------------------------------------------------+
```

#### An Everyday Analogy:
Imagine you are sitting in a passenger seat of a car:
- In **Local Space** (relative to the car): You are at $(X=0.5, Y=0.8, Z=0)$. You aren't moving at all relative to the steering wheel.
- In **World Space** (relative to the city): You are driving on Highway 101 at $100\text{ km/h}$.
- When you look at a portal, we constantly convert points between the **Room's World Space** and the **Portal's Local Doorway Space**.

---

## 2. Matrices: The Machines of 3D Graphics

### 2.1 What is a $4 \times 4$ Matrix?
If a vector is a point in space, a **Matrix** is a machine that transforms points. It can:
1. **Translate** (Move position: shift left, right, up, down).
2. **Rotate** (Turn around X, Y, or Z).
3. **Scale** (Stretch or shrink).

Why $4 \times 4$ instead of $3 \times 3$?
A $3 \times 3$ matrix can rotate and scale, but it **cannot move (translate)** a point without complicated addition. By using a $4 \times 4$ matrix with homogeneous coordinates $(x, y, z, 1)$, a single matrix multiplication can rotate, scale, AND move an object all at once!

```
        ┌                  ┐
        │  R   R   R   Tx  │  <-- R = Rotation & Scale
  M  =  │  R   R   R   Ty  │
        │  R   R   R   Tz  │  <-- T = Translation (Position in space)
        │  0   0   0    1  │
        └                  ┘
```

### 2.2 Matrix Multiplication: Chaining Transformations
When you multiply two matrices:
$$M_{\text{final}} = M_B \cdot M_A$$
It means: **Apply transformation $M_A$ first, then apply transformation $M_B$ second.**
> [!IMPORTANT]
> **Matrix multiplication order matters!**
> Walking forward 5 steps and *then* turning $90^\circ$ lands you in a completely different spot than turning $90^\circ$ first and *then* walking 5 steps!
> In math: $M_A \cdot M_B \ne M_B \cdot M_A$.

### 2.3 The Inverse Matrix ($M^{-1}$): The "Undo" Machine
Every transformation matrix $M$ has an opposite matrix called its **Inverse** ($M^{-1}$).
- If matrix $M$ moves you 5 units to the right and turns you $45^\circ$ clockwise...
- Then $M^{-1}$ turns you $45^\circ$ counter-clockwise and moves you 5 units to the left.
- Multiplying a matrix by its inverse cancels it out completely:
  $$M \cdot M^{-1} = I \quad (\text{Identity Matrix, which does nothing})$$

> **Why this matters for Portals:**
> If $M_{\text{portal}}$ is the matrix that places Portal A in the world, then $M_{\text{portal}}^{-1}$ takes any world-space coordinate and converts it into Portal A's local space!

---

## 3. The WebGL Graphics Pipeline: How Triangles Reach Your Screen

Three.js is a friendly wrapper around **WebGL**, which is a JavaScript API that talks directly to your computer's graphics card (GPU).

Here is the exact journey every 3D object takes through the GPU pipeline:

```
                  JavaScript / Three.js (CPU)
                               |
               [Sends 3D Vertices, Colors, Matrices]
                               |
                               v
                     Vertex Shader (GPU)
          * Runs once for EVERY SINGLE VERTEX in a mesh *
          * Calculates gl_Position (Where is this vertex on screen?) *
                               |
                               v
                  Primitive Assembly & Clipping
          * Discards any triangles outside the camera view *
          * (This is where Eric Lengyel's Oblique Clipping acts!) *
                               |
                               v
                         Rasterization
          * Turns 3D triangles into 2D grid pixels (Fragments) *
                               |
                               v
                    Fragment Shader (GPU)
          * Runs once for EVERY VISIBLE PIXEL on screen *
          * Calculates gl_FragColor (What color is this pixel?) *
                               |
                               v
                       Depth Test (Z-Buffer)
          * Discards pixels hidden behind closer objects *
                               |
                               v
                   Final Output on Canvas / Screen
```

---

## 4. Shaders Demystified (GLSL)

A shader is a mini-program written in **GLSL** (OpenGL Shading Language) that runs directly on thousands of tiny GPU cores simultaneously.

There are only two main shaders:

### 4.1 The Vertex Shader
- **Input:** 3D positions of the mesh corners (`position`).
- **Job:** Multiply the 3D vertex position by the model, view, and projection matrices to figure out where it lands on your 2D monitor.
- **Output:** `gl_Position` (a 4D vector in clip space).

In our project (`src/portal/portalShader.js`):
```glsl
void main() {
  // Standard transformation: converts local vertex to screen clip space
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

### 4.2 The Fragment Shader
- **Input:** The pixel being drawn, its coordinates (`gl_FragCoord`), and any passed variables.
- **Job:** Determine the RGBA color of that specific pixel.
- **Output:** `gl_FragColor`.

### 4.3 Shader Variables: Uniforms vs. Attributes
- **Uniform (`uniform`):** A variable sent from JavaScript (CPU) that is **identical** for every single pixel in that draw call (e.g., screen resolution `uRes`, portal tint color `uTint`, or the rendered texture `map`).
- **Attribute (`attribute`):** Per-vertex data that changes from corner to corner (e.g., vertex `position`).

---

## 5. Framebuffers & RenderTargets (Render-to-Texture)

Normally, Three.js draws the 3D scene directly to your monitor's screen (the default framebuffer).

However, WebGL allows you to redirect the GPU's output into an off-screen memory texture called a **`WebGLRenderTarget`** (or Framebuffer Object - FBO).

```
[Normal Render]:
Scene + Camera =====> Screen (You see it immediately)

[Render-to-Texture (FBO)]:
Scene + Camera =====> Off-screen WebGLRenderTarget (Invisible Texture in GPU VRAM)
                             |
                             +===> Applied as a texture onto another 3D mesh!
```

> **Why Portals Need RenderTargets:**
> We put a second "virtual camera" at the exit portal, render what it sees into an off-screen `WebGLRenderTarget`, and then paint that live picture onto the entrance portal's surface!

---

## 6. Summary Cheat Sheet for Beginners

| Term | What it is | Everyday Analogy |
| :--- | :--- | :--- |
| **Vector3** | $(x, y, z)$ coordinates | A GPS waypoint or a directional arrow |
| **Matrix4** | $4 \times 4$ math table | A machine that translates, rotates, and scales |
| **Inverse Matrix** | $M^{-1}$ | The "Ctrl+Z" (undo) button for a transformation |
| **World Space** | Coordinates relative to room center $(0,0,0)$ | City GPS coordinates |
| **Local Space** | Coordinates relative to an object's center | Distance from your own nose |
| **Vertex Shader** | Program computing corner positions | The architect mapping blueprints |
| **Fragment Shader** | Program computing pixel colors | The painter coloring each tile |
| **WebGLRenderTarget** | Off-screen GPU drawing canvas | Drawing a picture on paper to show on a TV later |
| **Z-Buffer / Depth Test** | Hardware depth comparison | "Don't draw the wall behind the couch" |
| **Frustum** | The pyramid of 3D space a camera can see | Your natural cone of vision |
