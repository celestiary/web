// Rubin's survey cadence, modelled (Rubin.md, "Cadence"): a night of
// visits at Cerro Pachón, from the published survey strategy's rules, not
// Rubin's log (its visit lists for 2026 are proprietary for two years).
// Pure and cheap: a night is built once, in tens of milliseconds, with no
// ephemeris calls (the Sun and the sidereal time by low-precision
// formulas; the object's place is handed in).

const toRad = Math.PI / 180
const toDeg = 180 / Math.PI
const MS_PER_DAY = 86400e3
const UNIX_EPOCH_JD = 2440587.5
const J2000_JD = 2451545

/** The camera's field: 9.6 deg², 3.5° across. */
export const FIELD_DIAMETER_DEG = 3.5
/** The tiling's spacing, a little under the field so the fields overlap. */
export const TILE_SPACING_DEG = 3
/** The lowest altitude a visit takes: airmass 2.0. */
export const CADENCE_MIN_ALT_DEG = 30
/** The survey's footprint in declination (Wide-Fast-Deep, roughly). */
export const FOOTPRINT_DEC_DEG = Object.freeze({min: -72, max: 12})
/** A visit: one 30 s exposure (or 2 × 15 s), and its overheads (readout, shutter). */
export const VISIT_EXP_S = 30
export const VISIT_OVERHEAD_S = 4
/** A pair's second visit comes back this long after the first. */
export const PAIR_GAP_MIN = 33
/** The last pairs of a night may come back sooner, but no sooner than twice this. */
const MIN_HALF_MS = 6 * 60e3
/** The mount doesn't track through the zenith (rubin.js MAX_EL_DEG). */
export const MAX_ALT_DEG = 86.5
/** A filter change, seconds. */
export const FILTER_CHANGE_S = 120
/** The night: the Sun this far down (the dome opens: rubin.js). */
export const NIGHT_SUN_EL_DEG = -12

/**
 * The slew's kinematics: the scheduler's own, rubin_scheduler's
 * KinemModel defaults (model_observatory/kinem_model.py at
 * lsst/rubin_scheduler f5a9d641, read 2026-11-20; Rubin.md): the
 * telescope's (TMA) azimuth and altitude top speed (°/s), acceleration
 * (°/s²) and jerk (°/s³), and its settle after a slew; the dome's, with no
 * jerk limit, and its azimuth's settle.
 */
export const KINEMATICS = Object.freeze({
  telAz: Object.freeze({speed: 7, accel: 7, jerk: 28}),
  telAlt: Object.freeze({speed: 3.5, accel: 3.5, jerk: 14}),
  domeAz: Object.freeze({speed: 1.5, accel: 0.75, jerk: null}),
  domeAlt: Object.freeze({speed: 1.75, accel: 0.875, jerk: null}),
  settleS: 3,
  domeAzSettleS: 1,
})

const FILTERS = ['g', 'r', 'i', 'z', 'y']


/**
 * @param {number} ms Unix ms
 * @returns {number} Julian Day (UTC)
 */
export function jdOf(ms) {
  return (ms / MS_PER_DAY) + UNIX_EPOCH_JD
}


/**
 * The Greenwich mean sidereal time (IAU 1982, as Meeus 12.4), degrees.
 *
 * @param {number} ms
 * @returns {number}
 */
export function gmstDeg(ms) {
  const d = jdOf(ms) - J2000_JD
  const t = d / 36525
  const g = 280.46061837 + (360.98564736629 * d) + (0.000387933 * t * t)
  return ((g % 360) + 360) % 360
}


/**
 * J2000 to the mean equator of date, first order (Meeus 21.1): enough for
 * a 3.5° field (arcseconds over decades, away from the poles).
 *
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {number} ms
 * @returns {{raDeg: number, decDeg: number}}
 */
export function precessToDate(raDeg, decDeg, ms) {
  const years = (jdOf(ms) - J2000_JD) / 365.25
  const m = 3.07496 * 15 / 3600
  const n = 1.33621 * 15 / 3600
  const nd = 20.0431 / 3600
  const a = raDeg * toRad
  const dec = Math.max(-89.9, Math.min(89.9, decDeg))
  return {
    raDeg: raDeg + ((m + (n * Math.sin(a) * Math.tan(dec * toRad))) * years),
    decDeg: decDeg + (nd * Math.cos(a) * years),
  }
}


