import {
  CLOUD_TILE_LEVEL,
  TILE_PX,
  dailySource,
  fillNarrowGaps,
  previousDate,
  tileGrid,
  tileRect,
  tileUrl,
  unmixTile,
} from './cloudSource.js'


/**
 * One day's cloud map, built whole from its tiles before it's shown, and
 * the day to show: the wanted one if its mosaic is complete, else the
 * latest complete day before it (#243).  Pure but for the injected tile
 * fetch, so it's tested without a browser; CloudMap.js does the fetching
 * and the GPU side.  Planet.md, "Clouds".
 *
 * Why whole days.  A day's map is 15 tiles, and a tile that differs from
 * its neighbour draws a hard step at the edge between them, along a
 * meridian (−180°, −108°, −36°, 36°, 108°) or a parallel (18° N, 54° S):
 *
 * - a tile not in yet, when the map was shown as each tile arrived;
 * - a tile neither layer could serve, which was left without clouds;
 * - a day GIBS hasn't finished: its tiles are built as the swaths are
 *   processed, each at its own time, so neighbours disagree at their edge
 *   (one has a region's swaths, the next not yet), and processing gaps of
 *   hours leave whole regions black.  What neither layer saw was filled
 *   from the bundled texture, another day's (infrared) clouds, so each
 *   gap's edge was a seam.  A day can be like that well past the 27 h
 *   cloudSource allows it (2026-10-12's was a third unseen between 50° N
 *   and S, 46 h after the day began).
 *
 * So a day is built off screen and shown at once, and only if it's
 * complete: what neither layer saw between COMPLETE_BAND_DEG N and S, where
 * the satellites see every place in daylight in every season, is at most
 * INCOMPLETE_SHARE of it.
 */


/**
 * The band of latitudes a day's completeness is judged over, degrees N and
 * S: in every season the satellites' early-afternoon pass sees all of it
 * in daylight.  At 60° the winter's low Sun leaves 3-6% unseen on complete
 * days (2025-12-21, 2026-06-21).
 */
export const COMPLETE_BAND_DEG = 50

/**
 * The share of the band left unseen by both layers (after the narrow gaps'
 * fill) over which a day is incomplete.  Complete days measure 0-0.08%
 * (VIIRS 2025-12-21 to 2026-10-11, MODIS 2010-03-15); unfinished ones
 * about a third (2026-10-12 and 13, on 2026-10-13).
 */
export const INCOMPLETE_SHARE = 0.01

/** Days before the wanted one tried when it is incomplete. */
export const DAYS_BACK = 2

/**
 * A tile's gaps worth the secondary layer's tile: more than this share of
 * it unseen (VIIRS's are rare outside polar night; MODIS's run between its
 * swaths at the equator).
 */
export const GAPS_WORTH_FILLING = 0.002

/** Tiles fetched at once. */
export const CONCURRENT_TILES = 4


/**
 * @param {object} source cloudSource's daily source
 * @param {number} [daysBack]
 * @returns {Array<object>} The source, then the days before it (each with
 *   its own layers), back to `daysBack` or the first satellite day
 */
export function fallbackSources(source, daysBack = DAYS_BACK) {
  const sources = [source]
  let date = source.date
  for (let i = 0; i < daysBack; i++) {
    date = previousDate(date)
    const s = dailySource(date)
    if (!s) {
      break
    }
    sources.push(s)
  }
  return sources
}


/**
 * @param {number} height The map's, pixels (180°)
 * @param {number} [deg] The band's half-width, degrees
 * @returns {{top: number, bottom: number}} The map's rows within `deg` N
 *   and S, `top` inclusive, `bottom` exclusive
 */
export function bandRows(height, deg = COMPLETE_BAND_DEG) {
  const pxPerDeg = height / 180
  return {top: Math.round((90 - deg) * pxPerDeg), bottom: Math.round((90 + deg) * pxPerDeg)}
}


/**
 * @param {Uint8Array} unseen The map's unseen mask
 * @param {object} rect {x, y, w, h}
 * @param {number} width The map's
 * @param {{top: number, bottom: number}} band Rows (bandRows)
 * @returns {number} The rect's unseen pixels within the band
 */
export function unseenInBand(unseen, rect, width, band) {
  let n = 0
  const j0 = Math.max(rect.y, band.top)
  const j1 = Math.min(rect.y + rect.h, band.bottom)
  for (let j = j0; j < j1; j++) {
    const start = (j * width) + rect.x
    for (let k = start; k < start + rect.w; k++) {
      n += unseen[k]
    }
  }
  return n
}


