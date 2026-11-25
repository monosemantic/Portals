/**
 * Debug Heads-Up Display (HUD).
 *
 * Lightweight DOM overlay for real-time diagnostics:
 * - Frame rate (FPS)
 * - Total scene render passes per frame
 * - Active recursion depth
 * - Oblique near-plane clipping toggle status
 *
 * Performance note:
 * Only updates element.innerHTML when string contents actually change,
 * avoiding unnecessary DOM reflows and browser layout thrashing.
 */

export class Hud {
  /**
   * @param {HTMLElement} element - Target container element
   */
  constructor(element) {
    this.element = element;
    this._cachedHtml = '';
  }

  /**
   * Updates the HUD display if the text has changed.
   * @param {string} htmlString - Formatted HTML text
   */
  set(htmlString) {
    if (htmlString === this._cachedHtml) return;
    this._cachedHtml = htmlString;
    this.element.innerHTML = htmlString;
  }
}