/**
 * An RA and Dec of date's altitude and azimuth at a site.
 *
 * @param {number} raDeg Of date
 * @param {number} decDeg
 * @param {number} ms
 * @param {{lat: number, lng: number}} site
 * @returns {{el: number, az: number}} Degrees, azimuth from north through east
 */
function ofDateToAltAz(raDeg, decDeg, ms, site) {
  const ha = (gmstDeg(ms) + site.lng - raDeg) * toRad
  const dec = decDeg * toRad
  const lat = site.lat * toRad
  const sinEl = (Math.sin(dec) * Math.sin(lat)) + (Math.cos(dec) * Math.cos(lat) * Math.cos(ha))
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)))
  const y = -Math.cos(dec) * Math.sin(ha)
  const x = (Math.sin(dec) * Math.cos(lat)) - (Math.cos(dec) * Math.sin(lat) * Math.cos(ha))
  return {el: el * toDeg, az: ((Math.atan2(y, x) * toDeg) + 360) % 360}
}


/**
 * A J2000 RA and Dec's altitude and azimuth at a site.
 *
 * @param {number} raDeg J2000
 * @param {number} decDeg
 * @param {number} ms
 * @param {{lat: number, lng: number}} site
 * @returns {{el: number, az: number}} Degrees, azimuth from north through east
 */
export function raDecToAltAz(raDeg, decDeg, ms, site) {
  const p = precessToDate(raDeg, decDeg, ms)
  return ofDateToAltAz(p.raDeg, p.decDeg, ms, site)
}


/**
 * The Sun's RA and Dec of date (the Astronomical Almanac's low-precision
 * formula, 0.01°), enough for twilight.
 *
 * @param {number} ms
 * @returns {{raDeg: number, decDeg: number}}
 */
export function sunRaDec(ms) {
  const n = jdOf(ms) - J2000_JD
  const l = (280.46 + (0.9856474 * n)) * toRad
  const g = (357.528 + (0.9856003 * n)) * toRad
  const lambda = l + (((1.915 * Math.sin(g)) + (0.02 * Math.sin(2 * g))) * toRad)
  const eps = (23.439 - (4e-7 * n)) * toRad
  return {
    raDeg: ((Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * toDeg) + 360) % 360,
    decDeg: Math.asin(Math.sin(eps) * Math.sin(lambda)) * toDeg,
  }
}


/**
 * @param {number} ms
 * @param {{lat: number, lng: number}} site
 * @returns {number} The Sun's altitude at the site, degrees
 */
export function sunAltitude(ms, site) {
  const s = sunRaDec(ms)
  return ofDateToAltAz(s.raDeg, s.decDeg, ms, site).el
}


/**
 * The night of a date at the site: from the evening's twilight to the
 * morning's, the Sun under NIGHT_SUN_EL_DEG.
 *
 * @param {number} nightMs The date's 0h UTC (the app's night)
 * @param {{lat: number, lng: number}} site
 * @returns {{startMs: number, endMs: number}}
 */
export function nightBounds(nightMs, site) {
  // Local midnight at the site, and outward to each twilight.
  const midnight = nightMs - (site.lng / 360 * MS_PER_DAY)
  const dark = (ms) => sunAltitude(ms, site) < NIGHT_SUN_EL_DEG
  const edge = (dir) => {
    let inside = midnight
    let outside = midnight
    const step = dir * 600e3
    while (dark(outside) && Math.abs(outside - midnight) < MS_PER_DAY / 2) {
      inside = outside
      outside += step
    }
    for (let i = 0; i < 20; i++) {
      const mid = (inside + outside) / 2
      if (dark(mid)) {
        inside = mid
      } else {
        outside = mid
      }
    }
    return inside
  }
  return {startMs: Math.ceil(edge(-1) / 1e3) * 1e3, endMs: Math.floor(edge(1) / 1e3) * 1e3}
}


/**
 * The night a clock time belongs to: the date whose 0h UTC is in it (the
 * day turns at 16h UTC, about noon at the site).
 *
 * @param {number} ms
 * @returns {number} ms at 0h UTC
 */
export function nightOf(ms) {
  return Math.floor((ms + (8 * 3600e3)) / MS_PER_DAY) * MS_PER_DAY
}


/**
 * The sky in fields: rings of declination TILE_SPACING_DEG apart over the
 * footprint, each with fields as far apart in RA.
 *
 * @param {number} [spacing]
 * @param {{min: number, max: number}} [footprint]
 * @returns {Array<{raDeg: number, decDeg: number}>}
 */
