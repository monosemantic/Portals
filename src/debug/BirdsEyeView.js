import * as THREE from 'three';
import { BIRDS_EYE, CAMERA } from '../config.js';
import { FrustumGizmo } from './FrustumGizmo.js';

/**
 * Bird's-Eye debug view (toggle with V).
 *
 * Renders the room from an elevated overview camera with the ceiling removed and shows:
 * - The player's avatar as a position and facing marker.
 * - The player camera frustum (white).
 * - The level-1 virtual camera frustum of every portal the player can currently see,
 *   tinted with that portal's color. With oblique clipping ON, it is cut by the exit
 *   portal's plane: the clipped part turns faint and the cut shows as a filled patch.
 * - An inset with the player's actual first-person view (portals fully rendered).
 *
 * WASD and mouse-look keep driving the player, so the frustums move live.
 * Q / E orbit the overview camera, the mouse wheel zooms.
 *
 * Pass order per frame:
 * 1. PortalRenderer runs normally (debug objects hidden, so they never leak into
 *    portal textures) and writes the player's final view into the inset target.
 * 2. The frustum gizmos are synced to this frame's cameras.
 * 3. The scene is drawn from the overview camera to the screen.
 * 4. The inset is composited into the bottom-right corner.
 */

const INSET_MARGIN = 12;       // CSS pixels from the screen corner
const INSET_BORDER = 2;        // CSS pixels
const INSET_BORDER_COLOR = new THREE.Color(0x3ddc97);
const PLAYER_FRUSTUM_COLOR = 0xffffff;

// Reusable scratch objects
const _size = new THREE.Vector2();
const _savedClearColor = new THREE.Color();
const _virtualMatrix = new THREE.Matrix4();
const _virtualEye = new THREE.Vector3();
const _clipPlane = new THREE.Plane();

export class BirdsEyeView {
  /**
   * @param {object} deps
   * @param {THREE.WebGLRenderer} deps.renderer
   * @param {THREE.Scene} deps.scene
   * @param {PortalRenderer} deps.portalRenderer
   * @param {Player} deps.player
   * @param {Array<Portal>} deps.portals
   * @param {THREE.Mesh} deps.ceiling - Hidden during the overview pass
   * @param {Avatar} deps.avatar - Player body, forced visible during the overview pass
   */
  constructor({ renderer, scene, portalRenderer, player, portals, ceiling, avatar }) {
    this.renderer = renderer;
    this.scene = scene;
    this.portalRenderer = portalRenderer;
    this.player = player;
    this.portals = portals;
    this.ceiling = ceiling;
    this.avatar = avatar;
    this.enabled = false;

    this._setupOverviewCamera();

    // Everything drawn only in the overview pass lives in one group, hidden by default
    this.debugGroup = new THREE.Group();
    this.debugGroup.visible = false;
    scene.add(this.debugGroup);

    this._setupFrustumGizmos();
    this._setupInset();

    renderer.domElement.addEventListener('wheel', (event) => {
      if (!this.enabled) return;
      const factor = Math.exp(event.deltaY * 0.001);
      this._zoom = THREE.MathUtils.clamp(this._zoom * factor, BIRDS_EYE.minZoom, BIRDS_EYE.maxZoom);
    }, { passive: true });
  }

  toggle() {
    this.enabled = !this.enabled;
  }

  /**
   * Orbits the overview camera with Q / E.
   * @param {number} dt - Delta time in seconds
   * @param {Input} input
   */
  update(dt, input) {
    if (!this.enabled) return;
    const orbit = (input.keys.KeyE ? 1 : 0) - (input.keys.KeyQ ? 1 : 0);
    this._azimuth += orbit * BIRDS_EYE.orbitSpeed * dt;
    this._placeOverviewCamera();
  }

  /**
   * Renders one complete Bird's-Eye frame to the screen.
   */
  render() {
    const renderer = this.renderer;
    const playerCam = this.player.camera;

    // 1. Regular portal pipeline; the player's final view goes into the inset texture
    this._syncInsetSize();
    this.portalRenderer.render(playerCam, this.insetTarget);

    // 2. Sync debug geometry to this frame's cameras
    this._syncFrustumGizmos();

    // 3. Overview pass: portals shown as flat tinted panes (their textures are
    //    screen-space for the PLAYER camera and would look scrambled from here)
    for (const portal of this.portals) {
      portal.surface.visible = portal.active;
      portal.material.uniforms.uFlat.value = 1.0;
    }
    this._syncOverviewAspect();
    const avatarWasVisible = this.avatar.object.visible;
    this.avatar.object.visible = true;
    this.ceiling.visible = false;
    this.debugGroup.visible = true;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.overviewCamera);
    this.ceiling.visible = true;
    this.debugGroup.visible = false;
    this.avatar.object.visible = avatarWasVisible;

