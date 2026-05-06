import {Euler, Quaternion, Vector3} from 'three'
import {toRad} from '../shared.js'


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
    this._lastSampleAt = 0
    this._handler = (e) => this._onEvent(e)
    this._q = new Quaternion()
    this._screenQ = new Quaternion()
    this._scratchEuler = new Euler()
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
    this._lastSample = {alpha: e.alpha, beta: e.beta, gamma: e.gamma}
    this._lastSampleAt = (typeof performance !== 'undefined') ? performance.now() : Date.now()
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
