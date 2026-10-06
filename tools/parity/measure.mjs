/**
 * The pure computation behind `yarn parity` (tools/parity/parity.mjs): compare
 * two renders of the same view, one with the Cesium layer forced on and one
 * with it forced off.  No browser, no I/O; see CESIUM.md, "Parity check".
 *
 * An image is `{width, height, data}`, with `data` RGBA bytes, row-major,
 * top row first (canvas ImageData order).  Values are the display values
 * (0-255, sRGB-encoded), as a viewer sees them.
 */


const CHANNELS = ['r', 'g', 'b']
// Rec. 709 luma weights, on display values.
const LUMA = [0.2126, 0.7152, 0.0722]
const BYTES_PER_PIXEL = 4
// Pixels darker than this in the off render (of 255) are left out of ratios:
// a ratio of near-zero values is quantisation noise, not colour.
const DEFAULT_MIN_LUMA = 12
// Fraction of the disc's radius the lit-disc region keeps: the limb, where
// the two renders' silhouettes and atmospheres differ, is left out.
const DEFAULT_DISC_INNER = 0.9
const DEFAULT_PROFILE_SAMPLES = 32
const DEFAULT_PROFILE_BAND = 3
// Fewest pixels a view must measure, so an empty region fails, not passes.
const DEFAULT_MIN_PIXELS = 200
// Terminator profiles stop this far from the image's edge, in pixels.
const EDGE_MARGIN_PX = 4


/**
 * @param {Uint8ClampedArray|Uint8Array|Array<number>} data RGBA
 * @param {number} i Pixel index
 * @returns {number} The pixel's luma, 0-255
 */
export function lumaAt(data, i) {
  const o = i * BYTES_PER_PIXEL
  return (LUMA[0] * data[o]) + (LUMA[1] * data[o + 1]) + (LUMA[2] * data[o + 2])
}


/**
 * @param {Array<number>} values
 * @returns {number} The median; NaN if empty
 */
export function median(values) {
  if (values.length === 0) {
    return NaN
  }
  const sorted = Float64Array.from(values).sort()
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}


/**
 * @param {Array<number>} values
 * @returns {number} The mean; NaN if empty
 */
export function mean(values) {
  return values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length
}


/**
 * The pixels to measure: a mask of the same size as the images.
 *
 * `region` is one of:
 *   - `{disc: {cx, cy, r}, inner}`: the body's disc in pixels, its inner
 *     `inner` fraction of the radius (default 0.9);
 *   - `{box: [x0, y0, x1, y1]}`: a box, in fractions of the image (0-1).
 * In both, only pixels lit in the off render (luma at least `minLuma`,
 * default 12 of 255) count: the dark side and space are not colour.
 *
 * @param {object} off The off image
 * @param {object} region
 * @param {number} [minLuma]
 * @returns {Uint8Array} 1 for measured pixels
 */
export function regionMask(off, region, minLuma = DEFAULT_MIN_LUMA) {
  const {width, height, data} = off
  const mask = new Uint8Array(width * height)
  let inRegion
  if (region.disc) {
    const {cx, cy, r} = region.disc
    const limit = r * (region.inner ?? DEFAULT_DISC_INNER)
    inRegion = (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= limit
  } else if (region.box) {
    const [x0, y0, x1, y1] = region.box
    inRegion = (x, y) => x >= x0 * width && x < x1 * width && y >= y0 * height && y < y1 * height
  } else {
    throw new Error('region needs a `disc` or a `box`')
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width) + x
      if (inRegion(x, y) && lumaAt(data, i) >= minLuma) {
        mask[i] = 1
      }
    }
  }
  return mask
}


/**
 * Median per-pixel ratio on/off over the masked pixels: of the luma, and of
 * each channel.  Per pixel first, then the median: a few bright or dark
 * pixels (coastlines, craters, sub-pixel misregistration) don't move it.
 *
 * @param {object} on The Cesium-on image
 * @param {object} off The Cesium-off image
 * @param {Uint8Array} mask
 * @returns {{count: number, luma: number, r: number, g: number, b: number}}
 *   `count` is how many pixels were measured; a ratio is NaN with none.
 */
