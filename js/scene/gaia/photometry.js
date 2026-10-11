/**
 * Gaia's photometry into the catalogue's (js/scene/Gaia.md, "Photometry").
 * The star field is calibrated in visual magnitudes (exposure.js,
 * LIMITING_MAGNITUDE; HDR.md, "Physical stars") and coloured by effective
 * temperature through the blackbody table (stellar.js; Stars.md), so a
 * Gaia star needs a V and a Teff.
 *
 * - **V from G and BP−RP**: Riello et al. 2021 (A&A 649, A3), Table C.2,
 *   the EDR3 photometric relation to Johnson-Cousins V:
 *   G − V = −0.02704 + 0.01424 x − 0.2156 x² + 0.01426 x³, x = G_BP − G_RP,
 *   σ = 0.03 mag, fitted over −0.5 < x < 5.0 (Landolt standards).  Outside
 *   that range x is held to its ends.  Gaia's photometry is the same in
 *   DR3 as in EDR3.
 * - **Teff from BP−RP**: on the bundled catalogue's own temperature scale.
 *   Its stars' Teff come from their spectral classes (Stars.md,
 *   "Temperature from class": de Jager & Nieuwenhuijzen 1987, Levesque et
 *   al. 2005), and their colours from that Teff.  The tiler takes every
 *   catalogue star Gaia cross-matches (about 100,000, from O to M), bins
 *   them by Gaia's BP−RP and takes each bin's median Teff, held to fall
 *   with colour (calibrateColourTemperature); a Gaia star's Teff is read off
 *   that table.  So a Gaia star is the colour a catalogue star of its
 *   BP−RP is, with no second temperature scale to disagree with the first.
 *   The colour is the observed one, reddening included, as the magnitude
 *   is the observed one, extinction included: the sky as seen from here,
 *   as the catalogue's magnitudes are.
 */


/** Riello et al. 2021, Table C.2: G − V as a cubic in BP−RP. */
export const G_MINUS_V = [-0.02704, 0.01424, -0.2156, 0.01426]
/** The colour range the relation was fitted over. */
export const G_MINUS_V_RANGE = [-0.5, 5.0]
/**
 * The colour taken for a star Gaia has no BP−RP for: the Sun's, 0.82
 * (Casagrande & VandenBerg 2018, MNRAS 479, L102).
 */
export const DEFAULT_BP_RP = 0.82


/**
 * @param {number} bpRp G_BP − G_RP; not a number takes DEFAULT_BP_RP
 * @returns {number} G − V, magnitudes
 */
export function gMinusV(bpRp) {
  const x0 = Number.isFinite(bpRp) ? bpRp : DEFAULT_BP_RP
  const x = Math.max(G_MINUS_V_RANGE[0], Math.min(G_MINUS_V_RANGE[1], x0))
  const [a, b, c, d] = G_MINUS_V
  return a + (x * (b + (x * (c + (x * d)))))
}


/**
 * @param {number} g phot_g_mean_mag
 * @param {number} bpRp
 * @returns {number} Johnson V
 */
export function vFromG(g, bpRp) {
  return g - gMinusV(bpRp)
}


/**
 * @typedef {object} ColourTemperatureTable
 * @property {Array<number>} bpRp Bin centres, ascending
 * @property {Array<number>} teff K, falling (not rising) with colour
 * @property {Array<number>} n The stars in each bin
 */


/**
 * Pool adjacent violators: the closest non-increasing sequence, weighted.
 *
 * @param {Array<number>} values
 * @param {Array<number>} weights
 * @returns {Array<number>}
 */
export function nonIncreasing(values, weights) {
  const blocks = []
  for (let i = 0; i < values.length; i++) {
    blocks.push({v: values[i], w: weights[i], n: 1})
    while (blocks.length > 1 && blocks[blocks.length - 2].v < blocks[blocks.length - 1].v) {
      const b = blocks.pop()
      const a = blocks.pop()
      const w = a.w + b.w
      blocks.push({v: ((a.v * a.w) + (b.v * b.w)) / w, w, n: a.n + b.n})
    }
  }
  const out = []
  for (const b of blocks) {
    for (let i = 0; i < b.n; i++) {
      out.push(b.v)
    }
  }
  return out
}


/**
 * @param {Array<number>} sorted
 * @returns {number}
 */
function median(sorted) {
  const m = sorted.length >> 1
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}


/**
 * The catalogue's temperature against Gaia's colour, from the stars in
 * both: each bin's median Teff (in log, so a bin's hot and cool outliers
 * weigh alike), bins with too few stars merged into their neighbours, and
 * the result held non-increasing in colour.
 *
 * @param {Array<{bpRp: number, teff: number}>} pairs
 * @param {object} [opts]
 * @param {number} [opts.binWidth] Magnitudes of BP−RP
 * @param {number} [opts.minPerBin]
 * @returns {ColourTemperatureTable}
 */
export function calibrateColourTemperature(pairs, {binWidth = 0.05, minPerBin = 25} = {}) {
  const good = pairs.filter((p) => Number.isFinite(p.bpRp) && p.teff > 0)
  if (good.length === 0) {
    throw new Error('No stars to calibrate colour against temperature')
  }
  good.sort((a, b) => a.bpRp - b.bpRp)
  // Fixed-width bins, then merged left to right until each has enough.
  const bins = new Map()
  for (const p of good) {
    const k = Math.floor(p.bpRp / binWidth)
    if (!bins.has(k)) {
      bins.set(k, [])
    }
    bins.get(k).push(p)
  }
  const groups = []
  let cur = []
  for (const k of [...bins.keys()].sort((a, b) => a - b)) {
    cur = cur.concat(bins.get(k))
    if (cur.length >= minPerBin) {
      groups.push(cur)
      cur = []
    }
  }
  if (cur.length > 0) {
    if (groups.length > 0) {
      groups[groups.length - 1] = groups[groups.length - 1].concat(cur)
    } else {
      groups.push(cur)
    }
  }
  const bpRp = groups.map((g) => median(g.map((p) => p.bpRp)))
  const logT = groups.map((g) => median(g.map((p) => Math.log10(p.teff)).sort((a, b) => a - b)))
  const n = groups.map((g) => g.length)
  const held = nonIncreasing(logT, n)
  return {bpRp, teff: held.map((l) => Math.round(10 ** l)), n}
}


/**
 * Read a Teff off the table, interpolating in log T, held at its ends.
 *
 * @param {ColourTemperatureTable} table
 * @param {number} bpRp
 * @returns {number} K; 0 for no colour (the renderer's "unknown")
 */
export function teffFromBpRp(table, bpRp) {
  if (!Number.isFinite(bpRp)) {
    return 0
  }
  const xs = table.bpRp
  const ts = table.teff
  if (bpRp <= xs[0]) {
    return ts[0]
  }
  if (bpRp >= xs[xs.length - 1]) {
    return ts[ts.length - 1]
  }
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= bpRp) {
      lo = mid
    } else {
      hi = mid
    }
  }
  const f = (bpRp - xs[lo]) / (xs[hi] - xs[lo])
  return Math.round(10 ** (((1 - f) * Math.log10(ts[lo])) + (f * Math.log10(ts[hi]))))
}
