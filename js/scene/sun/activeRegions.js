import {CARRINGTON_DEG_PER_DAY, MS_PER_DAY, cyclesAt, rotationRate, sunspotNumber} from './solarCycle.js'
import {binGenerator, gaussian, logNormal, poisson} from './sunRandom.js'


/**
 * The Sun's active regions (sunspot groups) at a date (js/scene/Sun.md,
 * "Spots"): each emerges on a day drawn from a Poisson process whose rate
 * follows the sunspot number, in its cycle's zone (Spörer's law), grows,
 * decays by the Gnevyshev-Waldmeier rule, and is carried by the surface's
 * differential rotation.  Deterministic: a day's regions come from that
 * day's seeded generator (sunRandom.js), so evaluating any date needs no
 * history.
 */


// Each group's largest area, in millionths of the solar hemisphere (MSH):
// log-normal, the form Baumann & Solanki (2005, A&A 443, 1061) found for
// the Greenwich record's group areas.  The median and spread are set so
// that, at a steady sunspot number R, the visible hemisphere holds the
// observed spot area and number of groups (below; tested).
export const GROUP_AREA_MEDIAN_MSH = 50
export const GROUP_AREA_SIGMA = 1.4
// Gnevyshev-Waldmeier: a spot's largest area over its lifetime is about
// 10 MSH a day (Petrovay & van Driel-Gesztelyi 1997, Sol. Phys. 176, 249),
// its decay parabolic, A(t) = A0 (1 − t/T)², as they found it.
export const GW_MSH_PER_DAY = 10
// Growth is fast: a few days for a large region; a tenth of its decay
// here, at least half a day (a model).
export const GROWTH_FRACTION = 0.1
export const GROWTH_MIN_DAYS = 0.5
export const LIFE_MIN_DAYS = 0.5
// The longest-lived groups last four or five rotations; the window looked
// back over for regions still alive.
export const LIFE_MAX_DAYS = 120
// A sunspot number of R means R/12.08 groups on the visible disc in the
// group number's normalisation (Hoyt & Schatten 1998), on the old scale,
// R_v2 = R_v1/0.6 (Clette et al. 2014): R_v2/20.1 groups.
export const SN_PER_VISIBLE_GROUP = 12.08 / 0.6
// The visible hemisphere's spot area is 16.7 MSH per unit of the old
// sunspot number (Hathaway 2015, from the RGO areas 1874-1976): 10.0 MSH
// per unit of the version-2 number.  The test's target, not an input.
export const MSH_PER_SN = 16.7 * 0.6
// Joy's law: the leading spot nearer the equator, tilted 32.1° sin(lat)
// from the east-west line (Stenflo & Kosovichev 2012, ApJ 745, 129).
export const JOY_DEG = 32.1
// The leading spot carries more of a group's area than the following
// (a model: leaders are the larger, more compact spots).
export const LEADING_SHARE = 0.6
// The spots' separation grows with the group: 3° plus 4° per
// sqrt(area/500 MSH), at most 15° (a model; large bipolar groups span
// 10-15°).
export const SEPARATION_DEG = [3, 4, 15]
// Spots don't emerge nearer the equator than this.
export const MIN_LATITUDE_DEG = 2
const DEG = Math.PI / 180
const STREAM_REGIONS = 1


/**
 * A group's area at an age, by its growth and parabolic decay.
 *
 * @param {number} peak MSH
 * @param {number} growth days
 * @param {number} life days of decay
 * @param {number} age days
 * @returns {number} MSH
 */
export function groupArea(peak, growth, life, age) {
  if (age < 0 || age > growth + life) {
    return 0
  }
  if (age < growth) {
    return peak * age / growth
  }
  const f = 1 - ((age - growth) / life)
  return peak * f * f
}


/**
 * @param {number} peak MSH
 * @returns {{growth: number, life: number}} days
 */
export function groupTimes(peak) {
  const life = Math.min(Math.max(peak / GW_MSH_PER_DAY, LIFE_MIN_DAYS), LIFE_MAX_DAYS)
  return {growth: Math.max(GROWTH_FRACTION * life, GROWTH_MIN_DAYS), life}
}


// The log-normal's mean life and mean area-days, by quadrature over its
// log (±6σ), for the emergence rate.
const GROUP_MEANS = (() => {
  const steps = 600
  let w = 0
  let life = 0
  let areaDays = 0
  for (let i = 0; i <= steps; i++) {
    const z = -6 + (12 * i / steps)
    const p = Math.exp(-z * z / 2)
    const peak = GROUP_AREA_MEDIAN_MSH * Math.exp(GROUP_AREA_SIGMA * z)
    const t = groupTimes(peak)
    w += p
    life += p * (t.growth + t.life)
    areaDays += p * peak * ((t.growth / 2) + (t.life / 3))
  }
  return {life: life / w, areaDays: areaDays / w}
})()
export const MEAN_GROUP_LIFE_DAYS = GROUP_MEANS.life
export const MEAN_GROUP_AREA_DAYS = GROUP_MEANS.areaDays


/**
 * New groups a day over the whole Sun for a sunspot number: twice the
 * visible hemisphere's groups over their mean life.
 *
 * @param {number} sn
 * @returns {number}
 */
