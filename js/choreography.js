/**
 * The first load's sequence (DESIGN.md, "The first load"): once the scene
 * is in, the loading text goes, then the overlays fade in a beat apart,
 * then the chrome.  Steps run from the animation loop's clock, not timers,
 * so nothing is left pending (and the tests drive it with numbers).
 */


/**
 * When each part of the load comes in, ms after the scene is in (the camera
 * placed, the stars drawn and the target's surface loaded; or
 * READY_TIMEOUT_MS after the camera is placed, whichever is first).  Each
 * fades over FADE_MS (scene/fade.js), so the last is in about 1.3 s after
 * the scene is.  The physical scene comes first, from black, as the loading
 * text goes; it has rendered behind it all along, so the exposure has
 * adapted, and its own entrance (the Sun's flash as the meter takes the
 * stars in) plays as it shows.
 */
export const REVEAL_AT = Object.freeze({
  loading: 0, // the loading text fades out, the scene fades in
  orbits: 250, // o
  diagrams: 450, // a, the grids e c g, the expansion lines x
  labels: 650, // p, l, galaxies' G
  chrome: 900, // the nav and HUD, v
})


/**
 * Don't hold the overlays and the chrome back longer than this after the
 * camera is placed, ms, whatever is still loading (a slow texture).
 */
export const READY_TIMEOUT_MS = 4000


/** Runs steps at their times after a start. */
export default class Choreography {
  /** @param {Array<{at: number, run: Function}>} steps At ms after the start */
  constructor(steps) {
    this.steps = [...steps].sort((a, b) => a.at - b.at)
    this.startMs = null
    this._next = 0
  }


  /** @returns {boolean} */
  get started() {
    return this.startMs !== null
  }


  /** @returns {boolean} Every step has run */
  get done() {
    return this._next >= this.steps.length
  }


  /** @param {number} nowMs */
  start(nowMs) {
    if (this.startMs === null) {
      this.startMs = nowMs
    }
  }


  /**
   * Run the steps whose time has come.
   *
   * @param {number} nowMs
   * @returns {number} How many ran
   */
  frame(nowMs) {
    if (this.startMs === null) {
      return 0
    }
    let ran = 0
    while (this._next < this.steps.length && nowMs - this.startMs >= this.steps[this._next].at) {
      this.steps[this._next++].run()
      ran++
    }
    return ran
  }
}
