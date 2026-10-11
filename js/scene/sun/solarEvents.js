import {WHITE_LIGHT_SHARE, flareContrast} from './emission.js'
import {
  CARRINGTON_DEG_PER_DAY,
  MS_PER_DAY,
  activityLevel,
  cyclesAt,
  monthIndex,
  msAtMonths,
  rotationRate,
  smoothedSunspotNumber,
  sunspotNumber,
} from './solarCycle.js'
import {bodyUnit} from './activeRegions.js'
import {binGenerator, gaussian, logNormal, poisson} from './sunRandom.js'


/**
 * The Sun's eruptive events at a date (js/scene/Sun.md): flares, coronal
 * mass ejections and prominences, each a Poisson process in seeded time
 * bins whose rate follows the sunspot number, so a date's events are the
 * same in every session.  They are the model's events, not the historical
 * ones: the rates, sizes and durations are the observed statistics'.
 */


const MS_PER_HOUR = 3600e3
const MS_PER_MINUTE = 60e3
const STREAM_FLARES = 2
const STREAM_CMES = 3
const STREAM_PROMINENCES = 4
const DEG = Math.PI / 180


// --- Flares.

// Cycle 23 (May 1996 to December 2008) had 1,442 M-class and 126 X-class
// flares on the GOES scale before the 0.7 factor was taken out in 2020
// (the counts tabulated in Space Weather Space Clim. 2025, "swsc240043",
// Table 1).  Their ratio, 11, is a peak-flux distribution N(>F) ∝ F^−1,
// a differential index of 2.0 (as the catalogues' fits give, 1.9-2.1).
export const CYCLE23_M_FLARES = 1442
export const CYCLE23_X_FLARES = 126
export const FLARE_INDEX = 2
// The weakest flare drawn: C1, 1e-6 W m⁻² (no white light below it).
export const FLARE_MIN_FLUX = 1e-6
export const FLARE_M_FLUX = 1e-5
export const FLARE_X_FLUX = 1e-4
export const FLARE_MAX_FLUX = 4e-3
// GOES rise and decay times: minutes and tens of minutes, longer for the
// larger flares (Veronig et al. 2002, A&A 382, 1070): here 6 and 15
// minutes at M1, as (F/F_M1)^0.15 (a model of that weak trend).  The white
// light comes in the impulsive phase, the rise.
export const FLARE_RISE_MINUTES = 6
export const FLARE_DECAY_MINUTES = 15
export const FLARE_DURATION_EXPONENT = 0.15
// A kernel's radius, 1.5 Mm (white-light kernels are 1-3 Mm across; their
// areas 10¹⁶-10¹⁸ cm²), and the two ribbons' separation, 10-30 Mm.
export const KERNEL_RADIUS_MM = 1.5
export const RIBBON_SEPARATION_MM = [10, 30]
const SUN_RADIUS_MM = 695.7


/**
 * Flares of M1 and over a day per unit of sunspot number: cycle 23's M and
 * X flares over its sunspot number's integral over the cycle, month by
 * month.
 */
export const M_FLARES_PER_SN_DAY = (() => {
  let integral = 0
  for (let m = monthIndex('1996-05'); m < monthIndex('2008-12'); m++) {
    integral += sunspotNumber(msAtMonths(m + 0.5)) * (msAtMonths(1) / MS_PER_DAY)
  }
  return (CYCLE23_M_FLARES + CYCLE23_X_FLARES) / integral
})()


/**
 * Flares at or over a GOES flux, a day, at a sunspot number.
 *
 * @param {number} sn
 * @param {number} [flux]
 * @returns {number}
 */
export function flareRate(sn, flux = FLARE_MIN_FLUX) {
  return M_FLARES_PER_SN_DAY * Math.max(sn, 0) * ((FLARE_M_FLUX / flux) ** (FLARE_INDEX - 1))
}


/**
 * @param {number} flux
 * @returns {string} The GOES class, e.g. 'M2.3'
 */
