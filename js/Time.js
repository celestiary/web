/**
 * The simulation clock.  Its date stays within the supported range,
 * MIN_SIM_TIME_MS to MAX_SIM_TIME_MS (J2000 ± SUPPORTED_YEARS_FROM_J2000):
 * time stops at a bound rather than running on to dates the ephemerides
 * can't evaluate.
 */
export default class Time {
  /**
   */
  constructor(setTimeStr = () => {/**/}) {
    /**
     * Time scale is applied to wall-clock time, so that by a larger time
     * scale will speed things up, 1 is real-time, (0,1) is slower than
     * realtime, 0 is paused, negative is backwards.
     */
    this.timeScale = 1.0
    this.timeScaleBeforePause = null

    /**
     * Controlled by UI clicks.. timeScale is basically 2^steps: signed
     * powers of two of real time, or while stepping by days of days a
     * second (stepUnit).  A link's rate is exact, and the steps the nearest.
     */
    this.timeScaleSteps = 0

    /**
     * Day steps (design/URLs.md, the `time:` token's `step=`): 0 runs the
     * clock continuously; N jumps it by N whole days at a time, each landed
     * at local apparent solar noon by `noonNear`, at timeScale / 86400 days
     * a second of the wall clock.
     */
    this.stepDays = 0
    /**
     * The solar noon nearest a date, at the view's meridian (Unix ms in and
     * out; Celestiary's, solarNoon.js), or null: the steps are then whole
     * days of the clock.
     */
    this.noonNear = null
    // Days run up on the wall clock and not yet stepped.
    this._stepCarry = 0

    /**
     * Called, with no arguments, when the rate, the pause or the date is
     * set (onTimeScaleChange): the display's cue, and the link's.
     */
    this._scaleListeners = new Set

    const now = Date.now()
    this.startTime = now
    this.lastUpdate = now
    this.simTime = now
    this.simTimeElapsed = 0
    /** Whether the date is held at a bound of the supported range. */
    this.atLimit = false
    this.setTimeStr = setTimeStr
    this.setTimeStr(timeToDateStr(this.simTime))
    this.isPaused = false
    // UI
    this.lastUiUpdateTime = 0
    this.updateTime()
  }


  /**
   * Update time to current system time (Date.now) and move simulation forward
   * by the delta since last update, multiplied by the current timeScale.
   */
  updateTime() {
    const now = Date.now()
    const timeDelta = now - this.lastUpdate
    this.lastUpdate = now
    this.sysTime = now
    if (this.isPaused) {
      return
    }
    if (this.stepDays > 0) {
      this._stepByDays(timeDelta)
    } else {
      this._setSimTime(this.simTime + (timeDelta * this.timeScale))
    }
    this.simTimeElapsed = this.simTime - this.startTime
    // console.log(`timeDelta: ${timeDelta}, sysTime: ${this.sysTime}, simTime: ${this.simTime}`
    //    + `simTimeSecs: ${this.simTimeSecs}, simTimeElapsed: ${this.simTimeElapsed}`);
    this.updateUi()
  }


  /**
   * While stepping by days: the wall clock's time at the rate runs up days,
   * and each whole step of them moves the date on by its days, landed at
   * solar noon (noonNear).  A frame steps no days, or one step or more:
   * at 30 days a second and 60 frames, a day every other frame.
   *
   * @param {number} wallMs Wall-clock milliseconds since the last update
   */
  _stepByDays(wallMs) {
    this._stepCarry += (wallMs * this.timeScale) / millisPerDay
    // A hair over, so a carry summed from frames to 6.9999999 is 7.
    const steps = this._stepCarry / this.stepDays
    const days = Math.trunc(steps + (Math.sign(steps) * STEP_EPSILON)) * this.stepDays
    if (days === 0) {
      return
    }
    this._stepCarry -= days
    const target = this.simTime + (days * millisPerDay)
    this._setSimTime(this.noonNear ? this.noonNear(target) : target)
  }


