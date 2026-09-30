import {Quaternion, Vector3} from 'three'
import {toRad} from '../shared.js'
import {J2000_JD} from './celestialFrame.js'


// The Moon's geocentric position from Meeus, *Astronomical Algorithms* (2nd
// ed., 1998), chapter 47: the truncated ELP-2000/82 series of Chapront-Touzé
// and Chapront.  About 10″ in longitude, 4″ in latitude and a few km in
// distance near the present (see lunarTheory.test.js for the comparison
// with JPL Horizons).
//
// Output frame: the MEAN ECLIPTIC AND EQUINOX OF DATE, geometric (no
// nutation, light-time or aberration).  That is the frame of VSOP87C, which
// places the planets in the scene, so the Moon's geocentric offset goes
// straight into the scene with the same axis remap as the planets (see
// eclipticToScene and DESIGN.md "Orbital mechanics").
//
// Time argument: JDE, Julian Ephemeris Day (TT).  The simulation clock is
// UTC; convert with celestialFrame.utcToTtJulianDay.


const DAYS_PER_CENTURY = 36525
// Meeus 47: Δ = 385000.56 km + Σr.
const MEAN_DISTANCE_KM = 385000.56
const METERS_PER_KM = 1000
// Units of the series coefficients: Σl and Σb in 1e-6 degree, Σr in 1e-3 km.
const SERIES_DEG_UNIT = 1e-6
const SERIES_KM_UNIT = 1e-3

// Inclination of the mean lunar equator to the ecliptic (IAU; Meeus 53).
// By Cassini's laws the equator's descending node is the orbit's ascending
// node, so the spin pole sits at ecliptic longitude Ω + 90°, 1.54242° from
// the ecliptic pole.
export const LUNAR_EQUATOR_INCLINATION_DEG = 1.54242
// Mean inclination of the orbit to the ecliptic (Meeus 47 notes).
export const LUNAR_ORBIT_INCLINATION_DEG = 5.145396


// Meeus Table 47.A: periodic terms for longitude (Σl) and distance (Σr).
// Columns: multiples of D, M, M', F; Σl coefficient; Σr coefficient.
const LR_TERMS = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752],
]


// Meeus Table 47.B: periodic terms for latitude (Σb).
// Columns: multiples of D, M, M', F; Σb coefficient.
const B_TERMS = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],
  [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],
  [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],
  [2, 0, 2, 1, 422],
  [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351],
  [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],
  [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],
  [1, 1, 0, -1, 223],
  [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],
  [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177],
  [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],
  [4, -1, 0, -1, 115],
  [2, -2, 0, 1, 107],
]


/**
 * Evaluate a polynomial in T, coefficients lowest order first.
 *
 * @param {number} t
 * @param {Array<number>} c
 * @returns {number}
 */
function poly(t, c) {
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) {
    v = (v * t) + c[i]
  }
  return v
}


/**
 * @param {number} deg
 * @returns {number} deg in [0, 360)
 */
function norm360(deg) {
  const r = deg % 360
  return r < 0 ? r + 360 : r
}


/**
 * The fundamental arguments of Meeus 47.1-47.5 and 47.7, in degrees
 * normalised to [0, 360).
 *
 * @param {number} jde Julian Ephemeris Day (TT)
 * @returns {{t: number, lp: number, d: number, m: number, mp: number, f: number, node: number, perigee: number}}
 *   t: Julian centuries from J2000; lp: the Moon's mean longitude L';
 *   d: mean elongation D; m: the Sun's mean anomaly M; mp: the Moon's mean
 *   anomaly M'; f: argument of latitude F; node: longitude of the mean
 *   ascending node Ω; perigee: longitude of the mean perigee.
 */
export function moonArguments(jde) {
  const t = (jde - J2000_JD) / DAYS_PER_CENTURY
  return {
    t,
    lp: norm360(poly(t, [218.3164477, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000])),
    d: norm360(poly(t, [297.8501921, 445267.1114034, -0.0018819, 1 / 545868, -1 / 113065000])),
    m: norm360(poly(t, [357.5291092, 35999.0502909, -0.0001536, 1 / 24490000])),
    mp: norm360(poly(t, [134.9633964, 477198.8675055, 0.0087414, 1 / 69699, -1 / 14712000])),
    f: norm360(poly(t, [93.2720950, 483202.0175233, -0.0036539, -1 / 3526000, 1 / 863310000])),
    node: norm360(poly(t, [125.0445479, -1934.1362891, 0.0020754, 1 / 467441, -1 / 60616000])),
    perigee: norm360(poly(t, [83.3532465, 4069.0137287, -0.0103200, -1 / 80053, 1 / 18999000])),
  }
}


/**
 * The Moon's geocentric ecliptic position, Meeus 47.
 *
 * @param {number} jde Julian Ephemeris Day (TT)
 * @returns {{lambda: number, beta: number, distanceKm: number, sumL: number, sumB: number, sumR: number, args: object}}
 *   lambda, beta: geometric longitude and latitude in degrees, mean
 *   ecliptic and equinox of date (lambda in [0, 360)); distanceKm: centre
 *   to centre; sumL, sumB, sumR: Meeus's Σl, Σb, Σr (for checking against
 *   his worked example); args: moonArguments(jde).
 */