export function goesClass(flux) {
  const classes = [['X', FLARE_X_FLUX], ['M', FLARE_M_FLUX], ['C', FLARE_MIN_FLUX], ['B', 1e-7]]
  for (const [letter, base] of classes) {
    if (flux >= base) {
      return `${letter}${(flux / base).toFixed(1)}`
    }
  }
  return `A${(flux / 1e-8).toFixed(1)}`
}


// Flares are looked for in the hours before a time: the longest decay.
const FLARE_WINDOW_HOURS = 4


/**
 * The flares under way at a time, each in an active region picked by its
 * area (flares come from the active regions, the large ones most).
 *
 * @param {number} ms UTC
 * @param {Array<object>} regions activeRegionsAt's, at the same time
 * @param {number} [seed]
 * @returns {Array<object>} {start, flux, class, rise, decay (ms), whiteLight,
 *     contrast (its kernels' peak), kernels: [unit, unit], radius (rad),
 *     region, phase: the white light's share of its peak now}
 */
export function flaresAt(ms, regions, seed = 0) {
  const out = []
  const totalArea = regions.reduce((s, r) => s + r.area, 0)
  if (!(totalArea > 0)) {
    return out
  }
  const hour = Math.floor(ms / MS_PER_HOUR)
  for (let h = hour - FLARE_WINDOW_HOURS; h <= hour; h++) {
    const rng = binGenerator(h, seed, STREAM_FLARES)
    const sn = sunspotNumber((h + 0.5) * MS_PER_HOUR)
    const n = poisson(flareRate(sn) / 24, rng)
    for (let k = 0; k < n; k++) {
      const start = (h + rng()) * MS_PER_HOUR
      // N(>F) ∝ F^−(α−1): F = F_min u^(−1/(α−1)).
      const flux = Math.min(FLARE_MIN_FLUX * (Math.max(rng(), 1e-9) ** (-1 / (FLARE_INDEX - 1))), FLARE_MAX_FLUX)
      const scale = (flux / FLARE_M_FLUX) ** FLARE_DURATION_EXPONENT
      const rise = FLARE_RISE_MINUTES * scale * MS_PER_MINUTE * (0.5 + rng())
      const decay = FLARE_DECAY_MINUTES * scale * MS_PER_MINUTE * (0.5 + rng())
      const share = flux >= FLARE_M_FLUX ? WHITE_LIGHT_SHARE.mx : WHITE_LIGHT_SHARE.c
      const whiteLight = rng() < share
      const pick = rng() * totalArea
      const sep = (RIBBON_SEPARATION_MM[0] + ((RIBBON_SEPARATION_MM[1] - RIBBON_SEPARATION_MM[0]) * rng())) / SUN_RADIUS_MM
      const angle = rng() * 2 * Math.PI
      if (ms < start || ms > start + rise + decay) {
        continue
      }
      let acc = 0
      let region = regions[regions.length - 1]
      for (const r of regions) {
        acc += r.area
        if (acc >= pick) {
          region = r
          break
        }
      }
      // The white light peaks in the impulsive phase: a bump over the rise.
      const t = (ms - start) / rise
      const phase = whiteLight ? Math.exp(-(((t - 0.7) / 0.35) ** 2)) : 0
      out.push({
        start, flux, class: goesClass(flux), rise, decay, whiteLight,
        contrast: whiteLight ? flareContrast(flux) : 0,
        phase,
        kernels: ribbonKernels(region.centre, sep, angle),
        radius: KERNEL_RADIUS_MM / SUN_RADIUS_MM,
        region: region.id,
      })
    }
  }
  return out
}


/**
 * Two kernels astride a point on the unit sphere, a separation apart in a
 * direction (an angle in its tangent plane).
 *
 * @param {Array<number>} c unit
 * @param {number} sep radians
 * @param {number} angle radians
 * @returns {Array<Array<number>>}
 */
