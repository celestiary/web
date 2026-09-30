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


// ΔT = TT − UT before 1972: Espenak & Meeus's piecewise polynomials
// (NASA Five Millennium Canon of Solar Eclipses, 2006; "Polynomial
// expressions for Delta T", eclipse.gsfc.nasa.gov/SEhelp/deltatpoly2004.html).
// Each row: [from year, origin year, scale in years, coefficients lowest
// order first], ΔT = Σ c_i ((year − origin) / scale)^i seconds.  Before
// −500 it's Morrison & Stephenson's long-term parabola, −20 + 32 u² with
// u = (year − 1820) / 100.  Adjacent segments meet within ~0.2 s, and the
// 1961-1986 segment meets the leap-second table at 1972.0 within 0.1 s.
const DELTA_T_SEGMENTS = [
  [-Infinity, 1820, 100, [-20, 0, 32]],
  [-500, 0, 100, [10583.6, -1014.41, 33.78311, -5.952053, -0.1798452, 0.022174192, 0.0090316521]],
  [500, 1000, 100, [1574.2, -556.01, 71.23472, 0.319781, -0.8503463, -0.005050998, 0.0083572073]],
  [1600, 1600, 1, [120, -0.9808, -0.01532, 1 / 7129]],
  [1700, 1700, 1, [8.83, 0.1603, -0.0059285, 0.00013336, -1 / 1174000]],
  [1800, 1800, 1, [13.72, -0.332447, 0.0068612, 0.0041116, -0.00037436, 0.0000121272, -0.0000001699, 0.000000000875]],
  [1860, 1860, 1, [7.62, 0.5737, -0.251754, 0.01680668, -0.0004473624, 1 / 233174]],
  [1900, 1900, 1, [-2.79, 1.494119, -0.0598939, 0.0061966, -0.000197]],
  [1920, 1920, 1, [21.20, 0.84493, -0.076100, 0.0020936]],
  [1941, 1950, 1, [29.07, 0.407, -1 / 233, 1 / 2547]],
  [1961, 1975, 1, [45.45, 1.067, -1 / 260, -1 / 718]],
]


/**
 * ΔT before 1972 from DELTA_T_SEGMENTS.
 *
 * @param {number} year decimal year
 * @returns {number} seconds
 */
function deltaTBefore1972(year) {
  let seg = DELTA_T_SEGMENTS[0]
  for (const s of DELTA_T_SEGMENTS) {
    if (year >= s[0]) {
      seg = s
    }
  }
  const [, origin, scale, c] = seg
  const t = (year - origin) / scale
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) {
    v = (v * t) + c[i]
  }
  return v
}


/**
 * TT − UTC in seconds at a UTC Julian Day.
 *
 * - From 1972: 32.184 s + the leap seconds (exact, to the day; it steps by
 *   1 s at each leap second, as UTC does).  UT1 − UTC (< 0.9 s) is ignored.
 * - Before 1972, when there was no UTC as now: ΔT = TT − UT from the
 *   Espenak-Meeus polynomials, continuous with the table at 1972.0.
 * - After the last leap second (2017) it stays at 69.184 s.  That is right
 *   for a UTC clock, since leap seconds stop by 2035, but UT1 (Earth's
 *   rotation) will keep drifting from UTC.  Earth-rotation work (GMST for
 *   future dates, #96) needs UT1 − UTC or a ΔT model, not this function.
 *
 * @param {number} jdUtc Julian Day (UTC)
 * @returns {number} seconds
 */
export function ttMinusUtcSeconds(jdUtc) {
  const year = YEAR_2000 + ((jdUtc - JD_2000_JAN_1) / DAYS_PER_JULIAN_YEAR)
  if (year < FIRST_LEAP_YEAR) {
    return deltaTBefore1972(year)
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
