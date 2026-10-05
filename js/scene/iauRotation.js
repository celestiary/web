import {Quaternion, Vector3} from 'three'
import {toRad} from '../shared.js'
import {J2000_JD} from './celestialFrame.js'
import {icrfToScene, referencePlaneQuaternion} from './meanElements.js'
import table from './iauRotation.json'


// The IAU WGCCRE rotation models (#96): each body's north pole (right
// ascension α0 and declination δ0 in ICRF) and prime meridian W (the angle
// along the body's equator, eastward, from its ascending node on the ICRF
// equator to longitude 0), as functions of time, with the periodic terms
// where the report gives them (Mars and its moons, Jupiter's, Saturn's,
// Uranus's and Neptune's moons, Neptune, the Moon, Mercury's librations).
//
// The values are in iauRotation.json, generated from NAIF's pck00011.tpc
// (the 2015 report, Archinal et al. 2018) by tools/iau/pckRotation.mjs; its
// `source` and each body's say where they're from.  The report's time
// argument is TDB; TT is within 2 ms of it, so the scene's TT stands in.
//
// The body frame is celestiary's (coords.js): +Y the north pole, +X the
// prime meridian, east longitude toward -Z.  In the report's terms the
// rotation from it to ICRF is Rz(α0 + 90°)·Rx(90° - δ0)·Rz(W), which
// meanElements.referencePlaneQuaternion gives for the first two, in the
// scene's axes (ecliptic of J2000), and a rotation about scene Y for W.
//
// For the IAU's retrograde rotators (Venus, Uranus, Triton) W decreases;
// for Pluto and Charon the pole is the one about which they turn
// prograde (the 2009 report's convention for dwarf planets), south of the
// ecliptic.  The same formula serves all of them.


const DAYS_PER_CENTURY = 36525
const DAYS_PER_YEAR = 365.25
const FULL_TURN_DEG = 360
const Y_AXIS = new Vector3(0, 1, 0)
const tmpQ = new Quaternion


/**
 * @param {string} name a body's name, as in its JSON
 * @returns {object|null} the body's model from iauRotation.json, with its
 *     system's angles attached, or null if the report gives none
 *     (Hyperion, whose rotation is chaotic; the Sun isn't animated)
 */
export function rotationModel(name) {
  const body = table.bodies[name]
  if (!body) {
    return null
  }
  return {name, ...body, angles: body.system ? table.systems[body.system] : null}
}


/**
 * @param {Array<number>} p [c0, c1, c2]
 * @param {number} t
 * @returns {number} c0 + c1·t + c2·t²
 */
function poly(p, t) {
  return p[0] + (p[1] * t) + (p[2] * t * t)
}


/**
 * @param {Array<Array<number>>|undefined} terms [coefficient, angle index]
 * @param {Array<number>} theta the system's angles, radians
 * @param {Function} fn Math.sin or Math.cos
 * @returns {number}
 */
function periodic(terms, theta, fn) {
  let sum = 0
  if (terms) {
    for (const [c, i] of terms) {
      sum += c * fn(theta[i])
    }
  }
  return sum
}


/**
 * A body's pole and prime meridian at a date.
 *
 * @param {object} model from rotationModel
 * @param {number} jde Julian Ephemeris Day (TT, for TDB)
 * @param {object} [target]
 * @returns {{ra: number, dec: number, w: number}} degrees; w in [0, 360)
 */