function ribbonKernels(c, sep, angle) {
  // A tangent basis at c.
  const up = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e = normalize(cross(up, c))
  const n = cross(c, e)
  const d = [0, 1, 2].map((i) => (Math.cos(angle) * e[i]) + (Math.sin(angle) * n[i]))
  const h = sep / 2
  return [
    normalize([0, 1, 2].map((i) => c[i] + (h * d[i]))),
    normalize([0, 1, 2].map((i) => c[i] - (h * d[i]))),
  ]
}


const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])]
const normalize = (v) => {
  const l = Math.hypot(...v) || 1
  return v.map((x) => x / l)
}


// --- Coronal mass ejections.

// LASCO's rate: about 0.5 a day near minimum to about 6 a day near
// maximum (Yashiro et al. 2004, JGR 109, A07105), here linear in the
// cycle's level (activityLevel: 1 at cycle 23's maximum).  Their mean
// apparent width, 47° at minimum to 61° at maximum (the same), and speed,
// 300 to 550 km/s (Yashiro et al. 2003, for the narrow ones; the
// catalogue's mean is ~450), and masses of 10¹³ to 10¹⁶ g, ~10¹⁵ typical
// (Vourlidas et al. 2010, ApJ 722, 1522).
export const CME_RATE_PER_DAY = Object.freeze([0.5, 6])
export const CME_WIDTH_DEG = Object.freeze([47, 61])
export const CME_SPEED_KM_S = Object.freeze([300, 550])
export const CME_MASS_G = 1e15
export const CME_MASS_SIGMA = 1.0
// Most CMEs leave from active regions; the rest from quiescent filaments
// and the streamer belt (a model's split).
export const CME_FROM_REGIONS = 0.7
// Followed out to here (solar radii), past LASCO C3's field (30).
export const CME_MAX_RADII = 40
const CME_WINDOW_HOURS = 72
const CME_BIN_HOURS = 6
const SUN_RADIUS_KM = 695700


/**
 * @param {number} level activityLevel
 * @param {Array<number>} range [at minimum, at a strong maximum]
 * @returns {number}
 */
function byLevel(level, range) {
  return range[0] + ((range[1] - range[0]) * Math.min(Math.max(level, 0), 1.5))
}


/**
 * CMEs a day at a date.
 *
 * @param {number} ms
 * @returns {number}
 */
export function cmeRate(ms) {
  return byLevel(activityLevel(ms), CME_RATE_PER_DAY)
}


/**
 * The CMEs in flight at a time, out to CME_MAX_RADII.  Their sources are
 * drawn as the active regions' are (the cycle's spot zones) or from the
 * streamer belt, not tied to a particular region, so a CME in flight never
 * moves when a region elsewhere is born or dies.
 *
 * @param {number} ms UTC
 * @param {number} [seed]
 * @returns {Array<object>} {launch (ms), speed (km/s), width (half-angle,
 *     rad), mass (g), source: {lat, lon} in the Carrington frame at
 *     launch, front (solar radii from the centre now)}
 */
export function cmesAt(ms, seed = 0) {
  const out = []
  const bin = Math.floor(ms / (CME_BIN_HOURS * MS_PER_HOUR))
  for (let b = bin - (CME_WINDOW_HOURS / CME_BIN_HOURS); b <= bin; b++) {
    const rng = binGenerator(b, seed, STREAM_CMES)
    const mid = (b + 0.5) * CME_BIN_HOURS * MS_PER_HOUR
    const level = activityLevel(mid)
    const n = poisson(cmeRate(mid) * CME_BIN_HOURS / 24, rng)
    if (n === 0) {
      continue
    }
    const cycles = cyclesAt(mid)
    const zone = cycles.reduce((a, c) => (c.share > a.share ? c : a), cycles[0])
    for (let k = 0; k < n; k++) {
      const launch = (b + rng()) * CME_BIN_HOURS * MS_PER_HOUR
      const speed = logNormal(byLevel(level, CME_SPEED_KM_S) * 0.85, 0.5, rng)
      const width = Math.min(logNormal(byLevel(level, CME_WIDTH_DEG) * 0.85, 0.5, rng), 150) * DEG / 2
      const mass = logNormal(CME_MASS_G, CME_MASS_SIGMA, rng)
      const fromRegion = rng() < CME_FROM_REGIONS && zone
      const z = gaussian(rng)
      const v = rng()
      const hemisphere = rng() < 0.5 ? -1 : 1
      const lat = fromRegion ? hemisphere * Math.abs(zone.latitude + (zone.width * z)) :
        (v - 0.5) * 2 * (30 + (30 * Math.min(level, 1)))
      const source = {lat, lon: 360 * rng()}
      const front = 1 + (speed * (ms - launch) / 1000 / SUN_RADIUS_KM)
      if (ms >= launch && front < CME_MAX_RADII) {
        out.push({launch, speed, width, mass, source, front})
      }
    }
  }
  return out
}


