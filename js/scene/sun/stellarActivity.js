import {SUN_TEFF} from '../stellar.js'


/**
 * A star's magnetic activity from its parameters (js/scene/Sun.md, "Other
 * stars"): whether it has the Sun's kind at all (spots, flares,
 * prominences, a hot corona and CMEs all come from a dynamo in a
 * convective envelope), and how much of it against the Sun's, so that the
 * Sun's own event model (solarEvents.js) can be run for it.  The Sun is
 * the reference: its scales are 1 by construction.
 *
 * The chain is the rotation-activity relation: a star's rotation period
 * over its convective turnover time is its Rossby number, which sets its
 * X-ray luminosity as a share of its bolometric one; the X-ray luminosity
 * sets the rate of its flares.  Each step is a published relation; what
 * the catalogue doesn't give (a period, an age) is a model, said so below.
 */


/** The Sun's sidereal rotation, days (Carrington's), and its age, Gyr. */
export const SUN_ROTATION_DAYS = 25.38
export const SUN_AGE_GYR = 4.57


// The regimes.  'solar': a convective envelope and a hot corona.
// 'radiative': too hot for an outer convection zone (their X-rays are
// their winds' shocks, not flares).  'wind': the cool giants and
// supergiants past the coronal dividing line (Linsky & Haisch 1979, ApJ
// 229, L27: no transition region or corona later than about K1 III and
// G5 Ib, but cool, massive winds).  'degenerate': a white dwarf.
export const REGIME_SOLAR = 'solar'
export const REGIME_RADIATIVE = 'radiative'
export const REGIME_WIND = 'wind'
export const REGIME_DEGENERATE = 'degenerate'
// Above this the envelope is radiative (Star.js draws no granules or
// spots there either); coronae come in from about F0 (Schmitt 1997, A&A
// 318, 215: every F to M dwarf within 13 pc is an X-ray source), and
// their strength is tapered in over the last 750 K (a model: the
// convection zone is thin there).
export const CONVECTIVE_TEFF_MAX = 7000
export const CONVECTIVE_TAPER_K = 750
// The dividing line: giants (log g under 3) cooler than K1 III's 4,600 K,
// to G5 Ib's 4,900 K at a supergiant's log g of 0.5.
export const GIANT_LOGG = 3
export const DIVIDING_TEFF = Object.freeze({giant: 4600, supergiant: 4900, loggGiant: 2, loggSupergiant: 0.5})
export const DEGENERATE_LOGG = 6.5


/**
 * @param {number} teff K
 * @param {number} logg cgs
 * @returns {string} The star's regime
 */
export function activityRegime(teff, logg) {
  if (logg > DEGENERATE_LOGG) {
    return REGIME_DEGENERATE
  }
  if (teff >= CONVECTIVE_TEFF_MAX) {
    return REGIME_RADIATIVE
  }
  if (logg < GIANT_LOGG) {
    const d = DIVIDING_TEFF
    const t = Math.min(Math.max((d.loggGiant - logg) / (d.loggGiant - d.loggSupergiant), 0), 1)
    if (teff < d.giant + ((d.supergiant - d.giant) * t)) {
      return REGIME_WIND
    }
  }
  return REGIME_SOLAR
}


/**
 * The convective turnover time from the mass: Wright et al. 2011 (ApJ
 * 743, 48, eq. 11), log τ = 1.16 − 1.49 log M − 0.54 log² M, fitted from
 * 0.09 to 1.36 M☉ and held at its ends.
 *
 * @param {number} mass M☉
 * @returns {number} days
 */
export function turnoverDays(mass) {
  const m = Math.log10(Math.min(Math.max(mass, 0.09), 1.36))
  return 10 ** (1.16 - (1.49 * m) - (0.54 * m * m))
}


// L_X / L_bol against the Rossby number Ro = P / τ (Wright et al. 2011):
// saturated at 10^−3.13 under Ro = 0.13, falling as Ro^−2.70 above it.
// For the Sun (Ro 1.76) that is 10^−6.18; they quote the Sun's as −6.24.
export const SATURATED_RX = 10 ** -3.13
export const SATURATION_ROSSBY = 0.13
export const RX_INDEX = -2.7


/**
 * @param {number} rossby
 * @returns {number} L_X / L_bol
 */
export function xrayFraction(rossby) {
  return SATURATED_RX * ((Math.max(rossby, SATURATION_ROSSBY) / SATURATION_ROSSBY) ** RX_INDEX)
}


export const SUN_ROSSBY = SUN_ROTATION_DAYS / turnoverDays(1)
export const SUN_RX = xrayFraction(SUN_ROSSBY)