/**
 * Build a day's coverage map from its tiles, off screen.  Each tile is
 * unmixed against the month's Blue Marble, its gaps from the secondary
 * layer, narrow gaps from either side; what's left, and a tile neither
 * layer could serve, keeps the bundled texture's coverage.  Stops early once
 * the band's unseen share passes `stopAbove`: the day is incomplete.
 *
 * @param {object} opts
 * @param {object} opts.source cloudSource's daily source
 * @param {Uint8ClampedArray|Uint8Array} opts.ground The month's Blue Marble,
 *   RGBA at the map's size
 * @param {Uint8Array} opts.bundled The bundled texture's coverage, at the map's size
 * @param {function(string): Promise<?Uint8ClampedArray>} opts.fetchTile A
 *   tile's RGBA (TILE_PX square) by its URL, or null where there's none
 * @param {number} [opts.stopAbove] Give up past this share of the band unseen
 * @param {function(): boolean} [opts.stale] Whether the build is no longer wanted
 * @param {function(object): void} [opts.onTile] Called as each tile is done,
 *   with {done, failed, unmixMs} so far
 * @param {Array<number>} [opts.columns] Only these tile columns (the seam
 *   strip's); the rest of the map keeps the bundled coverage, and the
 *   completeness is judged over these columns only
 * @param {number} [opts.level]
 * @returns {Promise<?{coverage: Uint8Array, unseen: Uint8Array,
 *   unseenShare: number, complete: boolean, aborted: boolean, failed: number,
 *   unmixMs: number}>}
 *   null if it went stale
 */
export async function buildDay({
  source, ground, bundled, fetchTile, stopAbove = INCOMPLETE_SHARE, stale = () => false, onTile = null,
  columns = null, level = CLOUD_TILE_LEVEL,
}) {
  const {date, layers} = source
  const {cols, rows, width, height} = tileGrid(level)
  const coverage = Uint8Array.from(bundled)
  const unseen = new Uint8Array(width * height).fill(1)
  const band = bandRows(height)
  let bandTotal = 0
  let bandUnseen = 0
  let aborted = false
  let done = 0
  let failed = 0
  // Main-thread time spent unmixing, ms.
  let unmixMs = 0
  const tiles = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!columns || columns.includes(col)) {
        tiles.push({row, col})
        bandTotal += tileRect(level, row, col).w * (band.bottom - band.top)
      }
    }
  }
  const one = async ({row, col}) => {
    if (aborted || stale()) {
      return
    }
    const rect = tileRect(level, row, col)
    let missing = rect.w * rect.h
    let any = false
    for (let i = 0; i < layers.length && missing > rect.w * rect.h * GAPS_WORTH_FILLING; i++) {
      const pixels = await fetchTile(tileUrl(layers[i].layer, date, level, row, col))
      if (aborted || stale()) {
        return
      }
      if (!pixels) {
        continue
      }
      any = true
      const t0 = now()
      missing = unmixTile(pixels, TILE_PX, rect, ground, coverage, bundled, unseen, width, true)
      unmixMs += now() - t0
    }
    if (any) {
      const t0 = now()
      fillNarrowGaps(coverage, unseen, rect, width)
      unmixMs += now() - t0
    } else {
      failed++
    }
    bandUnseen += unseenInBand(unseen, rect, width, band)
    done++
    onTile?.({done, failed, unmixMs})
    if (bandUnseen > stopAbove * bandTotal) {
      aborted = true
    }
  }
  await runLimited(tiles, CONCURRENT_TILES, one)
  if (stale()) {
    return null
  }
  const unseenShare = bandUnseen / bandTotal
  return {coverage, unseen, unseenShare, complete: !aborted && unseenShare <= INCOMPLETE_SHARE, aborted, failed, unmixMs}
}


/**
 * The day to show: the first of `sources` whose mosaic is complete; if none
 * is, the first, gaps and all.
 *
 * @param {Array<object>} sources fallbackSources'
 * @param {function(object, number): Promise<?object>} build A day's
 *   buildDay, given its source and its stopAbove; null if it went stale
 * @returns {Promise<?{source: object, day: object}>} null if a build went stale
 */
export async function chooseDay(sources, build) {
  for (const source of sources) {
    const day = await build(source, INCOMPLETE_SHARE)
    if (!day) {
      return null
    }
    if (day.complete) {
      return {source, day}
    }
  }
  // None is: the wanted day after all, built whole.
  const day = await build(sources[0], Infinity)
  return day ? {source: sources[0], day} : null
}


/**
 * The antimeridian (#251).  A day's mosaic is cut at ±180°, between swaths
 * taken a day apart: the map's east edge was seen early in the UTC day, its
 * west edge at its end, so the clouds on either side of the cut differ by
 * about a day (a step 2.9-4.4 times the other meridians', every day).  The
 * day before's mosaic ended at that cut as this one begins: its west edge
 * was seen at the time this day's east edge was.  So the day's westernmost
 * columns, the far side of the cut from there, are faded into the day
 * before's over SEAM_FADE_DEG: weight 1 of the day before at -180°, so the
 * clouds meet across the cut, down to 0 at the fade's far edge, where the
 * day's own are shown.  The cut becomes a gradual change of the clouds'
 * age, as it is round the rest of the globe.  The day before is always
 * there to fetch (the day after is not, for the present), and only its
 * column of tiles is needed: 3 of 15.
 */