    // 4. First-person inset in the bottom-right corner
    this._renderInset();
  }

  // ---------------------------------------------------------------------------
  // Overview camera
  // ---------------------------------------------------------------------------

  _setupOverviewCamera() {
    this.overviewCamera = new THREE.PerspectiveCamera(BIRDS_EYE.fov, 1, 0.1, 200);
    this._target = new THREE.Vector3().fromArray(BIRDS_EYE.target);

    // Express the configured position as an orbit around the target
    const offset = new THREE.Vector3().fromArray(BIRDS_EYE.position).sub(this._target);
    this._orbitRadius = Math.hypot(offset.x, offset.z);
    this._orbitHeight = offset.y;
    this._azimuth = Math.atan2(offset.x, offset.z);
    this._zoom = 1;
    this._placeOverviewCamera();
  }

  _placeOverviewCamera() {
    const r = this._orbitRadius * this._zoom;
    this.overviewCamera.position.set(
      this._target.x + Math.sin(this._azimuth) * r,
      this._target.y + this._orbitHeight * this._zoom,
      this._target.z + Math.cos(this._azimuth) * r
    );
    this.overviewCamera.lookAt(this._target);
  }

  _syncOverviewAspect() {
    const aspect = this.player.camera.aspect;
    if (this.overviewCamera.aspect !== aspect) {
      this.overviewCamera.aspect = aspect;
      this.overviewCamera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------------------
  // Frustum gizmos
  // ---------------------------------------------------------------------------

  _setupFrustumGizmos() {
    this.playerFrustum = new FrustumGizmo(PLAYER_FRUSTUM_COLOR);
    this.debugGroup.add(this.playerFrustum.object);

    // One level-1 virtual camera frustum per portal, in that portal's color
    this.virtualFrustums = this.portals.map(portal => {
      const gizmo = new FrustumGizmo(portal.material.uniforms.uTint.value);
      this.debugGroup.add(gizmo.object);
      return { portal, gizmo };
    });
  }

  _syncFrustumGizmos() {
    const playerCam = this.player.camera;
    const far = BIRDS_EYE.frustumFar;
    this.playerFrustum.update(playerCam.matrixWorld, CAMERA.fov, playerCam.aspect, far);

    for (const { portal, gizmo } of this.virtualFrustums) {
      const rendered = this.portalRenderer.visibleFromRoot.has(portal);
      gizmo.object.visible = rendered;
      if (!rendered) continue;

      // Same mapping PortalRenderer uses to place the level-1 virtual camera
      portal.mapMatrix(_virtualMatrix, playerCam.matrixWorld);

      // The virtual camera starts behind the exit wall, so extend its frustum by its
      // distance to the exit plane to reach equally far into the visible room
      const exit = portal.link;
      _clipPlane.setFromNormalAndCoplanarPoint(exit.normal, exit.origin);
      _virtualEye.setFromMatrixPosition(_virtualMatrix);
      const behindExit = Math.max(0, -_clipPlane.distanceToPoint(_virtualEye));

      const clipPlane = this.portalRenderer.obliqueEnabled ? _clipPlane : null;
      gizmo.update(_virtualMatrix, CAMERA.fov, playerCam.aspect, far + behindExit, clipPlane);
    }
  }

  // ---------------------------------------------------------------------------
  // First-person inset
  // ---------------------------------------------------------------------------

  _setupInset() {
    this.insetTarget = new THREE.WebGLRenderTarget(1, 1);
    this.insetScene = new THREE.Scene();
    this.insetCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.insetCamera.position.z = 0.5;
    this.insetScene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: this.insetTarget.texture, depthTest: false, depthWrite: false })
    ));
  }

  /**
   * The inset target must match the drawing buffer, because portal surfaces
   * sample their textures in screen space (gl_FragCoord / uRes).
   */
  _syncInsetSize() {
    const size = this.renderer.getDrawingBufferSize(_size);
    if (this.insetTarget.width !== size.x || this.insetTarget.height !== size.y) {
      this.insetTarget.setSize(size.x, size.y);
    }
  }

  _renderInset() {
    const renderer = this.renderer;
    const screen = renderer.getSize(_size); // CSS pixels
    const w = Math.round(screen.x * BIRDS_EYE.insetWidth);
    const h = Math.round(w / this.player.camera.aspect);
    const x = screen.x - w - INSET_MARGIN;
    const y = INSET_MARGIN; // Viewport origin is the bottom-left corner
    const b = INSET_BORDER;

    renderer.setScissorTest(true);

    // Border: clear a slightly larger rectangle with the accent color
    renderer.getClearColor(_savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.setScissor(x - b, y - b, w + 2 * b, h + 2 * b);
    renderer.setClearColor(INSET_BORDER_COLOR, 1);
    renderer.clear();
    renderer.setClearColor(_savedClearColor, savedClearAlpha);

    // Player view
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    renderer.render(this.insetScene, this.insetCamera);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, screen.x, screen.y);
  }
}
