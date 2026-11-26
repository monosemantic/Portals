import * as THREE from 'three';
import { ROOM, ROOM_H, PLAYER, PORTAL_WALL_OFFSET } from '../config.js';

/**
 * Test environment: room shell and boundary collision.
 *
 * Color-coded walls (North is Red, South is Green, East is Blue, West is Yellow)
 * provide immediate visual orientation cues when looking through portals.
 *
 * The floor and ceiling are built once. The four walls are rebuilt per chamber
 * (see addWalls) because they have real openings cut where the portals hang.
 */

// The four walls. rotY turns a +Z-facing plane so it faces into the room,
// exactly like the rotation a portal mounted on that wall uses.
const WALLS = [
  { accent: '#d06a6a', x: 0, z: -ROOM, rotY: 0 },             // North (red)
  { accent: '#6ad08a', x: 0, z: ROOM, rotY: Math.PI },        // South (green)
  { accent: '#6a8ad0', x: ROOM, z: 0, rotY: -Math.PI / 2 },   // East (blue)
  { accent: '#d0c06a', x: -ROOM, z: 0, rotY: Math.PI / 2 },   // West (yellow)
];

// Reusable scratch vectors
const _local = new THREE.Vector3();
const _offset = new THREE.Vector3();

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
 * Checkerboard wall material. One checker tile covers 2 x 2 world units when the
 * geometry's UVs are in world units.
 */
function createWallMaterial(accentColor, uvScale = 1) {
  return new THREE.MeshStandardMaterial({
    map: createGridTexture('#dddddd', accentColor, uvScale / 2, uvScale / 2),
    roughness: 0.9,
  });
}

/**
 * Builds the floor and ceiling (shared by every chamber).
 *
 * @returns {{ceiling: THREE.Mesh}} Handles the debug views need (the ceiling is hidden in Bird's-Eye mode)
 */
export function createRoom(scene) {
  const size = 2 * ROOM;

  // PlaneGeometry UVs run 0..1, so scale the texture repeat by the plane size
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), createWallMaterial('#888888', size));
  floor.rotation.x = -Math.PI / 2; // Faces +Y
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(size, size), createWallMaterial('#666666', size));
  ceiling.position.y = ROOM_H;
  ceiling.rotation.x = Math.PI / 2; // Faces -Y
  scene.add(ceiling);

  return { ceiling };
}

/**
 * Adds the four walls to `group`, each with a floor-level opening behind every
 * portal mounted on it.
 *
 * The openings matter for rendering: the portal surface is a shallow box reaching
 * behind the wall plane (see Portal.js). Without a hole, the wall would hide that box
 * whenever the camera's near plane clips the portal's front quad.
 *
 * @param {THREE.Group} group - Chamber group the wall meshes are added to
 * @param {Array<Portal>} portals - Portals already placed for this chamber
 */
export function addWalls(group, portals) {
  for (const wall of WALLS) {
    const openings = portals
      .map(portal => wallOpening(wall, portal))
      .filter(Boolean)
      .sort((a, b) => a.left - b.left);

    // ShapeGeometry UVs equal the shape coordinates (world units), so the
    // checkerboard continues seamlessly around the openings.
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(createWallShape(openings)),
      createWallMaterial(wall.accent)
    );
    mesh.position.set(wall.x, 0, wall.z);
    mesh.rotation.y = wall.rotY;
    group.add(mesh);
  }
}

/**
 * Returns the opening {left, right, top} a portal needs in `wall`, in the wall's
 * local coordinates (x along the wall, y up from the floor), or null if the portal
 * is not mounted on this wall.
 */
function wallOpening(wall, portal) {
  const normalX = Math.sin(wall.rotY);
  const normalZ = Math.cos(wall.rotY);
  _offset.set(portal.origin.x - wall.x, 0, portal.origin.z - wall.z);

  const facesSameWay = portal.normal.x * normalX + portal.normal.z * normalZ > 0.99;
  const onWallPlane = Math.abs(_offset.x * normalX + _offset.z * normalZ) < 0.1;
  if (!facesSameWay || !onWallPlane) return null;

  // Wall local +X in world space is (cos rotY, 0, -sin rotY)
  const center = _offset.x * Math.cos(wall.rotY) - _offset.z * Math.sin(wall.rotY);
  return { left: center - portal.width / 2, right: center + portal.width / 2, top: portal.height };
}

/**
 * Outline of a full wall (2 * ROOM wide, ROOM_H tall) with rectangular notches
 * cut up from the floor for each opening. Openings must be sorted left to right.
 */
function createWallShape(openings) {
  const shape = new THREE.Shape();
  shape.moveTo(-ROOM, 0);
  for (const { left, right, top } of openings) {
    shape.lineTo(left, 0);
    shape.lineTo(left, top);
    shape.lineTo(right, top);
    shape.lineTo(right, 0);
  }
  shape.lineTo(ROOM, 0);
  shape.lineTo(ROOM, ROOM_H);
  shape.lineTo(-ROOM, ROOM_H);
  shape.closePath();
  return shape;
}

/**
 * Keeps the player inside the room, except where a portal opening lets them
 * walk up to (and through) the portal plane.
 *
 * @param {THREE.Vector3} position - Position to constrain (modified in place)
 * @param {THREE.Vector3} previous - Position at the start of this frame
 * @param {Array<Portal>} portals
 */
export function clampToRoom(position, previous, portals) {
  for (const portal of portals) {
    if (portal.active && resolveDoorway(position, previous, portal)) {
      return;
    }
  }

  // Constrain position within room boundaries
  const limit = ROOM - PLAYER.radius;
  position.x = Math.max(-limit, Math.min(limit, position.x));
  position.z = Math.max(-limit, Math.min(limit, position.z));
}

/**
 * Doorway collision for one portal, in the portal's local frame (x across, z out of the wall).
 *
 * The "wall line" is PLAYER.radius in front of the wall, where the room clamp stops the player.
 * - Coming from the room, the player may only cross the wall line inside the opening.
 * - Once past it (in the doorway), the door jambs clamp them sideways, so strafing
 *   never snaps them backwards into the room.
 * The walkable half-width (width / 2 + doorwayMargin) is narrower than the teleport
 * check in Portal.crossed(), so every crossing of the portal plane teleports.
 *
 * @returns {boolean} True if the position is legal inside this doorway (skip the room clamp)
 */
function resolveDoorway(position, previous, portal) {
  const halfOpening = portal.width / 2 + PLAYER.doorwayMargin;

  // Past the wall line (the portal hangs PORTAL_WALL_OFFSET in front of the wall)
  // AND within this opening's width: another portal may sit on the same wall.
  portal.toLocal(_local, previous);
  const wasInDoorway = _local.z + PORTAL_WALL_OFFSET < PLAYER.radius
    && Math.abs(_local.x) <= halfOpening + 1e-6;

  portal.toLocal(_local, position);
  if (_local.z + PORTAL_WALL_OFFSET >= PLAYER.radius) return false; // Not past the wall line

  if (!wasInDoorway) {
    return Math.abs(_local.x) < halfOpening; // Entering: only through the opening
  }

  // Already in the doorway: the jambs stop sideways movement
  _local.x = THREE.MathUtils.clamp(_local.x, -halfOpening, halfOpening);
  position.copy(_local.applyMatrix4(portal.world));
  return true;
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
