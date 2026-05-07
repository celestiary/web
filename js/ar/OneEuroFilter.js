/**
 * 1€ filter — Casiez, Roussel & Vogel (2012),
 * https://gery.casiez.net/1euro/
 *
 * A first-order low-pass on the signal whose cutoff frequency adapts to
 * the smoothed magnitude of the signal's first derivative.  The effect
 * is exactly what hand-held AR tracking needs:
 *
 *   - At rest (low |dx/dt|), cutoff drops to `minCutoff` → strong
 *     smoothing kills the few-degree micro-jitter from hand tremor and
 *     magnetometer/accelerometer noise.
 *   - During genuine motion (high |dx/dt|), cutoff scales up by `beta`
 *     × |dx/dt| → filter becomes responsive, lag stays bounded.
 *
 * One filter per scalar axis; for orientation data, run three of these
 * over alpha / beta / gamma independently before composing into the
 * Three.js quaternion.  Quaternion-domain 1€ filters exist but are
 * overkill here: at the noise scale we're filtering (~few degrees), the
 * coupling between the Euler axes is irrelevant.
 *
 * Tuning rules of thumb:
 *   - Increase `minCutoff` if the filter feels laggy at rest.
 *   - Decrease `minCutoff` if jitter at rest is still visible.
 *   - Increase `beta` if fast motion feels laggy.
 *   - Decrease `beta` if fast motion overshoots / wobbles.
 *
 * Use `OneEuroFilterLib` (the canonical `1eurofilter` package) for the
 * authoritative reference implementation; this local class exists so
 * tests and callers have a dependency-free path with the same surface.
 */
export default class OneEuroFilter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.minCutoff]  Baseline cutoff frequency in Hz; default 1.0.
   * @param {number} [opts.beta]       Speed-adaptive coefficient; default 0.05.
   * @param {number} [opts.dCutoff]    Cutoff for the derivative EMA; default 1.0.
   */
  constructor({minCutoff = 1.0, beta = 0.05, dCutoff = 1.0} = {}) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
    this._xPrev = null
    this._dxPrev = 0
    this._tPrev = null
  }


  /** Drop all filter state.  Next `filter()` will treat its input as a fresh sample. */
  reset() {
    this._xPrev = null
    this._dxPrev = 0
    this._tPrev = null
  }


  /**
   * @param {number} x  New raw sample
   * @param {number} t  Timestamp in seconds (any monotonically increasing clock)
   * @returns {number}  Filtered sample
   */
  filter(x, t) {
    if (this._xPrev === null || this._tPrev === null) {
      this._xPrev = x
      this._tPrev = t
      return x
    }
    const dt = t - this._tPrev
    if (!(dt > 0)) {
      // Duplicate / out-of-order timestamp — skip update, keep last filtered.
      return this._xPrev
    }
    // Derivative, smoothed at fixed cutoff (dCutoff).
    const dx = (x - this._xPrev) / dt
    const edx = lerp(this._dxPrev, dx, smoothingAlpha(this.dCutoff, dt))
    // Adaptive cutoff: faster motion → higher cutoff → less smoothing.
    const cutoff = this.minCutoff + (this.beta * Math.abs(edx))
    const xFiltered = lerp(this._xPrev, x, smoothingAlpha(cutoff, dt))
    this._xPrev = xFiltered
    this._dxPrev = edx
    this._tPrev = t
    return xFiltered
  }
}


/**
 * Convert a low-pass cutoff frequency + time-step to the EMA blend factor
 * α used in `lerp(prev, curr, α)`.  Derived from the analog single-pole
 * RC low-pass: τ = 1/(2πfₒ); α = 1/(1 + τ/Δt).
 *
 * @param {number} cutoffHz
 * @param {number} dtSec
 * @returns {number} α in (0, 1]
 */
export function smoothingAlpha(cutoffHz, dtSec) {
  const tau = 1.0 / (2.0 * Math.PI * cutoffHz)
  return 1.0 / (1.0 + (tau / dtSec))
}


/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number} a + (b - a) * t
 */
function lerp(a, b, t) {
  return a + ((b - a) * t)
}


/**
 * Adapter for circular angle signals (e.g. DeviceOrientation alpha,
 * which is in [0, 360) and wraps).  Maintains an unwrapped running
 * total so the underlying `OneEuroFilter` sees a continuous signal —
 * a 359° → 1° wrap reads as +2°, not −358°.
 *
 * Pass the result to `composeDeviceToEnu` (or anywhere that treats
 * Euler angles as continuous radians); no need to re-wrap.
 */
export class AngleOneEuroFilter {
  /** @param {object} [opts]  Same shape as `OneEuroFilter`'s options */
  constructor(opts) {
    this._inner = new OneEuroFilter(opts)
    this._lastRaw = null
    this._unwrapped = 0
  }


  /** Drop all filter state. */
  reset() {
    this._inner.reset()
    this._lastRaw = null
    this._unwrapped = 0
  }


  /**
   * @param {number} rawDeg  Raw circular angle, degrees, any range
   * @param {number} t       Timestamp in seconds
   * @returns {number}       Filtered angle, degrees (unwrapped — may be outside [0, 360))
   */
  filter(rawDeg, t) {
    if (this._lastRaw === null) {
      this._lastRaw = rawDeg
      this._unwrapped = rawDeg
      return this._inner.filter(rawDeg, t)
    }
    let delta = rawDeg - this._lastRaw
    if (delta > HALF_TURN) {
      delta -= FULL_TURN
    } else if (delta < -HALF_TURN) {
      delta += FULL_TURN
    }
    this._unwrapped += delta
    this._lastRaw = rawDeg
    return this._inner.filter(this._unwrapped, t)
  }
}


const HALF_TURN = 180
const FULL_TURN = 360
