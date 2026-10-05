import {Quaternion, Vector3} from 'three'
import {ASTRO_UNIT_METER, toRad} from '../shared.js'
import {J2000_OBLIQUITY_DEG} from './celestialFrame.js'


// Keplerian motion from published mean elements, for the bodies neither
// VSOP87 nor the lunar theory covers: Pluto and the planets' moons (#6).
//
// The elements live in each body's JSON `orbit` block, with their source,
// reference plane and epoch beside them.  Two forms:
//
// - Satellite mean elements (JPL SSD, ssd.jpl.nasa.gov/sats/elem): a, e,
//   i, node Ω, argument of pericentre ω and mean anomaly M at `epoch` (JD
//   TDB), referred to a plane given by its pole (`referencePole`, RA and Dec
//   in ICRF): the moon's Laplace plane, or the planet's equator.  Ω is
//   measured from the ascending node of that plane on the ICRF equator
//   (i.e. at RA = pole RA + 90°).  ω and Ω precess at constant rates, given
//   as the periods `apsidalPeriod` and `nodalPeriod` in years, SIGNED here
//   (the table lists magnitudes): negative when the angle decreases.  Nodes
//   regress for prograde orbits and advance for retrograde ones (Triton).
//   Apsides advance, except Io's and Europa's, which the Laplace resonance
//   drives backwards (ϖ̇ = 2n(Europa) - n(Io) = -0.74°/day).
//   `period` (days) is the table's period, and `periodOf` says which angle
//   it is the period of: the mean anomaly (JUP365's Galileans: Io's
//   1.762732 d is anomalistic, its sidereal period being 1.769138 d) or the
//   mean longitude Ω + ω + M (SAT441's Saturnian moons).  Both readings were
//   checked against JPL Horizons (meanElements.test.js); the wrong one puts
//   a moon tens of degrees off within a decade.
// - Planetary Keplerian elements (Standish, JPL "Keplerian elements for
//   approximate positions of the major planets", table 1, 1800-2050): a, e,
//   i, Ω, longitude of perihelion ϖ and mean longitude L at J2000 in the
//   ecliptic and equinox of J2000, each with a rate per Julian century
//   (`ratesPerCentury`).  Pluto.
//
// Everything here is computed in the ecliptic and equinox of J2000 (the
// frame of the elements and of JPL Horizons' ecliptic vectors), in the
// scene's axes: ecliptic (x, y, z) → scene (x, z, -y).  Animation rotates
// the results into the scene's frame, the ecliptic of date, with
// celestialFrame.precessionQuaternion.


const DAYS_PER_YEAR = 365.25
const DAYS_PER_CENTURY = 36525
const FULL_TURN_DEG = 360
const RIGHT_ANGLE_DEG = 90
const KEPLER_ITERATIONS = 12
const KEPLER_TOLERANCE = 1e-14
const Y_AXIS = new Vector3(0, 1, 0)
const X_AXIS = new Vector3(1, 0, 0)
const tmpQuat = new Quaternion


/**
 * @param {number|{scalar: number}} v a number, or a reified Measure
 * @returns {number}
 */
function scalarOf(v) {
  return Number((v !== null && typeof v === 'object') ? v.scalar : v)
}


/**
 * The degrees-per-day rate of an angle with the given signed period.
 *
 * @param {number} periodYears signed; 0 (or absent) for no motion
 * @returns {number}
 */
function rateOfPeriod(periodYears) {
  return periodYears ? FULL_TURN_DEG / (periodYears * DAYS_PER_YEAR) : 0
}


/**
 * A direction given by right ascension and declination in ICRF, as a unit
 * vector in the ecliptic of J2000, in scene axes.
 *
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {Vector3} [target]
 * @returns {Vector3}
 */
export function icrfToScene(raDeg, decDeg, target = new Vector3) {
  const a = raDeg * toRad
  const d = decDeg * toRad
  const eps = J2000_OBLIQUITY_DEG * toRad
  const x = Math.cos(d) * Math.cos(a)
  const y = Math.cos(d) * Math.sin(a)
  const z = Math.sin(d)
  const yEcl = (y * Math.cos(eps)) + (z * Math.sin(eps))
  const zEcl = (-y * Math.sin(eps)) + (z * Math.cos(eps))
  return target.set(x, zEcl, -yEcl)
}


/**
 * Rotation from a reference plane's frame (x toward its ascending node on
 * the ICRF equator, z its pole) to the ecliptic of J2000, in scene axes.
 * In equatorial terms Rz(α + 90°)·Rx(90° - δ), then Rx(-ε) to the ecliptic.
 *
 * @param {{ra: number, dec: number}} pole ICRF, degrees
 * @param {Quaternion} [target]
 * @returns {Quaternion}
 */
export function referencePlaneQuaternion(pole, target = new Quaternion) {
  target.setFromAxisAngle(X_AXIS, -J2000_OBLIQUITY_DEG * toRad)
  target.multiply(tmpQuat.setFromAxisAngle(Y_AXIS, (pole.ra + RIGHT_ANGLE_DEG) * toRad))
  target.multiply(tmpQuat.setFromAxisAngle(X_AXIS, (RIGHT_ANGLE_DEG - pole.dec) * toRad))
  return target
}


