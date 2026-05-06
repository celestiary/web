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
