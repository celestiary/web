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


/**
 * Whether any pixel of the night lights' pass can be on the night side:
 * `nightVisible`, narrowed to the camera's frustum.  The pass computes each
 * pixel's normal from its view ray against the body's sphere (the first hit,
 * or for a ray that misses, the point where it passes nearest), and draws
 * where N·S is under NIGHT_LIGHT_EDGE (S toward the Sun).  That normal
 * depends on the ray's angle β off the nadir (straight down, toward the
 * body's centre) and its azimuth φ about the nadir: it lies at an angle γ(β)
 * from the camera's sub-point, at the same azimuth.  So the frustum's rays,
 * bounded by their range of β and of φ, put every normal the pass can
 * compute in a box of γ and φ, and the box's least N·S is a lower bound on
 * the pass's.  Conservative: never false where the pass would draw a light.
 *
 * Rays past `coverRadius` (Cesium's stencil shell: the terrain's top) hold
 * none of Cesium's pixels, and the pass discards them.  A camera inside the
 * sphere (under the datum) falls back to nightVisible.
 *
 * @param {{position: Array<number>, direction: Array<number>, up: Array<number>}} view
 *   The camera in the body's ECEF frame (cameraToEcefView)
 * @param {number} fovyRad Vertical field of view, radians
 * @param {number} aspect Width / height
 * @param {Array<number>} lightDirection Unit ECEF direction sunlight travels
 * @param {number} radius The sphere the pass computes its normals on, metres
 * @param {number} coverRadius The farthest from the centre Cesium draws, metres
 * @returns {boolean}
 */
export function nightInView(view, fovyRad, aspect, lightDirection, radius, coverRadius) {
  const {position} = view
  const d = Math.hypot(...position)
  if (!(d > radius)) {
    return nightVisible(position, lightDirection, radius)
  }
  const zenith = scale(position, 1 / d)
  const nadir = scale(zenith, -1)
  const frustum = frustumCorners(view, fovyRad, aspect)
  const minNadir = angleToCone(nadir, frustum)
  const maxNadir = Math.PI - angleToCone(zenith, frustum)
  const cover = coverRadius >= d ? Math.PI : Math.asin(coverRadius / d)
  if (minNadir > cover) {
    return false
  }
  const b1 = minNadir
  const b2 = Math.min(maxNadir, cover)
  // γ(β): rises to the horizon's angle at the tangent ray, then falls back
  // (a missed ray's nearest point), to 0 for a ray at or over the horizontal.
  const gamma = (beta) => {
    if (beta >= Math.PI / 2) {
      return 0
    }
    const s = d * Math.sin(beta) / radius
    return s < 1 ? Math.asin(s) - beta : (Math.PI / 2) - beta
  }
  const tangent = Math.asin(radius / d)
  const gLo = Math.min(gamma(b1), gamma(b2))
  const gHi = b1 <= tangent && tangent <= b2 ? Math.acos(radius / d) : Math.max(gamma(b1), gamma(b2))
  // The Sun's angle from the sub-point, and its azimuth's: the least
  // cos(φ − φS) over the frustum's azimuths.
  const sun = scale(lightDirection, -1)
  const cosSigma = clamp(dot(sun, zenith))
  const sinSigma = Math.sqrt(1 - (cosSigma * cosSigma))
  const cosAzimuth = minCosAzimuth(zenith, sun, frustum, b1 === 0 || maxNadir === Math.PI)
  // N·S over γ at that azimuth: A·cos(γ − δ).
  const a = Math.hypot(cosSigma, sinSigma * cosAzimuth)
  const delta = Math.atan2(sinSigma * cosAzimuth, cosSigma)
  let least = Math.min(a * Math.cos(gLo - delta), a * Math.cos(gHi - delta))
  for (const g of [delta + Math.PI, delta - Math.PI]) {
    if (g >= gLo && g <= gHi) {
      least = -a
    }
  }
  return least < NIGHT_LIGHT_EDGE
}


