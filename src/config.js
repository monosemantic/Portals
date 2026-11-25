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

// Rendering and recursion settings
export const DEFAULT_DEPTH = 3;    // Initial recursion depth
export const MAX_LEVELS = 5;       // Maximum recursion depth supported by hotkeys (1-5)

// Small offset on the oblique near plane to prevent the portal mesh from clipping itself
export const OBLIQUE_BIAS = 0.003;

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

  // Buffer zone around portal openings where wall collision is lifted
  doorwayMargin: 0.2,  // Extra horizontal clearance around portal width
  doorwayDepth: 0.7,   // Distance from wall plane where wall collision is disabled
};

// Maximum delta time per frame to prevent simulation jumps on tab switch
export const MAX_DT = 0.05;
