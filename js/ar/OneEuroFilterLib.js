/**
 * Drop-in replacement for `./OneEuroFilter.js` that uses Casiez's
 * canonical `1eurofilter` package for the underlying 1€ math.  The
 * base filter is the reference implementation by the algorithm's
 * author (Géry Casiez & Alix Goguey, BSD-3-Clause); using it here
 * means our deployed AR pipeline rides on top of canonical code that
 * gets upstream maintenance / fixes.
 *
 * The constructor signature, `filter(x, t)`, and `reset()` are
 * identical to the local impl so callers can swap imports without
 * touching anything else.  The thin wrapping is required only because
 * the lib uses positional constructor args (freq, mincutoff, beta,
 * dcutoff) while we prefer a named-options bag.
 */
import {OneEuroFilter as LibOneEuroFilter} from '1eurofilter'


/**
 * Default sampling-frequency seed for the lib (overridden by the
 * lib's own timestamp-driven adaptation on the second sample).
 */
const DEFAULT_SEED_FREQ_HZ = 60


export default class OneEuroFilter {
  /**
   * @param {object} [opts]            See `./OneEuroFilter.js` for full docs.
   * @param {number} [opts.minCutoff]
   * @param {number} [opts.beta]
   * @param {number} [opts.dCutoff]
   */
  constructor({minCutoff = 1.0, beta = 0.05, dCutoff = 1.0} = {}) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
    this._inner = new LibOneEuroFilter(DEFAULT_SEED_FREQ_HZ, minCutoff, beta, dCutoff)
  }


  /** Drop all filter state. */
  reset() {
    this._inner.reset()
  }


  /**
   * @param {number} x  New raw sample
   * @param {number} t  Timestamp in seconds
   * @returns {number}  Filtered sample
   */
  filter(x, t) {
    return this._inner.filter(x, t)
  }
}


/**
 * Same wrap-aware adapter as in `./OneEuroFilter.js`, but wrapping the
 * lib-backed inner filter.
 */
export class AngleOneEuroFilter {
  /** @param {object} [opts]  See `OneEuroFilter` constructor */
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
   * @param {number} rawDeg  Raw circular angle (any range)
   * @param {number} t       Timestamp in seconds
   * @returns {number}       Filtered angle (degrees, may be unwrapped)
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
