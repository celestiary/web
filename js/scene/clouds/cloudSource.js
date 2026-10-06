/**
 * Earth's far-field clouds: which data to show for a date, and how a
 * satellite's true-colour picture becomes a cloud coverage map.  Pure, so
 * it's tested without a browser; CloudMap.js does the fetching and the GPU
 * side.  See Planet.md, "Clouds".
 *
 * The source is NASA GIBS's daily Corrected Reflectance (true colour)
 * mosaics, from VIIRS (NOAA-20 from 2018, Suomi NPP from late 2015) or
 * MODIS (Aqua from mid-2002, Terra from 2000).  A daily mosaic is the
 * satellite's swaths of that UTC day, each place seen once, at the
 * satellite's local overpass time (about 13:30 for Aqua and the VIIRS,
 * 10:30 for Terra).  It shows the ground where there are no clouds; the
 * ground under it is known (the Blue Marble, the month's cloud-free mosaic,
 * cut from MODIS too), so each pixel is unmixed into a cloud coverage: how
 * much of the pixel is a white cloud over that ground (coverageFromColour).
 *
 * Before 2000-02-24, or for a date after the latest complete day, there is
 * no daily picture, and the bundled cloud texture (earth_atmos.jpg, one
 * day's clouds of no recorded date) stands in.
 */


/**
 * GIBS's true-colour layers, newest first: for a date, the first whose data
 * begins on or before it is the primary, the next the secondary (it fills
 * the primary's gaps: MODIS's between swaths at the equator, a missing
 * day).  Start dates from GIBS's GetCapabilities (EPSG:4326, `best`),
 * 2026-10.  Within a layer's range GIBS has some missing days; a missing
 * tile answers 404, and the secondary covers it.
 */