export function medianRatios(on, off, mask) {
  const luma = []
  const channels = CHANNELS.map(() => [])
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) {
      continue
    }
    const offLuma = lumaAt(off.data, i)
    luma.push(lumaAt(on.data, i) / offLuma)
    for (let c = 0; c < CHANNELS.length; c++) {
      const o = off.data[(i * BYTES_PER_PIXEL) + c]
      // A channel that is 0 in the off render has no ratio; leave it out.
      if (o > 0) {
        channels[c].push(on.data[(i * BYTES_PER_PIXEL) + c] / o)
      }
    }
  }
  const out = {count: luma.length, luma: median(luma)}
  CHANNELS.forEach((name, c) => {
    out[name] = median(channels[c])
  })
  return out
}


/**
 * Ratio of the means on/off over the masked pixels: of the luma, and of each
 * channel.  The energy in the region, not its pixels' agreement: it holds
 * where the two renders differ in resolution (a bright city sharp in one and
 * a blur in the other), which the per-pixel median ratio can't see past.
 *
 * @param {object} on The Cesium-on image
 * @param {object} off The Cesium-off image
 * @param {Uint8Array} mask
 * @returns {{luma: number, r: number, g: number, b: number}} NaN with
 *   nothing measured, or a black off render
 */
export function meanRatios(on, off, mask) {
  let lumaOn = 0
  let lumaOff = 0
  const sumOn = CHANNELS.map(() => 0)
  const sumOff = CHANNELS.map(() => 0)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) {
      continue
    }
    lumaOn += lumaAt(on.data, i)
    lumaOff += lumaAt(off.data, i)
    for (let c = 0; c < CHANNELS.length; c++) {
      sumOn[c] += on.data[(i * BYTES_PER_PIXEL) + c]
      sumOff[c] += off.data[(i * BYTES_PER_PIXEL) + c]
    }
  }
  const out = {luma: lumaOn / lumaOff}
  CHANNELS.forEach((name, c) => {
    out[name] = sumOn[c] / sumOff[c]
  })
  return out
}


/**
 * Brightness (luma, 0-255) along a line, for a terminator profile: `samples`
 * points evenly from `from` to `to` (fractions of the image), each the mean
 * of a `band`-pixel-wide strip across the line, so a single noisy pixel or a
 * coastline doesn't set it.
 *
 * @param {object} image
 * @param {Array<number>} from [x, y], fractions of the image
 * @param {Array<number>} to [x, y]
 * @param {number} [samples]
 * @param {number} [band] Strip width in pixels
 * @returns {Array<number>}
 */
export function sampleProfile(image, from, to, samples = DEFAULT_PROFILE_SAMPLES, band = DEFAULT_PROFILE_BAND) {
  const {width, height, data} = image
  const x0 = from[0] * width
  const y0 = from[1] * height
  const dx = (to[0] * width) - x0
  const dy = (to[1] * height) - y0
  const length = Math.hypot(dx, dy)
  // Unit normal to the line, for the strip.
  const nx = length === 0 ? 0 : -dy / length
  const ny = length === 0 ? 0 : dx / length
  const out = []
  for (let s = 0; s < samples; s++) {
    const t = samples === 1 ? 0 : s / (samples - 1)
    const px = x0 + (t * dx)
    const py = y0 + (t * dy)
    const values = []
    for (let k = 0; k < band; k++) {
      const off = k - ((band - 1) / 2)
      const x = Math.floor(px + (off * nx))
      const y = Math.floor(py + (off * ny))
      if (x >= 0 && x < width && y >= 0 && y < height) {
        values.push(lumaAt(data, (y * width) + x))
      }
    }
    out.push(mean(values))
  }
  return out
}


/**
 * The line for a terminator profile: through the disc's centre along the
 * Sun's direction on screen, from the dark side to the lit, each half out to
 * `reach` of the radius or, if that comes first, to the image's edge (less a
 * margin): close to a body, its limb is far off screen.
 *
 * @param {{cx: number, cy: number, r: number}} disc In pixels
 * @param {Array<number>} sun Unit vector on screen, toward the lit side
 * @param {{width: number, height: number}} size The image's
 * @param {number} [reach] Fraction of the radius (default 1)
 * @returns {{from: Array<number>, to: Array<number>}} Fractions of the image
 */
export function terminatorLine(disc, sun, size, reach = 1) {
  const {cx, cy, r} = disc
  const [ux, uy] = sun
  const along = (c, u, extent) => {
    if (u === 0) {
      return Infinity
    }
    return ((u > 0 ? extent - EDGE_MARGIN_PX : EDGE_MARGIN_PX) - c) / u
  }
  // Distance from the centre in direction sign * (ux, uy).
  const room = (sign) => Math.max(0, Math.min(
      reach * r, along(cx, sign * ux, size.width), along(cy, sign * uy, size.height)))
  const back = room(-1)
  const ahead = room(1)
  return {
    from: [(cx - (ux * back)) / size.width, (cy - (uy * back)) / size.height],
    to: [(cx + (ux * ahead)) / size.width, (cy + (uy * ahead)) / size.height],
  }
}