export function tileSky(spacing = TILE_SPACING_DEG, footprint = FOOTPRINT_DEC_DEG) {
  const tiles = []
  for (let dec = footprint.min; dec <= footprint.max + 1e-9; dec += spacing) {
    const n = Math.max(1, Math.round(360 * Math.cos(dec * toRad) / spacing))
    // Alternate rings start half a step on, as a hexagonal tiling's do.
    const offset = (Math.round((dec - footprint.min) / spacing) % 2) * 0.5
    for (let i = 0; i < n; i++) {
      tiles.push({raDeg: ((i + offset) * 360) / n, decDeg: dec})
    }
  }
  return tiles
}


/**
 * One axis's slew time, a trapezoid (or triangle) of speed.
 *
 * @param {number} dist Degrees
 * @param {{speed: number, accel: number}} axis
 * @returns {number} Seconds
 */
export function axisSlewSeconds(dist, {speed, accel, jerk = null}) {
  const d = Math.abs(dist)
  if (!(d > 0)) {
    return 0
  }
  if (!jerk) {
    const rampDist = (speed * speed) / accel
    if (d <= rampDist) {
      return 2 * Math.sqrt(d / accel)
    }
    return (2 * speed / accel) + ((d - rampDist) / speed)
  }
  // Constant jerk, a symmetric S-curve: each ramp to speed is tj of
  // jerk, ta of constant acceleration and tj of jerk again.
  let tj = accel / jerk
  let ta = (speed / accel) - tj
  if (ta < 0) {
    // Top speed before full acceleration.
    tj = Math.sqrt(speed / jerk)
    ta = 0
  }
  const rampToSpeed = speed * ((2 * tj) + ta)
  if (d >= rampToSpeed) {
    return (2 * ((2 * tj) + ta)) + ((d - rampToSpeed) / speed)
  }
  // Short of top speed: full acceleration reached, or not.
  const aTj = accel / jerk
  if (aTj * aTj * jerk <= speed && d >= 2 * accel * aTj * aTj) {
    const a = (-3 * aTj) + Math.sqrt((aTj * aTj) + (4 * d / accel))
    return 2 * ((2 * aTj) + (a / 2))
  }
  return 4 * Math.cbrt(d / (2 * jerk))
}


/**
 * @param {number} a Degrees
 * @param {number} b
 * @returns {number} The shorter azimuth difference, degrees
 */
export function azDiff(a, b) {
  return Math.abs(((((b - a) % 360) + 540) % 360) - 180)
}


/**
 * The slew between two pointings: the slowest axis, telescope or dome,
 * as rubin_scheduler's KinemModel has it (lax_dome off): the telescope's
 * slower axis and its settle, or the dome's slower axis, the azimuth with
 * its own settle, whichever is longer (between neighbouring fields, the
 * dome's azimuth).
 *
 * @param {{el: number, az: number}} from
 * @param {{el: number, az: number}} to
 * @param {object} [k] KINEMATICS' shape
 * @returns {number} Seconds
 */
export function slewSeconds(from, to, k = KINEMATICS) {
  const dAz = azDiff(from.az, to.az)
  const dAlt = Math.abs(to.el - from.el)
  if (dAz < 1e-6 && dAlt < 1e-6) {
    return 0
  }
  const tel = Math.max(axisSlewSeconds(dAz, k.telAz), axisSlewSeconds(dAlt, k.telAlt)) + k.settleS
  const domeAz = dAz > 0 ? axisSlewSeconds(dAz, k.domeAz) + k.domeAzSettleS : 0
  return Math.max(tel, domeAz, axisSlewSeconds(dAlt, k.domeAlt))
}


/**
 * A seeded generator (mulberry32), for the night's choices.
 *
 * @param {number} seed
 * @returns {() => number} In [0, 1)
 */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


/**
 * @param {number} ra1 Degrees
 * @param {number} dec1
 * @param {number} ra2
 * @param {number} dec2
 * @returns {number} The angle between them, degrees
 */
export function separationDeg(ra1, dec1, ra2, dec2) {
  const c = (Math.sin(dec1 * toRad) * Math.sin(dec2 * toRad)) +
    (Math.cos(dec1 * toRad) * Math.cos(dec2 * toRad) * Math.cos((ra1 - ra2) * toRad))
  return Math.acos(Math.max(-1, Math.min(1, c))) * toDeg
}


