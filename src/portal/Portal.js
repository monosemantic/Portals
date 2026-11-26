import * as THREE from 'three';
import { PORTAL_W, PORTAL_H, PORTAL_DEPTH } from '../config.js';
import { portalVertexShader, portalFragmentShader } from './portalShader.js';

/**
 * Portal entity and coordinate space transformations.
 *
 * Local orientation:
 * - Local +Z is the FRONT of the portal (entrance threshold facing out).
 * - Local +Y is UP (vertical axis, origin at the floor).
 * - Local +X is RIGHT (across the doorway width).
 *
 * Note on the 180° rotation:
 * Walking into the front (+Z) of Portal A means emerging out of the front (+Z) of Portal B.
 * Without a 180° rotation around Y, walking through Portal A would leave the player
 * facing backwards into the wall behind Portal B.
 */
const ROTATION_180_Y = new THREE.Matrix4().makeRotationY(Math.PI);

// Reusable scratch vectors to avoid allocations during per-frame physics checks
const _scratchA = new THREE.Vector3();
const _scratchB = new THREE.Vector3();

const FRAME_THICKNESS = 0.15; // Visual border thickness for the portal doorway

/**
 * Builds the portal surface as an open-bottomed box: the doorway quad at local z = 0
 * plus side, top, and back faces extending `depth` units behind it (into the wall opening).
 *
 * Why a box instead of a flat quad: when the camera is closer to the portal than its
 * near-plane distance, the GPU clips the front quad and the player would briefly see
 * the wall behind it. Because the portal shader samples in SCREEN space, every face of
 * the box shows exactly the same image, so the faces behind the front quad seamlessly
 * take over. There is no bottom face, which would z-fight with the floor.
 */
function createPortalSurfaceGeometry(width, height, depth) {
  const x = width / 2;
  const z = -depth;
  const positions = [
    -x, 0, 0, x, 0, 0, x, height, 0, -x, height, 0, // 0-3: front (doorway plane)
    -x, 0, z, x, 0, z, x, height, z, -x, height, z, // 4-7: back
  ];
  const quads = [
    [0, 1, 2, 3], // front
    [5, 4, 7, 6], // back
    [4, 0, 3, 7], // left
    [1, 5, 6, 2], // right
    [3, 2, 6, 7], // top
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]));
  return geometry;
}