/**
 * @param {{position: Array<number>, direction: Array<number>, up: Array<number>}} view
 * @param {number} fovyRad
 * @param {number} aspect
 * @returns {{axis: Array<number>, right: Array<number>, up: Array<number>, tx: number, ty: number,
 *   corners: Array<Array<number>>}} The frustum's axes, half-extents (tangents) and its corner
 *   rays, unit, in order round it
 */
function frustumCorners({direction, up}, fovyRad, aspect) {
  const axis = normalize(direction)
  const upO = normalize(sub(up, scale(axis, dot(up, axis))))
  const right = cross(axis, upO)
  const ty = Math.tan(fovyRad / 2)
  const tx = ty * aspect
  const corner = (sx, sy) => normalize(add(axis, add(scale(right, sx * tx), scale(upO, sy * ty))))
  return {axis, right, up: upO, tx, ty, corners: [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)]}
}


/**
 * @param {Array<number>} p Unit direction
 * @param {object} f frustumCorners
 * @returns {number} The least angle from p to a ray in the frustum: 0 inside
 */
function angleToCone(p, f) {
  const z = dot(p, f.axis)
  if (z > 0 && Math.abs(dot(p, f.right)) <= f.tx * z && Math.abs(dot(p, f.up)) <= f.ty * z) {
    return 0
  }
  let least = Math.PI
  for (let i = 0; i < 4; i++) {
    least = Math.min(least, angleToArc(p, f.corners[i], f.corners[(i + 1) % 4]))
  }
  return least
}


/**
 * @param {Array<number>} p Unit direction
 * @param {Array<number>} u Unit direction, the arc's start
 * @param {Array<number>} v Unit direction, its end, under a half turn from u
 * @returns {number} The least angle from p to the great-circle arc from u to v
 */
export function angleToArc(p, u, v) {
  const n = normalize(cross(u, v))
  const pn = dot(p, n)
  const q = sub(p, scale(n, pn))
  const qLength = Math.hypot(...q)
  if (qLength > 1e-12) {
    const qh = scale(q, 1 / qLength)
    if (dot(cross(u, qh), n) >= 0 && dot(cross(qh, v), n) >= 0) {
      return Math.atan2(Math.abs(pn), qLength)
    }
  }
  return Math.min(Math.acos(clamp(dot(p, u))), Math.acos(clamp(dot(p, v))))
}


/**
 * @param {Array<number>} zenith Unit: the camera's sub-point
 * @param {Array<number>} sun Unit, toward the Sun
 * @param {object} f frustumCorners
 * @param {boolean} allRound The frustum holds the nadir or the zenith, so
 *   every azimuth
 * @returns {number} The least cos(φ − φS) over the frustum's azimuths about
 *   the zenith
 */
function minCosAzimuth(zenith, sun, f, allRound) {
  const e1 = normalize(Math.abs(zenith[0]) < 0.9 ? cross(zenith, [1, 0, 0]) : cross(zenith, [0, 1, 0]))
  const e2 = cross(zenith, e1)
  const azimuth = (p) => Math.atan2(dot(p, e2), dot(p, e1))
  if (Math.hypot(dot(sun, e1), dot(sun, e2)) < 1e-12) {
    return 1
  }
  const sunAz = azimuth(sun)
  if (allRound) {
    return -1
  }
  // The projected frustum spans under a half turn: its corners bound it.
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  const first = azimuth(f.corners[0])
  const offsets = f.corners.map((c) => wrap(azimuth(c) - first))
  const lo = first + Math.min(...offsets)
  const hi = first + Math.max(...offsets)
  const anti = wrap(sunAz + Math.PI - lo)
  if (anti >= 0 && anti <= hi - lo) {
    return -1
  }
  return Math.min(Math.cos(lo - sunAz), Math.cos(hi - sunAz))
}


const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const normalize = (a) => scale(a, 1 / Math.hypot(...a))
const clamp = (x) => Math.max(-1, Math.min(1, x))
