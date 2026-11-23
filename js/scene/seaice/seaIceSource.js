/**
 * Earth's sea ice by day (design/Cryosphere.md, phase 1; Planet.md, "Sea
 * ice"): which of NASA GIBS's passive-microwave records to show for a date,
 * their tiles, and how a day's tiles become one concentration map.  Pure,
 * so it's tested without a browser; SeaIceMap.js does the fetching and the
 * GPU side.
 *
 * The map is one byte a pixel, concentration × 255, equirectangular at
 * 0.28125° (1280 × 640), −180° at the left edge and north at row 0, as the
 * clouds' map and the Blue Marble are laid out.
 *
 * - From 2002-09-01: GHRSST's MUR25 sea ice concentration (EPSG:4326, the
 *   `2km` matrix set at level 1: 3 × 2 tiles of 512 px, 144° each, so the
 *   map is the mosaic's top left 1280 × 640).  1% steps, palette index =
 *   percent + 1, 0 no data (land).
 * - 1978-10-26 to 2002-08-31: NSIDC's SMMR/SSM/I/SSMIS record, in the
 *   polar stereographic grids (EPSG:3413 north, 3031 south; `1km` at level
 *   0: 2 × 2 tiles of 512 px at 8,192 m, ±4,194,304 m), reprojected here.
 *   0.4% steps; its classes are the pole hole (ice: the satellites' orbits
 *   don't reach it), coast, land and missing.  Every other day before
 *   1987-08-20.
 * - Before the record, and past the latest day by more than a couple of
 *   days, a stand-in: the same calendar day of the nearest year that has
 *   one, said so in the status (`standin`).  The bundled weekly atlas
 *   (Cryosphere.md, phase 2) will replace it.
 *
 * GIBS's colour maps: colormaps/v1.3/GHRSST_Sea_Ice_Concentration.xml and
 * SSMIS_Sea_Ice_Concentration.xml; a tile's palette index is the map's
 * `ref` (checked 2026-11-22, every entry of both).
 */


export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts'

export const MAP_WIDTH = 1280
export const MAP_HEIGHT = 640
const DEG_PER_PX = 180 / MAP_HEIGHT

export const TILE_PX = 512

/** MUR25 from this day; NSIDC's before it, from its first. */
export const MUR_FROM = '2002-09-01'
export const SSMIS_FROM = '1978-10-26'
// SSMIS's every-other-day years end here (GIBS's time dimension).
const SSMIS_DAILY_FROM = '1987-08-20'

/**
 * Concentration below this is drawn as open water: the convention of
 * NSIDC's Sea Ice Index (an ice edge at 15%), below which the passive
 * microwave's weather and coastal spill are noise.
 */
export const EDGE_CONCENTRATION = 0.15

// GIBS puts a day up within hours, the UTC day's last swaths at its end.
const LATEST_AFTER_MS = 40 * 3600 * 1000
// The present: a date this far past the latest day shows the latest.
const PRESENT_SLACK_MS = 3 * 86400 * 1000
const DAY_MS = 86400 * 1000

/** Days back a day's gap is filled from (a day missing from a layer). */
export const DAYS_BACK = 3

/**
 * A day is real data only with ice on it: GIBS answers a day missing from
 * a layer with empty tiles, not a 404.  At their smallest the two
 * hemispheres together have about 5 million km² of ice, tens of thousands
 * of the map's pixels.
 */
export const MIN_ICE_PIXELS = 2000


/**
 * @param {number} ms Epoch milliseconds
 * @returns {string} Its UTC date, YYYY-MM-DD
 */
export function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}


/**
 * @param {string} date YYYY-MM-DD
 * @param {number} days
 * @returns {string} That many days later (negative: earlier)
 */
export function addDays(date, days) {
  return utcDate(Date.parse(`${date}T00:00:00Z`) + (days * DAY_MS))
}


/**
 * @param {string} date YYYY-MM-DD
 * @returns {'mur'|'ssmis'|null} The record that has it
 */
export function recordOf(date) {
  if (date >= MUR_FROM) {
    return 'mur'
  }
  return date >= SSMIS_FROM ? 'ssmis' : null
}


