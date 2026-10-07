import {TOGGLES} from './toggles.js'


/** Bumped when the snapshot's shape changes, so a pasted one says what it is. */
export const SNAPSHOT_VERSION = 1


/**
 * What the overlay's Copy button puts on the clipboard: the view and the
 * machine, what was measured and with which passes switched off, for the
 * user to paste back.  Pure: the page gives it what it knows.
 *
 * @param {object} p
 * @param {Date} p.takenAt
 * @param {string} p.link The page's URL, hash included: the view's permalink
 * @param {{width: number, height: number, drawingBufferWidth: number, drawingBufferHeight: number}} p.viewport
 * @param {number} p.devicePixelRatio
 * @param {{renderer: string|null, vendor: string|null, unmaskedRenderer: string|null, unmaskedVendor: string|null}} p.gpu
 *   What the context says (the unmasked strings need WEBGL_debug_renderer_info, which a browser may hide)
 * @param {string} p.userAgent
 * @param {{host: boolean, shadow: boolean|null, disjoints: number, dropped: number}} p.timer Whether GPU timers work
 * @param {object} p.summary PerfStats.summary()
 * @param {Set<string>|Array<string>} p.off The toggle keys switched off
 * @param {object} [p.scene] What the view is: the target, hdr, the Cesium bodies active
 * @returns {object} JSON-serialisable
 */
export function buildSnapshot({takenAt, link, viewport, devicePixelRatio, gpu, userAgent, timer, summary, off, scene}) {
  const offSet = new Set(off)
  const toggles = {}
  for (const t of TOGGLES) {
    toggles[t.key] = !offSet.has(t.key)
  }
  return {
    tool: 'celestiary perf',
    version: SNAPSHOT_VERSION,
    takenAt: takenAt.toISOString(),
    link,
    viewport,
    devicePixelRatio,
    gpu,
    userAgent,
    timer,
    scene: scene ?? {},
    // true: the pass runs; false: switched off, so the look and the cost differ from the full pipeline's.
    toggles,
    units: 'ms per frame unless named otherwise; gpu and cpu are mean, p95 and max over the last n frames ' +
      '(a pass that did not run in a frame counts as 0, runShare is the share that it did); ' +
      'counts are per-frame means, in total and by pass',
    timings: summary,
  }
}


/**
 * @param {object} snapshot buildSnapshot's
 * @returns {string} It as JSON, indented, for pasting
 */
export function snapshotJson(snapshot) {
  return JSON.stringify(snapshot, null, 2)
}
