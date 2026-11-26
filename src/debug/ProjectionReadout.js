import * as THREE from 'three';

/**
 * Live HUD readout of row 3 (the depth row) of the projection matrix (toggle with M).
 *
 * Shows the player camera's standard row next to the row used by the level-1 virtual
 * camera of the first portal in view. With oblique clipping ON, that row is the one
 * Eric Lengyel's method overwrites, so the numbers change as the player moves.
 *
 * The virtual camera is rebuilt with PortalRenderer.placeVirtualCamera(), so the
 * readout shows exactly the matrix used for rendering this frame.
 */
export class ProjectionReadout {
  /**
   * @param {PortalRenderer} portalRenderer
   */
  constructor(portalRenderer) {
    this.portalRenderer = portalRenderer;
    this.enabled = false;
    this._camera = new THREE.PerspectiveCamera();
  }

  toggle() {
    this.enabled = !this.enabled;
  }

  /**
   * Builds the readout for this frame. Call after PortalRenderer.render().
   *
   * @param {THREE.PerspectiveCamera} playerCam
   * @returns {string} HUD HTML, or '' when disabled
   */
  html(playerCam) {
    if (!this.enabled) return '';

    const renderer = this.portalRenderer;
    const lines = [
      'Projection row 3 (depth row) (M)',
      '  standard ' + formatRow(playerCam.projectionMatrix),
    ];

    const portal = renderer.visibleFromRoot.values().next().value;
    if (!portal) {
      lines.push('  (no portal in view)');
    } else {
      renderer.placeVirtualCamera(this._camera, playerCam, portal);
      const swatch = '<span style="color:#' + portal.material.uniforms.uTint.value.getHexString() + '">&#9632;</span>';
      lines.push('  ' + swatch + ' portal ' + formatRow(this._camera.projectionMatrix));
      lines.push('  ' + describe(renderer, this._camera.projectionMatrix, playerCam.projectionMatrix));
    }

    return '<div class="hud-matrix">' + lines.join('\n') + '</div>';
  }
}

/**
 * Row 3 of a column-major Three.js matrix: elements 2, 6, 10, 14.
 */
function formatRow(matrix) {
  const e = matrix.elements;
  const cells = [e[2], e[6], e[10], e[14]].map(v => v.toFixed(3).padStart(7));
  return '[' + cells.join(' ') + ' ]';
}

/**
 * Explains why the virtual camera's row is (or is not) oblique.
 */
function describe(renderer, virtualProjection, standardProjection) {
  if (!renderer.obliqueEnabled) return '-> oblique OFF: standard near plane';
  if (virtualProjection.equals(standardProjection)) return '-> guard: camera at exit plane, standard kept';
  return '-> oblique: near plane = exit portal plane';
}