  /**
   * Step by days, at solar noon, or run continuously (0).  Entering, a rate
   * under a day a second becomes DEFAULT_STEP_DAYS_PER_SEC (its sign kept),
   * and the date lands on the nearest noon unless `land` is false (a link,
   * whose date is a noon already and whose camera isn't placed yet).
   * Leaving keeps the rate as a multiplier on real time.
   *
   * @param {number} days Days a step, a whole number; 0 or a bad one is off
   * @param {object} [opts]
   * @param {boolean} [opts.land]
   */
  setStepDays(days, {land = true} = {}) {
    const d = Number.isFinite(days) && days >= 1 ? Math.round(days) : 0
    if (d === this.stepDays) {
      return
    }
    const entering = this.stepDays === 0
    this.stepDays = d
    this._stepCarry = 0
    if (d && entering && Math.abs(this.timeScale) < secsPerDay) {
      this.timeScale = (this.timeScale < 0 ? -1 : 1) * DEFAULT_STEP_DAYS_PER_SEC * secsPerDay
    }
    this.timeScaleSteps = this._nearestSteps(this.timeScale)
    if (d && land && this.noonNear) {
      this._setSimTime(this.noonNear(this.simTime))
      this.setTimeStr(timeToDateStr(this.simTime))
    }
    this._notifyScaleChange()
  }


  /**
   * @returns {number} What a rate step multiplies: 1 (real time), or a
   *   day a second while stepping by days
   */
  get stepUnit() {
    return this.stepDays > 0 ? secsPerDay : 1
  }


  /** @returns {number} The most steps either way, for the unit */
  _maxSteps() {
    return this.stepDays > 0 ? MAX_STEP_DAY_STEPS : MAX_TIME_SCALE_STEPS
  }


  /**
   * @param {number} scale A multiplier on real time
   * @returns {number} The signed steps nearest it, in the unit
   */
  _nearestSteps(scale) {
    const steps = Math.min(Math.round(Math.log2(Math.max(Math.abs(scale) / this.stepUnit, 1))), this._maxSteps())
    // 'j' on real time leaves -1 at no steps (invertTimeScale).
    return (Math.sign(scale) * steps) + 0
  }


  /**
   * Set the date, clamped to the supported range, and show it (paused
   * too).  A NaN is ignored.
   *
   * @param {number} unixTime Unix epoch milliseconds
   */
  setTime(unixTime) {
    this._setSimTime(unixTime)
    this.setTimeStr(timeToDateStr(this.simTime))
    this._notifyScaleChange()
  }


  /** @param {number} ms Unix epoch milliseconds, clamped; NaN is ignored */
  _setSimTime(ms) {
    if (Number.isNaN(ms)) {
      return
    }
    this.simTime = clampSimTime(ms)
    this.atLimit = !(ms > MIN_SIM_TIME_MS && ms < MAX_SIM_TIME_MS)
  }


  /** */
  setTimeToNow() {
    this.stepDays = 0
    this._stepCarry = 0
    this.timeScale = 1.0
    this.timeScaleSteps = 0
    this.simTime = this.sysTime
    this.updateTime()
    this._notifyScaleChange()
  }


  /**
   * Set the rate by 'j', 'k', 'l' and the time panel's buttons, paused or
   * not: paused is when the step is often set, and resuming runs at it.
   * From an exact rate (a link's) they go on from the nearest step.  While
   * stepping by days the steps are of days a second; the reset (0) is real
   * time, out of day steps.
   *
   * @param delta -1, 0 or 1 for slower, reset or faster.
   */
  changeTimeScale(delta) {
    if (delta === 0) {
      this.stepDays = 0
      this._stepCarry = 0
      this.timeScaleSteps = 0
    } else {
      const max = this._maxSteps()
      this.timeScaleSteps = Math.min(Math.max(this.timeScaleSteps + delta, -max), max)
    }
    this.timeScale = (this.timeScaleSteps < 0 ? -1 : 1) * Math.pow(2, Math.abs(this.timeScaleSteps)) * this.stepUnit
    this._notifyScaleChange()
  }


