import {Quaternion} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {J2000_JD} from './celestialFrame.js'
import {LUNAR_ORBIT_INCLINATION_DEG, moonArguments} from './lunarTheory.js'
import {eccentricAnomaly, elementsAt, meanElements} from './meanElements.js'
import {planetElements} from './planetsApprox.js'


// A body's six orbital elements at a date, as the info panel lists them and
// the orbit diagram draws them (orbitDiagram.js; DESIGN.md "Orbital
// elements").  Each body gets them from what places it, where it can:
//
// - the planets: Standish's elements and rates (planetsApprox.js), the
//   stand-in before VSOP87C loads and within a few arcminutes of it;
// - the Moon: the mean node, perigee and longitude of date (Meeus 47,
//   lunarTheory.js), whose node turns once in 18.6 years;
// - Pluto and the moons: their published mean elements (meanElements.js),
//   referred to their Laplace plane or their planet's equator;
// - anything else (the demo descriptors): its JSON's elements as at J2000,
//   with the mean longitude run on at its period.
//
// Angles in degrees, in the elements' reference plane; `frame` turns that
// plane's axes (scene axes: the plane XZ, its pole +Y, the reference
// direction +X) into the ecliptic of J2000, or, for the Moon's (`ofDate`),
// the ecliptic of date: the scene's own frame.


const FULL_TURN_DEG = 360
const SECONDS_PER_DAY = 86400
const IDENTITY = new Quaternion
const DEFAULT_MOON_ECCENTRICITY = 0.0549


/**
 * The elements' symbols, names and colours, in the order they're listed.
 * The pericentre is given as its longitude ϖ = Ω + ω or its argument ω, and
 * the body's place as its mean longitude L = ϖ + M or its mean anomaly M,
 * as the body's source gives them.
 */
export const ORBIT_ELEMENTS = {
  semiMajorAxis: {symbol: 'a', name: 'semi-major axis', color: 0xffb02e},
  eccentricity: {symbol: 'e', name: 'eccentricity', color: 0xff6ad5},
  inclination: {symbol: 'i', name: 'inclination', color: 0x4cd964},
  longitudeOfAscendingNode: {symbol: 'Ω', name: 'longitude of the ascending node', color: 0x2ec7e6},
  longitudeOfPericenter: {symbol: 'ϖ', name: 'longitude of pericentre', color: 0x8c8cff},
  argumentOfPericenter: {symbol: 'ω', name: 'argument of pericentre', color: 0x8c8cff},
  meanLongitude: {symbol: 'L', name: 'mean longitude', color: 0xff5f57},
  meanAnomaly: {symbol: 'M', name: 'mean anomaly', color: 0xff5f57},
}


/**
 * @param {number|{scalar: number}} v a number, or a reified Measure
 * @returns {number}
 */
function scalarOf(v) {
  return Number((v !== null && typeof v === 'object') ? v.scalar : v)
}


/**
 * @param {number} deg
 * @returns {number} in [0, 360)
 */
