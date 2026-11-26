import * as THREE from 'three';
import { ROOM, ROOM_H, PLAYER } from '../config.js';

/**
 * Test environment: shared 3D room shell and boundary collision.
 *
 * Color-coded walls (North is Red, South is Green, East is Blue, West is Yellow)
 * provide immediate visual orientation cues when looking through portals.
 */

/**
 * Generates a procedural 2x2 checkerboard texture using an HTML5 2D canvas.
 * Keeps the demo self-contained without needing external image assets.
 */
function createGridTexture(baseColor, checkColor, repeatX, repeatY) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Background base color
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 64, 64);

  // Checker pattern tiles
  ctx.fillStyle = checkColor;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(32, 32, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

/**
 * Helper to create and position a single-sided textured room plane.
 */
function addWallPlane(scene, width, height, accentColor, position, rotX, rotY) {
  const material = new THREE.MeshStandardMaterial({
    map: createGridTexture('#dddddd', accentColor, width / 2, height / 2),
    roughness: 0.9,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotX, rotY, 0); // Planes face +Z by default in Three.js
  scene.add(mesh);
  return mesh;
}

/**
 * Builds the 6 outer bounding planes of the room (Floor, Ceiling, 4 Walls).
 * @returns {THREE.Mesh} The ceiling mesh
 */
function addRoomShell(scene) {
  // Floor (faces +Y)
  addWallPlane(scene, 2 * ROOM, 2 * ROOM, '#888888', [0, 0, 0], -Math.PI / 2, 0);

  // Ceiling (faces -Y)
  const ceiling = addWallPlane(scene, 2 * ROOM, 2 * ROOM, '#666666', [0, ROOM_H, 0], Math.PI / 2, 0);

  // North Wall (Z = -ROOM, red tint, faces +Z into the room)
  addWallPlane(scene, 2 * ROOM, ROOM_H, '#d06a6a', [0, ROOM_H / 2, -ROOM], 0, 0);

  // South Wall (Z = +ROOM, green tint, faces -Z into the room)
  addWallPlane(scene, 2 * ROOM, ROOM_H, '#6ad08a', [0, ROOM_H / 2, ROOM], 0, Math.PI);

  // East Wall (X = +ROOM, blue tint, faces -X into the room)
  addWallPlane(scene, 2 * ROOM, ROOM_H, '#6a8ad0', [ROOM, ROOM_H / 2, 0], 0, -Math.PI / 2);

  // West Wall (X = -ROOM, yellow tint, faces +X into the room)
  addWallPlane(scene, 2 * ROOM, ROOM_H, '#d0c06a', [-ROOM, ROOM_H / 2, 0], 0, Math.PI / 2);

  return ceiling;
}

/**
 * Creates the shared room shell. Chamber-specific props, lights, and fixtures
 * live in chambers.js and are swapped in and out by ChamberManager.
 *
 * @returns {{ceiling: THREE.Mesh}} Handles the debug views need (the ceiling is hidden in Bird's-Eye mode)
 */
export function createRoom(scene) {
  const ceiling = addRoomShell(scene);
  return { ceiling };
}

/**
 * Clamps player position to stay inside room boundaries,
 * EXCEPT when the player is inside an active portal doorway.
 */
export function clampToRoom(position, portals) {
  // If player is stepping through any active portal doorway, bypass wall collision
  for (const portal of portals) {
    if (portal.active && portal.isInDoorway(position, PLAYER.doorwayMargin, PLAYER.doorwayDepth)) {
      return;
    }
  }

  // Constrain position within room boundaries
  const limit = ROOM - PLAYER.radius;
  position.x = Math.max(-limit, Math.min(limit, position.x));
  position.z = Math.max(-limit, Math.min(limit, position.z));
}

/**
 * Keeps the player on one side of a vertical divider along x = 0.
 * The side is taken from the PREVIOUS position, so a large step can never skip across.
 *
 * @param {THREE.Vector3} position - Position to constrain (modified in place)
 * @param {THREE.Vector3} previous - Position at the start of this frame
 * @param {number} halfThickness - Half the divider's physical thickness
 */
export function clampToDivider(position, previous, halfThickness = 0) {
  const limit = PLAYER.radius + halfThickness;
  if (previous.x < 0) {
    position.x = Math.min(position.x, -limit);
  } else {
    position.x = Math.max(position.x, limit);
  }
}