  /**
   * Set the rate to a link's (design/URLs.md, the `time:` token's `rate=`),
   * paused or not: exactly as given, held to ±2^MAX_TIME_SCALE_STEPS, with
   * the keys' step the nearest to it, so `j`, `k` and `l` go on from there
   * by powers of two (after one the rate is a power of two again).  A zero
   * or a non-number is real time, or while stepping by days
   * DEFAULT_STEP_DAYS_PER_SEC.
   *
   * @param {number} rate Multiplier on real time; negative runs backwards
   */
  setRate(rate) {
    if (!Number.isFinite(rate) || rate === 0) {
      this.timeScale = this.stepDays > 0 ? DEFAULT_STEP_DAYS_PER_SEC * secsPerDay : 1
    } else {
      const max = Math.pow(2, MAX_TIME_SCALE_STEPS)
      this.timeScale = Math.min(Math.max(rate, -max), max)
    }
    this.timeScaleSteps = this._nearestSteps(this.timeScale)
    this._notifyScaleChange()
  }


  /**
   * Pause or resume, to a link's state (togglePause, to a given state).
   *
   * @param {boolean} paused
   */
  setPaused(paused) {
    if (this.isPaused !== paused) {
      this.togglePause()
    }
  }


  /**
   * Run time the other way, paused or not.
   */
  invertTimeScale() {
    this.timeScale *= -1
    this.timeScaleSteps *= -1
    this._notifyScaleChange()
  }


  /**
   * Hear of a change of the rate, of the pause, or of a date set (the
   * display's cue: paused, the clock's own updates, which the display
   * otherwise follows, are not coming; and the link's).
   *
   * @param {Function} fn
   * @returns {Function} Stops listening
   */
  onTimeScaleChange(fn) {
    this._scaleListeners.add(fn)
    return () => this._scaleListeners.delete(fn)
  }


  /** */
  _notifyScaleChange() {
    for (const fn of this._scaleListeners) {
      fn()
    }
  }


  /**
   * Toggle pause state
   *
   * @returns {boolean} isPaused
   */
  togglePause() {
    this.isPaused = !this.isPaused
    this._notifyScaleChange()
    return this.isPaused
  }


  /** Update the UI time string, rounding to nearest second */
  updateUi() {
    if (this.sysTime > this.lastUiUpdateTime + 1000) {
      this.lastUiUpdateTime = this.sysTime
      this.setTimeStr(timeToDateStr(this.simTime))
    }
  }

  /** @returns {number} Number of days since UNIX Epoch */
  simTimeDays() {
    return this.simTime / millisPerDay
  }


  /**
   * See "Unix time" in table https://en.wikipedia.org/wiki/Julian_day#Variants
   *
   * @returns {number} The Julian Day
   */
  simTimeJulianDay() {
    return toJulianDay(this.simTime)
  }


  /** @returns {number} Number of seconds since UNIX Epoch */
  simTimeSecs() {
    return this.simTime / millisPerSec
  }
}


// Julian Day of the Unix epoch, 1970-01-01 00:00 UTC: exactly 2440587.5
// (https://en.wikipedia.org/wiki/Julian_day, "Unix time").  It used to be
// derived as (1970 + 4712) × 365.2480545 = 2440587.500169, which ran every
// Julian Day 14.6 s ahead.
const daysJulianToUnix = 2440587.5
const millisPerSec = 1000
const secsPerDay = 86400
const millisPerDay = millisPerSec * secsPerDay


