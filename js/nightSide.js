import {gmstRad} from './scene/celestialFrame.js'
import {julianDay, lowPrecisionSun, obliquity, sunEquatorial} from './tonight.js'
import NIGHT_LIGHTS from './scene/nightLights.json'


/**
 * Which night side the homepage's tour flies over, and from where
 * (DESIGN.md "The tour").  The tour is live, at the visitor's own time, so
 * the picture is planned against the Sun, not the ground: the camera comes
 * in on the evening side, the sunlit crescent, the terminator and the night
 * side in the frame, and of the night sides near local midnight now it aims
 * at the one with the most city light.  Europe at one hour, India, East
 * Asia or the Americas at another; when midnight is over the Pacific, the
 * nearest lit coast.
 *
 * City light is the Earth material's own night-lights texture, summed per
 * 5° cell (scene/nightLights.json, by tools/home/nightLights.py;
 * scene/Planet.md "City light per cell").  Darkness is the Sun's altitude
 * at each cell, from the app's ephemeris (`sunAt`, as tonight.js's), so a
 * summer's short nights in the north count for less, and a polar day for
 * nothing.
 *
 * Angles for the tour (tour.js) are in its frame: azimuth about the
 * ecliptic's north from Earth's sunward direction (0 noon, 90 the dusk
 * terminator, 180 midnight, -90 the dawn terminator), elevation over the
 * ecliptic.  In it the terminator is always the meridians at ±90°, whatever
 * the season.
 */


const DEG = Math.PI / 180
const HOUR_DEG = 15
const HALF_TURN = 180
const TURN = 360


/** Earth's mean radius, m. */
export const EARTH_RADIUS_METER = 6.371e6


/**
 * Where the aim may be, hours from local midnight (negative before it):
 * first on the evening side, from 20:30 to 00:30; failing anything bright
 * enough there, from 19:00 to 03:30, nearest midnight first.
 */
export const PREFERRED_HOURS = Object.freeze([-3.5, 0.5])
export const FALLBACK_HOURS = Object.freeze([-5, 3.5])
// Within the preferred hours, 21:00 to 23:00 count fully, and each hour
// further out 15% less.
const BEST_HOURS = Object.freeze([-3, -1])
const HOUR_PENALTY = 0.15
const HOURS_EPSILON = 1e-9

/**
 * A cell's lights count fully where the Sun is DARK_FULL_DEG down (nautical
 * dusk: a dark sky over them), and not at all over DARK_FROM_DEG (the
 * twilight still bright round them).
 */
export const DARK_FULL_DEG = -12
export const DARK_FROM_DEG = -6

// What the frame's middle takes in: cells within this of the aim, degrees of
// arc, weighed down to nothing at the edge.
const FOOTPRINT_DEG = 15
// Aims: latitudes where people live, not the poles' long nights or days.
const AIM_LAT_MIN = -45
const AIM_LAT_MAX = 60
const AIM_STEP_DEG = 2.5

/**
 * A night side worth flying over has at least this share of the brightest
 * one's light (Europe's, India's, the eastern United States'), all of it
 * dark.  Less is ocean, or a scatter of islands.
 */
export const MIN_SHARE = 0.25


/**
 * @param {number} deg
 * @returns {number} In (-180, 180]
 */
export function wrap180(deg) {
  const d = ((deg % TURN) + TURN) % TURN
  return d > HALF_TURN ? d - TURN : d
}


/**
 * @param {number} t
 * @returns {number} Smoothstep, 0 to 1
 */
function smooth(t) {
  const u = Math.min(Math.max(t, 0), 1)
  return u * u * (3 - (2 * u))
}


/**
 * @param {number} lat Degrees
 * @param {number} lng Degrees
 * @returns {Array<number>} The unit vector, Earth-fixed
 */
function unit(lat, lng) {
  const c = Math.cos(lat * DEG)
  return [c * Math.cos(lng * DEG), c * Math.sin(lng * DEG), Math.sin(lat * DEG)]
}


/**
 * The table's cells as points with their light, the dark ones dropped.
 *
 * @param {{cellDeg: number, lights: Array<Array<number>>}} table
 * @returns {Array<{lat: number, lng: number, light: number, u: Array<number>}>}
 */
function litCells(table) {
  const {cellDeg, lights} = table
  const cells = []
  lights.forEach((row, r) => {
    row.forEach((light, c) => {
      if (light > 0) {
        const lat = 90 - ((r + 0.5) * cellDeg)
        const lng = -HALF_TURN + ((c + 0.5) * cellDeg)
        cells.push({lat, lng, light, u: unit(lat, lng)})
      }
    })
  })
  return cells
}


/** @type {?object} The default table's cells and its brightest footprint */
let defaultCells = null


/**
 * @param {object} table
 * @returns {{cells: Array<object>, maxLight: number}}
 */
