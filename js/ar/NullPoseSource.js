import {Quaternion} from 'three'


/**
 * Stand-in PoseSource for desktops / browsers without sensor APIs.
 *
 * Reports an identity orientation forever — the user can still see what
 * the AR view would show (camera platform pinned to the rotating body,
 * looking straight up) without device sensors.  Useful for development
 * and as a graceful fallback when permissions are denied.
 */
export default class NullPoseSource {
  constructor() {
    this.kind = 'null'
    this.needsCalibration = false
    this._q = new Quaternion()
  }


  /** @returns {Promise<void>} */
  async start() {
    // Nothing to attach.
  }


  /** */
  stop() {
    // Nothing to detach.
  }


  /**
   * Always returns identity (camera-frame ≡ ENU-frame).  In practice that
   * means the user is looking straight up (camera +Z = ENU Up) the whole
   * time — exactly what a "no sensors, just show me the sky overhead"
   * fallback should produce.
   *
   * @param {Quaternion} out
   * @returns {boolean} always true (we're always "fresh", just static)
   */
  getQuaternion(out) {
    out.copy(this._q)
    return true
  }


  /** @returns {{fresh: boolean, source: string}} */
  getStatus() {
    return {fresh: true, source: this.kind}
  }
}
