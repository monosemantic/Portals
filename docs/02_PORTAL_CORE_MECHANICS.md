# Chapter 2: The Core Portal Mechanics (The Illusion & The Math)

> **The Big Idea:** In video games, a portal is never a literal hole cut into a 3D wall mesh. 
> Cutting holes in 3D geometry in real time (called Constructive Solid Geometry or CSG) is slow, creates messy polygon edges, and wrecks performance.
> Instead, **a portal is an optical illusion:** a flat rectangular plane that acts like a live, perfectly calibrated magic mirror.

---

## 1. The Core Optical Illusion

Imagine standing in front of an open doorway:
- If you step to the left, you see more of the right side of the room beyond the door.
- If you step closer, the doorway frames a wider field of view.
- This natural shifting effect is called **parallax**.

To recreate this seamlessly on a flat 3D rectangle:
1. We calculate where an imaginary **Virtual Camera** would be standing in the destination room.
2. We render what that virtual camera sees into an off-screen texture (`WebGLRenderTarget`).
3. We project that texture onto the portal plane in **screen space**.
4. When the player walks through the doorway plane, we teleport their position and camera angles instantly to the destination.

```
       [Room 1]                                [Room 2]
+--------------------+                  +--------------------+
|                    |                  |                    |
|    [Player]        |                  |   [Virtual Cam]    |
|       |            |                  |         |          |
|       v            |                  |         v          |
|   [Portal A] =====>|====== Network ===|====> [Portal B]    |
|   (Entrance)       |       or Memory  |      (Exit)        |
+--------------------+                  +--------------------+
```

---

## 2. Pillar 1: The Virtual Camera & Change-of-Basis Matrix Math

### 2.1 The Problem
When you stand at **Portal A** looking in, where should the **Virtual Camera** be placed at **Portal B**, and where should it point?

If you are 2 meters in front of Portal A, looking slightly up and to the left, the Virtual Camera must be positioned 2 meters in front of Portal B, looking slightly up and to the right into the target room!

### 2.2 The Change-of-Basis Formula
To compute the exact world transform matrix of the virtual camera ($M_{\text{virtual}}$), we use the core mathematical formula implemented in `src/portal/Portal.js` $\to$ `mapMatrix`:

$$M_{\text{virtual}} = M_{\text{exit}} \cdot R_Y(180^\circ) \cdot M_{\text{entrance}}^{-1} \cdot M_{\text{source}}$$

Let's break down this equation step by step:

```
[1. Source Matrix] (Player Camera in World Space)
        |
        |  x M_entrance^-1 (Step 1: World -> Entrance Local Space)
        v
[Position relative to Portal A Doorway]
        |
        |  x R_Y(180°) (Step 2: Turn 180 degrees around Y)
        v
[Position relative to Portal B Doorway (Forward direction flipped)]
        |
        |  x M_exit (Step 3: Exit Local Space -> World Space)
        v
[Virtual Camera in World Space at Portal B!]
```

#### Step 1: $M_{\text{entrance}}^{-1}$ (Enter Local Space)
- $M_{\text{entrance}}$ represents the position and orientation of Portal A in the world.
- $M_{\text{entrance}}^{-1}$ is its **inverse**.
- Multiplying the player's world matrix by $M_{\text{entrance}}^{-1}$ answers the question:
  > *"Where is the player located relative to Portal A's doorway frame?"*
  *(e.g., 2 meters back along local $Z$, 0.5 meters to the right along local $X$).*

#### Step 2: $R_Y(180^\circ)$ (The Mandatory $180^\circ$ Y-Axis Flip)
Why do we need a $180^\circ$ rotation?
- In our portal coordinate convention:
  - Local $+Z$ points straight out of the portal's front face into the room.
  - When you walk **into** Portal A, you are walking in the direction of **$-Z$** (towards the wall).
  - When you emerge **out** of Portal B, you must be moving in the direction of **$+Z$** (away from the wall, into the room).
- If we did NOT rotate by $180^\circ$, entering Portal A would cause you to exit Portal B facing **backwards directly into the wall**!
- $R_Y(180^\circ)$ flips the forward and backward directions while keeping vertical "up" ($+Y$) untouched.

