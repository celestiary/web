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


/**
 * Where to put Cesium's camera for a camera at `ecef` over celestiary's
 * sphere: on the same ray from the body's centre, at the same height over
 * Cesium's ellipsoid (along that ray) as over the sphere.  So a camera 5 km
 * above celestiary's 6,371 km Earth is 5 km above Cesium's WGS84 Earth (up
 * to 7 km larger at the equator) rather than underground, and from orbit
 * the body is exactly where celestiary draws it: the radial correction
 * only changes the distance, never the direction to the body's centre.
 *
 * Handing Cesium the sphere's latitude, longitude and altitude instead
 * (Cartesian3.fromRadians) put the camera on the ellipsoid's normal, not
 * the ray: from 30,000 km over Mars at 25° S, 16 km off, about a pixel.
 *
 * @param {Array<number>} ecef Camera ECEF [x, y, z], metres
 * @param {number} radius Celestiary's sphere radius, metres
 * @param {Array<number>} radii Cesium's ellipsoid radii [x, y, z], metres
 * @returns {Array<number>} Cesium camera ECEF [x, y, z], metres
 */
export function ellipsoidCameraPosition(ecef, radius, radii) {
  const [x, y, z] = ecef
  const r = Math.hypot(x, y, z)
  const [a, b, c] = radii
  const surface = 1 / Math.hypot(x / r / a, y / r / b, z / r / c)
  const k = (surface + r - radius) / r
  return [x * k, y * k, z * k]
}


/**
 * N·L at which the night lights are gone: the upper edge of celestiary's
 * `smoothstep(-0.05, 0.05, -N·L)` terminator band (Planet.md), about 3° into
 * the day side.
 */
export const NIGHT_LIGHT_EDGE = 0.05
// A margin on the sphere's radius for the horizon: terrain and the ellipsoid
// reach a little past it, so the visible cap is a little larger.
const HORIZON_RADIUS_MARGIN = 0.99


/**
 * Whether any of the body's surface in view can be on its night side, where
 * the lights pass has something to draw: a cheap, conservative test from
 * the camera's angle to the Sun and the angle of the cap of the sphere the
 * camera can see, ignoring the frustum.  Not the pass's own coverage: the
 * pass computes each pixel's N·L.
 *
 * @param {Array<number>} cameraEcef Camera ECEF [x, y, z], metres
 * @param {Array<number>} lightDirection Unit ECEF direction sunlight travels
 *   (sunLightDirectionEcef)
 * @param {number} radius The body's sphere radius, metres
 * @returns {boolean}
 */
export function nightVisible(cameraEcef, lightDirection, radius) {
  const [x, y, z] = cameraEcef
  const r = Math.hypot(x, y, z)
  if (!(r > 0)) {
    return true
  }
  // Angle from the sub-solar point to the camera's sub-point.
  const towardSun = -((x * lightDirection[0]) + (y * lightDirection[1]) + (z * lightDirection[2])) / r
  const fromSun = Math.acos(Math.max(-1, Math.min(1, towardSun)))
  // The camera sees the sphere out to this angle from its sub-point (a
  // quarter turn from the surface).
  const sees = r > radius * HORIZON_RADIUS_MARGIN ? Math.acos(radius * HORIZON_RADIUS_MARGIN / r) : Math.PI / 2
  return fromSun + sees > Math.acos(NIGHT_LIGHT_EDGE)
}
