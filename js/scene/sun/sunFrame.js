import {Quaternion, Vector3} from 'three'
import {J2000_JD, precessionQuaternion} from '../celestialFrame.js'
import {equatorQuaternion, poleAndMeridian} from '../iauRotation.js'


/**
 * The Sun's own frame (js/scene/Sun.md): its rotation axis and prime
 * meridian by the IAU WGCCRE model (Archinal et al. 2018): α0 = 286.13°,
 * δ0 = 63.87° (J2000; 7.25° from the ecliptic's pole), W = 84.176° +
 * 14.1844° d, d days from J2000 TDB.  W is the Carrington longitude's
 * meridian, so the body frame this gives is the Carrington frame, the one
 * the active regions' longitudes are in (activeRegions.js).
 */
export const SUN_IAU = Object.freeze({
  name: 'sun',
  ra: Object.freeze([286.13, 0, 0]),
  dec: Object.freeze([63.87, 0, 0]),
  w: Object.freeze([84.176, 14.1844, 0]),
  angles: null,
})


const Y_AXIS = new Vector3(0, 1, 0)
const DEG = Math.PI / 180
const tmpQ = new Quaternion
const precession = new Quaternion
const pm = {}


/**
 * The Sun's equator frame (no W: inertial, its +X the equator's ascending
 * node on the ICRF equator), in the scene's ecliptic of date.
 *
 * @param {number} jde Julian Ephemeris Day (TT)
 * @param {Quaternion} [target]
 * @returns {Quaternion}
 */
export function sunEquatorQuaternion(jde, target = new Quaternion) {
  poleAndMeridian(SUN_IAU, jde, pm)
  equatorQuaternion(pm, target)
  return target.premultiply(precessionQuaternion(J2000_JD, jde, precession))
}


/**
 * The Carrington frame: the equator frame turned by W.
 *
 * @param {number} jde Julian Ephemeris Day (TT)
 * @param {Quaternion} [target]
 * @returns {Quaternion}
 */
export function sunBodyQuaternion(jde, target = new Quaternion) {
  sunEquatorQuaternion(jde, target)
  return target.multiply(tmpQ.setFromAxisAngle(Y_AXIS, sunMeridianDeg(jde) * DEG))
}


/**
 * @param {number} jde
 * @returns {number} W, degrees in [0, 360)
 */
export function sunMeridianDeg(jde) {
  return poleAndMeridian(SUN_IAU, jde, pm).w
}
