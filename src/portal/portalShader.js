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
  void main() {
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

  void main() {
    // If we've reached the recursion depth limit, render a subtle dark tint
    // so the portal looks like a closed gateway rather than an infinite void.
    if (uFlat > 0.5) {
      gl_FragColor = vec4(uTint * 0.2, 1.0);
      return;
    }

    // Convert fragment pixel coordinates to normalized screen UVs in [0.0, 1.0]
    vec2 screenUV = gl_FragCoord.xy / uRes;

    // Sample the virtual camera's render target
    vec3 sceneColor = texture2D(map, screenUV).rgb;

    // Add a subtle 6% color tint to help the player visually distinguish
    // which portal doorway they are looking through (e.g. blue vs. orange).
    vec3 finalColor = mix(sceneColor, uTint, 0.06);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