export const TRUE_COLOUR_LAYERS = [
  {layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', from: '2018-01-05', satellite: 'VIIRS NOAA-20'},
  {layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', from: '2015-11-24', satellite: 'VIIRS Suomi NPP'},
  {layer: 'MODIS_Aqua_CorrectedReflectance_TrueColor', from: '2002-07-03', satellite: 'MODIS Aqua'},
  {layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', from: '2000-02-24', satellite: 'MODIS Terra'},
]


export const GIBS_WMTS_4326 = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best'


// A day's mosaic is complete once its last swaths are processed: GIBS's
// near-real-time imagery is up about 3 hours after it's taken, and the
// UTC day's last swaths are taken at its end.
const COMPLETE_AFTER_MS = 27 * 3600 * 1000
const DAY_MS = 86400 * 1000


/**
 * @param {number} ms Epoch milliseconds
 * @returns {string} Its UTC date, YYYY-MM-DD
 */
export function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}


/**
 * The clouds to show for a simulation time.
 *
 * - A date with a daily mosaic: that day's, from its primary layer, with
 *   the secondary for the primary's gaps.
 * - The simulation's present (the last day or so, the default when the app
 *   opens), whose mosaic isn't complete yet: the latest complete day's.
 * - Before the satellites, or in the future: the bundled texture.
 *
 * @param {number} simMs The simulation time, epoch milliseconds
 * @param {number} nowMs The real time, epoch milliseconds
 * @returns {{kind: 'daily', date: string, layers: Array<object>}|{kind: 'bundled', reason: string}}
 */
export function cloudSource(simMs, nowMs) {
  if (!Number.isFinite(simMs) || !Number.isFinite(nowMs)) {
    return {kind: 'bundled', reason: 'no date'}
  }
  const latest = utcDate(nowMs - COMPLETE_AFTER_MS)
  let date = utcDate(simMs)
  if (date > latest) {
    // The present: the latest complete day.  Further on is the future.
    if (simMs > nowMs + DAY_MS) {
      return {kind: 'bundled', reason: 'future'}
    }
    date = latest
  }
  const layers = TRUE_COLOUR_LAYERS.filter((l) => l.from <= date).slice(0, 2)
  if (layers.length === 0) {
    return {kind: 'bundled', reason: 'before the satellites'}
  }
  return {kind: 'daily', date, layers}
}


/**
 * The tile level of GIBS's EPSG:4326 `250m` matrix set the map is built
 * from: level 2 is 5 × 3 tiles of 512 px, 72° each (the last row half past
 * the south pole), 2560 px round the equator, ~16 km a pixel: about 1.2 MB
 * of JPEG a day.  Level 3 (10 × 5, 8 km) would be 4 MB.
 */
export const CLOUD_TILE_LEVEL = 2
export const TILE_PX = 512
// Level 0's tiles span 288°.
const LEVEL0_TILE_DEG = 288


/**
 * @param {number} level
 * @returns {{cols: number, rows: number, tileDeg: number, width: number, height: number}}
 *   The level's tiles, and the equirectangular map they make, 360° × 180°
 *   in whole pixels (one tile pixel each)
 */
export function tileGrid(level) {
  const tileDeg = LEVEL0_TILE_DEG / (2 ** level)
  const pxPerDeg = TILE_PX / tileDeg
  return {
    cols: Math.ceil(360 / tileDeg),
    rows: Math.ceil(180 / tileDeg),
    tileDeg,
    width: Math.round(360 * pxPerDeg),
    height: Math.round(180 * pxPerDeg),
  }
}


/**
 * @param {string} layer A GIBS layer identifier
 * @param {string} date YYYY-MM-DD
 * @param {number} level
 * @param {number} row
 * @param {number} col
 * @returns {string} The tile's URL (WMTS REST)
 */
export function tileUrl(layer, date, level, row, col) {
  return `${GIBS_WMTS_4326}/${layer}/default/${date}/250m/${level}/${row}/${col}.jpeg`
}


/**
 * Where a tile lands in the level's map (tileGrid): its top-left pixel, and
 * its size clipped to the map (the last row runs past the south pole).
 *
 * @param {number} level
 * @param {number} row
 * @param {number} col
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function tileRect(level, row, col) {
  const {width, height} = tileGrid(level)
  const x = col * TILE_PX
  const y = row * TILE_PX
  return {x, y, w: Math.min(TILE_PX, width - x), h: Math.min(TILE_PX, height - y)}
}


/**
 * The cloud's colour in the true-colour mosaics, as stored (0-1): a thick
 * cloud's top, not quite saturated.
 */
export const CLOUD_WHITE = 0.92

/**
 * The unmixed coverage that counts as clear, and as fully cloudy.  Over
 * clear ocean the mosaics are brighter than the Blue Marble's (haze, thin
 * cloud, a different stretch), and unmix to 0.05-0.15 (the mode of
 * clear-ocean pixels over a MODIS and a VIIRS day); clear land to about 0.
 * Thick cloud unmixes to 0.9-1.0.
 */
export const COVERAGE_CLEAR = 0.15
export const COVERAGE_FULL = 0.85

// A pixel no satellite saw (between swaths, polar night) is black: every
// channel under this, of 255.  JPEG blurs the gaps' edges, hence the margin.
const NO_DATA_MAX = 3

// Under this, a channel's cloud-over-ground contrast is too small to unmix
// (snow and ice under white cloud): the channel's weight is floored.
const MIN_CONTRAST = 0.05


/**
 * @param {number} lo
 * @param {number} hi
 * @param {number} x
 * @returns {number} x mapped linearly from [lo, hi] onto [0, 1], clamped
 */
function ramp(lo, hi, x) {
  return Math.min(Math.max((x - lo) / (hi - lo), 0), 1)
}


/**
 * Unmix one pixel: the mosaic's colour is `c · W + (1 − c) · G` for cloud
 * coverage c over the ground G, the cloud's colour W (CLOUD_WHITE).  Each
 * channel gives c = (O − G) / (W − G); a cloud brightens all three, so the
 * least of them is taken (smoke, a different stretch of one channel, or
 * vegetation greener than in 2004 brighten only some).  Then COVERAGE_CLEAR
 * to COVERAGE_FULL is stretched to 0-1.
 *
 * @param {number} r The mosaic's red, 0-255
 * @param {number} g
 * @param {number} b
 * @param {number} gr The ground's red (the Blue Marble), 0-255
 * @param {number} gg
 * @param {number} gb
 * @returns {number} Coverage 0-1, or -1 where the mosaic has no data
 */
export function coverageFromColour(r, g, b, gr, gg, gb) {
  if (r <= NO_DATA_MAX && g <= NO_DATA_MAX && b <= NO_DATA_MAX) {
    return -1
  }
  const c = Math.min(unmix(r, gr), unmix(g, gg), unmix(b, gb))
  return ramp(COVERAGE_CLEAR, COVERAGE_FULL, c)
}


// 1 / (255 · (W − G)) for each ground level G, 0-255: unmix's divisor.
const UNMIX = Float32Array.from({length: 256}, (_, g) => 1 / 255 / Math.max(CLOUD_WHITE - (g / 255), MIN_CONTRAST))


/**
 * @param {number} o The mosaic's channel, 0-255
 * @param {number} ground The ground's, 0-255
 * @returns {number} The channel's cloud coverage, (O − G) / (W − G)
 */
function unmix(o, ground) {
  return (o - ground) / 255 / Math.max(CLOUD_WHITE - (ground / 255), MIN_CONTRAST)
}


/**
 * The bundled cloud texture's grey levels as coverage: it is an infrared
 * picture, whose warm ground shows grey (0.29-0.36 over Australia, the
 * quartiles to the 90th percentile), and whose cold, high cloud is white.
 * Stretched from just over that ground, its mean coverage between 60° N
 * and S is 0.26; a daily mosaic's unmixes to about 0.46, so the fallback
 * is the less cloudy of the two (the picture misses low, warm cloud).
 */
export const BUNDLED_CLEAR = 0.37
export const BUNDLED_FULL = 0.65


/**
 * @param {number} v The bundled texture's value, 0-255
 * @returns {number} Coverage, 0-1
 */
export function coverageFromBundled(v) {
  return ramp(BUNDLED_CLEAR, BUNDLED_FULL, v / 255)
}


/**
 * Unmix a tile's worth of pixels into the map.  Pixels the tile has no data
 * for, and those within GAP_MARGIN of them (JPEG darkens a gap's edges,
 * which would unmix as clear), are marked unseen and given `fill`.
 *
 * @param {Uint8ClampedArray|Uint8Array} obs The tile's RGBA, from its top-left
 * @param {number} obsStride The tile's row length, pixels
 * @param {object} region Where it lands: {x, y, w, h} in the map (tileRect)
 * @param {Uint8ClampedArray|Uint8Array} ground The ground's RGBA over the whole map
 * @param {Uint8Array} out The map's coverage, 0-255, a byte a pixel, rows north to south
 * @param {Uint8Array} fill Coverage for the unseen pixels (the bundled texture's)
 * @param {Uint8Array} unseen The map's unseen mask: 1 where no layer has data yet
 * @param {number} mapWidth
 * @param {boolean} gapsOnly Only the pixels still unseen (a secondary layer
 *   filling the primary's gaps)
 * @returns {number} How many pixels of the region are unseen after it
 */
export function unmixTile(obs, obsStride, region, ground, out, fill, unseen, mapWidth, gapsOnly = false) {
  const {x, y, w, h} = region
  // coverageFromColour, inlined over a table of 1 / (W − G) (a few ms a
  // tile, where the calls took tens).
  const cov = new Uint8Array(w * h)
  const gap = new Uint8Array(w * h)
  const scale = 255 / (COVERAGE_FULL - COVERAGE_CLEAR)
  let gaps = 0
  for (let j = 0; j < h; j++) {
    let o = 4 * j * obsStride
    let gi = 4 * (((y + j) * mapWidth) + x)
    let k = j * w
    for (let i = 0; i < w; i++, o += 4, gi += 4, k++) {
      const r = obs[o]
      const g = obs[o + 1]
      const b = obs[o + 2]
      if (r <= NO_DATA_MAX && g <= NO_DATA_MAX && b <= NO_DATA_MAX) {
        gap[k] = 1
        gaps++
        continue
      }
      const gr = ground[gi]
      const gg = ground[gi + 1]
      const gb = ground[gi + 2]
      let c = (r - gr) * UNMIX[gr]
      const cg = (g - gg) * UNMIX[gg]
      const cb = (b - gb) * UNMIX[gb]
      if (cg < c) {
        c = cg
      }
      if (cb < c) {
        c = cb
      }
      const v = (c - COVERAGE_CLEAR) * scale
      cov[k] = v <= 0 ? 0 : (v >= 255 ? 255 : Math.round(v))
    }
  }
  const near = gaps > 0 ? dilate(gap, w, h, GAP_MARGIN) : gap
  let missing = 0
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j * w) + i
      const m = ((y + j) * mapWidth) + x + i
      if (gapsOnly && !unseen[m]) {
        continue
      }
      if (near[k]) {
        missing++
        unseen[m] = 1
        out[m] = fill[m]
      } else {
        unseen[m] = 0
        out[m] = cov[k]
      }
    }
  }
  return missing
}