/**
 * The simulation's dates are J2000 ± this many Julian years, JD 260045 to
 * 4643045: 17 Nov −4001 (4002 BC, proleptic Gregorian, as Date counts) to
 * 15 Feb 8000.  The ephemerides are series in powers of time from J2000, and
 * degrade away from it:
 * - VSOP87C (the full series, not truncated) is documented to 1″ over
 *   ±4000 years for Mercury to Mars, ±2000 for Jupiter and Saturn and
 *   ±6000 for Uranus and Neptune.  Evaluated further out it stays
 *   plausible to about ±8000 years (Jupiter's distance first leaves its
 *   4.95–5.46 AU there), is wrong by ±20,000 (Jupiter at 7.6 AU), and at
 *   ±100,000 puts the planets thousands of AU out: light-year-sized orbits.
 * - The Moon's series (Meeus 47), the IAU 1976 precession, the ΔT
 *   polynomials and the mean elements' rates are fitted over centuries to
 *   a few millennia.
 * A JS Date ends at ±8.64e15 ms (±275,000 years), past which the readout
 * shows NaN.
 */
export const SUPPORTED_YEARS_FROM_J2000 = 6000

/** SUPPORTED_YEARS_FROM_J2000 in days, for Julian Day offsets. */
export const SUPPORTED_DAYS_FROM_J2000 = SUPPORTED_YEARS_FROM_J2000 * 365.25

// J2000.0, 2000-01-01 12:00 UTC (the clock is UTC; TT is 64 s ahead).
const J2000_UNIX_MS = 946728000000

/** The earliest simulation date, Unix epoch milliseconds. */
export const MIN_SIM_TIME_MS = J2000_UNIX_MS - (SUPPORTED_DAYS_FROM_J2000 * millisPerDay)

/** The latest, Unix epoch milliseconds. */
export const MAX_SIM_TIME_MS = J2000_UNIX_MS + (SUPPORTED_DAYS_FROM_J2000 * millisPerDay)

/**
 * The time rate is 2^steps; this many steps is ~35,000 years a second,
 * across the whole range in a third of a second.  Unbounded, 2^1024 is
 * Infinity, and Infinity × a zero frame delta is NaN.
 */
export const MAX_TIME_SCALE_STEPS = 40

/**
 * While stepping by days the steps are of days a second, 2^steps; this many
 * is 2^23 days a second (23,000 years), inside 2^MAX_TIME_SCALE_STEPS.
 */
export const MAX_STEP_DAY_STEPS = 23

// Of a step, for the carry's rounding (_stepByDays).
const STEP_EPSILON = 1e-9

/** Days a second on entering day steps from a slower rate: a year in 11 s. */
export const DEFAULT_STEP_DAYS_PER_SEC = 32


/**
 * @param {number} ms Unix epoch milliseconds
 * @returns {number} ms within [MIN_SIM_TIME_MS, MAX_SIM_TIME_MS]; NaN stays NaN
 */
export function clampSimTime(ms) {
  return Math.min(Math.max(ms, MIN_SIM_TIME_MS), MAX_SIM_TIME_MS)
}


/**
 * @param {number} t System time (millis since Unix epoch)
 * @returns {number} Julian date
 */
export function toJulianDay(t) {
  const daysUnix = (t / millisPerDay)
  const julianDate = daysUnix + daysJulianToUnix
  return julianDate
}


/**
 * @param {number} jd Julian Day number
 * @returns {number} Unix epoch milliseconds
 */
export function fromJulianDay(jd) {
  return (jd - daysJulianToUnix) * millisPerDay
}


/**
 * @param {number} unixTime UNIX Epoch milliseconds
 * @returns {string}
 */
export function timeToDateStr(unixTime) {
  const date = new Date(unixTime)

  // Assuming the month and day are provided in a modern context
  // Adjust the formatting as needed
  const dateWithoutYear = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    timezone: 'long',
  })

  // Use commas for large-looking years
  const year = date.getUTCFullYear()
  const yearStr = Math.abs(year) < 10000 ? (year).toString() : (year).toLocaleString()

  return `${yearStr} ${dateWithoutYear}`
}
