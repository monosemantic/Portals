/**
 * Portal surface shaders (GLSL).
 *
 * The portal surface is a simple 2D plane quad, but it renders an interactive
 * window into another location via screen-space texture mapping:
 *
 * 1. The scene is rendered from a virtual camera at the exit portal into an
 *    offscreen WebGLRenderTarget.
 * 2. Because the virtual camera shares the exact same FOV, aspect ratio, and
 *    projection matrix as the player camera, visible objects occupy the exact
 *    same screen pixel coordinates.
 * 3. By sampling the render target at (gl_FragCoord.xy / resolution), the portal
 *    acts like a perfectly clear glass pane with correct parallax and zero UV distortion.
 */

export const portalVertexShader = `
  // Quad UVs (0..1 across the doorway), used only for the animated energy rim
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // Standard projection: transforms the portal quad vertex from local space
    // to screen clip space.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const portalFragmentShader = `
  // The off-screen scene texture rendered from the virtual camera
  uniform sampler2D map;

  // Render target resolution in pixels (matches the WebGL drawing buffer)
  uniform vec2 uRes;

  // When 1.0, we have reached the max recursion limit: draw a flat color
  // instead of sampling a non-existent deeper level.
  uniform float uFlat;

  // The distinctive color of this portal (e.g., cyan or orange)
  uniform vec3 uTint;

  // Elapsed time in seconds (drives the rim pulse)
  uniform float uTime;

  // Doorway size in world units, so the rim has the same thickness on every side
  uniform vec2 uSize;

  varying vec2 vUv;

  // Rim thickness in world units
  const float RIM_WIDTH = 0.12;

  // Soft glow along the left, right, and top edges (the bottom edge touches the floor).
  float energyRim() {
    vec2 fromEdge = min(vUv, 1.0 - vUv) * uSize;  // distance to the nearest edge per axis
    float sideDist = fromEdge.x;
    float topDist = (1.0 - vUv.y) * uSize.y;
    float rim = 1.0 - smoothstep(0.0, RIM_WIDTH, min(sideDist, topDist));
    float pulse = 0.65 + 0.35 * sin(uTime * 3.0);
    return rim * pulse;
  }

  void main() {
    vec3 baseColor;

    if (uFlat > 0.5) {
      // Reached the recursion depth limit: render a subtle dark tint
      // so the portal looks like a closed gateway rather than an infinite void.
      baseColor = uTint * 0.2;
    } else {
      // Convert fragment pixel coordinates to normalized screen UVs in [0.0, 1.0]
      vec2 screenUV = gl_FragCoord.xy / uRes;

      // Sample the virtual camera's render target, then add a subtle 6% tint so the
      // player can tell which doorway they are looking through (blue vs. orange).
      baseColor = mix(texture2D(map, screenUV).rgb, uTint, 0.06);
    }

    gl_FragColor = vec4(mix(baseColor, uTint, energyRim() * 0.7), 1.0);
  }
`;