// Pixels this close to a gap in the data are taken as gap too.
export const GAP_MARGIN = 2


/**
 * @param {Uint8Array} mask 1 set, 0 not, `w × h`
 * @param {number} w
 * @param {number} h
 * @param {number} radius
 * @returns {Uint8Array} The mask grown by `radius` pixels (a square)
 */
export function dilate(mask, w, h, radius) {
  // Rows, then columns: a square of side 2·radius + 1.
  const rows = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (mask[(j * w) + i]) {
        for (let d = Math.max(0, i - radius); d <= Math.min(w - 1, i + radius); d++) {
          rows[(j * w) + d] = 1
        }
      }
    }
  }
  const out = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (rows[(j * w) + i]) {
        for (let d = Math.max(0, j - radius); d <= Math.min(h - 1, j + radius); d++) {
          out[(d * w) + i] = 1
        }
      }
    }
  }
  return out
}


/**
 * Gaps no layer saw, narrower than this (pixels), are filled from the
 * pixels either side of them: MODIS's gaps between swaths, where Aqua's and
 * Terra's cross near the equator (a few degrees wide).  Wider ones (polar
 * night) keep the bundled texture's coverage.
 */
export const GAP_FILL_MAX_PX = 96

// Rows each way the filled pixels are smoothed over, so a fill isn't a
// stack of horizontal streaks.
const GAP_SMOOTH_ROWS = 3


