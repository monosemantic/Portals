import * as THREE from 'three';
import { CAMERA, MAX_LEVELS, MAX_DT, MAX_PIXEL_RATIO, DEFAULT_CHAMBER, LEVEL_TINT } from './config.js';
import { createRoom } from './world/room.js';
import { ChamberManager } from './world/ChamberManager.js';
import { Portal } from './portal/Portal.js';
import { PortalRenderer } from './portal/PortalRenderer.js';
import { Player } from './player/Player.js';
import { Input } from './player/Input.js';
import { Avatar } from './player/Avatar.js';
import { BirdsEyeView } from './debug/BirdsEyeView.js';
import { ProjectionReadout } from './debug/ProjectionReadout.js';
import { Hud } from './ui/Hud.js';

/**
 * Main application entry point.
 * Wires together the Three.js WebGL renderer, scene, camera, chambers, portals, player,
 * input controls, the recursive portal rendering pipeline, and the Bird's-Eye debug view.
 */

// 1. WebGL renderer and scene initialization
const renderer = new THREE.WebGLRenderer({ antialias: true });
// Cap pixel ratio to prevent performance slowdowns on HiDPI/Retina screens during recursion
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// Main first-person player camera
const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  window.innerWidth / window.innerHeight,
  CAMERA.near,
  CAMERA.far
);

// Shared room shell (walls, floor, ceiling); chamber content is added by ChamberManager
const room = createRoom(scene);

// 2. Portal pair (Portal A: cyan, Portal B: orange). Each chamber re-places them.
const portalA = new Portal(0x22ddff);
const portalB = new Portal(0xff8822);
Portal.link(portalA, portalB);

const portals = [portalA, portalB];
portals.forEach(portal => scene.add(portal.group));

const chambers = new ChamberManager(scene, portals);

// 3. Player, avatar, input, renderers, and HUD
const player = new Player(camera, portals, (pos, prev) => chambers.constrain(pos, prev));
const input = new Input(renderer.domElement);

// The avatar is visible through portals ("see yourself") but never in the player's own view
const avatar = new Avatar();
scene.add(avatar.object);

const portalRenderer = new PortalRenderer(renderer, scene, portals);
portalRenderer.viewer = avatar.object;

const birdsEye = new BirdsEyeView({
  renderer, scene, portalRenderer, player, portals, ceiling: room.ceiling, avatar,
});
const readout = new ProjectionReadout(portalRenderer);
const hud = new Hud(document.getElementById('hud'));

/**
 * Loads a chamber, moves the player to its spawn point, and syncs the HUD buttons.
 */
function selectChamber(index) {
  const chamber = chambers.load(index);
  player.setPose(chamber.spawn);
  hud.setActiveButton(index);
}

hud.setButtons(chambers.names, selectChamber);

// Start chamber: ?chamber=1..3 in the URL overrides DEFAULT_CHAMBER (handy for the demo)
const requested = parseInt(new URLSearchParams(window.location.search).get('chamber'), 10) - 1;
selectChamber(requested >= 0 && requested < chambers.count ? requested : DEFAULT_CHAMBER);

// Interactive hotkeys for live demonstrations
input.onPress('KeyO', () => {
  portalRenderer.obliqueEnabled = !portalRenderer.obliqueEnabled;
});

input.onPress('KeyV', () => birdsEye.toggle());

input.onPress('KeyC', () => selectChamber((chambers.index + 1) % chambers.count));

input.onPress('KeyR', () => player.setPose(chambers.current.spawn));

input.onPress('KeyH', () => hud.toggle());

input.onPress('KeyL', () => {
  portalRenderer.levelTint = !portalRenderer.levelTint;
});

input.onPress('KeyB', () => {
  portalRenderer.showViewer = !portalRenderer.showViewer;
});

input.onPress('KeyM', () => readout.toggle());

for (let depth = 1; depth <= MAX_LEVELS; depth++) {
  input.onPress('Digit' + depth, () => {
    portalRenderer.maxDepth = depth;
  });
}

// Handle window resizing
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  // Offscreen render targets automatically resize inside PortalRenderer._syncRenderTargetSizes()
});

// Expose core entities to window for debugging via the browser developer console
window.game = {
  THREE, scene, camera, renderer, player, avatar, portals, portalRenderer, input, chambers, birdsEye, readout,
};

// 4. Game and render loop
const clock = new THREE.Clock();
let elapsed = 0;
let fpsTime = 0;
let fpsFrames = 0;
let fps = 0;

const onOff = value => (value ? 'ON' : 'OFF');

// Colored "1 2 3 4 5" legend for the recursion level tint
const levelLegend = LEVEL_TINT.colors
  .map((color, i) => '<span style="color:#' + color.toString(16).padStart(6, '0') + '">&#9632;' + (i + 1) + '</span>')
  .join(' ');

function updateHud() {
  const lines = [
    '<b>Portals POC (Three.js WebGL)</b>',
    'Chamber <b>' + (chambers.index + 1) + '/' + chambers.count + ': ' + chambers.current.name + '</b> (C, R: respawn)',
    "Bird's-Eye View <b>" + onOff(birdsEye.enabled) + '</b> (V' + (birdsEye.enabled ? ', Q/E orbit, wheel zoom' : '') + ')',
    'Oblique Clipping <b>' + onOff(portalRenderer.obliqueEnabled) + '</b> (O)',
    'Recursion Depth <b>' + portalRenderer.maxDepth + '</b> (1-' + MAX_LEVELS + ')',
    'Level Colors <b>' + onOff(portalRenderer.levelTint) + '</b> (L)' + (portalRenderer.levelTint ? ' ' + levelLegend : ''),
    'See Yourself <b>' + onOff(portalRenderer.showViewer) + '</b> (B)',
    '<b>' + portalRenderer.passes + '</b> passes/frame | <b>' + fps + '</b> FPS',
    'WASD: move | Drag: look | M: matrix | H: hide HUD',
  ];
  hud.set(lines.join('<br>') + readout.html(camera));
}

function animationFrame() {
  requestAnimationFrame(animationFrame);

  // Cap delta time for the simulation to prevent jumps if the user leaves the tab
  // (the FPS counter below uses the real frame time)
  const frameTime = clock.getDelta();
  const dt = Math.min(frameTime, MAX_DT);
  elapsed += dt;

  // Process player movement & portal teleportation, then move the body along
  player.update(dt, input);
  avatar.sync(player);
  birdsEye.update(dt, input);

  // Animate chamber props and portal rims
  chambers.update(dt);
  portals.forEach(portal => portal.tick(elapsed));

  // Recursively render all portal views, then the final view (player or overview)
  if (birdsEye.enabled) {
    birdsEye.render();
  } else {
    portalRenderer.render(camera);
  }

  // Calculate FPS
  fpsFrames++;
  fpsTime += frameTime;
  if (fpsTime > 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }

  updateHud();
}

// Start the loop
animationFrame();