// Where no period is measured, the Rossby number is the Sun's scaled by
// age, Ro ∝ t^0.566: the spin-down law's exponent in Mamajek & Hillenbrand
// (2008, ApJ 687, 1264; Skumanich's is 0.5), taken at a fixed turnover
// time, which is the basis of their activity-age relation.  The age,
// where none is given, is the seed's draw from 1 to 10 Gyr (the disc's
// stars, evenly: a model).
export const SPIN_DOWN_INDEX = 0.566
export const FIELD_AGE_GYR = Object.freeze([1, 10])
// Fully convective M dwarfs (under 0.35 M☉) stay saturated for gigayears
// and then spin down fast: the activity lifetimes of West et al. (2008, AJ
// 135, 785) by spectral type, here by mass (M0 0.6 M☉ 0.8 Gyr, M3 0.36: 2,
// M4 0.25: 4.5, M5 0.16: 7, M7 0.09: 8), and a Rossby number of 0.1
// within it, 1 after (periods of ~100 days: Newton et al. 2017).
export const FULLY_CONVECTIVE_MASS = 0.35
export const ACTIVITY_LIFETIME = Object.freeze([[0.09, 8], [0.16, 7], [0.25, 4.5], [0.36, 2], [0.6, 0.8]])
// An evolved star's envelope has swollen and its rotation slowed (a
// model: twice the main sequence's Rossby number per dex of gravity under
// the subgiants' log g of 3.8).
export const EVOLVED_LOGG = 3.8


/**
 * @param {number} mass M☉
 * @returns {number} The time an M dwarf of this mass stays active, Gyr
 */
export function activityLifetimeGyr(mass) {
  const t = ACTIVITY_LIFETIME
  if (mass <= t[0][0]) {
    return t[0][1]
  }
  for (let i = 1; i < t.length; i++) {
    if (mass <= t[i][0]) {
      const f = (mass - t[i - 1][0]) / (t[i][0] - t[i - 1][0])
      return t[i - 1][1] + ((t[i][1] - t[i - 1][1]) * f)
    }
  }
  return t[t.length - 1][1]
}


// The rate of flares over a given energy goes as L_X^0.95 (Audard et al.
// 2000, ApJ 541, 396, for flares over 10³² erg on F to M dwarfs).
export const FLARE_LX_INDEX = 0.95
// CMEs follow the flares on the Sun; on active stars the Sun's relation
// would carry off more mass and energy than the stars have to give (Drake
// et al. 2013, ApJ 764, 170), and a strong large-scale field holds
// eruptions in (Alvarado-Gómez et al. 2018, ApJ 862, 93).  Their rate is
// the flares' up to this many times the Sun's, held there (a model).
export const CME_SCALE_MAX = 10
// The corona's emission measure goes as L_X, so its density as √(L_X / R³)
// (a model: one temperature, a corona the star's own size).
export const CORONA_SCALE_MAX = 30


/**
 * A star's activity against the Sun's.
 *
 * @param {object} star
 * @param {number} star.teff K
 * @param {number} star.logg cgs
 * @param {number} star.mass M☉
 * @param {number} star.radius R☉
 * @param {number} [star.rotationDays] Its measured period
 * @param {number} [star.ageGyr] Its age, where known
 * @param {number} [star.seed] 0 to 1: the age's draw where neither is given
 * @returns {object} {regime, has: whether it has the Sun's kind of
 *     activity, teff, rossby, ageGyr, rx: L_X / L_bol, lxRelSun: its X-ray
 *     luminosity over the Sun's, flareScale, cmeScale: its flares' and CMEs'
 *     rates over the Sun's at the same sunspot number, coronaScale: its
 *     corona's density over the Sun's}
 */
export function stellarActivity({teff = SUN_TEFF, logg = 4.44, mass = 1, radius = 1, rotationDays, ageGyr, seed = 0.5}) {
  const regime = activityRegime(teff, logg)
  const quiet = {regime, has: false, teff, rossby: Infinity, ageGyr: ageGyr ?? null, rx: 0, lxRelSun: 0,
    flareScale: 0, cmeScale: 0, coronaScale: 0}
  if (regime !== REGIME_SOLAR) {
    return quiet
  }
  const age = ageGyr ?? (FIELD_AGE_GYR[0] + ((FIELD_AGE_GYR[1] - FIELD_AGE_GYR[0]) * Math.min(Math.max(seed, 0), 1)))
  let rossby
  if (rotationDays > 0) {
    rossby = rotationDays / turnoverDays(mass)
  } else if (mass < FULLY_CONVECTIVE_MASS && logg >= EVOLVED_LOGG) {
    rossby = age < activityLifetimeGyr(mass) ? 0.1 : 1
  } else {
    rossby = SUN_ROSSBY * ((age / SUN_AGE_GYR) ** SPIN_DOWN_INDEX) * (2 ** Math.max(EVOLVED_LOGG - logg, 0))
  }
  const taper = Math.min(Math.max((CONVECTIVE_TEFF_MAX - teff) / CONVECTIVE_TAPER_K, 0), 1)
  const rx = xrayFraction(rossby) * taper
  const luminosity = radius * radius * ((teff / SUN_TEFF) ** 4)
  const lxRelSun = rx * luminosity / SUN_RX
  const flareScale = lxRelSun ** FLARE_LX_INDEX
  return {
    regime,
    has: lxRelSun > 0,
    teff,
    rossby,
    ageGyr: age,
    rx,
    lxRelSun,
    flareScale,
    cmeScale: Math.min(flareScale, CME_SCALE_MAX),
    coronaScale: Math.min(Math.sqrt(lxRelSun / (radius ** 3)), CORONA_SCALE_MAX),
  }
}
