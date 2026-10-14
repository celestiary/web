import {Quaternion, Vector3} from 'three'
import * as Shared from './shared'


/**
 * Plays a camera path (tour.js) on the scene: each frame, where the path
 * says, through the app's own camera API (DESIGN.md "Homepage").  The
 * camera rides the frame of the body it is about (Scene.goTo, which keeps
 * its world pose and turns following on), so stopping leaves it in the
 * live scene as a `g` would: at that body, following it.
 *
 * Its clock is the frame clock, stepped by each frame's interval, held to
 * MAX_STEP_MS, and not at all while the page is hidden: a hidden tab gets
 * no frames, and coming back carries on from where it was rather than
 * jumping ahead.
 */


/** The most a frame steps the tour's clock, ms. */
export const MAX_STEP_MS = 100

const DAY_MS = 86400000


/** Plays a CameraPath. */
export default class TourDriver {
  /**
   * @param {object} deps
   * @param {object} deps.scene The Scene: objects, setTarget, goTo
   * @param {object} deps.ui ThreeUi: camera, setFov, dimCanvas, showCanvas
   * @param {object} [deps.time] Time, for a path with dates (`days`)
   * @param {Function} [deps.quietly] Runs a function without the readout
   *   hearing of what it sets (Celestiary._quietly)
   */
  constructor({scene, ui, time = null, quietly = (fn) => fn()}) {
    this.scene = scene
    this.ui = ui
    this.time = time
    this.quietly = quietly
    this.path = null
    // ms into the path; null while there's none.
    this.t = null
    this.playing = false
    // The body the camera rides now (_enterFrame).
    this.frameBody = null
    this._lastMs = null
    this._stillMs = null
    this._loopFadeMs = 0
    this._dimmed = false
    this._dateStartMs = null
    this._pos = new Vector3()
    this._quat = new Quaternion()
  }


  /** @returns {boolean} A path is set (playing or held) */
  get active() {
    return this.path !== null
  }


  /**
   * Set a path, held at its start until play().
   *
   * @param {object} path A CameraPath
   * @param {object} [opts]
   * @param {?number} [opts.still] Hold at this time, ms, and never move
   *   (prefers-reduced-motion)
   * @param {number} [opts.loopFadeMs] A looping path fades the canvas to
   *   black over this long before its end, and back over its start
   * @param {?function(): object} [opts.replan] A looping path is replaced
   *   by what this returns each time round, at the loop (under its fade):
   *   a path planned for the scene's date (the homepage's, homeTour.js)
   */
  start(path, {still = null, loopFadeMs = 0, replan = null} = {}) {
    this.path = path
    this._stillMs = still
    this._loopFadeMs = path.loop ? loopFadeMs : 0
    this._replan = path.loop ? replan : null
    this._lap = 0
    this.t = still ?? 0
    this.playing = false
    // Frames drawn since, so the exposure can settle before it's seen.
    this.frames = 0
    this.frameBody = null
    this._lastMs = null
    this._dimmed = false
    this._dateStartMs = this.time?.simTime ?? null
  }


  /** Run the clock (a still path stays still). */
  play() {
    this.playing = this._stillMs === null
    this._lastMs = null
  }


  /** Stop: the camera stays where it is, in its body's frame. */
  stop() {
    if (this._dimmed) {
      this.ui.showCanvas?.(this._loopFadeMs)
    }
    this.path = null
    this.t = null
    this.playing = false
    this._dimmed = false
  }


  /**
   * Step the clock and put the camera where the path says.  From the
   * animation callback, after the bodies have moved for the frame.
   *
   * @param {number} nowMs
   */
  frame(nowMs) {
    if (!this.path) {
      return
    }
    if (this.playing && this._lastMs !== null && !globalThis.document?.hidden) {
      this.t += Math.min(Math.max(nowMs - this._lastMs, 0), MAX_STEP_MS)
    }
    this._lastMs = nowMs
    this._nextLap()
    this._loopFade()
    this.apply(this.t)
    this.frames++
  }


  /**
   * Put the camera where the path is at a time.
   *
   * @param {number} tMs
   */
  apply(tMs) {
    const pose = this.path.pose(tMs, (name) => this.bodyAt(name))
    if (pose.body !== this.frameBody) {
      this._enterFrame(pose.body)
    }
    const camera = this.ui.camera
    const platform = camera.platform
    platform.updateWorldMatrix(true, false)
    camera.position.copy(platform.worldToLocal(this._pos.copy(pose.position)))
    platform.getWorldQuaternion(this._quat)
    camera.quaternion.copy(this._quat.invert().multiply(pose.quaternion))
    if (Math.abs(camera.fov - pose.fov) > 1e-6) {
      this.ui.setFov(pose.fov)
    }
    if (pose.days !== null && this.time && this._dateStartMs !== null) {
      this.time.setTime(this._dateStartMs + (pose.days * DAY_MS))
    }
  }


  /**
   * @param {string} name
   * @returns {{pos: Vector3, ref: Vector3}} The body's world centre, and its
   *   azimuths' zero (tour.js): toward the Sun in the ecliptic plane; the
   *   Sun's toward Earth
   */
  bodyAt(name) {
    const pos = worldPos(this.scene.objects[name])
    const other = name === 'sun' ? 'earth' : 'sun'
    const ref = worldPos(this.scene.objects[other]).sub(pos)
    ref.y = 0
    if (ref.lengthSq() === 0) {
      ref.set(1, 0, 0)
    }
    return {pos, ref: ref.normalize()}
  }


  /**
   * Hang the camera on a body's frame, keeping its world pose, and target
   * it: what a go does, without the flight (Scene.goTo, its tween dropped).
   *
   * @param {string} name
   */
  _enterFrame(name) {
    this.frameBody = name
    this.quietly(() => {
      this.scene.setTarget(name, {look: false})
      this.scene.goTo()
      Shared.targets.tween = null
      Shared.targets.tweenNextFn = null
    })
  }


  /** Round again: a looping path planned anew (start's `replan`). */
  _nextLap() {
    if (!this._replan) {
      return
    }
    const lap = Math.floor(this.t / this.path.duration)
    if (lap !== this._lap) {
      this._lap = lap
      this.path = this._replan()
    }
  }


  /** A looping path's fade to black over its end, and back over its start. */
  _loopFade() {
    const fade = this._loopFadeMs
    if (!fade || !this.playing) {
      return
    }
    const local = this.path.localTime(this.t)
    const dim = local > this.path.duration - fade
    if (dim && !this._dimmed) {
      this._dimmed = true
      this.ui.dimCanvas?.(fade)
    } else if (!dim && this._dimmed && local < fade) {
      this._dimmed = false
      this.ui.showCanvas?.(fade)
    }
  }
}


/**
 * @param {?object} node
 * @returns {Vector3} Its world position; the origin if none
 */
function worldPos(node) {
  const v = new Vector3()
  if (node) {
    node.getWorldPosition(v)
  }
  return v
}
