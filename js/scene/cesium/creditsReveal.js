/**
 * Cesium's credits in full when a body comes into view, then compact
 * (CESIUM.md, "Credits stand back"): the ion logo alone, dimmed, until a
 * hover, a focus or a tap brings the rest back for a while.  ion's and Bing's terms
 * want the attribution on screen while their data is, so it never goes
 * away; it only stands back.  The compact look is index.css's
 * `#cesium-credits.compact`.
 */


/** How long the credits show in full, ms. */
export const CREDITS_FULL_MS = 6000


/** */
export default class CreditsReveal {
  /**
   * @param {HTMLElement} elt #cesium-credits
   * @param {object} [clock] for tests: setTimeout and clearTimeout
   */
  constructor(elt, clock = globalThis) {
    this.elt = elt
    this.clock = clock
    this.shown = null
    this._timer = null
    // A tap on the compact logo brings the credits back, rather than
    // following the logo's link; a tap on the full credits works as before.
    elt.addEventListener?.('click', (ev) => {
      if (this.elt.classList.contains('compact')) {
        ev.preventDefault()
        this._full()
      }
    })
  }


  /**
   * The body whose credits show, as it changes.
   *
   * @param {?string} name the nearest active body's, or null for none
   */
  show(name) {
    if (name === this.shown) {
      return
    }
    this.shown = name
    if (name) {
      this._full()
    } else {
      this.clock.clearTimeout(this._timer)
      this._timer = null
    }
  }


  /** In full, then compact after CREDITS_FULL_MS. */
  _full() {
    this.elt.classList.remove('compact')
    this.clock.clearTimeout(this._timer)
    this._timer = this.clock.setTimeout(() => {
      this._timer = null
      this.elt.classList.add('compact')
    }, CREDITS_FULL_MS)
  }
}