function prepared(table) {
  if (table === NIGHT_LIGHTS && defaultCells) {
    return defaultCells
  }
  const cells = litCells(table)
  // The brightest footprint anywhere, all of it dark.
  let maxLight = 0
  for (let lat = AIM_LAT_MIN; lat <= AIM_LAT_MAX; lat += AIM_STEP_DEG) {
    for (let lng = -HALF_TURN; lng < HALF_TURN; lng += AIM_STEP_DEG) {
      maxLight = Math.max(maxLight, footprint(cells, unit(lat, lng), () => 1))
    }
  }
  const out = {cells, maxLight}
  if (table === NIGHT_LIGHTS) {
    defaultCells = out
  }
  return out
}


/**
 * The light about an aim, each cell weighed by its darkness and by how near
 * the aim it is.
 *
 * @param {Array<object>} cells
 * @param {Array<number>} aim Unit vector
 * @param {function(object): number} dark A cell's darkness, 0 to 1
 * @returns {number}
 */
function footprint(cells, aim, dark) {
  const cosMax = Math.cos(FOOTPRINT_DEG * DEG)
  let sum = 0
  for (const cell of cells) {
    const cos = (cell.u[0] * aim[0]) + (cell.u[1] * aim[1]) + (cell.u[2] * aim[2])
    if (cos > cosMax) {
      const arc = Math.acos(Math.min(cos, 1)) / (FOOTPRINT_DEG * DEG)
      sum += cell.light * (1 - (arc * arc)) * dark(cell)
    }
  }
  return sum
}


/**
 * The Sun overhead: the subsolar point.
 *
 * @param {number} ms Unix epoch ms
 * @param {Function} [sunAt] The Sun from Earth at a Julian Day, ecliptic of
 *   date (tonight.js)
 * @returns {{lat: number, lng: number}} Degrees
 */
export function subsolarPoint(ms, sunAt = lowPrecisionSun) {
  const jd = julianDay(ms)
  const {ra, dec} = sunEquatorial(jd, sunAt)
  return {lat: dec / DEG, lng: wrap180((ra - gmstRad(jd)) / DEG)}
}


/**
 * @param {number} lng Degrees
 * @param {{lng: number}} subsolar
 * @returns {number} Local (apparent solar) hours from midnight, -12 to 12:
 *   negative before it
 */
export function hoursFromMidnight(lng, subsolar) {
  return wrap180(lng - subsolar.lng - HALF_TURN) / HOUR_DEG
}


/**
 * @param {number} lat
 * @param {number} lng
 * @param {{lat: number, lng: number}} subsolar
 * @returns {number} The Sun's altitude there, degrees (no refraction)
 */
export function sunAltitudeAt(lat, lng, subsolar) {
  const a = unit(lat, lng)
  const s = unit(subsolar.lat, subsolar.lng)
  const sin = (a[0] * s[0]) + (a[1] * s[1]) + (a[2] * s[2])
  return Math.asin(Math.min(Math.max(sin, -1), 1)) / DEG
}


/**
 * @param {number} altitude The Sun's, degrees
 * @returns {number} How dark it is for the lights, 0 (twilight or day) to 1
 */
export function darkness(altitude) {
  return smooth((DARK_FROM_DEG - altitude) / (DARK_FROM_DEG - DARK_FULL_DEG))
}


/**
 * @param {number} h Hours from midnight
 * @returns {number} The preference for an aim at that hour, 0 to 1
 */
function hourWeight(h) {
  const off = h < BEST_HOURS[0] ? BEST_HOURS[0] - h : Math.max(0, h - BEST_HOURS[1])
  return 1 - (HOUR_PENALTY * off)
}


/**
 * A place on Earth in the tour's frame at a time.
 *
 * @param {number} lat Degrees
 * @param {number} lng Degrees, east positive
 * @param {number} ms Unix epoch ms
 * @param {Function} [sunAt] As subsolarPoint's
 * @returns {{az: number, el: number}} Degrees: azimuth about the ecliptic's
 *   north from the sunward direction, elevation over the ecliptic
 */
export function tourAngles(lat, lng, ms, sunAt = lowPrecisionSun) {
  const jd = julianDay(ms)
  const eps = obliquity(jd)
  const theta = gmstRad(jd) + (lng * DEG)
  const phi = lat * DEG
  // Equatorial of date, then ecliptic of date (about the equinox).
  const qx = Math.cos(phi) * Math.cos(theta)
  const qy = Math.cos(phi) * Math.sin(theta)
  const qz = Math.sin(phi)
  const x = qx
  const y = (qy * Math.cos(eps)) + (qz * Math.sin(eps))
  const z = (qz * Math.cos(eps)) - (qy * Math.sin(eps))
  const s = sunAt(jd)
  const az = wrap180((Math.atan2(y, x) - Math.atan2(s.y, s.x)) / DEG)
  const el = Math.asin(Math.min(Math.max(z, -1), 1)) / DEG
  return {az, el}
}


