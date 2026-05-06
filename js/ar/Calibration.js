import {Quaternion, Vector3} from 'three'


/** localStorage namespace for AR calibration entries. */
const STORAGE_KEY = 'celestiary.ar.cal'


/**
 * Solve for the calibration quaternion that corrects the sensor's idea of
 * "where the camera is aimed" so that it matches a known true direction.
 *
 * Inputs are unit vectors in the same frame (typically ENU at the
 * observer):
 *   - `deviceAim`: the direction the sensor currently reports the camera
 *     forward as pointing toward.
 *   - `trueAim`:  the actual direction to the reference body (from the
 *     scene's world model, projected back through the rotating-body and
 *     ENU-mapping transforms into ENU coords).
 *
 * Output `q_cal` satisfies `q_cal · deviceAim = trueAim`, applied as
 * `q_cal_enu` in ARController's chain:
 *
 *   camera.quaternion =
 *     enu_to_bodyFixed(lat, lng) · q_cal_enu · q_camera_to_enu
 *
 * Three.js `Quaternion.setFromUnitVectors` returns the minimal-arc
 * rotation between two unit vectors — i.e. a 2-DoF correction.  This is
 * a slight over-fit relative to a pure-yaw heading correction (for which
 * we'd need at least two reference samples to disambiguate), but for the
 * single-tap UX it's the right shape: any one bias source — hard-iron,
 * miscalibrated zero, slight tilt — is absorbed in one shot.
 *
 * @param {Vector3} deviceAim  Unit vector, sensor's camera-forward in ENU
 * @param {Vector3} trueAim  Unit vector, scene's true body direction in ENU
 * @returns {Quaternion}
 */
export function solveCalibration(deviceAim, trueAim) {
  return new Quaternion().setFromUnitVectors(deviceAim, trueAim)
}


/**
 * Encode a calibration quaternion as a compact JSON string for
 * localStorage round-tripping.  Trims to 6 dp — calibration is a
 * sub-degree correction at most, and we don't need 17-digit precision.
 *
 * @param {Quaternion} q
 * @returns {string}
 */
export function encodeCalibration(q) {
  return JSON.stringify({
    x: roundTo6(q.x),
    y: roundTo6(q.y),
    z: roundTo6(q.z),
    w: roundTo6(q.w),
  })
}


/**
 * @param {string} s  JSON-encoded calibration
 * @returns {?Quaternion}  null if input is malformed
 */
export function decodeCalibration(s) {
  if (!s) {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(s)
  } catch (e) {
    void e
    return null
  }
  const {x, y, z, w} = parsed
  if ([x, y, z, w].some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return null
  }
  return new Quaternion(x, y, z, w).normalize()
}


/**
 * Per-pose-source / per-screen-orientation storage of a calibration
 * quaternion.  Scoped by source kind + screen angle so a re-orientation
 * (portrait → landscape) and a switch between WebXR / DeviceOrientation
 * each have their own slot — calibration meaning depends on which sensor
 * stack produced the bias.
 */
export class CalibrationStore {
  /**
   * @param {object} [opts]
   * @param {{getItem: Function, setItem: Function, removeItem: Function}} [opts.storage]
   *   Defaults to `window.localStorage` when present, otherwise an
   *   in-memory shim — keeps the class usable in tests / SSR.
   */
  constructor({storage} = {}) {
    this._storage = storage ?? defaultStorage()
  }


  _key(sourceKind, screenAngle) {
    return `${STORAGE_KEY}:${sourceKind}:${screenAngle | 0}`
  }


  /**
   * @param {string} sourceKind  PoseSource.kind
   * @param {number} screenAngle  screen.orientation.angle (degrees, integer)
   * @returns {?Quaternion}
   */
  load(sourceKind, screenAngle) {
    const raw = this._storage.getItem(this._key(sourceKind, screenAngle))
    return decodeCalibration(raw)
  }


  /**
   * @param {string} sourceKind
   * @param {number} screenAngle
   * @param {Quaternion} q
   */
  save(sourceKind, screenAngle, q) {
    this._storage.setItem(this._key(sourceKind, screenAngle), encodeCalibration(q))
  }


  /**
   * @param {string} sourceKind
   * @param {number} screenAngle
   */
  clear(sourceKind, screenAngle) {
    this._storage.removeItem(this._key(sourceKind, screenAngle))
  }
}


/**
 * @param {number} v
 * @returns {number}
 */
function roundTo6(v) {
  return Math.round(v * 1e6) / 1e6
}


/** @returns {{getItem: Function, setItem: Function, removeItem: Function}} */
function defaultStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  // In-memory shim for SSR / Bun tests.  Module-scoped Map so multiple
  // CalibrationStore instances in the same process share a backing store
  // (matches localStorage's process-wide semantics).
  const m = inMemoryStore
  return {
    getItem: (k) => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}


const inMemoryStore = new Map()
