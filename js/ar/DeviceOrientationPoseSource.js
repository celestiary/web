import {Euler, Quaternion, Vector3} from 'three'
import {toRad} from '../shared.js'
import AlphaPipeline from './AlphaPipeline.js'
import BiquadNotch from './BiquadNotch.js'
import LocalOneEuroFilter, {AngleOneEuroFilter as LocalAngleOneEuroFilter} from './OneEuroFilter.js'
import LibBackedOneEuroFilter, {AngleOneEuroFilter as LibBackedAngleOneEuroFilter} from './OneEuroFilterLib.js'


// A/B swap: flip USE_LIB_FILTER to exercise the canonical 1eurofilter
// package instead of our local impl.  Same constructor opts, same
// filter()/reset() API, same extension knobs (xDeadband / dDeadband /
// motionThresh).  The lib gives us Casiez's reference math; our impl
// is a direct port plus the same extensions.
const USE_LIB_FILTER = true
const OneEuroFilter = USE_LIB_FILTER ? LibBackedOneEuroFilter : LocalOneEuroFilter
const AngleOneEuroFilter = USE_LIB_FILTER ? LibBackedAngleOneEuroFilter : LocalAngleOneEuroFilter


// 1€ filter presets for the alpha (yaw / heading) axis — three damping
// levels exposed to the user from the AR HUD.  The noise floor on
// mid-range Android magnetometers isn't a clean tone we can notch out
// (closer to pink-ish random walk with broadband fuzz), so smoothing
// strength is the only knob that meaningfully changes UX.
//
//   light  : minCutoff 1.0, beta 0.05  → snappy, more visible jitter
//   medium : minCutoff 0.5, beta 0.05  → balanced; tested-good default
//                                        on a Samsung A34
//   heavy  : minCutoff 0.05, beta 0.005 → near-fixed 0.05 Hz LP at rest;
//                                        ~24° lag at 30°/s pan, but very
//                                        clean for "recognise dots in
//                                        the sky" use case
//
// Pitch + roll come from gravity via the accelerometer — much cleaner
// — so they share the lighter TILT_FILTER_OPTS regardless of the
// alpha damping selection.
const ALPHA_FILTER_PRESETS = Object.freeze({
  light: Object.freeze({minCutoff: 1.0, beta: 0.05, dCutoff: 1.0}),
  medium: Object.freeze({minCutoff: 0.5, beta: 0.05, dCutoff: 1.0}),
  heavy: Object.freeze({minCutoff: 0.05, beta: 0.005, dCutoff: 1.0}),
})
export const DEFAULT_ALPHA_DAMPING = 'medium'
const TILT_FILTER_OPTS = Object.freeze({minCutoff: 0.5, beta: 0.05, dCutoff: 1.0})


// No notch — the magnetometer artifact on tested mid-range Android
// hardware doesn't have a stationary spectrum a single-frequency notch
// can bite into.  Left wired in via AlphaPipeline so it's a one-line
// flip if a future device shows a clean carrier.
const ALPHA_NOTCH_OPTS = null


/** @returns {string[]} valid damping preset names */
export function getAlphaDampingNames() {
  return Object.keys(ALPHA_FILTER_PRESETS)
}


/**
 * Reusable axis vector for the screen-orientation correction quaternion —
 * device +Z is "out of the screen" in W3C device-axes terms.
 */
const DEVICE_Z = new Vector3(0, 0, 1)


/**
 * Read DeviceOrientationEvent.alpha/beta/gamma and produce a quaternion
 * that maps **camera-frame** vectors to **ENU-frame** vectors.
 *
 * Frame conventions (per W3C Device Orientation spec):
 *   - Device frame: +X right, +Y top of phone, +Z out of screen toward user.
 *   - Earth (ENU) frame: +X East, +Y North, +Z Up.
 *   - alpha (≥ 0, < 360°): rotation around device Z.
 *   - beta (-180°, 180°]: rotation around device X.
 *   - gamma (-90°, 90°]: rotation around device Y.
 *   - Composition is intrinsic Z-X-Y, i.e. q_dev_to_enu = Rz(α)·Rx(β)·Ry(γ).
 *
 * Camera-frame ≡ screen-frame (the renderer's viewport): +X right of the
 * rendered image, +Y up the rendered image, looking out the back of the
 * phone (Three.js camera forward = camera −Z = device −Z).  Screen-frame
 * relates to device-frame by `screen.orientation.angle` (a CCW rotation
 * around device +Z), so:
 *
 *   v_ENU  = q_dev_to_enu · v_device
 *          = q_dev_to_enu · Rz(+orient) · v_screen
 *          = q_cam_to_enu · v_camera
 *
 *   q_cam_to_enu = q_dev_to_enu · Rz(+orient)
 *
 * Absolute-orientation events (`deviceorientationabsolute` or
 * `DeviceOrientationEvent#absolute`) reference true Earth axes; relative
 * events reference whatever the browser pinned at session start.  The
 * factory (PoseSource.createPoseSource) prefers absolute when available,
 * otherwise falls back to relative + a calibration step.  iOS exposes
 * `webkitCompassHeading` on the relative event, which we *could* use to
 * derive an absolute alpha — left for a follow-up; for now the relative
 * fallback ships with the calibration gear surfaced in the AR HUD.
 *
 * Permissions: iOS 13+ requires a one-time
 * `DeviceOrientationEvent.requestPermission()` call from a user gesture.
 * `start()` invokes it; the caller is responsible for triggering `start()`
 * inside a button-tap handler.
 */