/**
 * The sea ice to show for a simulation time.
 *
 * @param {number} simMs The simulation time, epoch milliseconds
 * @param {number} nowMs The real time, epoch milliseconds
 * @returns {{date: string, wanted: string, record: string, standin: ?string}}
 *   The day to fetch, the day wanted, its record, and why another day
 *   stands in for it (null when it's the day itself)
 */
export function seaIceSource(simMs, nowMs) {
  const latest = utcDate(nowMs - LATEST_AFTER_MS)
  const wanted = utcDate(Number.isFinite(simMs) ? simMs : nowMs)
  let date = wanted
  let standin = null
  if (wanted > latest) {
    if (simMs <= nowMs + PRESENT_SLACK_MS) {
      // The present: the latest day.
      date = latest
    } else {
      date = sameDayIn(wanted, Number(latest.slice(0, 4)), latest)
      standin = 'future'
    }
  } else if (wanted < SSMIS_FROM) {
    date = sameDayIn(wanted, 1979)
    standin = 'before the record'
  }
  return {date, wanted, record: recordOf(date), standin}
}


/**
 * @param {string} date YYYY-MM-DD
 * @param {number} year
 * @param {string} [notAfter] YYYY-MM-DD: a year earlier if past it
 * @returns {string} The same calendar day in that year (28 February for a
 *   29th in a common year)
 */
export function sameDayIn(date, year, notAfter = null) {
  const mmdd = date.slice(5)
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const make = (y) => `${y}-${mmdd === '02-29' && !leap(y) ? '02-28' : mmdd}`
  let out = make(year)
  if (notAfter && out > notAfter) {
    out = make(year - 1)
  }
  return out
}


/**
 * The days to try for a source, in order: the day, then the days before it
 * (a gap in a layer), each in its own record.
 *
 * @param {{date: string}} source
 * @returns {Array<string>}
 */
export function daysToTry(source) {
  const out = []
  for (let back = 0; back <= DAYS_BACK; back++) {
    const date = addDays(source.date, -back)
    if (recordOf(date)) {
      out.push(date)
    }
  }
  // SSMIS's every-other-day years: the day after too, if it's in the record.
  if (source.date < SSMIS_DAILY_FROM && recordOf(source.date) === 'ssmis') {
    out.splice(1, 0, addDays(source.date, 1))
  }
  return out
}


/**
 * @param {string} date YYYY-MM-DD, in a record
 * @returns {Array<{url: string, hemisphere?: string, row: number, col: number}>}
 *   The day's tiles
 */
export function tilesOf(date) {
  const out = []
  if (recordOf(date) === 'mur') {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        out.push({row, col,
          url: `${GIBS}/epsg4326/best/GHRSST_L4_MUR25_Sea_Ice_Concentration/default/${date}/2km/1/${row}/${col}.png`})
      }
    }
    return out
  }
  for (const hemisphere of ['north', 'south']) {
    const epsg = hemisphere === 'north' ? 3413 : 3031
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        out.push({hemisphere, row, col,
          url: `${GIBS}/epsg${epsg}/best/SSMIS_Sea_Ice_Concentration/default/${date}/1km/0/${row}/${col}.png`})
      }
    }
  }
  return out
}


/**
 * Palette index to concentration × 255, by record.
 *
 * MUR25: index i in 1-101 is i − 1 percent; 0 (and the palette's unused
 * entries) no data.  SSMIS: index 1 is the pole hole, ice; 2-5 classes
 * (unused, coast, land, missing); 6-253 the values, (i − 5) × 0.4 percent;
 * 0 and 254-255 (outside the grid) no data.  Below the ice edge, 0.
 */
export const LOOKUP = Object.freeze({
  mur: lookup((i) => (i >= 1 && i <= 101 ? (i - 1) / 100 : 0)),
  ssmis: lookup((i) => {
    if (i === 1) {
      return 1
    }
    return i >= 6 && i <= 253 ? Math.min(1, (i - 5) * 0.004) : 0
  }),
})


/**
 * Which palette indices are no data (land, coast, outside the grid), not
 * water: the ice is spread into them at the shore (spreadIntoLand).
 */
