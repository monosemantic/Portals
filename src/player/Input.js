/**
 * Input controller for keyboard and mouse/pointer interactions.
 *
 * Responsibilities:
 * - Captures raw DOM keyboard and pointer events.
 * - Aggregates input state without modifying the player directly.
 * - Exposes normalized movement directions and mouse look deltas.
 */

export class Input {
  /**
   * @param {HTMLElement} domElement - The canvas element to listen for pointer events on
   */
  constructor(domElement) {
    this.domElement = domElement;
    this.keys = {};            // Tracks active held keys: keys[code] === true
    this.pressHandlers = {};   // One-shot callback functions registered per key code
    this.dragging = false;     // True while the user is holding down the mouse button on the canvas
    this.shiftLock = false;    // Toggleable Shift Lock state (free-look without holding mouse button)
    this.pointerLocked = false; // True when the browser has actively locked the pointer to domElement

    // Accumulated mouse movement since the last frame
    this._deltaX = 0;
    this._deltaY = 0;
    this._lookDelta = { x: 0, y: 0 };

    // Keyboard event listeners
    window.addEventListener('keydown', (event) => {
      this.keys[event.code] = true;

      if (!event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey
        && (event.code === 'ShiftLeft' || event.code === 'ShiftRight')) {
        this.toggleShiftLock();
      }

      // Trigger one-shot action if registered, ignoring keyboard auto-repeat
      const handler = this.pressHandlers[event.code];
      if (handler && !event.repeat) {
        handler();
      }
    });

    window.addEventListener('keyup', (event) => {
      this.keys[event.code] = false;
    });

    // Reset all inputs if the browser window loses focus (e.g. Alt+Tab)
    window.addEventListener('blur', () => {
      this.keys = {};
      this.dragging = false;
      this.shiftLock = false;
      this.pointerLocked = false;
      this._deltaX = 0;
      this._deltaY = 0;
    });

    // Keep state in sync if the user exits pointer lock via Esc or browser UI
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
      if (!this.pointerLocked) {
        this.shiftLock = false;
      }
      this._deltaX = 0;
      this._deltaY = 0;
    });

    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
    });

    // Pointer and mouse drag event listeners
    domElement.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      if (this.shiftLock && !this.pointerLocked) {
        this._requestPointerLock();
      }
      if (!this.pointerLocked) {
        // Pointer capture ensures events continue firing even if the cursor leaves the canvas
        domElement.setPointerCapture(event.pointerId);
      }
    });

    window.addEventListener('pointerup', () => {
      this.dragging = false;
    });

    window.addEventListener('pointercancel', () => {
      this.dragging = false;
    });

    document.addEventListener('pointermove', (event) => {
      if (!this.dragging && !this.lookLocked) return;
      this._deltaX += event.movementX || 0;
      this._deltaY += event.movementY || 0;
    });
  }

  /**
   * True whenever mouse-look without holding a mouse button is active
   * (either browser Pointer Lock or fallback Shift Lock).
   */
  get lookLocked() {
    return this.pointerLocked || this.shiftLock;
  }

  /**
   * Toggles Shift Lock on or off, requesting or exiting browser Pointer Lock.
   * If the browser blocks Pointer Lock on a standalone Shift key, shiftLock stays
   * enabled as a button-free hover look and upgrades to Pointer Lock on canvas click.
   */
  toggleShiftLock() {
    if (this.lookLocked) {
      this.shiftLock = false;
      if (this.pointerLocked && document.exitPointerLock) {
        document.exitPointerLock();
      }
      return;
    }

    this.shiftLock = true;
    this._deltaX = 0;
    this._deltaY = 0;
    this._requestPointerLock();
  }

  _requestPointerLock() {
    if (!this.domElement.requestPointerLock) return;
    try {
      const result = this.domElement.requestPointerLock();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Fall back to button-free hover look when browser rejects Shift activation
    }
  }

  /**
   * Registers a callback function to run exactly once when a key is pressed.
   *
   * @param {string} code - KeyboardEvent.code (e.g., 'KeyO', 'Digit3')
   * @param {Function} callback - Function to execute
   */
  onPress(code, callback) {
    this.pressHandlers[code] = callback;
  }

  /**
   * Forward and backward movement axis along local Z:
   * +1 = Forward (W / Arrow Up)
   * -1 = Backward (S / Arrow Down)
   *  0 = Neutral
   */
  get forward() {
    const forwardKey = this.keys.KeyW || this.keys.ArrowUp ? 1 : 0;
    const backwardKey = this.keys.KeyS || this.keys.ArrowDown ? 1 : 0;
    return forwardKey - backwardKey;
  }

  /**
   * Strafe left and right movement axis along local X:
   * +1 = Right (D / Arrow Right)
   * -1 = Left (A / Arrow Left)
   *  0 = Neutral
   */
  get strafe() {
    const rightKey = this.keys.KeyD || this.keys.ArrowRight ? 1 : 0;
    const leftKey = this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0;
    return rightKey - leftKey;
  }

  /**
   * Returns accumulated mouse movement in pixels since the last frame,
   * then resets the internal counter back to zero.
   */
  consumeLook() {
    this._lookDelta.x = this._deltaX;
    this._lookDelta.y = this._deltaY;
    this._deltaX = 0;
    this._deltaY = 0;
    return this._lookDelta;
  }
}
