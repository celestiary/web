import {Matrix4, Quaternion, Vector3} from 'three'


/**
 * A camera path: keyframes of where the camera is, what it faces, its field
 * of view and, optionally, the date, eased and interpolated (DESIGN.md
 * "Homepage", the tour).  Pure: it says where the camera is at a time,
 * given where the bodies are; tourDriver.js puts the camera there.  The
 * homepage's tour is one (homeTour.js); a guided tour can be another.
 *
 * A keyframe:
 *
 *   {
 *     at: 12000,      ms from the path's start (the first is 0)
 *     body: 'earth',  the body the camera is placed about, the frame it
 *                     rides and the target
 *     dist: 2e7,      m from the body's centre
 *     az: 40,         degrees about the ecliptic's north (+Y), from the
 *                     body's reference direction: toward the Sun (0 is
 *                     over the day side, 90 over the dusk terminator, 180
 *                     the night side); for the Sun, toward Earth
 *     el: 10,         degrees above the ecliptic
 *     fov: 45,        degrees
 *     look: 'sun',    the body faced, if not `body` (optional)
 *     days: 0.1,      the date, days after the path's start (optional:
 *                     the clock runs as it is where either end lacks it)
 *     ease: 'inOut',  the easing of the segment that ends here (EASINGS)
 *     turn: 0.5,      the share of that segment over which the camera
 *                     turns from the last keyframe's look to this one's
 *   }
 *
 * Between keyframes about one body, the camera moves in that body's frame
 * by its azimuth, elevation and the log of its distance, so a sweep past
 * 180° is a sweep, and a pull back from 2e7 m to 3e19 m is as smooth at
 * every scale.  Between two bodies, the start is re-expressed about the
 * second (where it is now, by the bodies' positions this frame) and
 * interpolated the same way: a travel from the Sun to Earth closes in on
 * Earth geometrically, Earth growing steadily rather than leaping up at
 * the end.
 */


const DEG = Math.PI / 180
const UP = Object.freeze(new Vector3(0, 1, 0))
// Where the look is within this of straight up or down, lookAt uses
// another up so its basis is defined.
const UP_PARALLEL = 0.9999


/**
 * Easings, 0 to 1 onto 0 to 1.  inOut is a sine's: at rest at both ends,
 * gentler in the middle than a cubic, for a calm path.
 */
export const EASINGS = Object.freeze({
  linear: (t) => t,
  in: (t) => 1 - Math.cos(t * Math.PI / 2),
  out: (t) => Math.sin(t * Math.PI / 2),
  inOut: (t) => (1 - Math.cos(t * Math.PI)) / 2,
})


/**
 * @param {string} [name] Of EASINGS; inOut if unknown or absent
 * @param {number} t 0 to 1, held to that
 * @returns {number}
 */
export function ease(name, t) {
  const fn = EASINGS[name] ?? EASINGS.inOut
  return fn(Math.min(Math.max(t, 0), 1))
}


/**
 * @param {number} a
 * @param {number} b
 * @param {number} u
 * @returns {number}
 */
export function lerp(a, b, u) {
  return a + ((b - a) * u)
}


/**
 * @param {number} a Degrees
 * @param {number} toward Degrees
 * @returns {number} `a` plus or minus whole turns, within half a turn of `toward`
 */
export function unwrapDegrees(a, toward) {
  return a + (360 * Math.round((toward - a) / 360))
}


/**
 * An offset from a body, from its azimuth, elevation and distance.
 *
 * @param {number} az Degrees about +Y from `ref`
 * @param {number} el Degrees above the plane
 * @param {number} dist
 * @param {Vector3} ref The body's reference direction, unit, in the plane
 * @param {Vector3} [out]
 * @returns {Vector3}
 */
export function fromSpherical(az, el, dist, ref, out = new Vector3()) {
  out.copy(ref).applyAxisAngle(UP, az * DEG).multiplyScalar(Math.cos(el * DEG))
  out.y += Math.sin(el * DEG)
  return out.multiplyScalar(dist)
}


/**
 * The inverse of fromSpherical.
 *
 * @param {Vector3} v An offset from a body
 * @param {Vector3} ref The body's reference direction, unit, in the plane
 * @returns {{az: number, el: number, dist: number}} Degrees, and v's length
 */
export function toSpherical(v, ref) {
  const dist = v.length()
  if (dist === 0) {
    return {az: 0, el: 0, dist: 0}
  }
  const el = Math.asin(Math.min(Math.max(v.y / dist, -1), 1)) / DEG
  // About +Y from ref to v's direction in the plane: (ref x v).y is the sine.
  const sin = (ref.z * v.x) - (ref.x * v.z)
  const cos = (ref.x * v.x) + (ref.z * v.z)
  const az = (sin === 0 && cos === 0) ? 0 : Math.atan2(sin, cos) / DEG
  return {az, el, dist}
}