export default class DeviceOrientationPoseSource {
  constructor() {
    this.kind = 'deviceorientation'
    // Absolute mode reads true heading, so calibration is "nice to have"
    // rather than mandatory.  Relative mode (no magnetometer fusion) starts
    // out at an arbitrary yaw and *needs* calibration to be useful.  Set
    // accurately once `start()` learns which mode the browser delivers.
    this.needsCalibration = true
    this._listening = false
    this._isAbsolute = false
    this._lastSample = null
    this._lastRawSample = null
    this._lastSampleAt = 0
    this._sampleCount = 0
    this._lastEventType = null
    this._handler = (e) => this._onEvent(e)
    this._q = new Quaternion()
    this._screenQ = new Quaternion()
    this._scratchEuler = new Euler()
    // Per-axis filters.  Alpha (yaw, magnetometer-fused, noisiest axis)
    // gets the full unwrap → notch → 1€ pipeline so we can pick off a
    // known periodic carrier before the smoothing stage.  Beta + gamma
    // (pitch + roll, accelerometer-derived) are clean enough that bare
    // 1€ is plenty.
    this._alphaDamping = DEFAULT_ALPHA_DAMPING
    this._alphaFilter = this._buildAlphaFilter(this._alphaDamping)
    this._betaFilter = new AngleOneEuroFilter(TILT_FILTER_OPTS)
    this._gammaFilter = new OneEuroFilter(TILT_FILTER_OPTS)
  }


  /**
   * Build (or rebuild) the alpha filter pipeline at the given damping
   * preset.  Used at construction time and whenever the user changes
   * the damping mode from the AR HUD.
   *
   * @param {string} name  One of `getAlphaDampingNames()`
   * @returns {AlphaPipeline}
   */
  _buildAlphaFilter(name) {
    const opts = ALPHA_FILTER_PRESETS[name] ?? ALPHA_FILTER_PRESETS[DEFAULT_ALPHA_DAMPING]
    return new AlphaPipeline({
      BaseFilter: OneEuroFilter,
      oneEuroOpts: opts,
      notch: ALPHA_NOTCH_OPTS ? new BiquadNotch(ALPHA_NOTCH_OPTS) : null,
    })
  }


  /**
   * Swap the alpha-axis filter to a different damping preset.  Rebuilds
   * the pipeline (state is reset, so a brief settling transient is
   * expected on the next sample — fine since the user is in the middle
   * of an explicit "change smoothing" gesture).
   *
   * @param {string} name  One of `getAlphaDampingNames()`
   */
  setAlphaDamping(name) {
    if (!Object.prototype.hasOwnProperty.call(ALPHA_FILTER_PRESETS, name)) {
      console.warn(`Unknown alpha damping preset: ${name}`)
      return
    }
    if (name === this._alphaDamping) {
      return
    }
    this._alphaDamping = name
    this._alphaFilter = this._buildAlphaFilter(name)
  }


  /** @returns {string} Current alpha damping preset name */
  getAlphaDamping() {
    return this._alphaDamping
  }


  /**
   * Request permissions if needed, then attach listeners.  Resolves once
   * either an event has arrived or the listener is wired (whichever first).
   * Throws if permission is denied or device-orientation events are
   * unavailable.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this._listening) {
      return
    }
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      throw new Error('DeviceOrientation not supported')
    }
    // iOS 13+ permission gate.  No-op on Android / desktop.
    const reqPerm = window.DeviceOrientationEvent.requestPermission
    if (typeof reqPerm === 'function') {
      const result = await reqPerm()
      if (result !== 'granted') {
        throw new Error(`DeviceOrientation permission ${result}`)
      }
    }
    // Prefer the absolute event when the browser exposes it; otherwise the
    // standard event and rely on `event.absolute` to advertise its mode.
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this._handler, true)
      this._isAbsolute = true
    } else {
      window.addEventListener('deviceorientation', this._handler, true)
    }
    this._listening = true
  }


  /** Detach listeners; safe to call repeatedly. */
  stop() {
    if (!this._listening) {
      return
    }
    window.removeEventListener('deviceorientationabsolute', this._handler, true)
    window.removeEventListener('deviceorientation', this._handler, true)
    this._listening = false
    this._lastSample = null
    this._lastRawSample = null
    this._alphaFilter.reset()
    this._betaFilter.reset()
    this._gammaFilter.reset()
  }