/**
 * How far two profiles differ, in luma levels (of 255).
 *
 * @param {Array<number>} on
 * @param {Array<number>} off
 * @returns {{max: number, mean: number}} Max and mean of |on - off|
 */
export function profileDeviation(on, off) {
  const diffs = on.map((v, i) => Math.abs(v - off[i])).filter((d) => Number.isFinite(d))
  return {max: diffs.length ? Math.max(...diffs) : NaN, mean: mean(diffs)}
}


/**
 * Compare a view's two renders.
 *
 * `view.region` and `view.profile` as regionMask and sampleProfile; see
 * tools/parity/views.json.  Returns the raw measurements, and the profiles
 * for the report.
 *
 * @param {object} on
 * @param {object} off
 * @param {object} view
 * @returns {object} {ratios, profile: {on, off, max, mean} | null,
 *   reference: {luma, blueRed, region, reference} | null}
 */
export function measureView(on, off, view) {
  if (on.width !== off.width || on.height !== off.height) {
    throw new Error(`image sizes differ: ${on.width}x${on.height} vs ${off.width}x${off.height}`)
  }
  const mask = regionMask(off, view.region, view.minLuma)
  const ratios = medianRatios(on, off, mask)
  ratios.fraction = mask.reduce((a, b) => a + b, 0) / mask.length
  ratios.mean = meanRatios(on, off, mask)
  // Each render's own median luma, for views where both sides could go
  // wrong alike (a bug in the atmosphere pass, which draws over both).
  const lumas = (img) => {
    const values = []
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        values.push(lumaAt(img.data, i))
      }
    }
    return median(values)
  }
  ratios.lumaOn = lumas(on)
  ratios.lumaOff = lumas(off)
  // The on render's region against another region of the same render
  // (`view.reference`, a box): for what has no counterpart in the off
  // render, e.g. Cesium's terrain above celestiary's sphere, which should
  // look like the ground below it, not the sky.
  let reference = null
  if (view.reference) {
    const refMask = regionMask(off, view.reference, view.minLuma)
    const stats = (m) => {
      const luma = []
      const blueRed = []
      for (let i = 0; i < m.length; i++) {
        if (m[i]) {
          luma.push(lumaAt(on.data, i))
          blueRed.push(on.data[(i * BYTES_PER_PIXEL) + 2] / Math.max(on.data[i * BYTES_PER_PIXEL], 1))
        }
      }
      return {count: luma.length, luma: median(luma), blueRed: median(blueRed)}
    }
    const region = stats(mask)
    const ref = stats(refMask)
    reference = {region, reference: ref, luma: region.luma / ref.luma, blueRed: region.blueRed / ref.blueRed}
  }
  let profile = null
  if (view.profile) {
    const {from, to, samples, band} = view.profile
    const onProfile = sampleProfile(on, from, to, samples, band)
    const offProfile = sampleProfile(off, from, to, samples, band)
    profile = {on: onProfile, off: offProfile, ...profileDeviation(onProfile, offProfile)}
  }
  return {ratios, profile, reference}
}


/**
 * Check one number against a tolerance: `[lo, hi]` (inclusive), `{max}` or
 * `{min}` bounds.  NaN always fails.
 *
 * @param {number} value
 * @param {Array<number>|{min?: number, max?: number}} tolerance
 * @returns {boolean}
 */
export function within(value, tolerance) {
  if (!Number.isFinite(value)) {
    return false
  }
  const [lo, hi] = Array.isArray(tolerance) ?
    tolerance :
    [tolerance.min ?? -Infinity, tolerance.max ?? Infinity]
  return value >= lo && value <= hi
}


/**
 * @param {Array<number>|{min?: number, max?: number}} tolerance
 * @returns {string} For the table, e.g. '0.90 - 1.10', '<= 12'
 */
export function describeTolerance(tolerance) {
  if (Array.isArray(tolerance)) {
    return `${tolerance[0]} - ${tolerance[1]}`
  }
  const parts = []
  if (tolerance.min !== undefined) {
    parts.push(`>= ${tolerance.min}`)
  }
  if (tolerance.max !== undefined) {
    parts.push(`<= ${tolerance.max}`)
  }
  return parts.join(', ')
}