/**
 * The world orientation of a camera at `eye` facing `target`, its up the
 * ecliptic's north (as 'c' squares it).
 *
 * @param {Vector3} eye
 * @param {Vector3} target
 * @param {Quaternion} [out]
 * @returns {Quaternion}
 */
export function lookQuaternion(eye, target, out = new Quaternion()) {
  const dir = _v.subVectors(target, eye)
  const len = dir.length()
  const up = len > 0 && Math.abs(dir.y / len) > UP_PARALLEL ? _altUp : UP
  _m.lookAt(eye, target, up)
  return out.setFromRotationMatrix(_m)
}
const _v = new Vector3()
const _m = new Matrix4()
const _altUp = Object.freeze(new Vector3(0, 0, 1))


/** Keyframes, and where the camera is between them. */
export default class CameraPath {
  /**
   * @param {Array<object>} keyframes As the header says, in time order
   * @param {object} [opts]
   * @param {boolean} [opts.loop] Start again after the last
   */
  constructor(keyframes, {loop = false} = {}) {
    if (!keyframes?.length) {
      throw new Error('A camera path needs a keyframe')
    }
    this.keyframes = [...keyframes].sort((a, b) => a.at - b.at)
    this.loop = loop
  }


  /** @returns {number} ms, the last keyframe's time */
  get duration() {
    return this.keyframes[this.keyframes.length - 1].at
  }


  /**
   * @param {number} tMs Since the start; wrapped if the path loops
   * @returns {number} The time within the path, 0 to duration
   */
  localTime(tMs) {
    const d = this.duration
    if (this.loop && d > 0) {
      return ((tMs % d) + d) % d
    }
    return Math.min(Math.max(tMs, 0), d)
  }


  /**
   * The keyframes either side of a time, and how far between them.
   *
   * @param {number} tMs
   * @returns {{index: number, k0: object, k1: object, u: number, uLook: number}}
   *   `index` is k1's; `u` the eased progress of the position, the field
   *   and the date, `uLook` of the turn.  At or before the first keyframe
   *   (or with one) both are it.
   */
  segmentAt(tMs) {
    const t = this.localTime(tMs)
    const kfs = this.keyframes
    let i = 1
    while (i < kfs.length && kfs[i].at < t) {
      i++
    }
    if (i >= kfs.length || t <= kfs[0].at) {
      const k = t <= kfs[0].at ? kfs[0] : kfs[kfs.length - 1]
      return {index: kfs.indexOf(k), k0: k, k1: k, u: 1, uLook: 1}
    }
    const k0 = kfs[i - 1]
    const k1 = kfs[i]
    const span = k1.at - k0.at
    const linear = span > 0 ? (t - k0.at) / span : 1
    const turn = k1.turn ?? 1
    return {
      index: i,
      k0,
      k1,
      u: ease(k1.ease, linear),
      uLook: ease('inOut', turn > 0 ? linear / turn : 1),
    }
  }


  /**
   * Where the camera is at a time.
   *
   * @param {number} tMs
   * @param {function(string): {pos: Vector3, ref: Vector3}} bodyAt A body's
   *   world centre now, and its reference direction (unit, in the ecliptic
   *   plane)
   * @returns {{position: Vector3, quaternion: Quaternion, fov: number,
   *   days: ?number, body: string, index: number}} World position and
   *   orientation; `body` is the frame (the segment's end's)
   */
  pose(tMs, bodyAt) {
    const {index, k0, k1, u, uLook} = this.segmentAt(tMs)
    const b1 = bodyAt(k1.body)
    let az0 = k0.az
    let el0 = k0.el
    let dist0 = k0.dist
    if (k0.body !== k1.body) {
      // Where k0 puts the camera, about k1's body.
      const b0 = bodyAt(k0.body)
      const p0 = fromSpherical(k0.az, k0.el, k0.dist, b0.ref).add(b0.pos).sub(b1.pos)
      const s = toSpherical(p0, b1.ref)
      az0 = unwrapDegrees(s.az, k1.az)
      el0 = s.el
      dist0 = s.dist
    }
    const dist = Math.exp(lerp(Math.log(Math.max(dist0, 1)), Math.log(Math.max(k1.dist, 1)), u))
    const position = fromSpherical(lerp(az0, k1.az, u), lerp(el0, k1.el, u), dist, b1.ref).add(b1.pos)
    const look1 = bodyAt(k1.look ?? k1.body).pos
    const quaternion = lookQuaternion(position, look1)
    const look0Name = k0.look ?? k0.body
    if (look0Name !== (k1.look ?? k1.body) && uLook < 1) {
      const q0 = lookQuaternion(position, bodyAt(look0Name).pos)
      quaternion.copy(q0.slerp(quaternion, uLook))
    }
    const fov = Math.exp(lerp(Math.log(k0.fov), Math.log(k1.fov), u))
    const days = (typeof k0.days === 'number' && typeof k1.days === 'number') ? lerp(k0.days, k1.days, u) : null
    return {position, quaternion, fov, days, body: k1.body, index}
  }
}