export function emergenceRate(sn) {
  return 2 * Math.max(sn, 0) / SN_PER_VISIBLE_GROUP / MEAN_GROUP_LIFE_DAYS
}


/**
 * A direction on the unit sphere in the Sun's body frame (coords.js: +Y
 * the north pole, +X the prime meridian, east longitude toward −Z).
 *
 * @param {number} latDeg
 * @param {number} lonDeg east
 * @returns {Array<number>}
 */
export function bodyUnit(latDeg, lonDeg) {
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)]
}


/**
 * A spot's radius on the unit sphere (radians) from its area: a cap of
 * A·10⁻⁶ of a hemisphere, 2π·A·10⁻⁶ steradians.
 *
 * @param {number} msh
 * @returns {number}
 */
export function spotRadius(msh) {
  return Math.sqrt(2 * Math.max(msh, 0) * 1e-6)
}


/**
 * The groups emerging on one day.
 *
 * @param {number} day Days since 1970 (UTC)
 * @param {number} seed
 * @returns {Array<object>} each with its birth, place and size, before
 *     its age is known
 */
export function regionsBornOn(day, seed) {
  const rng = binGenerator(day, seed, STREAM_REGIONS)
  const mid = (day + 0.5) * MS_PER_DAY
  const n = poisson(emergenceRate(sunspotNumber(mid)), rng)
  if (n === 0) {
    return []
  }
  const cycles = cyclesAt(mid)
  const out = []
  for (let k = 0; k < n; k++) {
    const birth = (day + rng()) * MS_PER_DAY
    // Its cycle, by the cycles' shares of the number then.
    let u = rng()
    let zone = cycles[cycles.length - 1]
    for (const c of cycles) {
      if (u < c.share) {
        zone = c
        break
      }
      u -= c.share
    }
    const hemisphere = rng() < 0.5 ? -1 : 1
    const lat = hemisphere * Math.max(MIN_LATITUDE_DEG, Math.abs(zone.latitude + (zone.width * gaussian(rng))))
    const lon = 360 * rng()
    const peak = logNormal(GROUP_AREA_MEDIAN_MSH, GROUP_AREA_SIGMA, rng)
    out.push({id: (day * 64) + k, birth, lat, lon, peak, cycle: zone.cycle, ...groupTimes(peak), shape: rng()})
  }
  return out
}


// A day's groups, kept for the window's days a frame re-reads.
const BORN_CACHE_SIZE = 512
const bornCache = new Map


/**
 * @param {number} day
 * @param {number} seed
 * @returns {Array<object>} regionsBornOn's, cached
 */
function bornOnCached(day, seed) {
  const key = `${seed}:${day}`
  let born = bornCache.get(key)
  if (!born) {
    born = regionsBornOn(day, seed)
    bornCache.set(key, born)
    if (bornCache.size > BORN_CACHE_SIZE) {
      bornCache.delete(bornCache.keys().next().value)
    }
  }
  return born
}


/**
 * The active regions alive at a time, with their areas and places then.
 *
 * @param {number} ms UTC
 * @param {number} [seed]
 * @returns {Array<object>} {id, lat, lon (east, in the Carrington frame),
 *     area (MSH), age (days), leading and following spots (body-frame
 *     unit vectors and radii, radians), ...}
 */
export function activeRegionsAt(ms, seed = 0) {
  const today = Math.floor(ms / MS_PER_DAY)
  const out = []
  for (let day = today - Math.ceil(LIFE_MAX_DAYS * (1 + GROWTH_FRACTION)) - 1; day <= today; day++) {
    for (const r of bornOnCached(day, seed)) {
      const age = (ms - r.birth) / MS_PER_DAY
      const area = groupArea(r.peak, r.growth, r.life, age)
      if (area > 0) {
        out.push(placeRegion(r, age, area))
      }
    }
  }
  return out
}


/**
 * A region's place at an age: carried from its birth longitude by the
 * rotation at its latitude, less the Carrington frame's; its two spots
 * astride its centre along the Joy's-law tilt.
 *
 * @param {object} r from regionsBornOn
 * @param {number} age days
 * @param {number} area MSH
 * @returns {object}
 */
export function placeRegion(r, age, area) {
  const lon = r.lon + ((rotationRate(r.lat) - CARRINGTON_DEG_PER_DAY) * age)
  const sep = Math.min(SEPARATION_DEG[0] + (SEPARATION_DEG[1] * Math.sqrt(area / 500)), SEPARATION_DEG[2])
  const tilt = JOY_DEG * Math.sin(Math.abs(r.lat) * DEG)
  // The leading spot ahead in the rotation (east longitude grows with it
  // in the body frame) and toward the equator.
  const dLon = (sep / 2) * Math.cos(tilt * DEG) / Math.max(Math.cos(r.lat * DEG), 0.2)
  const dLat = (sep / 2) * Math.sin(tilt * DEG) * Math.sign(r.lat)
  return {
    ...r,
    age,
    area,
    lon: ((lon % 360) + 360) % 360,
    leading: {unit: bodyUnit(r.lat - dLat, lon + dLon), radius: spotRadius(area * LEADING_SHARE)},
    following: {unit: bodyUnit(r.lat + dLat, lon - dLon), radius: spotRadius(area * (1 - LEADING_SHARE))},
    centre: bodyUnit(r.lat, lon),
    separation: sep * DEG,
  }
}
