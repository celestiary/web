import {Matrix4, Quaternion, Vector3} from 'three'
import {ease, lerp} from './tour'


/**
 * A flight from where the camera is to a view (DESIGN.md "Homepage",
 * leaving it): a card's link, tonight's sky, a search result.  Pure: it
 * says where the camera is at a share of the way, in the frame of the
 * body it is going to (Celestiary hangs the camera there first, as
 * Scene.goTo does, and puts it where this says each frame).
 *
 * - **Position:** about the body's centre, the log of the altitude eased
 *   from the start's to the end's, so a flight in from 3,200 light-years
 *   is as smooth at every scale as one across Earth's day side; the
 *   direction from the centre slerped, done by the middle of the way on a
 *   long descent, so the last of it is a descent rather than a skim over
 *   the ground.
 * - **Orientation:** three turns that overlap: from the start's view to
 *   facing the body (the first 30%), facing it as it comes in, then to the
 *   end's view (the last 40%).
 * - **Field:** geometric, over the last turn: a telescope's field (the
 *   occultation's 0.91°) narrows as it turns to its target.
 * - **Duration:** by the decades of altitude covered and the turn about
 *   the body, 2.4 to 6.5 s.
 * - **Ease-in:** the flight's clock comes up from standing to the path's
 *   own pace over its first FLIGHT_EASE_IN_MS (flightProgress), so a viewer
 *   sees the move begin before the fast travel.  It adds half that.
 */


/** The shortest and longest flights, ms. */
export const FLIGHT_MIN_MS = 2400
export const FLIGHT_MAX_MS = 6500
// A flight's length: a base, and more for each decade of altitude and each
// half turn about the body it covers.
const FLIGHT_BASE_MS = 2200
const FLIGHT_PER_DECADE_MS = 350
const FLIGHT_PER_HALF_TURN_MS = 600
// The turns' spans, shares of the flight: to face the body, and to the end's view.
const FACE_UNTIL = 0.3
const FINAL_FROM = 0.6
// The direction's share of a long descent (a decade of altitude takes
// this much off the whole flight's, down to a half).
const DIR_SHARE_PER_DECADE = 0.15
const DIR_SHARE_MIN = 0.5
// The altitude's floor, a share of the distance: the end is never inside
// the body's sphere (a landing's 2 m over terrain may be).
const MIN_ALT_SHARE = 1e-3
// Facing within this of the frame's up, another up squares the view.
const UP_PARALLEL = 0.9999

/**
 * A flight's ease-in, ms: over this long its pace comes up from standing to
 * the path's own (flightProgress).  The path's own start (its sine ease) is
 * at rest too, but in log altitude a long flight's first second already
 * covered a decade, too quick to see begin.
 */
export const FLIGHT_EASE_IN_MS = 1500


/**
 * Within this many of a body's radii of the camera, a change of date shows:
 * the body turns, its terminator moves (300 radii: under half a degree).
 */
export const NEAR_RADII = 300

/**
 * The longest change of date a flight eases through as it goes, ms: two
 * days, so Earth turns at most twice on the way.  Longer, near a body, the
 * date is set under a dip to black before the flight (timePlan).
 */
export const EASE_TIME_MAX_MS = 2 * 86400000


/**
 * How a flight changes the date to its end's (a card's link has one):
 *
 * - 'none': it doesn't;
 * - 'start': at the start, at once: nothing is near enough to the camera
 *   for the change to show (the bodies a few pixels across at most);
 * - 'ease': along the way, with the travel: near a body, a short change
 *   is a time-lapse (Earth turns, the Moon moves);
 * - 'dip': near a body, a longer change is made in the dark, then the
 *   flight: from the homepage the dark its foreground fades to, else a short
 *   dip to black.
 *
 * @param {number} deltaMs The change, ms
 * @param {number} nearestRadii The camera's distance from the nearest body
 *   in its view (the Sun, a planet, a moon), in its radii: one out of the
 *   view shows no change (Celestiary._nearestShownRadii)
 * @returns {string}
 */
export function timePlan(deltaMs, nearestRadii) {
  if (!deltaMs) {
    return 'none'
  }
  if (!(nearestRadii < NEAR_RADII)) {
    return 'start'
  }
  return Math.abs(deltaMs) <= EASE_TIME_MAX_MS ? 'ease' : 'dip'
}


/**
 * @param {number} alt0 The start's altitude over the body, m
 * @param {number} alt1 The end's
 * @param {number} angle The turn about the body's centre between them, radians
 * @returns {number} ms
 */
export function flightDuration(alt0, alt1, angle) {
  const decades = Math.abs(Math.log10(Math.max(alt0, 1) / Math.max(alt1, 1)))
  const ms = FLIGHT_BASE_MS + (FLIGHT_PER_DECADE_MS * decades) + (FLIGHT_PER_HALF_TURN_MS * angle / Math.PI)
  return Math.min(Math.max(ms, FLIGHT_MIN_MS), FLIGHT_MAX_MS)
}


/**
 * How far along its path (FlightPath.pose's `u`) a flight is a time into
 * it.  Over the first `easeInMs` the path's clock runs slow, its pace
 * coming up smoothly from standing to the path's own (a smoothstep in pace,
 * so the motion has no step in speed or acceleration); from then on it runs
 * at the path's own pace, so the fast travel and the settle are the path's
 * as they were, only begun later.  The ease-in covers the path's first
 * `easeInMs / 2`, so the flight is that much longer (flightTotalMs).
 *
 * @param {number} elapsedMs Since the flight began
 * @param {number} durationMs The path's (flightDuration)
 * @param {number} [easeInMs]
 * @returns {number} 0 to 1
 */
