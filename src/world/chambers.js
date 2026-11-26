import { ROOM, PORTAL_WALL_OFFSET } from '../config.js';
import {
  addStandardLighting,
  addPointLight,
  addTorusKnot,
  spinKnot,
  addCubes,
  addColumns,
  addDecoyBehind,
  addGlassDivider,
} from './props.js';

/**
 * Showcase chamber presets.
 *
 * All chambers live inside the same 20 x 20 room shell (ROOM = 10), so wall
 * collision stays trivial. Each preset is plain data plus a build() function:
 *
 * - name:    Label shown in the HUD
 * - portals: [placementA, placementB], each {x, z, rotY} as passed to Portal.place()
 * - spawn:   Player pose {x, z, yaw} applied when the chamber loads
 * - divider: True if the glass wall along x = 0 blocks the player
 * - build(group): Adds props and lights to `group`; may return an update(dt) callback
 */

const NORTH_Z = -ROOM + PORTAL_WALL_OFFSET;
const SOUTH_Z = ROOM - PORTAL_WALL_OFFSET;
const EAST_X = ROOM - PORTAL_WALL_OFFSET;

// Rotations so the portal's front (+Z) faces into the room
const FACE_SOUTH = 0;              // Mounted on the North wall
const FACE_NORTH = Math.PI;        // Mounted on the South wall
const FACE_WEST = -Math.PI / 2;    // Mounted on the East wall

/**
 * Adds the red oblique-clipping decoys behind both portal walls of a chamber.
 */
function addDecoys(group, portals) {
  portals.forEach(placement => addDecoyBehind(group, placement));
}

export const CHAMBERS = [
  {
    // Portals on perpendicular walls with red slabs behind both walls:
    // shows the change-of-basis transform and live oblique clipping (O).
    name: 'Oblique Clipping Lab',
    portals: [
      { x: -3, z: NORTH_Z, rotY: FACE_SOUTH },
      { x: EAST_X, z: 4, rotY: FACE_WEST },
    ],
    spawn: { x: 0, z: 6, yaw: 0 },
    divider: false,
    build(group) {
      addStandardLighting(group);
      addCubes(group, [
        [3, 2, 0x44aaff],
        [-4, 3, 0xaa66ff],
        [-2, -4, 0x66ff88],
        [5, -3, 0xffdd44],
      ]);
      addDecoys(group, this.portals);
      const knot = addTorusKnot(group, [0, 1.8, 0]);
      return dt => spinKnot(knot, dt);
    },
  },

  {
    // Two portals facing each other across the room: recursion depth 1 -> 5
    // produces an infinite hallway of repeated torus knots, columns, and players.
    // The knot sits off the center line so it never hides the player's own reflection.
    name: 'Infinite Mirror Hallway',
    portals: [
      { x: 0, z: NORTH_Z, rotY: FACE_SOUTH },
      { x: 0, z: SOUTH_Z, rotY: FACE_NORTH },
    ],
    spawn: { x: 0, z: 5, yaw: 0 }, // On the axis: you see your own back through Portal A
    divider: false,
    build(group) {
      addStandardLighting(group);
      addColumns(group, [
        [-4.5, -6], [-4.5, -2], [-4.5, 2], [-4.5, 6],
        [4.5, -6], [4.5, -2], [4.5, 2], [4.5, 6],
      ]);
      addDecoys(group, this.portals);
      const knot = addTorusKnot(group, [-2.5, 1.8, 0]);
      return dt => spinKnot(knot, dt);
    },
  },

  {
    // A glass wall splits the room into a cool West half and a warm East half.
    // The only way across is the portal pair, both mounted on the North wall.
    name: 'Split Glass Chamber',
    portals: [
      { x: -5, z: NORTH_Z, rotY: FACE_SOUTH },
      { x: 5, z: NORTH_Z, rotY: FACE_SOUTH },
    ],
    spawn: { x: -2.5, z: 4, yaw: -Math.PI / 6 },
    divider: true,
    build(group) {
      addStandardLighting(group, { ambient: 0.3, lamp: 0 });
      addPointLight(group, 0x5f9dff, 1.3, 13, [-5, 4.5, 0]);  // West: cool blue
      addPointLight(group, 0xffaa44, 1.3, 13, [5, 4.5, 0]);   // East: warm amber
      addGlassDivider(group);
      addCubes(group, [
        [-6.5, 3, 0x44aaff],
        [-3, -4, 0x66ff88],
        [3, -3, 0xffdd44],
        [7, 5, 0xaa66ff],
      ]);
      addDecoys(group, this.portals);
      const knot = addTorusKnot(group, [5, 1.8, 2]);
      return dt => spinKnot(knot, dt);
    },
  },
];