export function norm360(deg) {
  return ((deg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG
}


/**
 * A body's elements at a date.
 *
 * @param {string} name the body's, e.g. 'earth'
 * @param {object} orbit its `orbit` block, raw or reified
 * @param {number} jde Julian Ephemeris Day (TT)
 * @returns {object|null} {a (metres), e, i, node, w (argument of
 *     pericentre), m (mean anomaly), peri (ϖ), meanLongitude (L), nu (true
 *     anomaly), frame (Quaternion), ofDate (frame is to the ecliptic of
 *     date), plane ('ecliptic', 'eclipticOfDate', 'Laplace' or 'equator'), pericentreKey, placeKey (which of ϖ or ω, L or M the
 *     source gives)}; null with no orbit
 */
export function elementsOfDate(name, orbit, jde) {
  if (!orbit || orbit.eccentricity === undefined) {
    return null
  }
  let el
  let frame = IDENTITY
  let plane = 'ecliptic'
  let satellite = false
  let ofDate = false
  if (name === 'moon') {
    ofDate = true
    plane = 'eclipticOfDate'
    const args = moonArguments(jde)
    // Meeus 47's mean elements: the node and perigee of date, the orbit
    // inclined 5.145° to the ecliptic, as moonOrbitOrientation lays it.
    el = {
      a: scalarOf(orbit.semiMajorAxis), e: DEFAULT_MOON_ECCENTRICITY, i: LUNAR_ORBIT_INCLINATION_DEG,
      node: args.node, w: args.perigee - args.node, m: args.lp - args.perigee,
    }
  } else if (planetElements(name)) {
    el = elementsAt(planetElements(name), jde)
  } else {
    const mean = meanElements(orbit)
    if (mean) {
      el = elementsAt(mean, jde)
      frame = mean.frame
      if (orbit.referencePole) {
        plane = orbit.referencePlane === 'Laplace' ? 'Laplace' : 'equator'
        satellite = true
      }
    } else {
      // The JSON's elements, as at J2000, the body run on at its period.
      const periodDays = scalarOf(orbit.siderealOrbitPeriod) / SECONDS_PER_DAY
      const n = periodDays > 0 ? FULL_TURN_DEG / periodDays : 0
      el = {
        a: scalarOf(orbit.semiMajorAxis), e: orbit.eccentricity, i: orbit.inclination,
        node: orbit.longitudeOfAscendingNode,
        w: orbit.longitudeOfPericenter - orbit.longitudeOfAscendingNode,
        m: orbit.meanLongitude - orbit.longitudeOfPericenter + (n * (jde - J2000_JD)),
      }
    }
  }
  if (el.i < 0) {
    // Standish's Earth crosses zero inclination: the same plane, its node
    // the other way (ϖ is unchanged).
    el = {...el, i: -el.i, node: el.node + 180, w: el.w - 180}
  }
  const e = el.e
  const m = norm360(el.m)
  const E = eccentricAnomaly(m * Math.PI / 180, e)
  const nu = norm360(2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)) *
    180 / Math.PI)
  return {
    a: el.a, e, i: el.i, node: norm360(el.node), w: norm360(el.w), m, nu,
    peri: norm360(el.node + el.w), meanLongitude: norm360(el.node + el.w + m),
    frame, ofDate, plane,
    pericentreKey: satellite ? 'argumentOfPericenter' : 'longitudeOfPericenter',
    placeKey: satellite ? 'meanAnomaly' : 'meanLongitude',
  }
}


/**
 * The six elements to list, in order, with their values formatted.
 *
 * @param {object} el elementsOfDate()
 * @returns {Array<{key: string, symbol: string, name: string, color: number, value: string}>}
 */
export function elementRows(el) {
  const deg = (v) => `${v.toFixed(3)}°`
  const values = {
    semiMajorAxis: formatDistance(el.a),
    eccentricity: el.e.toFixed(5),
    inclination: deg(el.i),
    longitudeOfAscendingNode: deg(el.node),
    longitudeOfPericenter: deg(el.peri),
    argumentOfPericenter: deg(el.w),
    meanLongitude: deg(el.meanLongitude),
    meanAnomaly: deg(el.m),
  }
  const keys = ['semiMajorAxis', 'eccentricity', 'inclination', 'longitudeOfAscendingNode',
    el.pericentreKey, el.placeKey]
  return keys.map((key) => ({key, ...ORBIT_ELEMENTS[key], value: values[key]}))
}


/**
 * @param {number} m metres
 * @returns {string} in AU from a tenth of one, else in km
 */
export function formatDistance(m) {
  const au = m / ASTRO_UNIT_METER
  if (au >= 0.1) {
    return `${au.toFixed(4)} AU`
  }
  return `${Math.round(m / 1000).toLocaleString('en-US')} km`
}
