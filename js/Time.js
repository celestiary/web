/**
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

    /** Controlled by UI clicks.. timeScale is basically 2^steps. */
    this.timeScaleSteps = 0

    const now = Date.now()
    this.startTime = now
    this.lastUpdate = now
    this.simTime = now
    this.simTimeElapsed = 0
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
    this.simTime += timeDelta * this.timeScale
    this.simTimeElapsed = this.simTime - this.startTime
    // console.log(`timeDelta: ${timeDelta}, sysTime: ${this.sysTime}, simTime: ${this.simTime}`
    //    + `simTimeSecs: ${this.simTimeSecs}, simTimeElapsed: ${this.simTimeElapsed}`);
    this.updateUi()
  }


  /** @param {number} unixTime In seconds */
  setTime(unixTime) {
    this.simTime = unixTime
  }


  /** */
  setTimeToNow() {
    this.timeScale = 1.0
    this.timeScaleSteps = 0
    this.simTime = this.sysTime
    this.updateTime()
  }


  /** @param delta -1, 0 or 1 for slower, reset or faster. */
  changeTimeScale(delta) {
    if (this.isPaused) {
      return
    }
    if (delta === 0) {
      this.timeScaleSteps = 0
    } else {
      this.timeScaleSteps += delta
    }
    this.timeScale = (this.timeScaleSteps < 0 ? -1 : 1) * Math.pow(2, Math.abs(this.timeScaleSteps))
  }


  /**
   */
  invertTimeScale() {
    this.timeScale *= -1
    this.timeScaleSteps *= -1
  }


  /**
   * Toggle pause state
   *
   * @returns {boolean} isPaused
   */
  togglePause() {
    if (this.isPaused) {
      this.isPaused = false
    } else {
      this.isPaused = true
    }
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


// See "Unix time" in table https://en.wikipedia.org/wiki/Julian_day
const unixEpoch = 1970
const julianEpoch = -4712
// TODO(pablo): hand searched to yield daysJulianToUnix ~= 2440587.5, as per article
const daysPerYear = 365.2480545
// 2440587.500169
const daysJulianToUnix = ((unixEpoch - julianEpoch) * daysPerYear)
const millisPerSec = 1000
const secsPerDay = 86400
const millisPerDay = millisPerSec * secsPerDay


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
