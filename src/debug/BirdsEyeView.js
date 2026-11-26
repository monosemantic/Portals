import * as THREE from 'three';
import { BIRDS_EYE, CAMERA, PLAYER } from '../config.js';

/**
 * Bird's-Eye debug view (toggle with V).
 *
 * Renders the room from an elevated overview camera with the ceiling removed and shows:
 * - A marker for the player's position and facing direction.
 * - The player camera frustum (white).
 * - The level-1 virtual camera frustum of every portal the player can currently see,
 *   tinted with that portal's color. With oblique clipping ON, its near plane
 *   visibly snaps onto the exit portal's wall.
 * - An inset with the player's actual first-person view (portals fully rendered).
 *
 * WASD and mouse-look keep driving the player, so the frustums move live.
 * Q / E orbit the overview camera, the mouse wheel zooms.
 *
 * Pass order per frame:
 * 1. PortalRenderer runs normally (debug objects hidden, so they never leak into
 *    portal textures) and writes the player's final view into the inset target.
 * 2. Debug cameras and helpers are synced to this frame's player/virtual cameras.
 * 3. The scene is drawn from the overview camera to the screen.
 * 4. The inset is composited into the bottom-right corner.
 */

const INSET_MARGIN = 12;       // CSS pixels from the screen corner
const INSET_BORDER = 2;        // CSS pixels
const INSET_BORDER_COLOR = new THREE.Color(0x3ddc97);
const PLAYER_FRUSTUM_COLOR = new THREE.Color(0xffffff);

// Reusable scratch objects
const _size = new THREE.Vector2();
const _savedClearColor = new THREE.Color();

export class BirdsEyeView {
  /**
   * @param {object} deps
   * @param {THREE.WebGLRenderer} deps.renderer
   * @param {THREE.Scene} deps.scene
   * @param {PortalRenderer} deps.portalRenderer
   * @param {Player} deps.player
   * @param {Array<Portal>} deps.portals
   * @param {THREE.Mesh} deps.ceiling - Hidden during the overview pass
   */
  constructor({ renderer, scene, portalRenderer, player, portals, ceiling }) {
    this.renderer = renderer;
    this.scene = scene;
    this.portalRenderer = portalRenderer;
    this.player = player;
    this.portals = portals;
    this.ceiling = ceiling;
    this.enabled = false;

    this._setupOverviewCamera();

    // Everything drawn only in the overview pass lives in one group, hidden by default
    this.debugGroup = new THREE.Group();
    this.debugGroup.visible = false;
    scene.add(this.debugGroup);

    this.avatar = createAvatar();
    this.debugGroup.add(this.avatar);
    this._setupFrustumHelpers();
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
    this._syncAvatar();
    this._syncFrustumHelpers();

    // 3. Overview pass: portals shown as flat tinted panes (their textures are
    //    screen-space for the PLAYER camera and would look scrambled from here)
    for (const portal of this.portals) {
      portal.surface.visible = portal.active;
      portal.material.uniforms.uFlat.value = 1.0;
    }
    this._syncOverviewAspect();
    this.ceiling.visible = false;
    this.debugGroup.visible = true;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.overviewCamera);
    this.ceiling.visible = true;
    this.debugGroup.visible = false;

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
  // Player marker and frustum helpers
  // ---------------------------------------------------------------------------

  _syncAvatar() {
    const position = this.player.camera.position;
    this.avatar.position.set(position.x, 0, position.z);
    this.avatar.rotation.y = this.player.yaw;
  }

  _setupFrustumHelpers() {
    // Proxy of the player camera with a short far plane, so the wireframe stays
    // inside the room instead of shooting 100 units away. Its projection is also
    // the base projection for the virtual camera proxies below.
    this.playerProxy = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, BIRDS_EYE.frustumFar);
    this.playerHelper = createFrustumHelper(this.playerProxy, PLAYER_FRUSTUM_COLOR);
    this.debugGroup.add(this.playerHelper);

    // One level-1 virtual camera proxy per portal
    this.virtualProxies = this.portals.map(portal => {
      const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, BIRDS_EYE.frustumFar);
      const helper = createFrustumHelper(camera, portal.material.uniforms.uTint.value);
      this.debugGroup.add(helper);
      return { portal, camera, helper };
    });
  }

  _syncFrustumHelpers() {
    const playerCam = this.player.camera;
    const proxy = this.playerProxy;

    if (proxy.aspect !== playerCam.aspect) {
      proxy.aspect = playerCam.aspect;
      proxy.updateProjectionMatrix();
    }
    // Copy in place: CameraHelper holds a reference to camera.matrixWorld
    proxy.matrixWorld.copy(playerCam.matrixWorld);
    proxy.matrixWorldInverse.copy(playerCam.matrixWorldInverse);
    this.playerHelper.update();

    // Rebuild each virtual camera exactly like PortalRenderer does for level 1
    // (same mapping matrix, same oblique near plane, same refreshed inverse)
    for (const { portal, camera, helper } of this.virtualProxies) {
      const rendered = this.portalRenderer.visibleFromRoot.has(portal);
      helper.visible = rendered;
      if (!rendered) continue;

      this.portalRenderer.placeVirtualCamera(camera, proxy, portal, proxy.projectionMatrix);
      helper.update();
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

/**
 * Creates a CameraHelper drawn in a single color, always on top of the scene.
 * (r128's CameraHelper has hard-coded per-part colors and no setColors().)
 */
function createFrustumHelper(camera, color) {
  const helper = new THREE.CameraHelper(camera);

  const colors = helper.geometry.getAttribute('color');
  for (let i = 0; i < colors.count; i++) {
    colors.setXYZ(i, color.r, color.g, color.b);
  }
  colors.needsUpdate = true;

  helper.material.depthTest = false;
  helper.material.transparent = true;
  helper.renderOrder = 999;
  // Vertex positions change every frame, so the cached bounding sphere would go stale
  helper.frustumCulled = false;
  return helper;
}

/**
 * Simple player marker: a body cylinder plus a cone "nose" pointing along -Z (forward).
 */
function createAvatar() {
  const avatar = new THREE.Group();
  const bodyHeight = PLAYER.eyeHeight - 0.2;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(PLAYER.radius, PLAYER.radius, bodyHeight, 20),
    new THREE.MeshBasicMaterial({ color: 0x3ddc97 })
  );
  body.position.y = bodyHeight / 2;

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.6, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  nose.rotation.x = -Math.PI / 2; // Cone tip (+Y) now points along -Z
  nose.position.set(0, PLAYER.eyeHeight, -PLAYER.radius - 0.2);

  avatar.add(body, nose);
  return avatar;
}
