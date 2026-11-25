import * as THREE from 'three';
import { OBLIQUE_BIAS } from '../config.js';

/**
 * Oblique Near-Plane Clipping (Eric Lengyel's Algorithm, 2004).
 *
 * Problem:
 * When rendering from a virtual camera positioned behind the exit portal,
 * intervening walls or objects between the camera and doorway would block the view.
 *
 * Solution:
 * Instead of adding clip planes to every shader or using stencil buffers,
 * we tilt the camera's near clipping plane to match the 3D plane of the destination
 * portal by modifying the 3rd row (depth row) of the 4x4 projection matrix.
 * Geometry behind the portal is discarded by the GPU hardware clipping unit before rasterization.
 */

// Reusable scratch objects to prevent garbage collection pauses during render passes
const clipPlaneWorld = new THREE.Plane();
const clipPlaneView = new THREE.Vector4();
const frustumCorner = new THREE.Vector4();

/**
 * Modifies the camera's projection matrix in-place so its near clipping plane
 * matches the plane of the destination portal.
 *
 * @param {THREE.PerspectiveCamera} camera - The virtual camera to modify (must have updated matrices)
 * @param {Portal} destinationPortal - The portal the virtual camera looks out from
 * @param {number} bias - Small offset to prevent self-clipping of the portal quad
 */
export function applyObliqueNearPlane(camera, destinationPortal, bias = OBLIQUE_BIAS) {
  // 1. Define the destination portal's plane in world space (normal pointing out, coplanar with origin)
  clipPlaneWorld.setFromNormalAndCoplanarPoint(
    destinationPortal.normal,
    destinationPortal.origin
  );

  // 2. Transform the clipping plane into camera view space using matrixWorldInverse
  clipPlaneWorld.applyMatrix4(camera.matrixWorldInverse);

  // Plane equation in view space: Ax + By + Cz + D = 0
  clipPlaneView.set(
    clipPlaneWorld.normal.x,
    clipPlaneWorld.normal.y,
    clipPlaneWorld.normal.z,
    clipPlaneWorld.constant
  );

  // In Three.js, projectionMatrix.elements is stored in column-major order:
  // e[0]=M[0][0], e[4]=M[0][1], e[8]=M[0][2],  e[12]=M[0][3]
  // e[1]=M[1][0], e[5]=M[1][1], e[9]=M[1][2],  e[13]=M[1][3]
  // e[2]=M[2][0], e[6]=M[2][1], e[10]=M[2][2], e[14]=M[2][3]
  // e[3]=M[3][0], e[7]=M[3][1], e[11]=M[3][2], e[15]=M[3][3]
  const e = camera.projectionMatrix.elements;

  // 3. Find the frustum corner most opposite to the clipping plane in NDC coordinates (sgn(Cx), sgn(Cy), 1, 1),
  // then unproject it back into view space.
  frustumCorner.x = (Math.sign(clipPlaneView.x) + e[8]) / e[0];
  frustumCorner.y = (Math.sign(clipPlaneView.y) + e[9]) / e[5];
  frustumCorner.z = -1.0;
  frustumCorner.w = (1.0 + e[10]) / e[14];

  // 4. Scale the clip plane vector so the near plane passes exactly through that corner
  const dotProduct = clipPlaneView.dot(frustumCorner);
  const projectionScale = 2.0 / dotProduct;
  clipPlaneView.multiplyScalar(projectionScale);

  // 5. Overwrite the 3rd row (Z/depth row: indices 2, 6, 10, 14) of the projection matrix
  e[2] = clipPlaneView.x;
  e[6] = clipPlaneView.y;
  e[10] = clipPlaneView.z + 1.0 - bias; // Apply slight bias to prevent z-fighting at the threshold
  e[14] = clipPlaneView.w;
}