export function poleAndMeridian(model, jde, target = {}) {
  const d = jde - J2000_JD
  const T = d / DAYS_PER_CENTURY
  let theta = null
  if (model.angles) {
    theta = model._theta || (model._theta = new Array(model.angles.length))
    for (let i = 0; i < model.angles.length; i++) {
      theta[i] = poly(model.angles[i], T) * toRad
    }
  }
  target.ra = poly(model.ra, T) + periodic(model.raTerms, theta, Math.sin)
  target.dec = poly(model.dec, T) + periodic(model.decTerms, theta, Math.cos)
  // W grows by up to ~10⁶° a century (Phobos); reduce the linear part
  // before adding, to keep the angle's precision.
  const w = ((model.w[1] * d) % FULL_TURN_DEG) + model.w[0] + (model.w[2] * d * d) +
    periodic(model.wTerms, theta, Math.sin)
  target.w = ((w % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG
  return target
}


/**
 * The rotation that takes the body frame to the plane of the body's
 * equator at its node: Rz(α0 + 90°)·Rx(90° - δ0), in the scene's axes, in
 * the ecliptic of J2000.  The pole is its +Y, and its +X the ascending
 * node of the equator on the ICRF equator, from which W is measured.
 *
 * @param {{ra: number, dec: number}} pm from poleAndMeridian
 * @param {Quaternion} [target]
 * @returns {Quaternion}
 */
export function equatorQuaternion(pm, target = new Quaternion) {
  return referencePlaneQuaternion(pm, target)
}


/**
 * A body's whole orientation: the rotation from its body frame to the
 * ecliptic of J2000, in the scene's axes.  Premultiply the J2000 → date
 * precession for the scene's frame.
 *
 * @param {object} model from rotationModel
 * @param {number} jde Julian Ephemeris Day (TT)
 * @param {Quaternion} [target]
 * @returns {Quaternion}
 */
export function bodyQuaternion(model, jde, target = new Quaternion) {
  const pm = poleAndMeridian(model, jde)
  equatorQuaternion(pm, target)
  return target.multiply(tmpQ.setFromAxisAngle(Y_AXIS, pm.w * toRad))
}


/**
 * The planetocentric longitude and latitude, in a body's frame, of a
 * direction from its centre.
 *
 * @param {Quaternion} bodyQuat body frame → the direction's frame
 * @param {Vector3} dir from the body's centre, in that frame
 * @returns {{lng: number, lat: number}} degrees, east longitude in
 *     (-180, 180]
 */
export function subPoint(bodyQuat, dir) {
  const v = dir.clone().normalize().applyQuaternion(tmpQ.copy(bodyQuat).invert())
  return {
    lng: Math.atan2(-v.z, v.x) / toRad,
    lat: Math.asin(Math.max(-1, Math.min(1, v.y))) / toRad,
  }
}


/**
 * A body's north pole at a date, as a unit vector in the ecliptic of J2000,
 * in the scene's axes.
 *
 * @param {object} model from rotationModel
 * @param {number} jde Julian Ephemeris Day (TT)
 * @param {Vector3} [target]
 * @returns {Vector3}
 */
export function poleVector(model, jde, target = new Vector3) {
  const pm = poleAndMeridian(model, jde)
  return icrfToScene(pm.ra, pm.dec, target)
}


/**
 * How far to turn a body's surface texture east, in its body frame, for a
 * texture that follows the visible clouds rather than the IAU meridian
 * (Jupiter: `texture_rotation` in its JSON).  The clouds turn with their
 * own meridian, W_c = w[0] + w[1]·d (System II for Jupiter's), and a
 * feature drawn at `textureLongitude` in the texture (east, from its
 * centre column) is put at its observed west longitude in that system,
 * `longitude` at `epoch` plus `driftPerYear`.  A point at west longitude L
 * in a system with meridian W_s is W_s - L east of the equator's node, so
 * its east longitude in the body frame is W_s - L - W.
 *
 * @param {object} spec the JSON's texture_rotation
 * @param {number} jde Julian Ephemeris Day (TT)
 * @param {number} wDeg the body's IAU W at jde
 * @returns {number} degrees, in [0, 360)
 */
export function textureTurn(spec, jde, wDeg) {
  const d = jde - J2000_JD
  const wClouds = ((spec.w[1] * d) % FULL_TURN_DEG) + spec.w[0]
  const feature = spec.feature
  const west = feature.longitude + (feature.driftPerYear * (jde - feature.epoch) / DAYS_PER_YEAR)
  const turn = wClouds - west - wDeg - feature.textureLongitude
  return ((turn % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG
}
