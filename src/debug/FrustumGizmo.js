import * as THREE from 'three';

/**
 * Wireframe view frustum (pyramid from the eye to a far rectangle), optionally cut
 * by a clip plane, for the Bird's-Eye debug view.
 *
 * With a clip plane (the exit portal plane when oblique clipping is ON):
 * - The part of the frustum on the kept side of the plane is drawn solid.
 * - The part that gets clipped away is drawn faint.
 * - The cross-section with the plane is drawn as a filled patch: exactly the region
 *   the oblique near plane slices along.
 *
 * Built geometrically instead of with THREE.CameraHelper: CameraHelper unprojects the
 * corners of the projection matrix, and the corners of an OBLIQUE projection can land
 * behind the camera or at infinity, which draws lines across the whole screen.
 */

// Frustum pyramid: 4 side edges (eye -> far corner) + 4 far-rectangle edges
const EDGES = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1]];
const MAX_SECTION_POINTS = 5; // A plane cuts a 5-faced pyramid in at most 5 points

// Reusable scratch objects
const _points = Array.from({ length: 5 }, () => new THREE.Vector3());
const _section = Array.from({ length: MAX_SECTION_POINTS }, () => new THREE.Vector3());
const _centroid = new THREE.Vector3();
const _axisU = new THREE.Vector3();
const _axisV = new THREE.Vector3();
const _split = new THREE.Vector3();

export class FrustumGizmo {
  /**
   * @param {THREE.Color|number} color
   */
  constructor(color) {
    this.object = new THREE.Group();

    this._kept = createLines(color, 1.0);
    this._cut = createLines(color, 0.25);
    this.object.add(this._kept.mesh, this._cut.mesh);

    // Cross-section patch: triangle fan + outline over the same vertex buffer
    const positions = new THREE.BufferAttribute(new Float32Array(MAX_SECTION_POINTS * 3), 3);
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute('position', positions);
    fillGeometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
    this._fill = new THREE.Mesh(fillGeometry, overlayMaterial(THREE.MeshBasicMaterial, color, 0.18));
    this._fill.material.side = THREE.DoubleSide;

    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute('position', positions);
    this._outline = new THREE.LineLoop(outlineGeometry, overlayMaterial(THREE.LineBasicMaterial, color, 1.0));
    this._sectionPositions = positions;

    for (const mesh of [this._fill, this._outline]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 999;
      this.object.add(mesh);
    }
  }

  /**
   * Rebuilds the wireframe for a camera pose.
   *
   * @param {THREE.Matrix4} cameraMatrix - Camera world matrix (camera looks down its local -Z)
   * @param {number} fov - Vertical field of view in degrees
   * @param {number} aspect - Width / height
   * @param {number} far - Distance of the far rectangle
   * @param {THREE.Plane|null} clipPlane - Points with negative distance are clipped
   */
  update(cameraMatrix, fov, aspect, far, clipPlane = null) {
    // Eye + 4 far corners in world space
    const halfH = far * Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    const halfW = halfH * aspect;
    _points[0].set(0, 0, 0);
    _points[1].set(-halfW, -halfH, -far);
    _points[2].set(halfW, -halfH, -far);
    _points[3].set(halfW, halfH, -far);
    _points[4].set(-halfW, halfH, -far);
    _points.forEach(p => p.applyMatrix4(cameraMatrix));

    this._kept.clear();
    this._cut.clear();
    let sectionCount = 0;

    for (const [i, j] of EDGES) {
      const a = _points[i];
      const b = _points[j];
      const da = clipPlane ? clipPlane.distanceToPoint(a) : 1;
      const db = clipPlane ? clipPlane.distanceToPoint(b) : 1;

      if (da >= 0 && db >= 0) {
        this._kept.push(a, b);
      } else if (da < 0 && db < 0) {
        this._cut.push(a, b);
      } else {
        // The edge crosses the plane: split it and record the crossing point
        _split.lerpVectors(a, b, da / (da - db));
        const keptEnd = da >= 0 ? a : b;
        const cutEnd = da >= 0 ? b : a;
        this._kept.push(keptEnd, _split);
        this._cut.push(cutEnd, _split);
        _section[sectionCount++].copy(_split);
      }
    }

    this._kept.commit();
    this._cut.commit();
    this._updateSection(sectionCount, clipPlane);
  }

  /**
   * Writes the cross-section polygon, ordering its (convex) points by angle around their centroid.
   */
  _updateSection(count, clipPlane) {
    const visible = count >= 3;
    this._fill.visible = visible;
    this._outline.visible = visible;
    if (!visible) return;

    const points = _section.slice(0, count);
    _centroid.set(0, 0, 0);
    points.forEach(p => _centroid.add(p));
    _centroid.divideScalar(count);

    // In-plane basis for measuring angles
    _axisU.subVectors(points[0], _centroid).normalize();
    _axisV.crossVectors(clipPlane.normal, _axisU);
    const angle = p => {
      _split.subVectors(p, _centroid);
      return Math.atan2(_split.dot(_axisV), _split.dot(_axisU));
    };
    points.sort((p, q) => angle(p) - angle(q));

    points.forEach((p, i) => this._sectionPositions.setXYZ(i, p.x, p.y, p.z));
    this._sectionPositions.needsUpdate = true;
    this._fill.geometry.setDrawRange(0, (count - 2) * 3);
    this._outline.geometry.setDrawRange(0, count);
  }
}

/**
 * Debug overlay material: always drawn on top of the scene.
 */
function overlayMaterial(MaterialClass, color, opacity) {
  return new MaterialClass({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
}

/**
 * Fixed-capacity LineSegments buffer refilled every frame.
 */
function createLines(color, opacity) {
  const capacity = EDGES.length * 2;
  const positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);

  const mesh = new THREE.LineSegments(geometry, overlayMaterial(THREE.LineBasicMaterial, color, opacity));
  mesh.frustumCulled = false; // Vertices change every frame
  mesh.renderOrder = 999;

  let count = 0;
  return {
    mesh,
    clear() { count = 0; },
    push(a, b) {
      positions.setXYZ(count++, a.x, a.y, a.z);
      positions.setXYZ(count++, b.x, b.y, b.z);
    },
    commit() {
      positions.needsUpdate = true;
      geometry.setDrawRange(0, count);
    },
  };
}
