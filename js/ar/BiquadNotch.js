/**
 * Single-band IIR notch filter (biquad, direct form I), RBJ cookbook
 * formulation — https://www.w3.org/TR/audio-eq-cookbook/
 *
 * Transfer function (after normalising by a0 = 1 + α):
 *   H(z) = (b0 + b1·z⁻¹ + b2·z⁻²) / (1 + a1·z⁻¹ + a2·z⁻²)
 *   ω₀ = 2π·f₀/fs
 *   α  = sin(ω₀) / (2·Q)
 *   b0 = 1,                    b1 = -2·cos(ω₀),                b2 = 1
 *   a0 = 1 + α,                a1 = -2·cos(ω₀),                a2 = 1 - α
 *
 * Properties:
 *   - Unity gain at DC and at Nyquist (key vs the simpler pole-zero
 *     form — that one has DC gain (2−2c)/(1+r²−2rc) which is < 1 unless
 *     r → 1, and would scale slow drift down along with the notch).
 *   - Deep null at f₀ (limit: −∞ dB; in practice limited by float
 *     precision, ~−300 dB).
 *   - −3 dB bandwidth Δf ≈ f₀ / Q.  Q ≈ 5 means Δf = 0.2 f₀, which
 *     is sharp enough to leave nearby motion frequencies untouched
 *     while crushing the carrier.
 *
 * Coefficients are recomputed per sample from the actual `dt`, so
 * a varying event rate (DeviceOrientation can deliver anywhere from
 * 30–100 Hz across vendors) doesn't shift the notch frequency in the
 * time domain.  Cost is a few trig + muls per sample — negligible.
 */
export default class BiquadNotch {
  /**
   * @param {object} opts
   * @param {number} opts.f0Hz   Frequency to null out (Hz).
   * @param {number} [opts.Q]    Quality factor; higher = narrower notch,
   *   slower settle.  Default 5 (≈ 0.2·f₀ bandwidth).
   */
  constructor({f0Hz, Q = 5} = {}) {
    if (!(f0Hz > 0)) {
      throw new Error(`BiquadNotch: f0Hz must be > 0 (got ${f0Hz})`)
    }
    if (!(Q > 0)) {
      throw new Error(`BiquadNotch: Q must be > 0 (got ${Q})`)
    }
    this.f0Hz = f0Hz
    this.Q = Q
    this._x1 = 0
    this._x2 = 0
    this._y1 = 0
    this._y2 = 0
    this._initialized = false
  }


  /** Drop all delay-line state. */
  reset() {
    this._x1 = 0
    this._x2 = 0
    this._y1 = 0
    this._y2 = 0
    this._initialized = false
  }


  /**
   * @param {number} x   New raw sample.
   * @param {number} dt  Time since previous sample (seconds, > 0).  On
   *   the very first call, the delay lines are seeded with `x` so a
   *   constant input rides through clean (no startup ring).
   * @returns {number}   Filtered sample.
   */
  filter(x, dt) {
    if (!(dt > 0)) {
      // Repeated / out-of-order timestamp — no update, return last output.
      return this._y1
    }
    if (!this._initialized) {
      this._x1 = this._x2 = x
      this._y1 = this._y2 = x
      this._initialized = true
      return x
    }
    const fs = 1.0 / dt
    const omega = (2.0 * Math.PI * this.f0Hz) / fs
    const sinW = Math.sin(omega)
    const cosW = Math.cos(omega)
    const alpha = sinW / (2.0 * this.Q)
    const a0 = 1.0 + alpha
    // Normalised coefficients (b0/a0, b1/a0, ...).  Hoist 1/a0 once.
    const inv = 1.0 / a0
    const b0 = inv
    const b1 = -2.0 * cosW * inv
    const b2 = inv
    const a1 = -2.0 * cosW * inv
    const a2 = (1.0 - alpha) * inv
    const y = (b0 * x) + (b1 * this._x1) + (b2 * this._x2) -
              (a1 * this._y1) - (a2 * this._y2)
    this._x2 = this._x1
    this._x1 = x
    this._y2 = this._y1
    this._y1 = y
    return y
  }
}
