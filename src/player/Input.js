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
    this.keys = {};            // Tracks active held keys: keys[code] === true
    this.pressHandlers = {};   // One-shot callback functions registered per key code
    this.dragging = false;     // True while the user is holding down the mouse button on the canvas

    // Accumulated mouse movement since the last frame
    this._deltaX = 0;
    this._deltaY = 0;
    this._lookDelta = { x: 0, y: 0 };

    // Keyboard event listeners
    window.addEventListener('keydown', (event) => {
      this.keys[event.code] = true;

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
      this._deltaX = 0;
      this._deltaY = 0;
    });

    // Pointer and mouse drag event listeners
    domElement.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      // Pointer capture ensures events continue firing even if the cursor leaves the canvas
      domElement.setPointerCapture(event.pointerId);
    });

    window.addEventListener('pointerup', () => {
      this.dragging = false;
    });

    window.addEventListener('pointercancel', () => {
      this.dragging = false;
    });

    window.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this._deltaX += event.movementX;
      this._deltaY += event.movementY;
    });
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