/**
 * @param {number} az Degrees
 * @param {number} el Degrees
 * @returns {Array<number>} Unit vector: x sunward, y toward dusk, z north
 */
export function angleVector(az, el) {
  const c = Math.cos(el * DEG)
  return [c * Math.cos(az * DEG), c * Math.sin(az * DEG), Math.sin(el * DEG)]
}


/**
 * @param {Array<number>} a Unit vector
 * @param {Array<number>} b Unit vector
 * @returns {number} The arc between them, degrees
 */
export function arcDeg(a, b) {
  const cos = (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
  return Math.acos(Math.min(Math.max(cos, -1), 1)) / DEG
}


// The pass's geometry, degrees.  At the pass's end the camera's ground
// point is TERMINATOR_MIN_DEG to TERMINATOR_MAX_DEG of arc onto the night
// side from the terminator, AIM_OFF_DEG nearer it than the aim where it
// can be, so the aim is near the frame's middle and the terminator to one
// side of it, the sunlit crescent beyond.  Its elevation is the aim's,
// held to ±EL_MAX_DEG: over a summer's pole the azimuths crowd, and a
// camera whose up is the ecliptic's north would roll round it.
const AIM_OFF_DEG = 35
const TERMINATOR_MIN_DEG = 20
const TERMINATOR_MAX_DEG = 40
const EL_MAX_DEG = 50
// The aim's farthest from the camera's ground point, degrees: further,
// toward the limb, the lights foreshorten to a smear.
export const AIM_MAX_DEG = 45
// The pass starts this much further toward the Sun, in azimuth: over the
// crescent, the terminator ahead.
const ARRIVE_AZ_DEG = 30
// From far enough that the globe's limb is this far beyond both the aim
// and the terminator, the visible cap's radius held to LIMB_MIN_DEG to
// LIMB_MAX_DEG (2.9 to 4.8 Earth radii).
const LIMB_MARGIN_DEG = 25
const LIMB_MIN_DEG = 69.8
const LIMB_MAX_DEG = 78
// The arrival is this much further out than the pass's end.
const ARRIVE_DIST_SCALE = 1.17


/**
 * @param {Array<number>} v Unit vector, as angleVector's
 * @returns {number} Its arc from the terminator, degrees: positive on the
 *   night side
 */
export function nightDepthDeg(v) {
  return (Math.acos(Math.min(Math.max(v[0], -1), 1)) / DEG) - (HALF_TURN / 2)
}


/**
 * Where the camera passes over Earth for an aim: where the pass starts (the
 * tour's arrival, over the crescent) and ends (over the night side, the aim
 * near the frame's middle and the terminator to one side of it), in the
 * tour's frame.
 *
 * @param {{az: number, el: number}} target The aim's angles (tourAngles)
 * @param {string} side 'evening' (the dusk terminator in the frame) or
 *   'morning' (the dawn's)
 * @returns {{arrive: {az: number, el: number, dist: number}, pass: {az:
 *   number, el: number, dist: number}, terminatorDeg: number, aimDeg:
 *   number, limbDeg: number}} The two keyframes' angles and distances (m
 *   from Earth's centre); and at the pass's end, the arcs from the camera's
 *   ground point to the terminator, to the aim, and to the limb
 */
export function passGeometry(target, side) {
  const t = angleVector(target.az, target.el)
  const s = side === 'morning' ? -1 : 1
  const terminatorDeg = Math.min(Math.max(nightDepthDeg(t) - AIM_OFF_DEG, TERMINATOR_MIN_DEG), TERMINATOR_MAX_DEG)
  const el = Math.min(Math.max(target.el, -EL_MAX_DEG), EL_MAX_DEG)
  // cos(arc from the Sun) = cos el cos az, the arc 90° + terminatorDeg.
  const cosAz = -Math.sin(terminatorDeg * DEG) / Math.cos(el * DEG)
  const az = s * Math.acos(Math.min(Math.max(cosAz, -1), 1)) / DEG
  const aimDeg = arcDeg(angleVector(az, el), t)
  const limbDeg = Math.min(Math.max(Math.max(aimDeg, terminatorDeg) + LIMB_MARGIN_DEG, LIMB_MIN_DEG), LIMB_MAX_DEG)
  const dist = EARTH_RADIUS_METER / Math.cos(limbDeg * DEG)
  return {
    arrive: {az: az - (s * ARRIVE_AZ_DEG), el, dist: dist * ARRIVE_DIST_SCALE},
    pass: {az, el, dist},
    terminatorDeg,
    aimDeg,
    limbDeg,
  }
}


/**
 * The night side to fly over now, and the camera's pass over it
 * (chooseNightSide, passGeometry).
 *
 * @param {number} ms Unix epoch ms
 * @param {object} [opts] As chooseNightSide's
 * @returns {object} chooseNightSide's, and passGeometry's
 */
export function planEarthPass(ms, opts = {}) {
  const aim = chooseNightSide(ms, opts)
  return {...aim, ...passGeometry(aim.target, aim.side)}
}


/**
 * Choose the night side to fly over now.
 *
 * Every aim (2.5° apart, 45° S to 60° N) from 19:00 to 03:30 that is dark
 * (the Sun 12° down) and can be framed with the terminator nearer it (the
 * dusk's for an aim on the evening side of the ecliptic's midnight
 * meridian, the dawn's past it), the aim within AIM_MAX_DEG of the frame's
 * ground point (earthPass), scores the light about it (FOOTPRINT_DEG),
 * each cell's by its darkness.  Of the aims from 20:30 to 00:30 on the
 * evening side the brightest wins, a little less for each hour outside
 * 21:00 to 23:00, if it has MIN_SHARE of the brightest night side's light.
 * If none has (midnight over the Pacific), the aim nearest midnight that
 * has, on either side: the nearest lit coast.  If none has even then, the
 * brightest there is.
 *
 * @param {number} ms Unix epoch ms
 * @param {object} [opts]
 * @param {Function} [opts.sunAt] As subsolarPoint's
 * @param {object} [opts.table] City light per cell (scene/nightLights.json)
 * @returns {{lat: number, lng: number, hours: number, sunAltitude: number,
 *   share: number, side: string, fallback: boolean, subsolar: object,
 *   target: {az: number, el: number}}} The aim; its hours from midnight;
 *   the Sun's altitude there; its share of the brightest night side's
 *   light; the side the camera comes in on, 'evening' (over the dusk
 *   terminator) or 'morning' (dawn's); whether it is the fallback's; its
 *   angles in the tour's frame
 */
export function chooseNightSide(ms, {sunAt = lowPrecisionSun, table = NIGHT_LIGHTS} = {}) {
  const subsolar = subsolarPoint(ms, sunAt)
  const {cells, maxLight} = prepared(table)
  const darkOf = new Map(cells.map((c) => [c, darkness(sunAltitudeAt(c.lat, c.lng, subsolar))]))
  const dark = (c) => darkOf.get(c)
  const aims = []
  for (let lat = AIM_LAT_MIN; lat <= AIM_LAT_MAX; lat += AIM_STEP_DEG) {
    for (let lng = -HALF_TURN; lng < HALF_TURN; lng += AIM_STEP_DEG) {
      const hours = hoursFromMidnight(lng, subsolar)
      if (hours < FALLBACK_HOURS[0] || hours > FALLBACK_HOURS[1]) {
        continue
      }
      const sunAltitude = sunAltitudeAt(lat, lng, subsolar)
      if (darkness(sunAltitude) < 1) {
        continue
      }
      const target = tourAngles(lat, lng, ms, sunAt)
      const side = target.az >= 0 ? 'evening' : 'morning'
      if (passGeometry(target, side).aimDeg > AIM_MAX_DEG) {
        continue
      }
      const share = footprint(cells, unit(lat, lng), dark) / maxLight
      aims.push({lat, lng, hours, sunAltitude, share, side, target})
    }
  }
  const inPreferred = (a) => a.side === 'evening' && a.hours >= PREFERRED_HOURS[0] && a.hours <= PREFERRED_HOURS[1]
  let best = null
  for (const a of aims.filter(inPreferred)) {
    if (!best || (a.share * hourWeight(a.hours)) > (best.share * hourWeight(best.hours))) {
      best = a
    }
  }
  let fallback = false
  if (!best || best.share < MIN_SHARE) {
    fallback = true
    const lit = aims.filter((a) => a.share >= MIN_SHARE)
    best = null
    for (const a of lit.length ? lit : aims) {
      if (!best) {
        best = a
        continue
      }
      const dh = Math.abs(a.hours) - Math.abs(best.hours)
      const nearer = dh < -HOURS_EPSILON || (dh <= HOURS_EPSILON && a.share > best.share)
      if (lit.length ? nearer : a.share > best.share) {
        best = a
      }
    }
  }
  if (!best) {
    // Nowhere dark and framed in the hours (not seen between 45° S and 60° N).
    const lng = wrap180(subsolar.lng + HALF_TURN)
    const target = tourAngles(0, lng, ms, sunAt)
    best = {lat: 0, lng, hours: 0, sunAltitude: sunAltitudeAt(0, lng, subsolar), share: 0,
      side: target.az >= 0 ? 'evening' : 'morning', target}
    fallback = true
  }
  return {...best, fallback, subsolar}
}
