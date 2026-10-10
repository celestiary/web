/**
 * A SPARC galaxy's rotation curve against its baryons' (Galaxies.md,
 * "Rotation curves"): the observed circular velocity, and the one its gas
 * and stars alone would give, from SPARC's mass models (Lelli, McGaugh &
 * Schombert 2016, Table 2).  The gap between them is what a dark-matter
 * halo makes up (#106).
 */


/**
 * The stars' mass-to-light ratios at 3.6 µm SPARC adopts for its disc and
 * bulge (Lelli, McGaugh & Schombert 2016; McGaugh & Schombert 2014's
 * stellar populations): Table 2's V_disk and V_bul are for 1.
 */
export const UPSILON_36 = Object.freeze({disc: 0.5, bulge: 0.7})


/**
 * The baryons' circular velocity at a radius: the gas's, the disc's and
 * the bulge's added in quadrature, each squared with its sign (Table 2's
 * V_gas is negative where the gas's inner mass pulls outward), the stars'
 * scaled by their mass-to-light ratios.
 *
 * @param {Array<number>} row [R, Vobs, e_Vobs, Vgas, Vdisk, Vbul] (curves.json)
 * @param {object} [upsilon] UPSILON_36
 * @returns {number} km/s
 */
export function baryonicVelocity(row, upsilon = UPSILON_36) {
  const sq = (v) => v * Math.abs(v)
  const v2 = sq(row[3]) + (upsilon.disc * sq(row[4])) + (upsilon.bulge * sq(row[5]))
  return Math.sign(v2) * Math.sqrt(Math.abs(v2))
}


/** The plot's series colours: categorical slots 1 and 2 for a dark surface, checked for colour vision deficiency. */
export const CURVE_COLORS = Object.freeze({observed: '#3987e5', baryons: '#d95926'})


/**
 * The rotation curve as an inline SVG: the observed velocities as points
 * with their error bars, the baryons' as a line, one velocity axis.
 *
 * @param {Array<Array<number>>} curve curves.json's rows for one galaxy
 * @param {object} [opts]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @returns {string}
 */
export function rotationCurveSvg(curve, {width = 240, height = 150} = {}) {
  if (!curve || curve.length === 0) {
    return ''
  }
  const pad = {l: 42, r: 8, t: 8, b: 26}
  const rMax = Math.max(...curve.map((c) => c[0])) * 1.05
  const vMax = Math.max(...curve.map((c) => Math.max(c[1] + c[2], baryonicVelocity(c)))) * 1.1
  const x = (r) => pad.l + ((width - pad.l - pad.r) * r / rMax)
  const y = (v) => height - pad.b - ((height - pad.t - pad.b) * Math.max(v, 0) / vMax)
  const ticks = (max) => {
    const step = niceStep(max / 4)
    const out = []
    for (let t = 0; t <= max; t += step) {
      out.push(t)
    }
    return out
  }
  const muted = 'rgba(255, 255, 255, 0.55)'
  const grid = 'rgba(255, 255, 255, 0.12)'
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" ` +
    `aria-label="Rotation curve: observed velocity and the baryons' velocity against radius" ` +
    `style="font: 10px sans-serif">`]
  for (const v of ticks(vMax)) {
    parts.push(`<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${grid}"/>`)
    parts.push(`<text x="${pad.l - 4}" y="${y(v) + 3}" text-anchor="end" fill="${muted}">${v}</text>`)
  }
  for (const r of ticks(rMax)) {
    parts.push(`<text x="${x(r)}" y="${height - pad.b + 12}" text-anchor="middle" fill="${muted}">${r}</text>`)
  }
  parts.push(`<text x="${width - pad.r}" y="${height - 3}" text-anchor="end" fill="${muted}">R, kpc</text>`)
  const midY = (pad.t + height - pad.b) / 2
  parts.push(`<text transform="translate(9 ${midY}) rotate(-90)" text-anchor="middle" fill="${muted}">V, km/s</text>`)
  const line = curve.map((c, i) => `${i ? 'L' : 'M'}${x(c[0]).toFixed(1)},${y(baryonicVelocity(c)).toFixed(1)}`).join(' ')
  parts.push(`<path d="${line}" fill="none" stroke="${CURVE_COLORS.baryons}" stroke-width="2"/>`)
  for (const c of curve) {
    const [r, v, e] = c
    parts.push(`<g><title>${r} kpc: ${v} ± ${e} km/s observed, ${baryonicVelocity(c).toFixed(1)} from the baryons</title>` +
      `<line x1="${x(r)}" x2="${x(r)}" y1="${y(v - e)}" y2="${y(v + e)}" stroke="${CURVE_COLORS.observed}"/>` +
      `<circle cx="${x(r)}" cy="${y(v)}" r="2.5" fill="${CURVE_COLORS.observed}"/></g>`)
  }
  parts.push('</svg>')
  return parts.join('')
}


/**
 * @param {number} rough
 * @returns {number} 1, 2 or 5 times a power of ten, at least rough
 */
function niceStep(rough) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-9))))
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= rough)
}