#### Step 3: $M_{\text{exit}}$ (Return to World Space)
- Now that we have the camera positioned relative to the exit doorway, we multiply by $M_{\text{exit}}$ (Portal B's world matrix).
- This takes the coordinate frame and places it into the actual 3D world at Portal B's position and angle.

---

### 2.3 The Beauty of `mapMatrix`: One Formula for Everything!
This exact same function (`portal.mapMatrix(out, source)`) is reused throughout the entire codebase for three completely different systems:
1. **Virtual Cameras:** Positions the camera used for off-screen rendering.
2. **Player Teleportation:** Teleports the player's physical body and updates camera yaw/pitch angles.
3. **Future Physics:** Can transform rigid body velocity vectors ($\vec{v}_{\text{exit}} = \text{mapMatrix}(\vec{v}_{\text{enter}})$) to preserve momentum when throwing objects through portals!

---

## 3. Pillar 2: Screen-Space Render-to-Texture (The Shader)

### 3.1 Why Naive UV Mapping Fails Miserably
In standard 3D graphics, a texture is mapped onto a plane using **UV coordinates**:
- $(0, 0)$ is the bottom-left corner of the mesh.
- $(1, 1)$ is the top-right corner of the mesh.

If you render the virtual camera's view and map it onto the portal quad using standard UVs:
- As you walk around, the image on the portal stays glued to the rectangle's corners.
- It looks like a flat **television screen or a picture frame** hanging on the wall.
- **There is zero parallax.** It completely destroys the illusion of looking through a doorway into another room.

```
[Naive UV Mapping]                          [Screen-Space Mapping]
Looks like a flat TV screen:                Looks like an open glass window:

  +-------------------+                       +-------------------+
  |     [TV Image]    |                       | \   Target Room / |
  | (Glued to corners)|                       |  \   Seen with  / |
  |   Zero parallax   |                       |   \  Parallax  /  |
  +-------------------+                       +-------------------+
```

---

### 3.2 The Screen-Space Solution
Notice a crucial fact:
- The **Virtual Camera** uses the exact same vertical Field-of-View (`fov = 70`), aspect ratio, and projection matrix as the **Player's Camera**.
- This means that any 3D object visible through the doorway window occupies the **exact same 2D pixel coordinate on your monitor** in both camera views!

Therefore, we do NOT use the portal mesh's $(u, v)$ coordinates at all.
Instead, in our custom GLSL fragment shader (`src/portal/portalShader.js`), we sample the texture using the current pixel's **screen position**!

### 3.3 The Shaders Line-by-Line

#### Vertex Shader (`src/portal/portalShader.js`):
```glsl
void main() {
  // Multiply the portal quad vertex by modelViewMatrix and projectionMatrix
  // to get its standard position in clip space on screen.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

#### Fragment Shader (`src/portal/portalShader.js`):
```glsl
uniform sampler2D map;   // The offscreen texture rendered by the virtual camera
uniform vec2 uRes;       // The resolution of the drawing buffer (e.g., 1920, 1080)
uniform float uFlat;     // 1.0 if we reached the maximum recursion depth limit
uniform vec3 uTint;      // Frame accent color (cyan or orange)

void main() {
  // 1. Depth limit base-case
  if (uFlat > 0.5) {
    gl_FragColor = vec4(uTint * 0.2, 1.0); // Show subtle dark tint
    return;
  }

  // 2. Convert raw pixel coordinates to normalized screen UV in [0.0, 1.0]
  vec2 screenUV = gl_FragCoord.xy / uRes;

  // 3. Sample the virtual camera's render target at that exact screen UV
  vec3 sceneColor = texture2D(map, screenUV).rgb;

  // 4. Blend with a subtle 6% color tint
  vec3 finalColor = mix(sceneColor, uTint, 0.06);

  gl_FragColor = vec4(finalColor, 1.0);
}
```

### 3.4 Key Variables Explained:
- `gl_FragCoord.xy`: A built-in GLSL variable giving the exact pixel coordinates on your physical monitor (e.g., $x = 960.5, y = 540.5$).
- `uRes`: A `vec2` passed from JavaScript containing `(window.innerWidth, window.innerHeight)` scaled by pixel ratio.
- Dividing `gl_FragCoord.xy / uRes`:
  - When $x = 0$, $\text{screenUV}.x = 0.0$ (left edge of screen).
  - When $x = 1920$, $\text{screenUV}.x = 1.0$ (right edge of screen).
- **The Result:** The portal rectangle acts as a transparent window cutout. As you move your head left, the background behind the portal naturally shifts right, giving optically perfect, 100% physically accurate parallax!

---

## 4. Summary of Chapter 2

1. **Portals are not holes:** They are flat 2D planes displaying a live screen-space render target.
2. **Virtual Camera Transformation:** Uses $M_{\text{virtual}} = M_{\text{exit}} \cdot R_Y(180^\circ) \cdot M_{\text{entrance}}^{-1} \cdot M_{\text{source}}$.
3. **The $180^\circ$ rotation** is mathematically required to convert the entrance forward vector into an exit forward vector.
4. **Screen-space sampling** (`gl_FragCoord.xy / uRes`) ensures the portal behaves like real glass with perspective parallax, rather than a flat TV screen.
