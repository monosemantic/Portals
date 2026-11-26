import * as THREE from 'three';
import { ROOM, ROOM_H, PORTAL_WALL_OFFSET } from '../config.js';

/**
 * Reusable prop and lighting builders shared by the showcase chambers.
 *
 * Every builder adds its objects to a caller-owned THREE.Group, so a whole chamber
 * can be removed (and its GPU resources disposed) by dropping that single group.
 */

// Half-thickness of the glass divider's support frame (also used for collision)
export const DIVIDER_HALF_THICKNESS = 0.04;

/**
 * Standard white lighting: soft ambient fill plus an optional central ceiling lamp.
 * @param {{ambient?: number, lamp?: number}} intensities - Pass lamp: 0 to skip the ceiling lamp
 */
export function addStandardLighting(group, { ambient = 0.5, lamp = 0.9 } = {}) {
  group.add(new THREE.AmbientLight(0xffffff, ambient));

  if (lamp > 0) {
    const ceilingLamp = new THREE.PointLight(0xffffff, lamp, 40);
    ceilingLamp.position.set(0, 5, 0);
    group.add(ceilingLamp);
  }
}

/**
 * Colored point light used to give each half of a chamber its own mood.
 */
export function addPointLight(group, color, intensity, distance, position) {
  const light = new THREE.PointLight(color, intensity, distance);
  light.position.set(position[0], position[1], position[2]);
  group.add(light);
  return light;
}

/**
 * Spinning torus knot: continuous motion proves that portal views are live.
 * @returns {THREE.Mesh}
 */
export function addTorusKnot(group, position) {
  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.8, 0.28, 128, 16),
    new THREE.MeshStandardMaterial({ color: 0xff8844, metalness: 0.3, roughness: 0.4 })
  );
  knot.position.set(position[0], position[1], position[2]);
  group.add(knot);
  return knot;
}

/**
 * Advances the torus knot's tumbling animation.
 */
export function spinKnot(knot, dt) {
  knot.rotation.x += dt * 0.7;
  knot.rotation.y += dt * 0.9;
}

/**
 * Unit reference cubes resting on the floor.
 * @param {Array<[number, number, number]>} cubes - Entries of [x, z, color]
 */
export function addCubes(group, cubes) {
  for (const [x, z, color] of cubes) {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color })
    );
    cube.position.set(x, 0.5, z);
    group.add(cube);
  }
}

/**
 * Floor-to-ceiling columns that give depth cues to recursive "hallway" views.
 * @param {Array<[number, number]>} positions - Entries of [x, z]
 */
export function addColumns(group, positions) {
  const geometry = new THREE.CylinderGeometry(0.35, 0.35, ROOM_H, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 });
  for (const [x, z] of positions) {
    const column = new THREE.Mesh(geometry, material);
    column.position.set(x, ROOM_H / 2, z);
    group.add(column);
  }
}

/**
 * Oblique-clipping test fixture: a red slab directly behind the wall a portal hangs on.
 *
 * - Oblique Clipping ON: the virtual camera's near plane cuts the slab away completely.
 * - Oblique Clipping OFF (toggle with 'O'): the slab blocks the view through the portal.
 *
 * @param {{x: number, z: number, rotY: number}} placement - Same arguments as Portal.place()
 */
export function addDecoyBehind(group, { x, z, rotY }) {
  const SLAB_GAP = 0.8; // Distance from the wall plane to the slab center

  // Portal forward (+Z rotated by rotY); the slab sits on the opposite side of the wall
  const normalX = Math.sin(rotY);
  const normalZ = Math.cos(rotY);
  const behind = SLAB_GAP + PORTAL_WALL_OFFSET;

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(10, 6, 1),
    new THREE.MeshBasicMaterial({ color: 0x990000 })
  );
  slab.position.set(x - normalX * behind, 3, z - normalZ * behind);
  slab.rotation.y = rotY;
  group.add(slab);
}

/**
 * Translucent glass wall along x = 0 that splits the room into West and East halves.
 * Collision is handled separately by clampToDivider() in room.js.
 */
export function addGlassDivider(group) {
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * ROOM, ROOM_H),
    new THREE.MeshStandardMaterial({
      color: 0xbfe6ff,
      transparent: true,
      opacity: 0.25,
      roughness: 0.05,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false, // Lets objects behind the glass stay visible
    })
  );
  glass.position.set(0, ROOM_H / 2, 0);
  glass.rotation.y = Math.PI / 2;
  group.add(glass);

  // Thin metal frame so the glass reads as a solid surface
  const t = 2 * DIVIDER_HALF_THICKNESS;
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x2a3340, metalness: 0.6, roughness: 0.4 });

  for (const y of [t / 2, ROOM_H - t / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(t, t, 2 * ROOM), frameMaterial);
    rail.position.set(0, y, 0);
    group.add(rail);
  }
  for (const z of [-6, -2, 2, 6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(t, ROOM_H, t), frameMaterial);
    post.position.set(0, ROOM_H / 2, z);
    group.add(post);
  }
}
