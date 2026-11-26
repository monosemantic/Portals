/**
 * Debug Heads-Up Display (HUD).
 *
 * Lightweight DOM overlay for real-time diagnostics:
 * - Active chamber, Bird's-Eye and oblique clipping status
 * - Active recursion depth
 * - Total scene render passes per frame and frame rate (FPS)
 * - Clickable chamber buttons
 *
 * Performance note:
 * Only updates the status block's innerHTML when its contents actually change,
 * avoiding unnecessary DOM reflows and browser layout thrashing. The buttons
 * are built once and never re-created, so clicks are never lost mid-update.
 */

export class Hud {
  /**
   * @param {HTMLElement} element - Target container element
   */
  constructor(element) {
    this.element = element;
    this._cachedHtml = '';

    this.status = document.createElement('div');
    this.buttonBar = document.createElement('div');
    this.buttonBar.className = 'hud-buttons';
    this.element.append(this.status, this.buttonBar);

    this._buttons = [];
  }

  /**
   * Updates the status text if it has changed.
   * @param {string} htmlString - Formatted HTML text
   */
  set(htmlString) {
    if (htmlString === this._cachedHtml) return;
    this._cachedHtml = htmlString;
    this.status.innerHTML = htmlString;
  }

  /**
   * Builds one button per label.
   * @param {Array<string>} labels
   * @param {Function} onSelect - Called with the clicked button's index
   */
  setButtons(labels, onSelect) {
    this.buttonBar.replaceChildren();
    this._buttons = labels.map((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = (index + 1) + '. ' + label;
      button.addEventListener('click', () => {
        button.blur(); // Keep Space/Enter from re-triggering it later
        onSelect(index);
      });
      this.buttonBar.append(button);
      return button;
    });
  }

  /**
   * Highlights the button at `index`.
   */
  setActiveButton(index) {
    this._buttons.forEach((button, i) => button.classList.toggle('active', i === index));
  }
}
