import {Quaternion, Vector3} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {J2000_JD} from './celestialFrame.js'
import {LUNAR_ORBIT_INCLINATION_DEG, moonArguments} from './lunarTheory.js'
import {eccentricAnomaly, elementsAt, meanElements} from './meanElements.js'
import {osculatingEllipse} from './orbitPath.js'
import {planetElements} from './planetsApprox.js'


// A body's six orbital elements at a date, as the info panel lists them and
// the orbit diagram draws them (orbitDiagram.js; DESIGN.md "Orbital
// elements").
//
// The planets and the Moon get theirs osculating (elementsFromState): the
// two-body ellipse through the body's place and velocity of the moment, as
// its ephemeris gives them (Animation.orbitElements), so the diagram meets
// the body at any zoom.  Their mean elements miss it: the Moon's by up to
// ~12,000 km and 2° (the Sun's pull: evection, variation), Earth's ~10,000
// km, Jupiter's ~460,000 km.  The mean elements (elementsOfDate) are the
// rest's, and the planets' and the Moon's before a frame has run:
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
const RAD_DEG = 180 / Math.PI
const Y_AXIS = new Vector3(0, 1, 0)
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
 * Each element's short code, for the link's `orbits:` token (design/URLs.md)
 * and the scene's state: ϖ and ω are both `peri`, L and M both `at`, read
 * as whichever the body lists (elementForm).
 */
export const ELEMENT_CODES = {
  semiMajorAxis: 'a',
  eccentricity: 'e',
  inclination: 'i',
  longitudeOfAscendingNode: 'node',
  longitudeOfPericenter: 'peri',
  argumentOfPericenter: 'peri',
  meanLongitude: 'at',
  meanAnomaly: 'at',
}

/** The codes, in the order the elements are listed. */
export const CODES = ['a', 'e', 'i', 'node', 'peri', 'at']


/**
 * Which of ϖ or ω, L or M a body's elements give: the moons with a
 * reference pole give ω and M (JPL's satellite elements), the rest ϖ and L.
 *
 * @param {object} orbit its `orbit` block
 * @returns {{pericentreKey: string, placeKey: string}}
 */
export function elementForm(orbit) {
  const satellite = Boolean(orbit?.referencePole)
  return {
    pericentreKey: satellite ? 'argumentOfPericenter' : 'longitudeOfPericenter',
    placeKey: satellite ? 'meanAnomaly' : 'meanLongitude',
  }
}


/**
 * @param {string} code an ELEMENT_CODES value
 * @param {object} orbit the body's `orbit` block
 * @returns {?string} its ORBIT_ELEMENTS key for this body, or null
 */
export function keyOfCode(code, orbit) {
  const form = elementForm(orbit)
  switch (code) {
    case 'a': return 'semiMajorAxis'
    case 'e': return 'eccentricity'
    case 'i': return 'inclination'
    case 'node': return 'longitudeOfAscendingNode'
    case 'peri': return form.pericentreKey
    case 'at': return form.placeKey
    default: return null
  }
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
 *     date), plane ('ecliptic', 'eclipticOfDate', 'Laplace' or 'equator'),
 *     kind ('mean', or 'osculating' from elementsFromState), pericentreKey, placeKey (which of ϖ or ω, L or M the
 *     source gives)}; null with no orbit
 */
export function elementsOfDate(name, orbit, jde) {
  if (!orbit || orbit.eccentricity === undefined) {
    return null
  }
  let el
  let frame = IDENTITY
  let plane = 'ecliptic'
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
  return finish(el, orbit, {frame, ofDate, plane, kind: 'mean'})
}


/**
 * The elements of the two-body ellipse through a place with a velocity:
 * osculating elements.  In the scene's axes of date (the ecliptic and
 * equinox of date, as VSOP87C and the lunar theory give them), so `frame`
 * is the identity and `ofDate` true.
 *
 * @param {string} name the body's
 * @param {object} orbit its `orbit` block, for which of ϖ or ω it lists
 * @param {Vector3} r position relative to the primary, metres, scene axes
 * @param {Vector3} v velocity, metres per day
 * @param {number} mu G(M + m), m³/day²
 * @returns {object|null} as elementsOfDate's, or null where r and v make no
 *     ellipse
 */
export function elementsFromState(name, orbit, r, v, mu) {
  const osc = osculatingEllipse(r.clone(), v.clone(), mu)
  if (!osc) {
    return null
  }
  // The orbit's pole (prograde: +X toward -Z is about +Y), its ascending
  // node on the reference plane (XZ), and pericentre's angle from it.
  const pole = new Vector3().crossVectors(osc.p, osc.q)
  const i = Math.acos(Math.min(1, Math.max(-1, pole.y))) * RAD_DEG
  let node = new Vector3().crossVectors(Y_AXIS, pole)
  if (node.lengthSq() < 1e-24) {
    node = new Vector3(1, 0, 0)
  }
  node.normalize()
  const ahead = new Vector3().crossVectors(pole, node)
  const nodeDeg = Math.atan2(-node.z, node.x) * RAD_DEG
  const w = Math.atan2(osc.p.dot(ahead), osc.p.dot(node)) * RAD_DEG
  return finish({a: osc.a, e: osc.e, i, node: nodeDeg, w, m: osc.m0 * RAD_DEG}, orbit, {
    frame: IDENTITY, ofDate: true, plane: 'eclipticOfDate', kind: 'osculating',
  })
}


/**
 * The rest of an element set: angles in [0, 360), ϖ, L and ν, and which of
 * each pair the body lists.
 *
 * @param {object} el {a, e, i, node, w, m}, degrees
 * @param {object} orbit
 * @param {object} extra {frame, ofDate, plane, kind}
 * @returns {object}
 */
function finish(el, orbit, extra) {
  if (el.i < 0) {
    // Standish's Earth crosses zero inclination: the same plane, its node
    // the other way (ϖ is unchanged).
    el = {...el, i: -el.i, node: el.node + 180, w: el.w - 180}
  }
  const e = el.e
  const m = norm360(el.m)
  const E = eccentricAnomaly(m * Math.PI / 180, e)
  const nu = norm360(2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)) *
    RAD_DEG)
  return {
    a: el.a, e, i: el.i, node: norm360(el.node), w: norm360(el.w), m, nu,
    peri: norm360(el.node + el.w), meanLongitude: norm360(el.node + el.w + m),
    ...extra,
    ...elementForm(orbit),
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
