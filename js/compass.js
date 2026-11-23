import {Matrix4, Quaternion, Vector3} from 'three'


/**
 * The compass's geometry (design/UI.md, the camera control, step 3; #361):
 * the camera's heading and pitch over the ground under it, and the
 * orientation for a heading and pitch.  All vectors are in one frame (the
 * world's), unit length.
 *
 * - `up`: out of the body under the camera (camera minus the body's centre);
 * - `pole`: the body's north pole (its body frame's +Y);
 * - north and east on the ground: the pole and its cross with up, in the
 *   plane the up is normal to.
 */


const _north = new Vector3()
const _east = new Vector3()
const _fwd = new Vector3()
const _right = new Vector3()
const _camUp = new Vector3()
const _back = new Vector3()
const _m = new Matrix4()


/**
 * North and east on the ground under the camera.  At a pole, where the pole
 * is the up, north is undefined: any direction will do, so the body's +Z
 * stands in for it.
 *
 * @param {Vector3} up
 * @param {Vector3} pole
 * @param {Vector3} north Set to north on the ground
 * @param {Vector3} east Set to east on the ground
 */
export function groundAxes(up, pole, north, east) {
  north.copy(pole).addScaledVector(up, -pole.dot(up))
  if (north.lengthSq() < 1e-12) {
    north.set(0, 0, 1).addScaledVector(up, -up.z)
  }
  north.normalize()
  east.crossVectors(north, up).normalize()
}


/**
 * @param {Vector3} up
 * @param {Vector3} pole
 * @param {Vector3} forward The camera's looking direction
 * @returns {{heading: number, pitch: number}} Radians: heading east of
 *   north (0 north, π/2 east), pitch above the horizon (−π/2 straight down)
 */
export function headingOf(up, pole, forward) {
  groundAxes(up, pole, _north, _east)
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward.dot(up))))
  // Straight up or down the heading is the camera's up, which points along
  // the way it would look if it pitched level.
  return {heading: Math.atan2(forward.dot(_east), forward.dot(_north)), pitch}
}


/**
 * The orientation that looks at `heading` and `pitch` with no roll (the
 * camera's right along the ground).
 *
 * @param {Vector3} up
 * @param {Vector3} pole
 * @param {number} heading Radians east of north
 * @param {number} pitch Radians above the horizon, within ±π/2
 * @param {Quaternion} [out]
 * @returns {Quaternion} The camera's world orientation
 */
export function orientationFor(up, pole, heading, pitch, out = new Quaternion()) {
  groundAxes(up, pole, _north, _east)
  const ch = Math.cos(heading)
  const sh = Math.sin(heading)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  // Forward: along the ground at the heading, tipped by the pitch.
  _fwd.copy(_north).multiplyScalar(ch * cp).addScaledVector(_east, sh * cp).addScaledVector(up, sp)
  // Right: along the ground, a quarter turn clockwise of the heading.
  _right.copy(_east).multiplyScalar(ch).addScaledVector(_north, -sh)
  _back.copy(_fwd).negate()
  _camUp.crossVectors(_back, _right)
  _m.makeBasis(_right, _camUp, _back)
  return out.setFromRotationMatrix(_m)
}