// --- Prominences and filaments.

// The same structures: over the limb, prominences; on the disc, filaments
// (in white light they are all but invisible, Sun.md).  Quiescent ones
// are 60-600 Mm long, 15-100 Mm high and 4-15 Mm thick (Mackay et al.
// 2010, Space Sci. Rev. 151, 333); active-region filaments lower and
// shorter-lived, and polar-crown filaments at high latitude near maximum.
// How many and how long they live is a model: on the whole Sun, 10 plus
// 0.25 per unit of the smoothed sunspot number, living a median 25 days
// (quiescent: several rotations; active-region: days).
export const PROMINENCE_BASE = 10
export const PROMINENCE_PER_SN = 0.25
export const PROMINENCE_LIFE_DAYS = 25
export const PROMINENCE_LIFE_SIGMA = 0.7
export const PROMINENCE_LENGTH_MM = Object.freeze([60, 600])
export const PROMINENCE_HEIGHT_MM = Object.freeze([15, 100])
export const PROMINENCE_THICKNESS_MM = Object.freeze([4, 15])
// Hα's equivalent width, against the disc centre's continuum, of a
// typical quiescent prominence seen at the limb: integrated intensities of
// 10⁵ to 10⁶ erg cm⁻² s⁻¹ sr⁻¹ (Labrosse et al. 2010) over the continuum's
// 2.84e6 a ångström (emission.js) are 0.035-0.35 Å; 0.1 Å = 0.01 nm here,
// spread log-normally.
export const PROMINENCE_HALPHA_NM = 0.01
export const PROMINENCE_HALPHA_SIGMA = 0.6
const PROMINENCE_WINDOW_DAYS = 160


/**
 * @param {number} lo
 * @param {number} hi
 * @param {number} u uniform
 * @returns {number} log-uniform between lo and hi
 */
function logUniform(lo, hi, u) {
  return lo * ((hi / lo) ** u)
}


/**
 * The prominences born on one day, before their ages are known.
 *
 * @param {number} day Days since 1970 (UTC)
 * @param {number} seed
 * @returns {Array<object>}
 */
