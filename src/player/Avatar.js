import * as THREE from 'three';
import { PLAYER } from '../config.js';

/**
 * Visible body of the player.
 *
 * - Seen through portals ("see yourself"): PortalRenderer shows it in every portal
 *   pass and hides it in the player's own first-person pass.
 * - Seen from above: the Bird's-Eye view draws it as the player position marker.
 *
 * Hidden by default; the renderers decide per pass whether it is drawn.
 */
export class Avatar {
  constructor() {
    this.object = createAvatarMesh();
    this.object.visible = false;
  }

  /**
   * Places the body under the player's eye, facing the player's yaw.
   * @param {Player} player
   */
  sync(player) {
    const eye = player.camera.position;
    this.object.position.set(eye.x, eye.y - PLAYER.eyeHeight, eye.z);
    this.object.rotation.y = player.yaw;
  }
}

/**
 * Body cylinder, head sphere at eye height, and a cone "nose" pointing along -Z (forward).
 */
function createAvatarMesh() {
  const group = new THREE.Group();
  const r = PLAYER.radius;
  const headRadius = 0.2;
  const bodyHeight = PLAYER.eyeHeight - headRadius - 0.05;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, bodyHeight, 24),
    new THREE.MeshStandardMaterial({ color: 0x3ddc97, roughness: 0.6 })
  );
  body.position.y = bodyHeight / 2;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xe8f5ef, roughness: 0.5 })
  );
  head.position.y = PLAYER.eyeHeight;

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.4, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
  );
  nose.rotation.x = -Math.PI / 2; // Cone tip (+Y) now points along -Z (forward)
  nose.position.set(0, PLAYER.eyeHeight, -headRadius - 0.15);

  group.add(body, head, nose);
  return group;
}
