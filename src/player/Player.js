import * as THREE from 'three';
import { PLAYER } from '../config.js';

/**
 * First-person player controller and portal teleportation handler.
 *
 * In this implementation, the player and camera share the same transform:
 * - Camera position matches player eye level (1.6m).
 * - Rotation uses 'YXZ' Euler order (yaw around Y, pitch around X, zero roll).
 * - Seamless teleportation transforms the camera matrix through the portal,
 *   extracting updated yaw and pitch to prevent orientation snapping.
 */

// Reusable scratch objects to prevent allocations in requestAnimationFrame
const _transformMatrix = new THREE.Matrix4();
const _extractedEuler = new THREE.Euler();
const _previousPosition = new THREE.Vector3();

export class Player {
  /**
   * @param {THREE.PerspectiveCamera} camera - The main rendering camera
   * @param {Array<Portal>} portals - List of scene portals to test for crossings
   * @param {Function|null} constrainPosition - Boundary collision function (room walls)
   */
  constructor(camera, portals, constrainPosition = null) {
    this.camera = camera;
    this.portals = portals;
    this.constrainPosition = constrainPosition;

    // View angles in radians
    this.yaw = 0;    // Horizontal rotation (looking left / right)
    this.pitch = 0;  // Vertical rotation (looking up / down)

    // Standard FPS rotation order: Yaw around Y first, then Pitch around X.
    // This avoids gimbal lock within normal viewing ranges and keeps the horizon level.
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, PLAYER.eyeHeight, 6);
  }

  /**
   * Updates player rotation, movement, and checks for portal teleportation.
   *
   * @param {number} dt - Elapsed delta time in seconds
   * @param {Input} input - The active input manager
   */
  update(dt, input) {
    const cam = this.camera;

    // 1. Update mouse look orientation
    const look = input.consumeLook();
    this.yaw -= look.x * PLAYER.lookSpeed;

    // Clamp vertical pitch to prevent flipping upside down
    const nextPitch = this.pitch - look.y * PLAYER.lookSpeed;
    this.pitch = Math.max(-PLAYER.pitchLimit, Math.min(PLAYER.pitchLimit, nextPitch));

    // 2. Update horizontal movement
    const fwd = input.forward;
    const side = input.strafe;

    // Normalize diagonal movement vector so diagonal strafing isn't 1.41x faster
    const moveLength = Math.hypot(fwd, side);
    const speedNormalization = moveLength > 1 ? 1 / moveLength : 1;

    // Record position before this frame's step (needed for continuous crossing detection)
    _previousPosition.copy(cam.position);

    // Compute forward and strafe vectors relative to current yaw
    const forwardX = -Math.sin(this.yaw) * fwd;
    const forwardZ = -Math.cos(this.yaw) * fwd;
    const strafeX = Math.cos(this.yaw) * side;
    const strafeZ = -Math.sin(this.yaw) * side;

    const moveStep = speedNormalization * PLAYER.speed * dt;
    cam.position.x += (forwardX + strafeX) * moveStep;
    cam.position.z += (forwardZ + strafeZ) * moveStep;

    // Apply room boundary wall collision
    if (this.constrainPosition) {
      this.constrainPosition(cam.position);
    }

    // 3. Apply rotation to the camera before running portal crossing checks.
    // This ensures that if a teleport occurs on this frame, the transformed exit
    // orientation already incorporates the latest mouse movement.
    cam.rotation.set(this.pitch, this.yaw, 0);
    cam.updateMatrixWorld(true);

    // 4. Test continuous portal crossing
    for (const portal of this.portals) {
      if (portal.active && portal.crossed(_previousPosition, cam.position)) {
        this.teleport(portal);
        break; // Process at most one portal crossing per frame
      }
    }
  }

  /**
   * Teleports the player through an entrance portal to the linked exit portal.
   *
   * @param {Portal} entrancePortal - The portal the player walked through
   */
  teleport(entrancePortal) {
    const cam = this.camera;
    cam.updateMatrixWorld(true);

    // Transform camera world matrix using the portal pair's mapping matrix
    entrancePortal.mapMatrix(_transformMatrix, cam.matrixWorld);

    // Decompose the new world matrix into position, quaternion, and scale
    _transformMatrix.decompose(cam.position, cam.quaternion, cam.scale);

    // Extract updated yaw and pitch Euler angles from the new orientation quaternion
    _extractedEuler.setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = _extractedEuler.y;
    this.pitch = _extractedEuler.x;

    // Reapply Euler angles to camera and refresh matrices
    cam.rotation.set(this.pitch, this.yaw, 0);
    cam.updateMatrixWorld(true);
  }
}
