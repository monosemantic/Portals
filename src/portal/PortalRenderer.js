import * as THREE from 'three';
import { DEFAULT_DEPTH } from '../config.js';
import { applyObliqueNearPlane } from './obliqueClipping.js';

/**
 * Recursive Portal Renderer.
 *
 * To render portal-in-portal reflections without stencil buffer constraints,
 * this class implements a Depth-First Search (DFS) offscreen rendering pipeline:
 *
 * For a given camera view at recursion level L:
 * 1. Find all portals visible from the camera (front-facing and within view frustum).
 * 2. For each visible portal:
 *    a. Position a virtual camera behind the exit portal.
 *    b. Apply oblique near-plane clipping to slice away intervening walls.
 *    c. Recursively render that view (level L + 1) into an offscreen WebGLRenderTarget.
 * 3. Bind the generated textures to portal surface materials.
 * 4. Render the current scene with the camera into the target buffer (or screen).
 *
 * At the recursion depth limit, portals render a subtle flat tint rather than recursing further.
 */

// Reusable scratch objects for frustum culling to prevent per-frame allocations
const _frustum = new THREE.Frustum();
const _projViewMatrix = new THREE.Matrix4();
const _camWorldPos = new THREE.Vector3();

export class PortalRenderer {
  /**
   * @param {THREE.WebGLRenderer} renderer - The active Three.js WebGL renderer
   * @param {THREE.Scene} scene - The main 3D scene
   * @param {Array<Portal>} portals - List of all portals in the scene
   */
  constructor(renderer, scene, portals) {
    this.renderer = renderer;
    this.scene = scene;
    this.portals = portals;

    this.maxDepth = DEFAULT_DEPTH;   // Recursion depth limit (1 to 5)
    this.obliqueEnabled = true;      // Toggle for oblique near-plane clipping
    this.passes = 0;                 // Number of scene render passes performed in the last frame

    // Cached render target size (kept in sync with the WebGL drawing buffer)
    this.size = new THREE.Vector2(0, 0);
    this._bufferSize = new THREE.Vector2();

    // Map storing RenderTargets per portal per recursion level: Map<Portal, WebGLRenderTarget[]>
    this.targets = new Map();

    // Reusable PerspectiveCamera pool per recursion level
    this.virtualCams = [];

    // Reference to the main player camera of the current frame
    this.rootCamera = null;
  }

  /**
   * Main entry point called every frame.
   * Renders the complete scene (including all recursive portal views) to the screen.
   *
   * @param {THREE.PerspectiveCamera} camera - The player's main camera
   */
  render(camera) {
    this.rootCamera = camera;
    this.passes = 0;

    // Ensure our offscreen render targets match current screen/canvas resolution
    this._syncRenderTargetSizes();

    // Begin recursion at level 0, rendering directly to the screen (target = null)
    this._renderView(camera, 0, null);
  }

  /**
   * Releases GPU memory for a portal when it is removed from the game.
   */
  forget(portal) {
    const list = this.targets.get(portal);
    if (list) {
      list.forEach(rt => rt && rt.dispose());
    }
    this.targets.delete(portal);
  }

  /**
   * Checks if the WebGL drawing buffer size has changed (e.g. window resized),
   * and resizes all off-screen render targets to match.
   */
  _syncRenderTargetSizes() {
    const currentSize = this.renderer.getDrawingBufferSize(this._bufferSize);
    if (currentSize.equals(this.size)) return;

    this.size.copy(currentSize);
    this.targets.forEach(levelTargets => {
      levelTargets.forEach(rt => {
        if (rt) rt.setSize(currentSize.x, currentSize.y);
      });
    });
  }

  /**
   * Retrieves or lazily creates a WebGLRenderTarget for a given portal at a specific recursion level.
   * Distinct recursion levels need separate textures so child renders don't overwrite parent textures.
   */
  _getRenderTarget(portal, level) {
    let levelList = this.targets.get(portal);
    if (!levelList) {
      levelList = [];
      this.targets.set(portal, levelList);
    }
    if (!levelList[level]) {
      levelList[level] = new THREE.WebGLRenderTarget(this.size.x, this.size.y);
    }
    return levelList[level];
  }

