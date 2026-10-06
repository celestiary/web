/**
 * Per-frame counts of GL work, for the `?perf=1` overlay: what a pass does
 * as well as how long it takes.  Each count is attributed to the section
 * running when it happened (`pass`), and added to the frame's total.
 *
 * Pure bookkeeping: glCounters.js is what feeds it.
 */


/**
 * What is counted.
 *
 * - draws: draw calls (`drawArrays`, `drawElements`, instanced or ranged).
 * - fullscreen: draws that look like a full-screen pass: a triangle or quad
 *   (6 vertices or fewer, one instance) into a viewport of at least a fifth
 *   of the canvas.  A heuristic.
 * - triangles: from each draw's mode, count and instances.
 * - clears: `clear` and `clearBuffer*`.
 * - fbSwitches: draw-framebuffer bindings that changed, the render-target
 *   switches.
 * - readbacks: reads into client memory (`readPixels`, `getBufferSubData`,
 *   `finish`), which wait for the GPU to catch up.
 * - pboReads: `readPixels` into a pixel-pack buffer, which don't wait.
 * - uploads, uploadBytes: texture uploads (`texImage2D`, `texSubImage2D`,
 *   and the 3D and compressed forms), with their approximate size.
 * - blits: `blitFramebuffer` and `copyTex*`.
 * - programs: `useProgram` calls.
 */
export const COUNT_KEYS = [
  'draws', 'fullscreen', 'triangles', 'clears', 'fbSwitches', 'readbacks', 'pboReads', 'uploads', 'uploadBytes',
  'blits', 'programs',
]


/** @returns {{[key: string]: number}} A zeroed count of every key */
export function zeroCounts() {
  return Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]))
}


/** A frame's counts: in total, and by the pass running at the time. */
export class CountSink {
  constructor() {
    this.pass = 'other'
    this.total = zeroCounts()
    this.perPass = new Map()
  }


  /** @param {string} pass The section the next counts belong to */
  setPass(pass) {
    this.pass = pass
  }


  /**
   * @param {string} key One of COUNT_KEYS
   * @param {number} [n]
   */
  bump(key, n = 1) {
    this.total[key] += n
    let counts = this.perPass.get(this.pass)
    if (!counts) {
      counts = zeroCounts()
      this.perPass.set(this.pass, counts)
    }
    counts[key] += n
  }


  /**
   * @returns {{total: {[key: string]: number}, perPass: {[key: string]: {[key: string]: number}}}}
   *   The counts since the last take, and start afresh
   */
  take() {
    const out = {total: this.total, perPass: Object.fromEntries(this.perPass)}
    this.total = zeroCounts()
    this.perPass = new Map()
    return out
  }
}
