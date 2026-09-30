import {toRad} from '../shared.js'


// Julian Day at the J2000 epoch: 2000-01-01 12:00:00 TT (≈ 11:58:55.816 UTC).
// VSOP87C, the IAU galactic frame, GMST, and most modern astronomical
// constants are anchored here.
export const J2000_JD = 2451545.0


// IAU low-precision GMST polynomial coefficients (accurate to ~0.1 s over
// 1900-2100, more than good enough for visual simulation):
//
//   GMST(T) = 280.46061837° + 360.98564736629° · T
//
// where T is days from J2000.0 in UT1.  GMST is the right ascension of the
// Greenwich prime meridian — i.e., the angle from the vernal equinox to the
// prime meridian, measured east in the equatorial plane.  Earth's spin angle
// in a frame whose Y is the celestial pole and whose +X is the vernal
// equinox is *exactly* GMST.
const GMST_OFFSET_DEG = 280.46061837
const GMST_RATE_DEG_PER_DAY = 360.98564736629


/**
 * Greenwich Mean Sidereal Time as an angle in radians, normalized to [0, 2π).
 *
 * Tied to UT1; we feed it our simulation Julian Day (which is UTC-aligned).
 * The UT1−UTC offset is bounded to ±0.9 s by leap-second insertion, which
 * maps to ≤ 0.004° in GMST — invisible at any reasonable rendering scale.
 *
 * @param {number} julianDay Julian Day (UT1, treated identical to UTC here)
 * @returns {number} GMST in radians ∈ [0, 2π)
 */
export function gmstRad(julianDay) {
  const t = julianDay - J2000_JD
  const deg = GMST_OFFSET_DEG + (GMST_RATE_DEG_PER_DAY * t)
  const TWO_PI = 2 * Math.PI
  let r = (deg * toRad) % TWO_PI
  if (r < 0) {
    r += TWO_PI
  }
  return r
}


// TAI − UTC (leap seconds) from each date, as decimal years.  Last change
// 2017-01-01; none are scheduled, and UTC is to drop them by 2035.
const LEAP_SECONDS = [
  [1972.0, 10], [1972.5, 11], [1973.0, 12], [1974.0, 13], [1975.0, 14],
  [1976.0, 15], [1977.0, 16], [1978.0, 17], [1979.0, 18], [1980.0, 19],
  [1981.5, 20], [1982.5, 21], [1983.5, 22], [1985.5, 23], [1988.0, 24],
  [1990.0, 25], [1991.0, 26], [1992.5, 27], [1993.5, 28], [1994.5, 29],
  [1996.0, 30], [1997.5, 31], [1999.0, 32], [2006.0, 33], [2009.0, 34],
  [2012.5, 35], [2015.5, 36], [2017.0, 37],
]
const TT_MINUS_TAI_SEC = 32.184
const FIRST_LEAP_YEAR = 1972
const DAYS_PER_JULIAN_YEAR = 365.25
const SECS_PER_DAY = 86400
// JD of 2000-01-01 0h, the origin for decimal years here.
const JD_2000_JAN_1 = 2451544.5
const YEAR_2000 = 2000
// Morrison & Stephenson's long-term parabola, ΔT = -20 + 32 u² s with
// u = (year - 1820) / 100 (Espenak & Meeus); a few seconds off in the 20th
// century, which moves the Moon well under an arcminute.
const DT_PARABOLA_EPOCH = 1820
const DT_PARABOLA_A = -20
const DT_PARABOLA_B = 32
const YEARS_PER_CENTURY = 100


/**
 * TT − UTC in seconds at a UTC Julian Day: 32.184 s + the leap seconds
 * from 1972 on (exact, to the day), and the long-term ΔT parabola before.
 * UT1 − UTC (< 0.9 s) is ignored.
 *
 * @param {number} jdUtc Julian Day (UTC)
 * @returns {number} seconds
 */
export function ttMinusUtcSeconds(jdUtc) {
  const year = YEAR_2000 + ((jdUtc - JD_2000_JAN_1) / DAYS_PER_JULIAN_YEAR)
  if (year < FIRST_LEAP_YEAR) {
    const u = (year - DT_PARABOLA_EPOCH) / YEARS_PER_CENTURY
    return DT_PARABOLA_A + (DT_PARABOLA_B * u * u)
  }
  let leap = LEAP_SECONDS[0][1]
  for (const [from, secs] of LEAP_SECONDS) {
    if (year >= from) {
      leap = secs
    }
  }
  return TT_MINUS_TAI_SEC + leap
}


/**
 * @param {number} jdUtc Julian Day (UTC), as Time.simTimeJulianDay gives
 * @returns {number} Julian Ephemeris Day (TT)
 */
export function utcToTtJulianDay(jdUtc) {
  return jdUtc + (ttMinusUtcSeconds(jdUtc) / SECS_PER_DAY)
}


const ARCSEC = toRad / 3600
const DAYS_PER_CENTURY = 36525


/**
 * Precess ecliptic coordinates from the mean ecliptic and equinox of one
 * date to another's (Meeus 21.5-21.7, IAU 1976).  E.g. from of date (the
 * scene's frame, VSOP87C's) to J2000 (JPL Horizons' ecliptic vectors, the
 * star catalogue's frame).
 *
 * @param {number} lambdaDeg longitude at jdeFrom
 * @param {number} betaDeg latitude at jdeFrom
 * @param {number} jdeFrom Julian Ephemeris Day of the starting frame
 * @param {number} jdeTo Julian Ephemeris Day of the target frame
 * @returns {{lambda: number, beta: number}} degrees, lambda in [0, 360)
 */
export function precessEcliptic(lambdaDeg, betaDeg, jdeFrom, jdeTo) {
  const T = (jdeFrom - J2000_JD) / DAYS_PER_CENTURY
  const t = (jdeTo - jdeFrom) / DAYS_PER_CENTURY
  const eta = (((47.0029 - (0.06603 * T) + (0.000598 * T * T)) * t) +
    ((-0.03302 + (0.000598 * T)) * t * t) + (0.000060 * t * t * t)) * ARCSEC
  const bigPi = (174.876384 * toRad) +
    (((3289.4789 * T) + (0.60622 * T * T) - ((869.8089 + (0.50491 * T)) * t) + (0.03536 * t * t)) * ARCSEC)
  const p = (((5029.0966 + (2.22226 * T) - (0.000042 * T * T)) * t) +
    ((1.11113 - (0.000042 * T)) * t * t) - (0.000006 * t * t * t)) * ARCSEC
  const l0 = lambdaDeg * toRad
  const b0 = betaDeg * toRad
  const a = (Math.cos(eta) * Math.cos(b0) * Math.sin(bigPi - l0)) - (Math.sin(eta) * Math.sin(b0))
  const b = Math.cos(b0) * Math.cos(bigPi - l0)
  const c = (Math.cos(eta) * Math.sin(b0)) + (Math.sin(eta) * Math.cos(b0) * Math.sin(bigPi - l0))
  let lambda = (p + bigPi - Math.atan2(a, b)) / toRad
  lambda = ((lambda % 360) + 360) % 360
  return {lambda, beta: Math.asin(c) / toRad}
}