export function moonEcliptic(jde) {
  const args = moonArguments(jde)
  const {t, lp, d, m, mp, f} = args
  const a1 = (119.75 + (131.849 * t)) * toRad
  const a2 = (53.09 + (479264.290 * t)) * toRad
  const a3 = (313.45 + (481266.484 * t)) * toRad
  // Eccentricity of Earth's orbit decreasing: terms in M are scaled by E,
  // in 2M by E².
  const e = poly(t, [1, -0.002516, -0.0000074])
  const eFactor = [1, e, e * e]
  const dR = d * toRad
  const mR = m * toRad
  const mpR = mp * toRad
  const fR = f * toRad
  const lpR = lp * toRad

  let sumL = 0
  let sumR = 0
  for (const [cd, cm, cmp, cf, cl, cr] of LR_TERMS) {
    const arg = (cd * dR) + (cm * mR) + (cmp * mpR) + (cf * fR)
    const ef = eFactor[Math.abs(cm)]
    sumL += cl * ef * Math.sin(arg)
    sumR += cr * ef * Math.cos(arg)
  }
  let sumB = 0
  for (const [cd, cm, cmp, cf, cb] of B_TERMS) {
    const arg = (cd * dR) + (cm * mR) + (cmp * mpR) + (cf * fR)
    sumB += cb * eFactor[Math.abs(cm)] * Math.sin(arg)
  }
  // Additive terms: Venus (A1), Jupiter (A2) and the flattening of the
  // Earth (L' - F, and the L' terms in latitude).
  sumL += (3958 * Math.sin(a1)) + (1962 * Math.sin(lpR - fR)) + (318 * Math.sin(a2))
  sumB += (-2235 * Math.sin(lpR)) + (382 * Math.sin(a3)) +
    (175 * Math.sin(a1 - fR)) + (175 * Math.sin(a1 + fR)) +
    (127 * Math.sin(lpR - mpR)) - (115 * Math.sin(lpR + mpR))

  return {
    lambda: norm360(lp + (sumL * SERIES_DEG_UNIT)),
    beta: sumB * SERIES_DEG_UNIT,
    distanceKm: MEAN_DISTANCE_KM + (sumR * SERIES_KM_UNIT),
    sumL,
    sumB,
    sumR,
    args,
  }
}


/**
 * A direction or position in ecliptic coordinates, remapped into the scene
 * frame: scene X = ecliptic X (equinox), scene Y = ecliptic Z (north
 * ecliptic pole), scene Z = -ecliptic Y.  Same remap as Animation applies
 * to VSOP87C's (x, y, z).
 *
 * @param {number} lambdaDeg ecliptic longitude
 * @param {number} betaDeg ecliptic latitude
 * @param {number} r length of the result
 * @param {Vector3} [target]
 * @returns {Vector3}
 */
export function eclipticToScene(lambdaDeg, betaDeg, r, target = new Vector3) {
  const l = lambdaDeg * toRad
  const b = betaDeg * toRad
  const c = Math.cos(b)
  return target.set(r * c * Math.cos(l), r * Math.sin(b), -r * c * Math.sin(l))
}


/**
 * The Moon's position relative to Earth's centre, in the scene frame (of
 * date), in metres.
 *
 * @param {number} jde Julian Ephemeris Day (TT)
 * @param {Vector3} [target]
 * @returns {Vector3}
 */
export function moonScenePosition(jde, target = new Vector3) {
  const {lambda, beta, distanceKm} = moonEcliptic(jde)
  return eclipticToScene(lambda, beta, distanceKm * METERS_PER_KM, target)
}


const Y_AXIS = new Vector3(0, 1, 0)
const X_AXIS = new Vector3(1, 0, 0)
const tmpQ = new Quaternion


/**
 * The Moon's mean orientation by Cassini's laws, as a rotation from its
 * body frame to the scene frame (of date).
 *
 * Body frame, as for every body in celestiary (coords.js): +Y the north
 * pole, +X the prime meridian (longitude 0, the mean sub-Earth point), east
 * longitude toward -Z.  In ecliptic terms the rotation is
 *   Rz(Ω) · Rx(-I) · Rz(F + 180°)
 * (Meeus 53: the equator inclined I to the ecliptic about the node line Ω;
 * the prime meridian at F + 180° from the node, so that it faces Earth
 * when the Moon is at its mean longitude L' = Ω + F).  The scene remap
 * turns rotations about ecliptic Z into rotations about scene Y, and about
 * ecliptic X into scene X.
 *
 * The Earth's selenographic longitude under this orientation is Meeus's
 * optical libration l' (up to ±8°), and its latitude b' (up to ±7°).
 * Physical libration (a few hundredths of a degree) is left out; the IAU
 * rotation model is #96.
 *
 * @param {object} args moonArguments(jde)
 * @param {Quaternion} [target]
 * @returns {Quaternion}
 */
export function moonOrientation(args, target = new Quaternion) {
  target.setFromAxisAngle(Y_AXIS, args.node * toRad)
  target.multiply(tmpQ.setFromAxisAngle(X_AXIS, -LUNAR_EQUATOR_INCLINATION_DEG * toRad))
  target.multiply(tmpQ.setFromAxisAngle(Y_AXIS, (args.f * toRad) + Math.PI))
  return target
}


/**
 * Rotation that takes a flat orbit ellipse (major axis along +X, in the XZ
 * plane, as Planet.newOrbit draws it) onto the Moon's mean orbit of date:
 * inclined 5.145° about the node line Ω, the major axis toward the mean
 * perigee.  In ecliptic terms Rz(Ω) · Rx(i) · Rz(ϖ - Ω).
 *
 * @param {object} args moonArguments(jde)
 * @param {Quaternion} [target]
 * @returns {Quaternion}
 */
export function moonOrbitOrientation(args, target = new Quaternion) {
  target.setFromAxisAngle(Y_AXIS, args.node * toRad)
  target.multiply(tmpQ.setFromAxisAngle(X_AXIS, LUNAR_ORBIT_INCLINATION_DEG * toRad))
  target.multiply(tmpQ.setFromAxisAngle(Y_AXIS, (args.perigee - args.node) * toRad))
  return target
}
