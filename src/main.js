import * as THREE from 'three';
import { CAMERA, ROOM, MAX_LEVELS, MAX_DT, MAX_PIXEL_RATIO, PORTAL_WALL_OFFSET } from './config.js';
import { createRoom, clampToRoom } from './world/room.js';
import { Portal } from './portal/Portal.js';
import { PortalRenderer } from './portal/PortalRenderer.js';
import { Player } from './player/Player.js';
import { Input } from './player/Input.js';
import { Hud } from './ui/Hud.js';

/**
 * Main application entry point.
 * Wires together the Three.js WebGL renderer, scene, camera, portals, player,
 * input controls, and the recursive portal rendering pipeline.
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

// Populate the test environment (walls, lights, spinning torus knot prop)
const room = createRoom(scene);

// 2. Portal setup and linking
// Portal A: Cyan border, placed on North wall (Z = -ROOM), facing +Z into the room.
// Portal B: Orange border, placed on East wall (X = +ROOM), facing -X into the room.
const portalA = new Portal(0x22ddff);
const portalB = new Portal(0xff8822);

portalA.place(-3, -ROOM + PORTAL_WALL_OFFSET, 0);
portalB.place(ROOM - PORTAL_WALL_OFFSET, 4, -Math.PI / 2);

// Establish bidirectional link between Portal A and Portal B
Portal.link(portalA, portalB);

const portals = [portalA, portalB];
portals.forEach(portal => scene.add(portal.group));

// 3. Player, input, and recursive portal renderer
const player = new Player(camera, portals, (pos) => clampToRoom(pos, portals));
const input = new Input(renderer.domElement);
const portalRenderer = new PortalRenderer(renderer, scene, portals);

// Interactive hotkeys for live demonstrations
input.onPress('KeyO', () => {
  portalRenderer.obliqueEnabled = !portalRenderer.obliqueEnabled;
});

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
window.game = { THREE, scene, camera, renderer, player, portals, portalRenderer, input };

// 4. Game and render loop
const hud = new Hud(document.getElementById('hud'));
const clock = new THREE.Clock();
let fpsTime = 0;
let fpsFrames = 0;
let fps = 0;

function animationFrame() {
  requestAnimationFrame(animationFrame);

  // Cap delta time to prevent physics anomalies if the user leaves the tab
  const dt = Math.min(clock.getDelta(), MAX_DT);

  // Process player movement & portal teleportation
  player.update(dt, input);

  // Animate scene objects (e.g. rotating torus knot)
  room.update(dt);

  // Recursively render all portal views and the final scene
  portalRenderer.render(camera);

  // Calculate FPS
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime > 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }

  // Update HUD diagnostics
  hud.set(
    '<b>Portals POC (Three.js WebGL)</b><br>' +
    'WASD: move | Drag: look<br>' +
    'O: Oblique Near-Plane Clipping <b>' + (portalRenderer.obliqueEnabled ? 'ON' : 'OFF') + '</b><br>' +
    '1-' + MAX_LEVELS + ': Recursion Depth <b>' + portalRenderer.maxDepth + '</b><br>' +
    portalRenderer.passes + ' scene passes/frame | ' + fps + ' FPS'
  );
}

// Start the loop
animationFrame();
