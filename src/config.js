/**
 * Global configuration settings and tunable constants.
 *
 * Centralizing these values allows easy experimentation with room proportions,
 * camera field of view, player kinematics, and recursion depth limits.
 */

// Room geometry (square room centered at 0, 0, 0)
export const ROOM = 10;            // Half-size of the room (total width/depth = 20 units)
export const ROOM_H = 6;           // Ceiling height (units along Y)

// Portal dimensions and placement
export const PORTAL_W = 2.2;       // Doorway width
export const PORTAL_H = 3.2;       // Doorway height

// Pushed 1 cm in front of the wall plane to eliminate z-fighting
export const PORTAL_WALL_OFFSET = 0.01;

// How far the portal surface box reaches behind the doorway plane (into the wall opening).
// Must exceed the eye-to-near-plane-corner distance (about 0.09 for CAMERA.near = 0.05 at 16:9)
// so the near plane can never clip through the whole surface. Keep it well below the 0.3 gap
// to the red decoy slabs behind the walls.
export const PORTAL_DEPTH = 0.15;

// Rendering and recursion settings
export const DEFAULT_DEPTH = 3;    // Initial recursion depth
export const MAX_LEVELS = 5;       // Maximum recursion depth supported by hotkeys (1-5)

// World-space distance the oblique near plane is pushed BEHIND the exit portal plane,
// so floor/frame geometry exactly at the threshold is never clipped.
// Must stay below PORTAL_WALL_OFFSET, otherwise the wall behind the portal survives clipping.
export const OBLIQUE_BIAS = 0.003;

// MSAA samples for portal render targets (WebGL2 only; 0 disables multisampling)
export const PORTAL_MSAA_SAMPLES = 4;

// Cap pixel ratio to prevent performance drops on Retina/HiDPI screens during recursion
export const MAX_PIXEL_RATIO = 1.5;

// Camera field of view and clipping distances
export const CAMERA = {
  fov: 70,       // Vertical field of view in degrees
  near: 0.05,    // Near clipping plane (close to eye to avoid clipping nearby doorways)
  far: 100,      // Far clipping plane
};

// Player movement and collision settings
export const PLAYER = {
  eyeHeight: 1.6,      // Camera height above floor (standard human eye level)
  speed: 4.0,          // Walking speed in units per second
  lookSpeed: 0.004,    // Mouse look sensitivity (radians per pixel)
  pitchLimit: 1.4,     // Maximum vertical look angle in radians (~80 degrees)
  radius: 0.3,         // Player collision radius kept from walls

  // Walkable half-width of a portal opening is width / 2 + doorwayMargin.
  // Negative keeps the player strictly INSIDE the teleportable opening, so every
  // crossing of the portal plane is guaranteed to hit the doorway and teleport.
  doorwayMargin: -0.1,
};

// Maximum delta time per frame to prevent simulation jumps on tab switch
export const MAX_DT = 0.05;

// Chamber shown on load (0-based index into CHAMBERS; overridable with ?chamber=1..3)
export const DEFAULT_CHAMBER = 0;

// Bird's-Eye debug view (toggle with V)
export const BIRDS_EYE = {
  position: [0, 30, 22],   // Initial overview camera position (high above the South wall)
  target: [0, 0, -2],      // Point the overview camera orbits around / looks at
  fov: 50,
  orbitSpeed: 1.2,         // Q / E orbit speed in radians per second
  minZoom: 0.5,            // Mouse-wheel zoom limits (scale of the initial distance)
  maxZoom: 1.8,
  frustumFar: 8,           // How far the drawn frustums reach into the visible room
  insetWidth: 0.28,        // First-person inset width as a fraction of the screen width
};

// Recursion level colors (toggle with L): the view rendered at level N is tinted with
// colors[N - 1], so nested portal views are easy to tell apart.
export const LEVEL_TINT = {
  amount: 0.35,                                                    // Blend strength (0..1)
  colors: [0x3d7dff, 0x3ddc6a, 0xffd23d, 0xff3dd2, 0xff4d3d],      // Level 1..5: blue, green, yellow, magenta, red
};
