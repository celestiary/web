/**
 * Text for the overlay's table.  Pure, so it is tested without a DOM.
 */

const TEN = 10
const HUNDRED = 100
const THOUSAND = 1000
const MILLION = 1e6
const SYNC_NAMES_SHOWN = 4


/**
 * @param {number|undefined|null} v Milliseconds
 * @returns {string} Two decimals under 10, one under 100, whole beyond; '-' for none
 */
export function fmtMs(v) {
  if (v === undefined || v === null || !Number.isFinite(v)) {
    return '-'
  }
  if (v < TEN) {
    return v.toFixed(2)
  }
  return v < HUNDRED ? v.toFixed(1) : v.toFixed(0)
}


/**
 * @param {number|undefined|null} v A per-frame count's mean
 * @returns {string} Whole from 10, else one decimal with a trailing zero dropped; '0' for none
 */
export function fmtCount(v) {
  if (!v || !Number.isFinite(v)) {
    return '0'
  }
  if (v >= TEN) {
    return String(Math.round(v))
  }
  return String(Number(v.toFixed(1)))
}


/**
 * @param {number} v A count of triangles or bytes
 * @returns {string} 1.2M, 340k, 12
 */
export function fmtBig(v) {
  if (!Number.isFinite(v)) {
    return '-'
  }
  if (v >= MILLION) {
    return `${(v / MILLION).toFixed(1)}M`
  }
  return v >= THOUSAND ? `${Math.round(v / THOUSAND)}k` : String(Math.round(v))
}


/**
 * @param {object} summary PerfStats.summary()
 * @param {string} gpuMode 'ok' (GPU times are per pass), 'encoder' (they are
 *   per encoder: shown, no total) or 'none' (no GPU times: no timer, or sync mode)
 * @returns {Array<{name: string, depth: number, gpuMean: string, gpuP95: string, cpuMean: string, cpuP95: string,
 *   draws: string, rt: string, rb: string, sync: string}>} A row per pass, then 'total'
 */
export function tableRows(summary, gpuMode) {
  const shown = gpuMode !== 'none'
  const rows = summary.passes.map((p) => ({
    name: p.name,
    depth: p.name.split('.').length - 1,
    gpuMean: shown ? fmtMs(p.gpu?.mean ?? 0) : 'n/a',
    gpuP95: shown ? fmtMs(p.gpu?.p95 ?? 0) : 'n/a',
    cpuMean: fmtMs(p.cpu?.mean ?? 0),
    cpuP95: fmtMs(p.cpu?.p95 ?? 0),
    draws: fmtCount(p.counts.draws),
    rt: fmtCount(p.counts.fbSwitches),
    rb: fmtCount(p.counts.readbacks),
    sync: fmtCount(p.counts.syncCalls),
  }))
  const t = summary.total
  const total = gpuMode === 'ok' && t.gpu
  rows.push({
    name: 'total',
    depth: 0,
    gpuMean: total ? fmtMs(t.gpu.mean) : 'n/a',
    gpuP95: total ? fmtMs(t.gpu.p95) : 'n/a',
    cpuMean: fmtMs(t.cpu.mean),
    cpuP95: fmtMs(t.cpu.p95),
    draws: fmtCount(t.counts.draws),
    rt: fmtCount(t.counts.fbSwitches),
    rb: fmtCount(t.counts.readbacks),
    sync: fmtCount(t.counts.syncCalls),
  })
  return rows
}


/**
 * @param {object} summary PerfStats.summary()
 * @returns {string} A line of the frame's counts that aren't a column
 */
export function countsLine(summary) {
  const c = summary.total.counts
  const names = Object.entries(summary.total.syncByName ?? {}).sort((a, b) => b[1] - a[1]).slice(0, SYNC_NAMES_SHOWN)
      .map(([n, v]) => `${n} ${fmtCount(v)}`).join(', ')
  return [
    `full-screen ${fmtCount(c.fullscreen)}`,
    `clears ${fmtCount(c.clears)}`,
    `blits ${fmtCount(c.blits)}`,
    `uploads ${fmtCount(c.uploads)} (${fmtBig(c.uploadBytes)}B)`,
    `readPixels-PBO ${fmtCount(c.pboReads)}`,
    `programs ${fmtCount(c.programs)}`,
    `tris ${fmtBig(c.triangles)}`,
    `sync calls ${fmtCount(c.syncCalls)}${names ? ` (${names})` : ''}`,
  ].join('  ')
}