export const NO_DATA = Object.freeze({
  mur: Uint8Array.from({length: 256}, (_, i) => (i === 0 || i > 101 ? 1 : 0)),
  ssmis: Uint8Array.from({length: 256}, (_, i) => (i === 0 || (i >= 2 && i <= 5) || i > 253 ? 1 : 0)),
})


/**
 * @param {function(number): number} concentrationOf Index to 0-1
 * @returns {Uint8Array} 256 entries, concentration × 255, 0 below the edge
 */
function lookup(concentrationOf) {
  const out = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    const c = concentrationOf(i)
    out[i] = c >= EDGE_CONCENTRATION ? Math.round(c * 255) : 0
  }
  return out
}


/**
 * One day's map from its tiles.
 *
 * @param {string} date YYYY-MM-DD, in a record
 * @param {Array<?Uint8Array>} tiles Each of tilesOf(date)'s palette indices,
 *   TILE_PX square, in its order; null for one not had
 * @returns {{map: Uint8Array, icePixels: number, missing: number}}
 */
export function buildMap(date, tiles) {
  const map = new Uint8Array(MAP_WIDTH * MAP_HEIGHT)
  // 1 where the data has nothing (land, coast): the ice spreads into it.
  const land = new Uint8Array(MAP_WIDTH * MAP_HEIGHT)
  const specs = tilesOf(date)
  const missing = tiles.filter((t) => !t).length
  if (recordOf(date) === 'mur') {
    const table = LOOKUP.mur
    const noData = NO_DATA.mur
    specs.forEach((spec, i) => {
      const tile = tiles[i]
      if (!tile) {
        return
      }
      for (let y = 0; y < TILE_PX; y++) {
        const my = (spec.row * TILE_PX) + y
        if (my >= MAP_HEIGHT) {
          break
        }
        for (let x = 0; x < TILE_PX; x++) {
          const mx = (spec.col * TILE_PX) + x
          if (mx >= MAP_WIDTH) {
            break
          }
          const v = tile[(y * TILE_PX) + x]
          map[(my * MAP_WIDTH) + mx] = table[v]
          land[(my * MAP_WIDTH) + mx] = noData[v]
        }
      }
    })
  } else {
    fillPolar(map, land, specs, tiles)
  }
  spreadIntoLand(map, land)
  let icePixels = 0
  for (let i = 0; i < map.length; i++) {
    if (map[i] > 0) {
      icePixels++
    }
  }
  return {map, icePixels, missing}
}


/**
 * Pixels the ice spreads into the land from the shore.  The data have
 * nothing on land, so a filtered sample at the coast mixes the ice with
 * land's 0 and draws a dark line of open sea along every iced shore (on
 * Cesium's globe, which has no ocean mask, a pixel wide; on celestiary's,
 * under the hydrosphere mask's own filtering, fainter).  Spread a couple
 * of pixels (5-30 km at the ice's latitudes) into the land, the ice meets
 * the shore; celestiary's mask clips it there, and on Cesium's globe it
 * lies on the coast's first pixels, which ice-bound shores' snow mostly is.
 */
export const SPREAD_PX = 2


/**
 * Spread the ice into the no-data pixels next to it, SPREAD_PX passes of
 * the largest of each one's four neighbours (wrapping at ±180°).
 *
 * @param {Uint8Array} map
 * @param {Uint8Array} land 1 for no data
 */
export function spreadIntoLand(map, land) {
  for (let pass = 0; pass < SPREAD_PX; pass++) {
    const from = map.slice()
    for (let y = 0; y < MAP_HEIGHT; y++) {
      const row = y * MAP_WIDTH
      for (let x = 0; x < MAP_WIDTH; x++) {
        const i = row + x
        if (!land[i] || from[i]) {
          continue
        }
        const l = from[row + ((x + MAP_WIDTH - 1) % MAP_WIDTH)]
        const r = from[row + ((x + 1) % MAP_WIDTH)]
        const u = y > 0 ? from[i - MAP_WIDTH] : 0
        const d = y < MAP_HEIGHT - 1 ? from[i + MAP_WIDTH] : 0
        map[i] = Math.max(l, r, u, d)
      }
    }
  }
}


