/**
 * @returns {string}
 */
function timeToDateStr(time) {
  return new Date(time).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
}


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
    this.pause = false
    // UI
    this.lastUiUpdateTime = 0
    this.updateTime()
  }


  /**
   */
  updateTime() {
    const now = Date.now()
    const timeDelta = now - this.lastUpdate
    this.lastUpdate = now
    this.sysTime = now
    this.simTime += timeDelta * this.timeScale
    this.simTimeElapsed = this.simTime - this.startTime
    // console.log(`timeDelta: ${timeDelta}, sysTime: ${this.sysTime}, simTime: ${this.simTime}`
    //    + `simTimeSecs: ${this.simTimeSecs}, simTimeElapsed: ${this.simTimeElapsed}`);
    this.updateUi()
  }


  /**
   */
  setTimeToNow() {
    this.timeScale = 1.0
    this.timeScaleSteps = 0
    this.simTime = this.sysTime
    this.updateTime()
  }


  /** @param delta -1, 0 or 1 for slower, reset or faster. */
  changeTimeScale(delta) {
    if (this.pause) {
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
   */
  togglePause() {
    if (this.pause) {
      this.timeScale = this.timeScaleBeforePause
      this.pause = false
    } else {
      this.timeScaleBeforePause = this.timeScale
      this.timeScale = 0
      this.pause = true
    }
  }


  /**
   */
  updateUi() {
    if (this.sysTime > this.lastUiUpdateTime + 1000) {
      this.lastUiUpdateTime = this.sysTime
      this.setTimeStr(timeToDateStr(this.simTime))
    }
  }
}