  /** @param {DeviceOrientationEvent} e */
  _onEvent(e) {
    if (e.alpha === null || e.beta === null || e.gamma === null) {
      // Some platforms briefly emit null while the sensor warms up; just
      // wait for the next event.
      return
    }
    if (typeof e.absolute === 'boolean' && e.absolute) {
      this._isAbsolute = true
    }
    const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now()
    const tSec = nowMs / 1000
    this._lastRawSample = {alpha: e.alpha, beta: e.beta, gamma: e.gamma}
    this._lastSample = {
      alpha: this._alphaFilter.filter(e.alpha, tSec),
      beta: this._betaFilter.filter(e.beta, tSec),
      gamma: this._gammaFilter.filter(e.gamma, tSec),
    }
    this._lastSampleAt = nowMs
    this._sampleCount++
    this._lastEventType = e.type
    this.needsCalibration = !this._isAbsolute
  }


  /**
   * @param {Quaternion} out  Receives camera→ENU quaternion
   * @returns {boolean} false if no sample has arrived yet
   */
  getQuaternion(out) {
    if (!this._lastSample) {
      return false
    }
    const {alpha, beta, gamma} = this._lastSample
    composeDeviceToEnu(this._scratchEuler, this._q, alpha, beta, gamma)
    // Apply screen-orientation correction.  When the user rotates the phone
    // to landscape, screen-frame and device-frame diverge by the screen
    // angle around device Z; without this step the rendered horizon tilts
    // 90° on rotation.
    const orient = readScreenOrientationRad()
    if (orient !== 0) {
      this._screenQ.setFromAxisAngle(DEVICE_Z, orient)
      this._q.multiply(this._screenQ)
    }
    out.copy(this._q)
    return true
  }


  /** @returns {{fresh: boolean, source: string}} */
  getStatus() {
    const fresh = this._lastSample !== null &&
        ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - this._lastSampleAt) < 1000
    return {fresh, source: this._isAbsolute ? 'deviceorientation-absolute' : 'deviceorientation'}
  }


  /** @returns {object} Snapshot for the AR debug HUD */
  getDebugSnapshot() {
    // Pull the latest unwrapped + notched intermediates from the alpha
    // pipeline so the HUD graph can plot all four traces (raw → unwrap
    // → notch → 1€) and we can see which stage each artifact belongs to.
    const alphaInter = typeof this._alphaFilter.getDebugIntermediates === 'function' ?
      this._alphaFilter.getDebugIntermediates() :
      null
    return {
      kind: this.kind,
      listening: this._listening,
      isAbsolute: this._isAbsolute,
      sampleCount: this._sampleCount,
      lastSample: this._lastSample,
      lastRawSample: this._lastRawSample,
      lastNotchedAlpha: alphaInter ? alphaInter.notched : null,
      lastUnwrappedAlpha: alphaInter ? alphaInter.unwrapped : null,
      lastEventType: this._lastEventType,
      msSinceLastSample: this._lastSample === null ?
        null :
        Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - this._lastSampleAt),
    }
  }
}


/**
 * Pure-math helper, exported for tests.  Composes the W3C-spec Z-X-Y
 * intrinsic rotation into a Three.js quaternion.
 *
 * @param {Euler} scratchEuler  Pre-allocated Euler to avoid GC churn
 * @param {Quaternion} out  Receives the result
 * @param {number} alphaDeg  Rotation around device Z
 * @param {number} betaDeg  Rotation around device X
 * @param {number} gammaDeg  Rotation around device Y
 */
export function composeDeviceToEnu(scratchEuler, out, alphaDeg, betaDeg, gammaDeg) {
  // Three.js Euler order 'ZXY' yields M = Rz(z) · Rx(x) · Ry(y) when applied
  // via Quaternion.setFromEuler — exactly the W3C Z-X-Y intrinsic chain.
  scratchEuler.set(betaDeg * toRad, gammaDeg * toRad, alphaDeg * toRad, 'ZXY')
  out.setFromEuler(scratchEuler)
}


/**
 * Read `screen.orientation.angle` (or legacy `window.orientation`) in
 * radians.  Returns 0 if neither is available.
 *
 * @returns {number}
 */
function readScreenOrientationRad() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle * toRad
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    return window.orientation * toRad
  }
  return 0
}