/**
 * Fill the region's narrow unseen gaps from the coverage either side, row
 * by row, then smooth the filled pixels down the columns.  Unseen pixels
 * that were filled are marked seen.
 *
 * @param {Uint8Array} out The map's coverage
 * @param {Uint8Array} unseen The map's unseen mask
 * @param {object} rect The region, {x, y, w, h}
 * @param {number} width The map's
 * @param {number} [maxRun]
 * @returns {number} How many pixels were filled
 */
export function fillNarrowGaps(out, unseen, rect, width, maxRun = GAP_FILL_MAX_PX) {
  const {x, y, w, h} = rect
  const filled = new Uint8Array(w * h)
  let count = 0
  for (let j = 0; j < h; j++) {
    const row = ((y + j) * width) + x
    let i = 0
    while (i < w) {
      if (!unseen[row + i]) {
        i++
        continue
      }
      const start = i
      while (i < w && unseen[row + i]) {
        i++
      }
      const run = i - start
      if (start === 0 || i === w || run > maxRun) {
        continue
      }
      const a = out[row + start - 1]
      const b = out[row + i]
      for (let k = start; k < i; k++) {
        out[row + k] = Math.round(a + ((b - a) * (k - start + 1) / (run + 1)))
        filled[(j * w) + k] = 1
        count++
      }
    }
  }
  if (count === 0) {
    return 0
  }
  // Down the columns: each filled pixel the mean of the column's pixels
  // within GAP_SMOOTH_ROWS that were filled or seen.
  const before = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    const start = ((y + j) * width) + x
    before.set(out.subarray(start, start + w), j * w)
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!filled[(j * w) + i]) {
        continue
      }
      let sum = 0
      let n = 0
      for (let d = Math.max(0, j - GAP_SMOOTH_ROWS); d <= Math.min(h - 1, j + GAP_SMOOTH_ROWS); d++) {
        if (filled[(d * w) + i] || !unseen[((y + d) * width) + x + i]) {
          sum += before[(d * w) + i]
          n++
        }
      }
      out[((y + j) * width) + x + i] = Math.round(sum / n)
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (filled[(j * w) + i]) {
        unseen[((y + j) * width) + x + i] = 0
      }
    }
  }
  return count
}