/** The polar grids' half width, m (GIBS's EPSG:3413 and 3031 extent). */
export const POLAR_HALF = 4194304
const POLAR_PX_M = 8192
// Latitudes nearer the equator than this are outside both grids.
const POLAR_MIN_LAT = 30


/**
 * SSMIS's polar tiles reprojected into the map, nearest neighbour (its
 * 25 km data on 8 km pixels).
 *
 * @param {Uint8Array} map
 * @param {Uint8Array} land No data's pixels, set here
 * @param {Array<object>} specs tilesOf's
 * @param {Array<?Uint8Array>} tiles
 */
function fillPolar(map, land, specs, tiles) {
  const table = LOOKUP.ssmis
  const noData = NO_DATA.ssmis
  const grid = TILE_PX * 2
  const tileAt = {}
  specs.forEach((s, i) => {
    tileAt[`${s.hemisphere}/${s.row}/${s.col}`] = tiles[i]
  })
  const out = [0, 0]
  for (let my = 0; my < MAP_HEIGHT; my++) {
    const lat = 90 - ((my + 0.5) * DEG_PER_PX)
    if (Math.abs(lat) < POLAR_MIN_LAT) {
      continue
    }
    const hemisphere = lat > 0 ? 'north' : 'south'
    for (let mx = 0; mx < MAP_WIDTH; mx++) {
      const lon = -180 + ((mx + 0.5) * DEG_PER_PX)
      polarStereographic(lat, lon, hemisphere, out)
      const gx = Math.floor((out[0] + POLAR_HALF) / POLAR_PX_M)
      const gy = Math.floor((POLAR_HALF - out[1]) / POLAR_PX_M)
      if (gx < 0 || gy < 0 || gx >= grid || gy >= grid) {
        continue
      }
      const tile = tileAt[`${hemisphere}/${gy >> 9}/${gx >> 9}`]
      if (tile) {
        const v = tile[((gy & 511) * TILE_PX) + (gx & 511)]
        map[(my * MAP_WIDTH) + mx] = table[v]
        land[(my * MAP_WIDTH) + mx] = noData[v]
      }
    }
  }
}


// WGS84, the polar grids' ellipsoid.
const A = 6378137
const E = Math.sqrt(0.00669437999014)
const RAD = Math.PI / 180
/**
 * EPSG:3413, NSIDC Sea Ice Polar Stereographic North: true scale at 70° N,
 * central meridian 45° W.  EPSG:3031, Antarctic Polar Stereographic: true
 * scale at 71° S, central meridian 0°.
 */
export const POLAR = Object.freeze({
  north: Object.freeze({trueScaleLat: 70, centralLon: -45}),
  south: Object.freeze({trueScaleLat: -71, centralLon: 0}),
})


/**
 * Ellipsoidal polar stereographic (Snyder 1987, Map Projections: A Working
 * Manual, eqs. 21-33 to 21-35 and 15-9), as EPSG:3413 and 3031 define it.
 *
 * @param {number} lat Degrees
 * @param {number} lon Degrees
 * @param {'north'|'south'} hemisphere
 * @param {Array<number>} [out] [x, y], m
 * @returns {Array<number>} out
 */
export function polarStereographic(lat, lon, hemisphere, out = [0, 0]) {
  const {trueScaleLat, centralLon} = POLAR[hemisphere]
  // The south pole's case is the north's with every angle negated, and x
  // and y negated after (Snyder, p. 161).
  const s = hemisphere === 'north' ? 1 : -1
  const phi = s * lat * RAD
  const phiC = s * trueScaleLat * RAD
  const dLon = s * (lon - centralLon) * RAD
  const t = tsfn(phi)
  const mc = Math.cos(phiC) / Math.sqrt(1 - (E * E * Math.sin(phiC) * Math.sin(phiC)))
  const rho = A * mc * t / tsfn(phiC)
  out[0] = s * rho * Math.sin(dLon)
  out[1] = -s * rho * Math.cos(dLon)
  return out
}


/**
 * @param {number} phi Latitude, radians
 * @returns {number} Snyder's t (eq. 15-9)
 */
function tsfn(phi) {
  const es = E * Math.sin(phi)
  return Math.tan((Math.PI / 4) - (phi / 2)) / Math.pow((1 - es) / (1 + es), E / 2)
}