  /**
   * Retrieves or lazily creates a pooled virtual camera for a given recursion level.
   */
  _getVirtualCam(level) {
    if (!this.virtualCams[level]) {
      this.virtualCams[level] = new THREE.PerspectiveCamera();
    }
    return this.virtualCams[level];
  }

  /**
   * Frustum Culling & Facing Check:
   * Determines if a portal is actually visible from a camera.
   *
   * Optimization: If a portal is behind the camera or off to the side outside
   * the view frustum, we skip rendering its sub-view entirely, saving expensive draw calls.
   */
  _isPortalVisible(portal, cam) {
    if (!portal.active) return false;

    // Check 1: Camera must be in front of the portal plane
    _camWorldPos.setFromMatrixPosition(cam.matrixWorld);
    if (!portal.isInFront(_camWorldPos)) return false;

    // Check 2: Portal quad must intersect the camera's view frustum
    _projViewMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projViewMatrix);
    return _frustum.intersectsObject(portal.surface);
  }

  /**
   * Positions the virtual camera to view the world from the destination portal,
   * matching the relative angle and perspective of the incoming camera.
   */
  _placeVirtualCamera(virtualCam, sourceCam, portal) {
    // Transform camera world matrix through the portal pair
    portal.mapMatrix(virtualCam.matrixWorld, sourceCam.matrixWorld);

    // Decompose transformed matrix into position, quaternion, and scale
    virtualCam.matrixWorld.decompose(virtualCam.position, virtualCam.quaternion, virtualCam.scale);
    virtualCam.updateMatrixWorld(true);

    // Always start with an unmodified copy of the main projection matrix
    virtualCam.projectionMatrix.copy(this.rootCamera.projectionMatrix);

    // Tilt the near clipping plane to match the exit portal plane
    if (this.obliqueEnabled) {
      applyObliqueNearPlane(virtualCam, portal.link);
    }
  }

  /**
   * Core recursive rendering function (DFS).
   *
   * @param {THREE.Camera} cam - Camera rendering this view
   * @param {number} level - Current recursion level (0 = main player view)
   * @param {THREE.WebGLRenderTarget|null} target - Destination render target (null for screen)
   */
  _renderView(cam, level, target) {
    // 1. Determine which portals are visible from this camera
    const visiblePortals = new Set();
    for (const portal of this.portals) {
      if (this._isPortalVisible(portal, cam)) {
        visiblePortals.add(portal);
      }
    }

    // 2. Recursively render deeper portal views (if below maximum depth limit)
    const portalTextures = new Map();
    if (level < this.maxDepth) {
      const virtualCam = this._getVirtualCam(level + 1);

      for (const portal of visiblePortals) {
        // Place virtual camera at the linked exit portal
        this._placeVirtualCamera(virtualCam, cam, portal);

        // Get dedicated render target for this portal at this level
        const rt = this._getRenderTarget(portal, level);

        // Recurse down to render what the virtual camera sees
        this._renderView(virtualCam, level + 1, rt);

        // Store rendered texture to display on this portal's surface
        portalTextures.set(portal, rt.texture);
      }
    }

    // 3. Configure portal materials for the current render pass
    const isAtDepthLimit = level >= this.maxDepth;
    for (const portal of this.portals) {
      const uniforms = portal.material.uniforms;

      if (portalTextures.has(portal)) {
        // We have a rendered texture: show it on the surface
        portal.surface.visible = true;
        uniforms.map.value = portalTextures.get(portal);
        uniforms.uRes.value.copy(this.size);
        uniforms.uFlat.value = 0.0;
      } else if (isAtDepthLimit && visiblePortals.has(portal)) {
        // At maximum recursion depth: show a subtle flat tinted color
        portal.surface.visible = true;
        uniforms.uFlat.value = 1.0;
      } else {
        // Portal is not visible or facing away: hide surface mesh
        portal.surface.visible = false;
      }
    }

    // 4. Render the scene from the current camera into the target buffer
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, cam);
    this.passes++;
  }
}