export const SEAM_FADE_DEG = 20

/** The tile column (the westernmost) of the day before the fade needs. */
export const SEAM_TILE_COLUMN = 0


/**
 * @param {number} width The map's, pixels
 * @param {number} [deg]
 * @returns {number} The fade's width, whole columns from -180°
 */
export function seamColumns(width, deg = SEAM_FADE_DEG) {
  return Math.round(width * deg / 360)
}


/**
 * @param {number} x Column from -180° (the west edge is 0)
 * @param {number} columns The fade's width (seamColumns)
 * @returns {number} The weight of the day before's clouds at the column's
 *   centre: 1 at the cut, falling in a straight line to 0 at the fade's far edge
 */
export function seamWeight(x, columns) {
  return x < columns ? 1 - ((x + 0.5) / columns) : 0
}


/**
 * @param {object} source cloudSource's daily source
 * @returns {?object} The day before's, with its own layers, or null before
 *   the satellites
 */
export function seamSource(source) {
  return dailySource(previousDate(source.date))
}


/**
 * Build the day before's westernmost column of tiles, off screen, for
 * blendSeam.  Judged as a day is (buildDay): a strip that isn't complete is
 * not used.
 *
 * @param {object} opts buildDay's, but `source` is the day before's
 * @returns {Promise<?object>} buildDay's result for that column, or null if
 *   it went stale
 */
export function buildSeam(opts) {
  return buildDay({...opts, columns: [SEAM_TILE_COLUMN]})
}


/**
 * Fade the day before's clouds into the map's westernmost columns, in
 * place, where it saw them: `map ← map + w · (before − map)`.
 *
 * @param {Uint8Array} map The day's coverage
 * @param {object} before The day before's buildSeam result
 * @param {number} width The map's
 * @param {number} height
 * @param {number} [deg] The fade's width
 * @returns {number} The pixels changed
 */
export function blendSeam(map, before, width, height, deg = SEAM_FADE_DEG) {
  const columns = seamColumns(width, deg)
  let changed = 0
  for (let x = 0; x < columns; x++) {
    const w = seamWeight(x, columns)
    for (let j = 0; j < height; j++) {
      const k = (j * width) + x
      if (!before.unseen[k]) {
        map[k] = Math.round(map[k] + (w * (before.coverage[k] - map[k])))
        changed++
      }
    }
  }
  return changed
}


/**
 * Fade a shown day's map into the day before's at the antimeridian, in
 * place, if that day's westernmost tiles can be had and are complete; else
 * the map is left as it is, cut and all.  Fetches the day before's column
 * of tiles (3), so it's run after the day is shown, not before.
 *
 * @param {object} opts
 * @param {Uint8Array} opts.map The shown day's coverage, changed in place
 * @param {object} opts.shown cloudSource's daily source of the day shown
 * @param {function(object): (Uint8ClampedArray|Promise<Uint8ClampedArray>)} opts.groundOf
 *   A source's month's Blue Marble, RGBA at the map's size
 * @param {Uint8Array} opts.bundled The bundled texture's coverage
 * @param {function(string): Promise<?Uint8ClampedArray>} opts.fetchTile
 * @param {function(): boolean} [opts.stale] Whether the map is no longer wanted
 * @param {number} [opts.level]
 * @returns {Promise<?{date: ?string, state: string, unseenShare: number}>}
 *   The day before's date and what became of it: `blended`; `incomplete`
 *   (more than INCOMPLETE_SHARE of its tiles' band unseen, or a tile
 *   missing); `failed` (its ground didn't load); `none` (before the
 *   satellites); or null if it went stale, the map untouched
 */
export async function fadeSeam({map, shown, groundOf, bundled, fetchTile, stale = () => false, level = CLOUD_TILE_LEVEL}) {
  const source = seamSource(shown)
  if (!source) {
    return {date: null, state: 'none', unseenShare: 0}
  }
  let before
  try {
    before = await buildSeam({source, ground: await groundOf(source), bundled, fetchTile, stale, level})
  } catch (err) {
    console.warn(`[clouds] couldn't fade the antimeridian into ${source.date}'s clouds`, err)
    return {date: source.date, state: 'failed', unseenShare: 0}
  }
  if (!before || stale()) {
    return null
  }
  const {unseenShare} = before
  if (!before.complete) {
    return {date: source.date, state: 'incomplete', unseenShare}
  }
  const {width, height} = tileGrid(level)
  blendSeam(map, before, width, height)
  return {date: source.date, state: 'blended', unseenShare}
}


/** @returns {number} ms, for timing the main thread's share */
function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}


/**
 * Run `fn` over `items`, at most `limit` at a time.
 *
 * @param {Array} items
 * @param {number} limit
 * @param {Function} fn async
 * @returns {Promise<void>}
 */
export async function runLimited(items, limit, fn) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      await fn(items[next++])
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker))
}