export function flightProgress(elapsedMs, durationMs, easeInMs = FLIGHT_EASE_IN_MS) {
  if (!(elapsedMs > 0)) {
    return 0
  }
  let pathMs
  if (elapsedMs < easeInMs) {
    // The integral of smoothstep(e / easeInMs).
    const a = elapsedMs / easeInMs
    pathMs = easeInMs * ((a * a * a) - ((a * a * a * a) / 2))
  } else {
    pathMs = elapsedMs - (easeInMs / 2)
  }
  return Math.min(pathMs / durationMs, 1)
}


/**
 * @param {number} durationMs The path's (flightDuration)
 * @param {number} [easeInMs]
 * @returns {number} The flight's length with its ease-in, ms
 */
export function flightTotalMs(durationMs, easeInMs = FLIGHT_EASE_IN_MS) {
  return durationMs + (easeInMs / 2)
}


/**
 * Smoothstep over a span of a flight.
 *
 * @param {number} u 0 to 1
 * @param {number} from
 * @param {number} to
 * @returns {number} 0 before `from`, 1 after `to`
 */
function span(u, from, to) {
  const x = Math.min(Math.max((u - from) / (to - from), 0), 1)
  return x * x * (3 - (2 * x))
}


/** Where the camera is along a flight. */
export default class FlightPath {
  /**
   * @param {object} start The camera's pose at the start, in the body's frame
   * @param {Vector3} start.position
   * @param {Quaternion} start.quaternion
   * @param {number} start.fov Degrees
   * @param {number} radius The body's, m
   * @param {Vector3} [up] The frame's up, for facing the body (the ecliptic's north)
   */
  constructor({position, quaternion, fov}, radius, up = new Vector3(0, 1, 0)) {
    this.start = {position: position.clone(), quaternion: quaternion.clone(), fov}
    this.radius = radius
    this.up = up.clone()
  }


  /**
   * @param {Vector3} eye
   * @param {Vector3} target
   * @returns {Quaternion} Facing the target, square to the frame's up (or,
   *   looking along it, to another)
   */
  _facing(eye, target) {
    const dir = target.clone().sub(eye).normalize()
    const up = Math.abs(dir.dot(this.up)) > UP_PARALLEL ? new Vector3(0, 0, 1) : this.up
    return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, up))
  }


  /**
   * @param {object} end The end's pose, in the same frame
   * @param {Vector3} end.position
   * @param {Vector3} [center] The body's centre in the frame
   * @returns {{alt0: number, alt1: number, angle: number}} The altitudes over
   *   the body and the turn about it between start and end
   */
  measure(end, center = new Vector3()) {
    const {r, rel0, rel1} = this._radii(end.position, center)
    return {
      alt0: rel0.length() - r,
      alt1: rel1.length() - r,
      angle: rel0.angleTo(rel1),
    }
  }


  /**
   * @param {Vector3} endPosition
   * @param {Vector3} center
   * @returns {{r: number, rel0: Vector3, rel1: Vector3}} The radius the
   *   altitudes are over (the body's, or less if an end is inside it), and
   *   both ends from the centre
   */
  _radii(endPosition, center) {
    const rel0 = this.start.position.clone().sub(center)
    const rel1 = endPosition.clone().sub(center)
    const nearest = Math.min(rel0.length(), rel1.length())
    return {r: Math.min(this.radius, nearest * (1 - MIN_ALT_SHARE)), rel0, rel1}
  }


  /**
   * The camera's pose a share of the way, ending at `end` (which may move
   * as the flight goes: the body turns under a landing, the date eases).
   *
   * @param {number} u 0 to 1, linear in time
   * @param {object} end The end's pose, in the body's frame
   * @param {Vector3} end.position
   * @param {Quaternion} end.quaternion
   * @param {number} end.fov
   * @param {Vector3} [center] The body's centre in the frame
   * @returns {{position: Vector3, quaternion: Quaternion, fov: number, travel: number}}
   *   `travel` is the eased share of the way (the date's, the exposure's)
   */
  pose(u, end, center = new Vector3()) {
    const t = Math.min(Math.max(u, 0), 1)
    const travel = ease('inOut', t)
    const {r, rel0, rel1} = this._radii(end.position, center)
    const d0 = rel0.length()
    const d1 = rel1.length()
    const alt0 = d0 - r
    const alt1 = d1 - r
    const alt = Math.exp(lerp(Math.log(alt0), Math.log(alt1), travel))
    // On a long descent the direction comes round first.
    const decades = Math.abs(Math.log10(alt0 / alt1))
    const share = Math.max(1 - (DIR_SHARE_PER_DECADE * decades), DIR_SHARE_MIN)
    const turn = ease('inOut', t / share)
    const dir0 = rel0.divideScalar(d0)
    const dir1 = rel1.divideScalar(d1)
    const sweep = new Quaternion().setFromUnitVectors(dir0, dir1)
    const dir = dir0.clone().applyQuaternion(new Quaternion().slerp(sweep, turn))
    const position = dir.multiplyScalar(r + alt).add(center)
    const facing = this._facing(position, center)
    const quaternion = this.start.quaternion.clone().slerp(facing, span(t, 0, FACE_UNTIL))
    const last = span(t, FINAL_FROM, 1)
    quaternion.slerp(end.quaternion, last)
    const fov = Math.exp(lerp(Math.log(this.start.fov), Math.log(end.fov), last))
    if (t === 1) {
      // Exactly the end, not its arithmetic's last bit.
      return {position: end.position.clone(), quaternion: end.quaternion.clone(), fov: end.fov, travel}
    }
    return {position, quaternion, fov, travel}
  }
}
