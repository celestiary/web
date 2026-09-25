import {Matrix4, Vector3} from 'three'


/**
 * Frame conversions between celestiary's planet body frame and Cesium's
 * Earth-centred, Earth-fixed (ECEF) frame.  See CESIUM.md.
 *
 * Celestiary body frame (coords.js): +Y north pole, +X prime meridian,
 * east longitude winds toward −Z.  Cesium ECEF: +Z north pole, +X prime
 * meridian, +Y 90°E.  So ecef = (x, −z, y): a proper rotation (det +1),
 * handedness preserved.  Both frames are in metres.
 *
 * The same mapping serves the Moon and Mars: Cesium's Moon and Mars frames
 * use the same axis conventions on their own ellipsoids.
 */


/**
 * @param {Vector3} v Body-frame vector
 * @returns {Array<number>} ECEF [x, y, z]
 */
export function bodyToEcef(v) {
  return [v.x, -v.z, v.y]
}


/**
 * @param {Array<number>} e ECEF [x, y, z]
 * @returns {Vector3} Body-frame vector
 */
export function ecefToBody(e) {
  return new Vector3(e[0], e[2], -e[1])
}


const _inv = new Matrix4()
const _pos = new Vector3()
const _dir = new Vector3()
const _up = new Vector3()


/**
 * The camera's view expressed in the body's ECEF frame, for Cesium's
 * `camera.setView`.  `bodyWorld` is the rotating planet node's world matrix
 * (axial tilt and sidereal rotation included, no scale).  Computed in JS
 * doubles, so heliocentric world coordinates (~1e11 m) lose nothing.
 *
 * @param {Matrix4} cameraWorld Camera matrixWorld
 * @param {Matrix4} bodyWorld Planet node matrixWorld
 * @returns {{position: Array<number>, direction: Array<number>, up: Array<number>}}
 */
export function cameraToEcefView(cameraWorld, bodyWorld) {
  _inv.copy(bodyWorld).invert()
  _pos.setFromMatrixPosition(cameraWorld).applyMatrix4(_inv)
  // A camera looks down its local −Z; its up is local +Y.
  _dir.set(0, 0, -1).transformDirection(cameraWorld).transformDirection(_inv)
  _up.set(0, 1, 0).transformDirection(cameraWorld).transformDirection(_inv)
  return {
    position: bodyToEcef(_pos),
    direction: bodyToEcef(_dir),
    up: bodyToEcef(_up),
  }
}


/**
 * Direction sunlight travels (from the Sun toward the body), in the body's
 * ECEF frame — what Cesium's `DirectionalLight` wants.
 *
 * @param {Matrix4} bodyWorld Planet node matrixWorld
 * @param {Vector3} sunWorldPos Sun world position
 * @returns {Array<number>} Unit ECEF direction
 */
export function sunLightDirectionEcef(bodyWorld, sunWorldPos) {
  _pos.setFromMatrixPosition(bodyWorld)
  _dir.copy(_pos).sub(sunWorldPos).normalize()
  _inv.copy(bodyWorld).invert()
  _dir.transformDirection(_inv)
  return bodyToEcef(_dir)
}


/**
 * Cesium's `PerspectiveFrustum.fov` spans the wider canvas dimension;
 * celestiary's (three's) `fov` is vertical.
 *
 * @param {number} fovyRad Vertical field of view, radians
 * @param {number} aspect Width / height
 * @returns {number} Cesium fov, radians
 */
export function cesiumFov(fovyRad, aspect) {
  return aspect > 1 ? 2 * Math.atan(Math.tan(fovyRad / 2) * aspect) : fovyRad
}
