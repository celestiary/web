import {Quaternion, Vector3} from 'three'
import {moonEcliptic} from '../lunarTheory.js'
import {J2000_JD, precessionQuaternion, ttMinusUtcSeconds} from '../celestialFrame.js'


// The app's own series, as a craft's ephemeris reads them (ephemeris.js;
// Craft.md): the Moon from the lunar theory, the UTC VSOP87C is fed, and
// Horizons' frame to the app's.  Apart from ephemeris.js, and handed to it
// (`appBodies`), because these import modules the first load holds:
// imported from flights.js's side, they split out a chunk of their own,
// one more request for the homepage.

const SECONDS_PER_DAY = 86400
const METERS_PER_KM = 1000
const DEG = Math.PI / 180


/**
 * The Moon's place from the Earth's centre: the lunar theory's longitude,
 * latitude and distance (TT), in ecliptic axes.
 *
 * @param {number} jde
 * @param {Array<number>} [out]
 * @returns {Array<number>} metres
 */
export function moonGeocentric(jde, out = [0, 0, 0]) {
  const {lambda, beta, distanceKm} = moonEcliptic(jde)
  const r = distanceKm * METERS_PER_KM
  const cb = Math.cos(beta * DEG)
  out[0] = r * cb * Math.cos(lambda * DEG)
  out[1] = r * cb * Math.sin(lambda * DEG)
  out[2] = r * Math.sin(beta * DEG)
  return out
}


/**
 * @param {number} jde TT
 * @returns {number} the UTC Julian Day, as the app feeds VSOP87C
 *     (Animation.setDate)
 */
export function ttToUtc(jde) {
  return jde - (ttMinusUtcSeconds(jde) / SECONDS_PER_DAY)
}


/**
 * The bodies' places a craft's ephemeris is built on (ephemeris.js
 * geocentricTracks, heliocentricTracks).
 *
 * @param {?function(number): object} vsop VSOP87C's function, of the UTC
 *     Julian Day, in AU, or its stand-in's; null for the Moon alone
 * @returns {{vsop: ?function(number): object, moon: function(number, Array<number>): Array<number>,
 *     ttToUtc: function(number): number}}
 */
export function appBodies(vsop) {
  return {vsop, moon: moonGeocentric, ttToUtc}
}


const tmpQ = new Quaternion
const tmpV = new Vector3


/**
 * A vector in the ecliptic and equinox of J2000 (JPL Horizons'), in the
 * ecliptic of date: turned by the precession (celestialFrame.js), whose
 * quaternion is in the scene's axes, (x, z, −y).
 *
 * @param {Array<number>} v
 * @param {number} jde
 * @param {Array<number>} [out]
 * @returns {Array<number>}
 */
export function j2000ToDate(v, jde, out = [0, 0, 0]) {
  precessionQuaternion(J2000_JD, jde, tmpQ)
  tmpV.set(v[0], v[2], -v[1]).applyQuaternion(tmpQ)
  out[0] = tmpV.x
  out[1] = -tmpV.z
  out[2] = tmpV.y
  return out
}
