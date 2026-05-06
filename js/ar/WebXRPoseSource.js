import {Quaternion} from 'three'


/**
 * WebXR-backed PoseSource.
 *
 * The high-level idea: request an `'immersive-ar'` session with the
 * `'viewer'` reference space, and on each `XRSession#requestAnimationFrame`
 * tick read the viewer's pose.  WebXR delivers a fully-fused IMU + visual
 * pose, drift-corrected and screen-rotation-aware — calibration is
 * effectively a no-op there.
 *
 * The reference frame for `'local'` / `'viewer'` poses is implementation-
 * defined (NOT geographic ENU).  Reconciling that with our ENU contract
 * requires either:
 *   (a) a one-tap calibration to align the WebXR world to ENU, or
 *   (b) using the GeolocationSensor + WebXR's `'unbounded'` ref space if
 *       the device exposes them in concert.
 *
 * Stage 1a (this commit) ships a stub that always reports unsupported,
 * so the factory falls through to DeviceOrientationPoseSource — which is
 * the only path that exists on iOS Safari anyway.  Stage 1b wires the
 * full session.
 */
export default class WebXRPoseSource {
  constructor() {
    this.kind = 'webxr'
    // WebXR delivers a calibrated pose; the reference-frame alignment
    // step (WebXR-world → ENU) is a one-time per-session tap, not a
    // persistent magnetometer-bias correction, so we mark this false.
    this.needsCalibration = false
    this._q = new Quaternion()
  }


  /**
   * Async-probes navigator.xr.  Returns false on devices without WebXR
   * (which is most of the world right now, including all iOS).
   *
   * @returns {Promise<boolean>}
   */
  static isSupported() {
    // Stage 1a: short-circuit to false.  Stage 1b replaces this body with
    // a real navigator.xr.isSessionSupported('immersive-ar') probe and
    // gates on the 'viewer' or 'local-floor' reference space.  Returns a
    // Promise so the eventual async probe slots in cleanly.
    return Promise.resolve(false)
  }


  /** @returns {Promise<void>} */
  start() {
    return Promise.reject(new Error('WebXRPoseSource not yet implemented (stage 1b)'))
  }


  /** */
  stop() {
    // No-op.
  }


  /**
   * @param {Quaternion} _out
   * @returns {boolean}
   */
  getQuaternion(_out) {
    return false
  }


  /** @returns {{fresh: boolean, source: string}} */
  getStatus() {
    return {fresh: false, source: this.kind}
  }
}
