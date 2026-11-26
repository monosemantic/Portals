import * as THREE from 'three';
import { DEFAULT_DEPTH, PORTAL_MSAA_SAMPLES, LEVEL_TINT } from '../config.js';
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
 *
 * The viewer object (the player's avatar) is hidden in the level-0 pass only, so the
 * player never sees their own body up close but does see it through portals.
 *
 * Self-recursion guard: a virtual camera sits just behind its exit portal, so that
 * portal is excluded from the child pass (floating-point noise could otherwise make
 * it look "in front" and render a view of itself).
 */

// Reusable scratch objects for frustum culling to prevent per-frame allocations
const _frustum = new THREE.Frustum();
const _projViewMatrix = new THREE.Matrix4();
const _camWorldPos = new THREE.Vector3();

// Debug tint per recursion level (index = level of the view shown, minus 1)
const LEVEL_COLORS = LEVEL_TINT.colors.map(color => new THREE.Color(color));

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
    this.levelTint = false;          // Toggle for the per-recursion-level debug tint
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

    // Object representing the viewer (player avatar), shown only in portal views
    this.viewer = null;
    this.showViewer = true;

    // Portals that were visible from the root camera last frame (read by debug views)
    this.visibleFromRoot = new Set();

    // Multisampled targets give antialiased portal interiors, but require WebGL2
    this._useMsaa = PORTAL_MSAA_SAMPLES > 0 && renderer.capabilities.isWebGL2;
  }

  /**
   * Main entry point called every frame.
   * Renders the complete scene (including all recursive portal views) to the screen.
   *
   * @param {THREE.PerspectiveCamera} camera - The player's main camera
   * @param {THREE.WebGLRenderTarget|null} target - Final destination (null = screen).
   *        Must match the drawing buffer size, since portals sample in screen space.
   */
  render(camera, target = null) {
    this.rootCamera = camera;
    this.passes = 0;

    // Ensure our offscreen render targets match current screen/canvas resolution
    this._syncRenderTargetSizes();

    // Begin recursion at level 0, rendering to the screen (or the requested target)
    this._renderView(camera, 0, target);
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
      levelList[level] = this._createRenderTarget();
    }
    return levelList[level];
  }

  /**
   * Allocates one portal render target at the current drawing buffer size.
   */
  _createRenderTarget() {
    if (this._useMsaa) {
      const rt = new THREE.WebGLMultisampleRenderTarget(this.size.x, this.size.y);
      rt.samples = PORTAL_MSAA_SAMPLES;
      return rt;
    }
    return new THREE.WebGLRenderTarget(this.size.x, this.size.y);
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
   *
   * Public so debug tools can reproduce the exact camera of a pass (call after render()).
   */
  placeVirtualCamera(virtualCam, sourceCam, portal) {
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
   * @param {Portal|null} excludePortal - Portal this camera looks out of (never rendered in this pass)
   */
  _renderView(cam, level, target, excludePortal = null) {
    // 1. Determine which portals are visible from this camera
    const visiblePortals = new Set();
    for (const portal of this.portals) {
      if (portal === excludePortal) continue;
      if (this._isPortalVisible(portal, cam)) {
        visiblePortals.add(portal);
      }
    }
    if (level === 0) {
      this.visibleFromRoot = visiblePortals;
    }

    // 2. Recursively render deeper portal views (if below maximum depth limit)
    const portalTextures = new Map();
    if (level < this.maxDepth) {
      const virtualCam = this._getVirtualCam(level + 1);

      for (const portal of visiblePortals) {
        // Place virtual camera at the linked exit portal
        this.placeVirtualCamera(virtualCam, cam, portal);

        // Get dedicated render target for this portal at this level
        const rt = this._getRenderTarget(portal, level);

        // Recurse down to render what the virtual camera sees
        // (the exit portal is excluded so the virtual camera never sees through itself)
        this._renderView(virtualCam, level + 1, rt, portal.link);

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
        this._setLevelTint(uniforms.uLevelTint.value, level + 1);
      } else if (isAtDepthLimit && visiblePortals.has(portal)) {
        // At maximum recursion depth: show a subtle flat tinted color
        portal.surface.visible = true;
        uniforms.uFlat.value = 1.0;
      } else {
        // Portal is not visible or facing away: hide surface mesh
        portal.surface.visible = false;
      }
    }

    // 4. Render the scene from the current camera into the target buffer.
    //    The viewer's own body is hidden in the player's view, visible through portals.
    if (this.viewer) {
      this.viewer.visible = this.showViewer && level > 0;
    }
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, cam);
    this.passes++;
  }

  /**
   * Writes the debug tint for a view rendered at `viewLevel` (1 = first portal view).
   * Strength 0 disables it.
   */
  _setLevelTint(tint, viewLevel) {
    const color = LEVEL_COLORS[(viewLevel - 1) % LEVEL_COLORS.length];
    tint.set(color.r, color.g, color.b, this.levelTint ? LEVEL_TINT.amount : 0);
  }
}