/**
 * A night's visits (Rubin.md, "Cadence"): blocks of fields taken by
 * nearest neighbour from where the telescope is, among the footprint's
 * fields above CADENCE_MIN_ALT_DEG, each block visited again PAIR_GAP_MIN
 * later in the same order (two blocks interleaved: A, B, A, B), each
 * field once a night in a pair.  The filter changes a few times a night.
 * The target's field, centred on the object, is visited as a pair, the
 * first visit opening the block nearest its highest point in the night.
 *
 * @param {object} opts
 * @param {number} opts.nightMs The date's 0h UTC
 * @param {{lat: number, lng: number}} opts.site
 * @param {?{raDeg: number, decDeg: number}} [opts.target] The object's J2000 place that night
 * @param {Array<object>} [opts.tiles] tileSky's
 * @param {number} [opts.minAlt] Degrees
 * @returns {{startMs: number, endMs: number, visits: Array<object>, targetField: ?object}}
 *   visits, in time order: {tMs, endMs, slewS, raDeg, decDeg, el, az, expS,
 *   filter, isTarget, field, pair}; tMs the shutter opening, slewS the
 *   slew before it
 */
export function buildNight({nightMs, site, target = null, tiles = tileSky(), minAlt = CADENCE_MIN_ALT_DEG}) {
  const {startMs, endMs} = nightBounds(nightMs, site)
  const rand = seeded(Math.round(nightMs / MS_PER_DAY))
  const visitMs = (VISIT_EXP_S + VISIT_OVERHEAD_S) * 1e3
  const halfMs = PAIR_GAP_MIN * 60e3 / 2
  const fields = tiles.map((tile, i) => ({...tile, id: i, done: false}))
  let targetField = null
  let targetTime = null
  if (target) {
    targetField = {raDeg: target.raDeg, decDeg: target.decDeg, id: -1, done: false, isTarget: true}
    // The block nearest the object's highest point, above the limit.
    let best = -Infinity
    for (let s = startMs; s < endMs - (4 * halfMs); s += 300e3) {
      const el = raDecToAltAz(target.raDeg, target.decDeg, s, site).el
      if (el > best && el >= minAlt + 5) {
        best = el
        targetTime = s
      }
    }
    // Fields that hold the object are taken by its own.
    for (const f of fields) {
      if (separationDeg(f.raDeg, f.decDeg, target.raDeg, target.decDeg) < FIELD_DIAMETER_DEG / 2) {
        f.done = true
      }
    }
  }
  const visits = []
  let t = startMs
  let at = null // The telescope's pointing, at the last visit's end
  let filter = FILTERS[Math.floor(rand() * FILTERS.length)]
  let blocksInFilter = 0
  const take = (field, pair) => {
    // The slew to where the field will be when it ends, found in a few
    // steps (the sky turns while the mount moves).
    let slewS = 0
    let p = raDecToAltAz(field.raDeg, field.decDeg, t, site)
    for (let i = 0; at && i < 4; i++) {
      slewS = slewSeconds(at, p)
      p = raDecToAltAz(field.raDeg, field.decDeg, t + (slewS * 1e3), site)
    }
    if (at) {
      slewS = slewSeconds(at, p)
    }
    const tMs = t + (slewS * 1e3)
    const end = raDecToAltAz(field.raDeg, field.decDeg, tMs + visitMs, site)
    if (p.el < minAlt || end.el < minAlt || p.el > MAX_ALT_DEG || end.el > MAX_ALT_DEG || tMs + visitMs > endMs) {
      return false
    }
    visits.push({tMs, endMs: tMs + visitMs, slewS, raDeg: field.raDeg, decDeg: field.decDeg, el: p.el, az: p.az,
      expS: VISIT_EXP_S, filter, isTarget: field.isTarget === true, field: field.id, pair})
    at = end
    t = tMs + visitMs
    return true
  }
  const nearest = () => {
    let best = null
    let bestD = Infinity
    for (const f of fields) {
      if (f.done) {
        continue
      }
      const p = raDecToAltAz(f.raDeg, f.decDeg, t, site)
      // Clear of the limit: a field must stay up past its pair.
      if (p.el < minAlt + 8 || p.el > MAX_ALT_DEG - 2) {
        continue
      }
      const d = at ? azDiff(at.az, p.az) + Math.abs(at.el - p.el) : 90 - p.el
      if (d < bestD) {
        bestD = d
        best = f
      }
    }
    return best
  }
  const block = (untilMs, opener) => {
    const taken = []
    if (opener) {
      opener.done = true
      if (take(opener, 1)) {
        taken.push(opener)
      }
    }
    while (t < untilMs) {
      const f = nearest()
      if (!f) {
        break
      }
      f.done = true
      if (take(f, 1)) {
        taken.push(f)
      }
    }
    return taken
  }
  const revisit = (taken) => {
    for (const f of taken) {
      take(f, 2)
    }
  }
  while (t < endMs - (4 * visitMs)) {
    const half = Math.min(halfMs, (endMs - t) / 4)
    if (half < MIN_HALF_MS) {
      break
    }
    if (blocksInFilter >= 3 && rand() < 0.5) {
      // A filter change: another of the wheel's, and two minutes.
      const i = FILTERS.indexOf(filter)
      filter = FILTERS[(i + 1 + Math.floor(rand() * (FILTERS.length - 1))) % FILTERS.length]
      t += FILTER_CHANGE_S * 1e3
      blocksInFilter = 0
    }
    // The object's field opens the cycle that holds its time.
    const opener = targetField && !targetField.done && targetTime !== null && t + (4.5 * halfMs) >= targetTime ?
      targetField : null
    const a0 = t
    const a = block(a0 + half, opener)
    const b = block(a0 + (2 * half), null)
    // The pairs come back about PAIR_GAP_MIN after the first visits began.
    t = Math.max(t, a0 + (2 * half))
    revisit(a)
    revisit(b)
    blocksInFilter++
    if (a.length === 0 && b.length === 0) {
      t += 60e3
    }
  }
  return {startMs, endMs, visits, targetField}
}


