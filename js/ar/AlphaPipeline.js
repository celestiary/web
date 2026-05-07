/**
 * Three-stage processing for the noisiest axis (alpha / yaw):
 *
 *   raw °  ─►  unwrap  ─►  optional notch  ─►  base 1€ filter
 *
 * Each stage owns one specific concern:
 *
 *   - **unwrap** turns the raw [0, 360) reading into a continuous
 *     real-valued signal so the subsequent IIR / EMA stages don't see
 *     huge fake transients at the 0 / 360 boundary.
 *   - **notch** (when configured) removes a known periodic carrier —
 *     e.g. the ~1 Hz oscillation magnetometer fusion picks up from the
 *     device's own electronics or carrier frequencies in the ambient
 *     field.  A narrow biquad notch leaves all other frequencies
 *     essentially untouched, so legitimate slow pans pass through with
 *     no plateau-style staircase artifacts that velocity-based
 *     deadband heuristics introduce.
 *   - **base 1€ filter** smooths the residual broadband noise, with
 *     adaptive cutoff so fast pans aren't lagged.
 *
 * The base filter is injected so callers can swap our local 1€ impl
 * for the canonical `1eurofilter` package (see DeviceOrientationPoseSource
 * where USE_LIB_FILTER picks one).  Both expose the same `filter(x, t)`
 * + `reset()` shape.
 */
export default class AlphaPipeline {
  /**
   * @param {object} opts
   * @param {Function} opts.BaseFilter    Constructor for the base 1€ filter
   *   (`new BaseFilter(oneEuroOpts)` must yield an object with
   *   `filter(x, t)` and `reset()`).
   * @param {object} opts.oneEuroOpts     Passed straight to `BaseFilter`.
   * @param {object} [opts.notch]         Optional `BiquadNotch` instance.
   *   Pass `null` / omit to disable the notch stage.
   */
  constructor({BaseFilter, oneEuroOpts, notch = null}) {
    this._base = new BaseFilter(oneEuroOpts)
    this._notch = notch
    this._lastRawDeg = null
    this._unwrapped = 0
    this._tPrev = null
    this._lastUnwrapped = 0
    this._lastNotched = 0
  }


  /** Drop all filter state. */
  reset() {
    this._base.reset()
    if (this._notch) {
      this._notch.reset()
    }
    this._lastRawDeg = null
    this._unwrapped = 0
    this._tPrev = null
    this._lastUnwrapped = 0
    this._lastNotched = 0
  }


  /**
   * @param {number} rawDeg   Raw alpha in degrees, any range.
   * @param {number} t        Timestamp in seconds.
   * @returns {number}        Filtered, unwrapped alpha (degrees).
   */
  filter(rawDeg, t) {
    // Stage 1: unwrap.
    if (this._lastRawDeg === null) {
      this._unwrapped = rawDeg
    } else {
      let d = rawDeg - this._lastRawDeg
      if (d > HALF_TURN) {
        d -= FULL_TURN
      } else if (d < -HALF_TURN) {
        d += FULL_TURN
      }
      this._unwrapped += d
    }
    this._lastRawDeg = rawDeg
    this._lastUnwrapped = this._unwrapped

    // Stage 2: notch (optional).
    let value = this._unwrapped
    if (this._notch) {
      const dt = this._tPrev !== null ? t - this._tPrev : (1.0 / 60.0)
      value = this._notch.filter(value, dt)
    }
    this._tPrev = t
    this._lastNotched = value

    // Stage 3: base 1€ filter.
    return this._base.filter(value, t)
  }


  /**
   * @returns {{unwrapped: number, notched: number}}  Latest intermediate
   *   values from each stage.  Surface to the AR debug HUD so we can
   *   plot raw vs unwrapped vs notched vs filtered together.
   */
  getDebugIntermediates() {
    return {unwrapped: this._lastUnwrapped, notched: this._lastNotched}
  }
}


const HALF_TURN = 180
const FULL_TURN = 360