/**
 * The table rows for a view: one per metric its tolerances name.
 *
 * Tolerances (all optional; a metric without one isn't checked):
 *   - `ratio`: [lo, hi] for the median luma ratio on/off;
 *   - `channelRatio`: [lo, hi] for each of the r, g, b ratios, or `{r, g, b}`
 *     with a [lo, hi] each;
 *   - `meanRatio`: [lo, hi] for the ratio of the region's mean luma and of
 *     each channel's mean, on/off (`mean ratio luma`, `mean ratio r`...), for
 *     views where the two renders differ in resolution (Earth's night lights
 *     from low down: GIBS's 600 m against celestiary's 11 km texture), which
 *     moves the per-pixel medians but not the energy;
 *   - `profileMax`, `profileMean`: max bound on the profile deviation
 *     (luma levels of 255), as a number;
 *   - `luma`: [lo, hi] for each render's own median luma (of 255), on and
 *     off: catches what the ratios can't, both sides wrong alike;
 *   - `minPixels`: least measured pixels (default 200), so an empty region
 *     fails rather than passing on nothing;
 *   - `reference`: `{luma, blueRed}`, each [lo, hi], for views with a
 *     `reference` box: the on render's median luma, and median blue/red,
 *     over the region, over the same over the reference.
 *
 * @param {string} id The view's id
 * @param {object} measured measureView's result
 * @param {object} tolerance
 * @returns {Array<{view: string, metric: string, value: number, tolerance: string, pass: boolean}>}
 */
export function evaluateView(id, measured, tolerance) {
  const rows = []
  const add = (metric, value, tol) => {
    rows.push({view: id, metric, value, tolerance: describeTolerance(tol), pass: within(value, tol)})
  }
  const {ratios, profile} = measured
  add('pixels', ratios.count, {min: tolerance.minPixels ?? DEFAULT_MIN_PIXELS})
  if (tolerance.ratio) {
    add('ratio luma', ratios.luma, tolerance.ratio)
  }
  if (tolerance.channelRatio) {
    // One range for every channel, or {r, g, b} ranges.
    const perChannel = !Array.isArray(tolerance.channelRatio)
    for (const name of CHANNELS) {
      add(`ratio ${name}`, ratios[name], perChannel ? tolerance.channelRatio[name] : tolerance.channelRatio)
    }
  }
  if (tolerance.meanRatio) {
    add('mean ratio luma', ratios.mean.luma, tolerance.meanRatio)
    for (const name of CHANNELS) {
      add(`mean ratio ${name}`, ratios.mean[name], tolerance.meanRatio)
    }
  }
  if (tolerance.luma) {
    add('luma on', ratios.lumaOn, tolerance.luma)
    add('luma off', ratios.lumaOff, tolerance.luma)
  }
  const {reference} = measured
  if (tolerance.reference) {
    if (tolerance.reference.luma) {
      add('ref luma', reference?.luma ?? NaN, tolerance.reference.luma)
    }
    if (tolerance.reference.blueRed) {
      add('ref blue/red', reference?.blueRed ?? NaN, tolerance.reference.blueRed)
    }
  }
  if (profile && tolerance.profileMax !== undefined) {
    add('profile max', profile.max, {max: tolerance.profileMax})
  }
  if (profile && tolerance.profileMean !== undefined) {
    add('profile mean', profile.mean, {max: tolerance.profileMean})
  }
  return rows
}


/**
 * @param {Array<{pass: boolean}>} rows evaluateView's rows, over all views
 * @returns {boolean} Whether every row passed
 */
export function allPass(rows) {
  return rows.every((r) => r.pass)
}


/**
 * @param {number} v
 * @returns {string}
 */
function formatValue(v) {
  if (!Number.isFinite(v)) {
    return String(v)
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(3)
}


/**
 * The report table as text: view, metric, value, tolerance, result.
 *
 * @param {Array<object>} rows evaluateView's rows, over all views
 * @returns {string}
 */
export function formatTable(rows) {
  const header = ['view', 'metric', 'value', 'tolerance', 'result']
  const cells = rows.map((r) => [r.view, r.metric, formatValue(r.value), r.tolerance, r.pass ? 'PASS' : 'FAIL'])
  const widths = header.map((h, c) => Math.max(h.length, ...cells.map((row) => row[c].length)))
  const line = (row) => row.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd()
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n')
}