/**
 * The elements of a body's `orbit` block in one form, or null if it has
 * none (then Animation keeps the old flat ellipse).
 *
 * @param {object} orbit a body's `orbit`, raw or reified
 * @returns {object|null} {epoch, a, aRate, e, eRate, i, iRate, node,
 *     nodeRate, w, wRate, m, mRate, frame}: metres, degrees, per day; frame
 *     is the reference plane → ecliptic J2000 rotation
 */
export function meanElements(orbit) {
  if (!orbit || orbit.epoch === undefined) {
    return null
  }
  const frame = new Quaternion
  if (orbit.referencePole) {
    referencePlaneQuaternion(orbit.referencePole, frame)
  } else if (orbit.referencePlane !== 'ecliptic') {
    throw new Error(`orbit elements need a referencePole or the ecliptic: ${orbit.referencePlane}`)
  }
  const a = scalarOf(orbit.semiMajorAxis)
  const el = {
    epoch: orbit.epoch, a, aRate: 0, e: orbit.eccentricity, eRate: 0,
    i: orbit.inclination, iRate: 0, node: orbit.longitudeOfAscendingNode, frame,
  }
  const rates = orbit.ratesPerCentury
  if (rates) {
    // Standish's form: ϖ and L, and linear rates per century.
    const perDay = (k) => (rates[k] || 0) / DAYS_PER_CENTURY
    el.aRate = perDay('semiMajorAxisAu') * ASTRO_UNIT_METER
    el.eRate = perDay('eccentricity')
    el.iRate = perDay('inclination')
    el.nodeRate = perDay('longitudeOfAscendingNode')
    const periRate = perDay('longitudeOfPericenter')
    el.w = orbit.longitudeOfPericenter - orbit.longitudeOfAscendingNode
    el.wRate = periRate - el.nodeRate
    el.m = orbit.meanLongitude - orbit.longitudeOfPericenter
    el.mRate = perDay('meanLongitude') - periRate
  } else {
    el.nodeRate = rateOfPeriod(orbit.nodalPeriod)
    el.w = orbit.argumentOfPericenter
    el.wRate = rateOfPeriod(orbit.apsidalPeriod)
    el.m = orbit.meanAnomaly
    const n = FULL_TURN_DEG / orbit.period
    if (orbit.periodOf === 'meanLongitude') {
      el.mRate = n - el.wRate - el.nodeRate
    } else if (orbit.periodOf === 'meanAnomaly') {
      el.mRate = n
    } else {
      throw new Error(`orbit.periodOf must be meanAnomaly or meanLongitude: ${orbit.periodOf}`)
    }
  }
  return el
}


/**
 * Eccentric anomaly E from the mean anomaly M (Kepler's equation,
 * M = E - e sin E), by Newton's method.
 *
 * @param {number} m radians
 * @param {number} e < 1
 * @returns {number} radians
 */
export function eccentricAnomaly(m, e) {
  let E = e < 0.8 ? m : Math.PI
  for (let k = 0; k < KEPLER_ITERATIONS; k++) {
    const dE = (E - (e * Math.sin(E)) - m) / (1 - (e * Math.cos(E)))
    E -= dE
    if (Math.abs(dE) < KEPLER_TOLERANCE) {
      break
    }
  }
  return E
}


/**
 * The orbit at a date, in the ecliptic of J2000 (scene axes): the rotation
 * that takes the flat orbit ellipse Planet.newOrbit draws (major axis along
 * +X toward pericentre, in the XZ plane, motion from +X toward -Z) onto the
 * orbit, and the body's position relative to its primary.
 *
 * @param {object} el meanElements()
 * @param {number} jde Julian Ephemeris Day (TT)
 * @param {Quaternion} quat set to the orbit's orientation
 * @param {Vector3} pos set to the position, metres
 * @returns {{a: number, e: number}} the semi-major axis and eccentricity then
 */
export function orbitAt(el, jde, quat, pos) {
  const dt = jde - el.epoch
  const a = el.a + (el.aRate * dt)
  const e = el.e + (el.eRate * dt)
  quat.copy(el.frame)
  quat.multiply(tmpQuat.setFromAxisAngle(Y_AXIS, (el.node + (el.nodeRate * dt)) * toRad))
  quat.multiply(tmpQuat.setFromAxisAngle(X_AXIS, (el.i + (el.iRate * dt)) * toRad))
  quat.multiply(tmpQuat.setFromAxisAngle(Y_AXIS, (el.w + (el.wRate * dt)) * toRad))
  const m = (((el.m + (el.mRate * dt)) % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG
  const E = eccentricAnomaly(m * toRad, e)
  // Perifocal (x toward pericentre, y 90° ahead) → scene axes (x, 0, -y).
  pos.set(a * (Math.cos(E) - e), 0, -a * Math.sqrt(1 - (e * e)) * Math.sin(E)).applyQuaternion(quat)
  return {a, e}
}