export function prominencesBornOn(day, seed) {
  const out = []
  const life = PROMINENCE_LIFE_DAYS * Math.exp(PROMINENCE_LIFE_SIGMA * PROMINENCE_LIFE_SIGMA / 2)
  const rng = binGenerator(day, seed, STREAM_PROMINENCES)
  const mid = (day + 0.5) * MS_PER_DAY
  const sn = smoothedSunspotNumber(mid)
  const level = activityLevel(mid)
  const n = poisson((PROMINENCE_BASE + (PROMINENCE_PER_SN * sn)) / life, rng)
  if (n === 0) {
    return out
  }
  const cycles = cyclesAt(mid)
  const zone = cycles.reduce((a, c) => (c.share > a.share ? c : a), cycles[0])
  for (let k = 0; k < n; k++) {
    const birth = (day + rng()) * MS_PER_DAY
    const u = rng()
    let kind
    let lat
    let height
    let lifeDays
    if (u < 0.35) {
      kind = 'active'
      lat = zone ? zone.latitude + (zone.width * gaussian(rng)) : 15
      height = logUniform(5, 30, rng())
      lifeDays = logNormal(5, 0.6, rng)
    } else if (u < 0.85 - (0.15 * Math.min(level, 1))) {
      kind = 'quiescent'
      lat = (zone ? zone.latitude : 15) + 5 + (25 * rng())
      height = logUniform(PROMINENCE_HEIGHT_MM[0], PROMINENCE_HEIGHT_MM[1], rng())
      lifeDays = logNormal(PROMINENCE_LIFE_DAYS, PROMINENCE_LIFE_SIGMA, rng)
    } else {
      kind = 'polar crown'
      lat = 50 + (15 * rng())
      height = logUniform(PROMINENCE_HEIGHT_MM[0], PROMINENCE_HEIGHT_MM[1], rng())
      lifeDays = logNormal(PROMINENCE_LIFE_DAYS * 2, PROMINENCE_LIFE_SIGMA, rng)
    }
    lat *= rng() < 0.5 ? -1 : 1
    out.push({
      kind, birth, lat, lifeDays, height,
      lon: 360 * rng(),
      length: logUniform(PROMINENCE_LENGTH_MM[0], kind === 'active' ? 150 : PROMINENCE_LENGTH_MM[1], rng()),
      thickness: logUniform(PROMINENCE_THICKNESS_MM[0], PROMINENCE_THICKNESS_MM[1], rng()),
      // The filament's axis: east-west, tilted (polar crown nearly not).
      tilt: (kind === 'polar crown' ? 10 : 40) * gaussian(rng) * DEG,
      halpha: logNormal(PROMINENCE_HALPHA_NM, PROMINENCE_HALPHA_SIGMA, rng),
      seed: rng(),
    })
  }
  return out
}


const PROMINENCE_CACHE_SIZE = 512
const prominenceCache = new Map


/**
 * The prominences (and filaments) on the Sun at a time.
 *
 * @param {number} ms UTC
 * @param {number} [seed]
 * @returns {Array<object>} {centre, tangent (body-frame units), halfLength
 *     (rad), height, thickness (solar radii), halpha (nm), kind, seed}
 */
export function prominencesAt(ms, seed = 0) {
  const out = []
  const today = Math.floor(ms / MS_PER_DAY)
  for (let day = today - PROMINENCE_WINDOW_DAYS; day <= today; day++) {
    const key = `${seed}:${day}`
    let born = prominenceCache.get(key)
    if (!born) {
      born = prominencesBornOn(day, seed)
      prominenceCache.set(key, born)
      if (prominenceCache.size > PROMINENCE_CACHE_SIZE) {
        prominenceCache.delete(prominenceCache.keys().next().value)
      }
    }
    for (const p of born) {
      const age = (ms - p.birth) / MS_PER_DAY
      if (age < 0 || age > p.lifeDays) {
        continue
      }
      const lon = p.lon + ((rotationRate(p.lat) - CARRINGTON_DEG_PER_DAY) * age)
      const centre = bodyUnit(p.lat, lon)
      // East (growing longitude) and north at the centre, turned by the tilt.
      const east = bodyUnit(0, lon + 90)
      const north = cross(centre, east)
      const tangent = [0, 1, 2].map((i) => (Math.cos(p.tilt) * east[i]) + (Math.sin(p.tilt) * north[i]))
      // Grows in and fades out over a tenth of its life.
      const fade = Math.min(1, age / (0.1 * p.lifeDays), (p.lifeDays - age) / (0.1 * p.lifeDays))
      out.push({
        kind: p.kind, lat: p.lat, lon, centre, tangent,
        halfLength: p.length / 2 / SUN_RADIUS_MM,
        height: p.height / SUN_RADIUS_MM,
        thickness: p.thickness / SUN_RADIUS_MM,
        halpha: p.halpha * fade,
        seed: p.seed,
      })
    }
  }
  return out
}
