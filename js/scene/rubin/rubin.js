import {Matrix4, Quaternion, Vector3} from 'three'


// The NSF-DOE Vera C. Rubin Observatory on Cerro Pachón, and an alt-azimuth
// telescope's pointing at a body in the sky (Rubin.md).  Pure: the frame at
// the site, the altitude and azimuth of a direction there, the mount's
// angles for a pointing, and whether the dome is open.
//
// Nothing here imports the first load's modules (coords.js, shared.js):
// the feature is a dynamic import, and a module it shared with the entry
// would be split into a chunk of its own, a request more on the first
// load (Rubin.md, the first load).  Scene hands install.js what it needs.

const toRad = Math.PI / 180
const toDeg = 180 / Math.PI

/** The site: Rubin's own figures (lsst.org), geodetic. */
export const SITE = Object.freeze({
  name: 'Rubin Observatory',
  lat: -30.2446,
  lng: -70.7494,
  /** Metres over the ellipsoid; the terrain's height when a Cesium layer knows it. */
  alt: 2663,
})

/** The body the telescope follows, and the run that found it. */
export const TARGET = 'ed138'

/** The discovery images' span, UTC: the nights of March to July 2026. */
export const RUN_START_MS = Date.UTC(2026, 2, 1)
export const RUN_END_MS = Date.UTC(2026, 7, 1)

/**
 * The Simonyi Survey Telescope's elevation range, degrees: it doesn't
 * observe under 20° (airmass 2.9) and can't track through the zenith.
 */
export const MIN_EL_DEG = 20
export const MAX_EL_DEG = 86.5

/** The dome opens when the Sun is this far down: nautical twilight. */
export const DOME_OPENS_SUN_EL_DEG = -12

/** Parked: the telescope at the zenith. */
export const PARK_EL_DEG = 90

const tmpUp = new Vector3
const tmpEast = new Vector3
const tmpSouth = new Vector3
const tmpMatrix = new Matrix4


/**
 * The frame at a place on a body, in the body-fixed frame (coords.js: +Y
 * the pole, +X longitude 0, east toward −Z): local +X east, +Y up, +Z
 * south, so that −Z is north, as a camera looks.
 *
 * @param {number} lat Degrees
 * @param {number} lng Degrees, east-positive
 * @param {Quaternion} [target]
 * @returns {Quaternion} local → body-fixed
 */
export function localFrameQuaternion(lat, lng, target = new Quaternion) {
  // The radial, as coords.js latLngAltToBodyFixed has it (rubin.test.js
  // holds them equal).
  const latRad = lat * toRad
  const lngRad = lng * toRad
  tmpUp.set(Math.cos(latRad) * Math.cos(lngRad), Math.sin(latRad), -Math.cos(latRad) * Math.sin(lngRad))
  tmpEast.set(-Math.sin(lngRad), 0, -Math.cos(lngRad))
  // north = up × east; south is its negative.
  tmpSouth.crossVectors(tmpUp, tmpEast).negate()
  tmpMatrix.makeBasis(tmpEast, tmpUp, tmpSouth)
  return target.setFromRotationMatrix(tmpMatrix)
}


/**
 * @param {Vector3} dir In the local frame (localFrameQuaternion); any length
 * @returns {{el: number, az: number}} Degrees: the altitude over the
 *   horizon, and the azimuth from north through east, [0, 360)
 */
export function altAz(dir) {
  const r = dir.length()
  if (!(r > 0)) {
    return {el: 0, az: 0}
  }
  const el = Math.asin(Math.max(-1, Math.min(1, dir.y / r))) * toDeg
  // `|| 0` keeps −0 out of atan2, which would read the zenith as south.
  const az = ((Math.atan2(dir.x || 0, -dir.z || 0) * toDeg) + 360) % 360
  return {el, az}
}


/**
 * Whether the telescope can hold a pointing: the body up, within the
 * mount's range, by night.
 *
 * @param {number} el The body's altitude, degrees
 * @param {number} sunEl The Sun's altitude, degrees
 * @returns {boolean}
 */
export function canObserve(el, sunEl) {
  return el >= MIN_EL_DEG && sunEl <= DOME_OPENS_SUN_EL_DEG
}


/**
 * The mount's angles for a pointing, as the model turns (rubinModel.js):
 * the azimuth group about +Y, the elevation group about its +X, with the
 * tube along +Y at the park, tilting toward north (−Z) at azimuth 0.
 *
 * @param {number} el Degrees
 * @param {number} az Degrees
 * @returns {{azimuthY: number, elevationX: number}} Radians
 */
export function mountAngles(el, az) {
  const held = Math.min(Math.max(el, MIN_EL_DEG), MAX_EL_DEG)
  return {azimuthY: -az * toRad, elevationX: -(90 - held) * toRad}
}


/**
 * The telescope's state for a frame: following the body, or parked with
 * the dome shut.
 *
 * @param {Vector3} toBody The body's direction in the local frame
 * @param {Vector3} toSun The Sun's
 * @returns {{tracking: boolean, open: boolean, el: number, az: number, sunEl: number, sunAz: number, bodyEl: number,
 *   azimuthY: number, elevationX: number}}
 */
export function pointingState(toBody, toSun) {
  const body = altAz(toBody)
  const {el: sunEl, az: sunAz} = altAz(toSun)
  const tracking = canObserve(body.el, sunEl)
  if (!tracking) {
    return {tracking, open: false, el: PARK_EL_DEG, az: 0, sunEl, sunAz, bodyEl: body.el, azimuthY: 0, elevationX: 0}
  }
  return {tracking, open: true, el: body.el, az: body.az, sunEl, sunAz, bodyEl: body.el, ...mountAngles(body.el, body.az)}
}