export class Portal {
  /**
   * Creates a new portal entity.
   * @param {number|string} color - Hex color for the portal frame and subtle surface tint
   * @param {number} width - Doorway width in world units
   * @param {number} height - Doorway height in world units
   */
  constructor(color, width = PORTAL_W, height = PORTAL_H) {
    this.width = width;
    this.height = height;
    this.link = null;          // Reference to the connected paired portal
    this.enabled = true;       // When false, the portal is invisible and deactivated

    // Cached spatial properties (recomputed whenever place() is called)
    this.origin = new THREE.Vector3();          // Center of the portal threshold on the floor
    this.normal = new THREE.Vector3(0, 0, 1);   // World-space forward vector (+Z)
    this.worldInverse = new THREE.Matrix4();    // Matrix to transform from world space into portal local space

    // Root Three.js group for this portal's visual and collision components
    this.group = new THREE.Group();

    // The portal surface shader: samples the virtual camera's render target in screen space.
    // Double-sided so the inner faces of the surface box render too; whether the portal
    // is drawn at all is decided per pass by PortalRenderer (front-facing + frustum check).
    this.material = new THREE.ShaderMaterial({
      vertexShader: portalVertexShader,
      fragmentShader: portalFragmentShader,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: null },                    // Injected every frame by PortalRenderer
        uRes: { value: new THREE.Vector2(1, 1) },// Screen drawing buffer resolution
        uFlat: { value: 0 },                     // 1.0 when recursion depth limit is reached
        uTint: { value: new THREE.Color(color) },// Frame color accent
        uTime: { value: 0 },                     // Seconds elapsed (animated energy rim)
        uSize: { value: new THREE.Vector2(width, height) }, // Doorway size in world units
        uLevelTint: { value: new THREE.Vector4(0, 0, 0, 0) } // Recursion level debug tint (set by PortalRenderer)
      },
    });

    // The portal surface mesh (doorway quad + shallow box behind it, bottom on the floor)
    this.surface = new THREE.Mesh(createPortalSurfaceGeometry(width, height, PORTAL_DEPTH), this.material);
    this.group.add(this.surface);

    // Build the visual border frame
    this._buildFrame(color);

    // Place at default position (0, 0, 0)
    this.place(0, 0, 0);
  }

  /**
   * Constructs the visible rectangular frame around the portal (left, right, and top borders).
   */
  _buildFrame(color) {
    const t = FRAME_THICKNESS;
    const w = this.width;
    const h = this.height;
    const frameMaterial = new THREE.MeshBasicMaterial({ color });

    // Left vertical post
    const leftPost = new THREE.Mesh(new THREE.BoxGeometry(t, h + t, t), frameMaterial);
    leftPost.position.set(-w / 2 - t / 2, h / 2, 0);

    // Right vertical post
    const rightPost = new THREE.Mesh(new THREE.BoxGeometry(t, h + t, t), frameMaterial);
    rightPost.position.set(w / 2 + t / 2, h / 2, 0);

    // Top horizontal header
    const topHeader = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * t, t, t), frameMaterial);
    topHeader.position.set(0, h + t / 2, 0);

    this.group.add(leftPost, rightPost, topHeader);
  }

  /**
   * Advances time-based visual effects (the pulsing energy rim).
   * @param {number} elapsed - Seconds since start
   */
  tick(elapsed) {
    this.material.uniforms.uTime.value = elapsed;
  }

  /**
   * Connects two portals bidirectionally so they teleport to each other.
   */
  static link(portalA, portalB) {
    portalA.link = portalB;
    portalB.link = portalA;
  }

  /**
   * Returns the world transform matrix of this portal.
   */
  get world() {
    return this.group.matrixWorld;
  }

  /**
   * True if both this portal and its connected destination are ready for rendering/teleporting.
   */
  get active() {
    return this.enabled && this.link !== null && this.link.enabled;
  }

  /**
   * Enables or disables this portal.
   */
  setEnabled(value) {
    this.enabled = value;
    this.group.visible = value;
  }

  /**
   * Positions and rotates the portal in the world.
   * Recomputes all cached matrices and vectors.
   *
   * @param {number} x - Floor X coordinate
   * @param {number} z - Floor Z coordinate
   * @param {number} rotY - Rotation around the Y axis in radians (0 = facing +Z)
   */
  place(x, z, rotY) {
    this.group.position.set(x, 0, z);
    this.group.rotation.set(0, rotY, 0);
    this.group.updateMatrixWorld(true);

    // Cache the inverse world matrix for quick local-space conversions
    this.worldInverse.copy(this.world).invert();

    // Cache origin and forward direction vector in world coordinates
    this.origin.copy(this.group.position);
    this.normal.set(0, 0, 1).transformDirection(this.world);
  }

  /**
   * Transforms a world-space matrix `sourceMatrix` as if it traveled through this
   * portal and exited through the linked portal:
   *
   *   Result = M_exit * R_180 * M_entrance_inverse * sourceMatrix
   *
   * Used to position virtual cameras, teleport the player, or transform physics velocities.
   *
   * @param {THREE.Matrix4} outMatrix - Matrix receiving the result
   * @param {THREE.Matrix4} sourceMatrix - Input world matrix to transform
   * @returns {THREE.Matrix4} The transformed matrix
   */
  mapMatrix(outMatrix, sourceMatrix) {
    return outMatrix
      .copy(this.link.world)        // Step 3: Transform from exit portal local space to world space
      .multiply(ROTATION_180_Y)     // Step 2: Rotate 180 degrees around Y so forward stays forward
      .multiply(this.worldInverse)  // Step 1: Transform from world space to entrance portal local space
      .multiply(sourceMatrix);      // Input transform
  }

  /**
   * Transforms a 3D point from world space into this portal's local coordinate system.
   */
  toLocal(outPoint, worldPoint) {
    return outPoint.copy(worldPoint).applyMatrix4(this.worldInverse);
  }

  /**
   * Checks if a world position is in front of the portal plane (local Z > 0).
   */
  isInFront(worldPoint) {
    return this.toLocal(_scratchA, worldPoint).z > 0;
  }

  /**
   * Continuous Collision Detection (CCD):
   * Determines if the player crossed the portal plane from front to back during the last frame step.
   *
   * @param {THREE.Vector3} oldPos - World position at the start of the frame
   * @param {THREE.Vector3} newPos - World position at the end of the frame
   * @returns {boolean} True if the movement path pierced the portal doorway
   */
  crossed(oldPos, newPos) {
    const localStart = this.toLocal(_scratchA, oldPos);
    const localEnd = this.toLocal(_scratchB, newPos);

    // The player must transition from in front (Z >= 0) to behind (Z < 0)
    if (!(localStart.z >= 0 && localEnd.z < 0)) {
      return false;
    }

    // Find the intersection fraction 't' along the segment where Z = 0:
    // localStart.z + t * (localEnd.z - localStart.z) = 0  ==>  t = localStart.z / (localStart.z - localEnd.z)
    const t = localStart.z / (localStart.z - localEnd.z);

    // Compute the exact (X, Y) coordinates where the path crossed the Z = 0 plane
    const hitX = localStart.x + (localEnd.x - localStart.x) * t;
    const hitY = localStart.y + (localEnd.y - localStart.y) * t;

    // Check if the intersection point is inside the doorway rectangle:
    // X is centered at 0, Y goes from floor (0) to portal height (H)
    const withinHorizontalBounds = Math.abs(hitX) < this.width / 2;
    const withinVerticalBounds = hitY > 0 && hitY < this.height;

    return withinHorizontalBounds && withinVerticalBounds;
  }
}