/**
 * Where a night's visits are at a time.
 *
 * @param {Array<object>} visits buildNight's, in time order
 * @param {number} ms
 * @returns {{index: number, slewing: boolean}} The visit under way or the
 *   next; -1 before the first, visits.length after the last
 */
export function visitAt(visits, ms) {
  let lo = 0
  let hi = visits.length
  // The first visit that hasn't ended.
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (visits[mid].endMs <= ms) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  if (lo === visits.length) {
    return {index: lo, slewing: false}
  }
  const v = visits[lo]
  if (ms >= v.tMs) {
    return {index: lo, slewing: false}
  }
  if (lo === 0) {
    return {index: -1, slewing: false}
  }
  return {index: lo, slewing: ms >= v.tMs - (v.slewS * 1e3)}
}


/**
 * The mount's pointing at a time: on the visit's field while it's under
 * way, eased from the last field's end to the next's start while slewing,
 * held at the last field between.
 *
 * @param {Array<object>} visits
 * @param {number} ms
 * @param {{lat: number, lng: number}} site
 * @returns {?{el: number, az: number, index: number, slewing: boolean}} null outside the visits
 */
export function pointingAt(visits, ms, site) {
  const {index, slewing} = visitAt(visits, ms)
  if (index < 0 || index >= visits.length) {
    return null
  }
  const v = visits[index]
  if (ms >= v.tMs) {
    return {...raDecToAltAz(v.raDeg, v.decDeg, ms, site), index, slewing: false}
  }
  const prev = visits[index - 1]
  const from = raDecToAltAz(prev.raDeg, prev.decDeg, prev.endMs, site)
  if (!slewing) {
    return {...from, index, slewing: false}
  }
  const to = raDecToAltAz(v.raDeg, v.decDeg, v.tMs, site)
  const moveS = Math.max(1e-3, v.slewS - KINEMATICS.domeAzSettleS)
  const s = Math.min(1, (ms - (v.tMs - (v.slewS * 1e3))) / (moveS * 1e3))
  const e = s * s * (3 - (2 * s))
  const dAz = ((((to.az - from.az) % 360) + 540) % 360) - 180
  return {el: from.el + ((to.el - from.el) * e), az: (from.az + (dAz * e) + 360) % 360, index, slewing: true}
}


/**
 * @param {Array<object>} visits
 * @param {number} ms
 * @returns {?object} The next visit of the target's field to start after ms, or null
 */
export function nextTargetVisit(visits, ms) {
  return visits.find((v) => v.isTarget && v.tMs > ms) ?? null
}
