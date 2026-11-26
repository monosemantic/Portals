import * as THREE from 'three';
import { CHAMBERS } from './chambers.js';
import { clampToRoom, clampToDivider } from './room.js';
import { DIVIDER_HALF_THICKNESS } from './props.js';

/**
 * Owns the lifecycle of the switchable showcase chambers.
 *
 * Loading a chamber:
 * 1. Removes the previous chamber's group and frees its GPU resources.
 * 2. Builds the new chamber's props and lights into a fresh group.
 * 3. Re-places the existing portal pair (portals and their render targets are reused).
 *
 * The player pose is NOT touched here; callers apply `chamber.spawn` themselves,
 * which keeps this class independent of the player controller.
 */
export class ChamberManager {
  /**
   * @param {THREE.Scene} scene - Scene the chamber groups are added to
   * @param {Array<Portal>} portals - The linked portal pair [A, B]
   */
  constructor(scene, portals) {
    this.scene = scene;
    this.portals = portals;
    this.index = -1;
    this.group = null;
    this._update = null;
  }

  get count() {
    return CHAMBERS.length;
  }

  get current() {
    return CHAMBERS[this.index];
  }

  get names() {
    return CHAMBERS.map(chamber => chamber.name);
  }

  /**
   * Builds the chamber at `index` and tears down the previous one.
   * @returns {object} The loaded chamber preset
   */
  load(index) {
    this._unload();

    const chamber = CHAMBERS[index];
    this.index = index;

    this.group = new THREE.Group();
    this.group.name = 'chamber:' + chamber.name;
    this._update = chamber.build(this.group) || null;
    this.scene.add(this.group);

    chamber.portals.forEach(({ x, z, rotY }, i) => this.portals[i].place(x, z, rotY));
    return chamber;
  }

  /**
   * Loads the next chamber, wrapping around after the last one.
   */
  next() {
    return this.load((this.index + 1) % this.count);
  }

  /**
   * Advances chamber animations (e.g. the spinning torus knot).
   */
  update(dt) {
    if (this._update) this._update(dt);
  }

  /**
   * Player collision for the active chamber: room walls (with portal doorways)
   * plus the glass divider when the chamber has one.
   */
  constrain(position, previous) {
    clampToRoom(position, this.portals);
    if (this.current.divider) {
      clampToDivider(position, previous, DIVIDER_HALF_THICKNESS);
    }
  }

  _unload() {
    if (!this.group) return;
    this.scene.remove(this.group);
    disposeTree(this.group);
    this.group = null;
    this._update = null;
  }
}

/**
 * Frees geometries, materials, and textures of every mesh under `root`.
 * Shared resources are safe to dispose repeatedly.
 */
function disposeTree(root) {
  root.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.map) material.map.dispose();
      material.dispose();
    }
  });
}
