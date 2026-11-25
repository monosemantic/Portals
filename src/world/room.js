import * as THREE from 'three';
import { ROOM, ROOM_H, PLAYER } from '../config.js';

/**
 * Test environment: 3D room shell, props, lighting, and boundary collision.
 *
 * Visual design features:
 * - Color-coded walls (North is Red, South is Green, East is Blue, West is Yellow)
 *   provide immediate visual orientation cues when looking through portals.
 * - Rotating center torus knot provides continuous motion to prove portal views are live.
 * - Red decoy occluder slabs behind portal walls demonstrate oblique near-plane clipping.
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
}

/**
 * Builds the 6 outer bounding planes of the room (Floor, Ceiling, 4 Walls).
 */
function addRoomShell(scene) {
  // Floor (faces +Y)
  addWallPlane(scene, 2 * ROOM, 2 * ROOM, '#888888', [0, 0, 0], -Math.PI / 2, 0);

  // Ceiling (faces -Y)
  addWallPlane(scene, 2 * ROOM, 2 * ROOM, '#666666', [0, ROOM_H, 0], Math.PI / 2, 0);

  // North Wall (Z = -ROOM, red tint, faces +Z into the room)
  addWallPlane(scene, 2 * ROOM, ROOM_H, '#d06a6a', [0, ROOM_H / 2, -ROOM], 0, 0);

  // South Wall (Z = +ROOM, green tint, faces -Z into the room)
  addWallPlane(scene, 2 * ROOM, ROOM_H, '#6ad08a', [0, ROOM_H / 2, ROOM], 0, Math.PI);

  // East Wall (X = +ROOM, blue tint, faces -X into the room)
  addWallPlane(scene, 2 * ROOM, ROOM_H, '#6a8ad0', [ROOM, ROOM_H / 2, 0], 0, -Math.PI / 2);

  // West Wall (X = -ROOM, yellow tint, faces +X into the room)
  addWallPlane(scene, 2 * ROOM, ROOM_H, '#d0c06a', [-ROOM, ROOM_H / 2, 0], 0, Math.PI / 2);
}

/**
 * Adds distinct landmark props inside the room to make perspective and parallax obvious.
 */
function addRoomProps(scene) {
  // Animated central torus knot
  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.8, 0.28, 128, 16),
    new THREE.MeshStandardMaterial({ color: 0xff8844, metalness: 0.3, roughness: 0.4 })
  );
  knot.position.set(0, 1.8, 0);
  scene.add(knot);

  // Scattered colored reference cubes
  const cubeData = [
    [3, 0.5, 2, 0x44aaff],
    [-4, 0.5, 3, 0xaa66ff],
    [-2, 0.5, -4, 0x66ff88],
    [5, 0.5, -3, 0xffdd44],
  ];

  for (const [x, y, z, color] of cubeData) {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color })
    );
    cube.position.set(x, y, z);
    scene.add(cube);
  }

  return knot;
}

/**
 * Sets up basic ambient and point lighting.
 */
function addLighting(scene) {
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const ceilingLamp = new THREE.PointLight(0xffffff, 0.9, 40);
  ceilingLamp.position.set(0, 5, 0);
  scene.add(ceilingLamp);
}

/**
 * Test fixture: Red occluder slabs placed directly behind the portal walls.
 *
 * Demonstrates Eric Lengyel's oblique clipping live in action:
 * - Oblique Clipping ON: The near plane cuts away these red slabs completely.
 * - Oblique Clipping OFF (toggle with 'O'): The red slabs obscure the portal view.
 */
function addDecoyOccluders(scene) {
  const createSlab = (x, z, sx, sz) => {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(sx, 6, sz),
      new THREE.MeshBasicMaterial({ color: 0x990000 })
    );
    slab.position.set(x, 3, z);
    scene.add(slab);
  };

  // Behind Portal A (North Wall)
  createSlab(-3, -ROOM - 0.8, 10, 1);

  // Behind Portal B (East Wall)
  createSlab(ROOM + 0.8, 4, 1, 10);
}

/**
 * Creates and initializes the test room environment.
 * @returns {object} Object with update(dt) method for scene animations
 */
export function createRoom(scene) {
  addRoomShell(scene);
  const rotatingKnot = addRoomProps(scene);
  addLighting(scene);
  addDecoyOccluders(scene);

  return {
    update(dt) {
      // Continuous rotation to prove live rendering inside portals
      rotatingKnot.rotation.x += dt * 0.7;
      rotatingKnot.rotation.y += dt * 0.9;
    },
  };
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
