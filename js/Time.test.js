import {afterEach, describe, expect, it, spyOn} from 'bun:test'
import Time, {
  MAX_SIM_TIME_MS,
  MAX_TIME_SCALE_STEPS,
  MIN_SIM_TIME_MS,
  SUPPORTED_YEARS_FROM_J2000,
  fromJulianDay,
  timeToDateStr,
  toJulianDay,
} from './Time'


// `toLocaleDateString` formats with an ICU-version-dependent separator
// between the date and the clock — "Apr 5 at 10:13" on some ICU builds,
// "Apr 5, 10:13" on others.  Both renderings are meaningfully equivalent
// for the human readers of the time HUD, so the assertions here only
// pin the year + month + day + clock components and accept either glue
// token.
const SEP = '(?:,| at)'


describe('Time', () => {
  describe('timeToDateStr', () => {
    it('handles start of unix epoch', () => {
      expect(timeToDateStr(0).toString()).toMatch(new RegExp(`^1970 Jan 1${SEP} 12:00:00 AM$`))
    })

    it('handles future', () => {
      expect(timeToDateStr(1000000000000000).toString())
          .toMatch(new RegExp(`^33,658 Sep 27${SEP} 1:46:40 AM$`))
    })

    it('handles past', () => {
      expect(timeToDateStr(-1000000000000000).toString())
          .toMatch(new RegExp(`^-29,719 Apr 5${SEP} 10:13:20 PM$`))
    })
  })

  describe('toJulianDay', () => {
    it('puts the Unix epoch at JD 2440587.5 exactly', () => {
      expect(toJulianDay(0)).toBe(2440587.5)
    })

    it('puts J2000.0 (2000-01-01 12:00) at JD 2451545.0', () => {
      // Within a microsecond (float64 JD resolution near 2.4e6 days).
      expect(Math.abs(toJulianDay(Date.UTC(2000, 0, 1, 12)) - 2451545.0) * 86400).toBeLessThan(1e-4)
    })

    it('round-trips with fromJulianDay', () => {
      const t = Date.UTC(2026, 8, 29, 14, 25)
      expect(Math.abs(fromJulianDay(toJulianDay(t)) - t)).toBeLessThan(1)
    })
  })

  describe('supported range', () => {
    const J2000_JD = 2451545
    const DAYS_PER_YEAR = 365.25
    const MS_PER_YEAR = DAYS_PER_YEAR * 86400000
    let nowSpy = null

    afterEach(() => {
      if (nowSpy) {
        nowSpy.mockRestore()
        nowSpy = null
      }
    })


    /**
     * A Time on a wall clock the test advances.
     *
     * @returns {{time: Time, strs: Array<string>, tick: Function}}
     */
    function clocked() {
      let now = Date.UTC(2026, 8, 30)
      nowSpy = spyOn(Date, 'now').mockImplementation(() => now)
      const strs = []
      const time = new Time((str) => strs.push(str))
      return {time, strs, tick: (ms) => {
        now += ms
        time.updateTime()
      }}
    }


    it('is J2000 ± 6000 Julian years', () => {
      expect(SUPPORTED_YEARS_FROM_J2000).toBe(6000)
      expect(toJulianDay(MIN_SIM_TIME_MS)).toBeCloseTo(J2000_JD - (6000 * DAYS_PER_YEAR), 6)
      expect(toJulianDay(MAX_SIM_TIME_MS)).toBeCloseTo(J2000_JD + (6000 * DAYS_PER_YEAR), 6)
    })


    it('clamps a date set past either end, and shows the clamped date', () => {
      const {time, strs} = clocked()
      for (const [ms, bound] of [
        [MAX_SIM_TIME_MS + 1, MAX_SIM_TIME_MS],
        [1e6 * MS_PER_YEAR, MAX_SIM_TIME_MS],
        [1e20, MAX_SIM_TIME_MS],
        [Infinity, MAX_SIM_TIME_MS],
        [MIN_SIM_TIME_MS - 1, MIN_SIM_TIME_MS],
        [-1e6 * MS_PER_YEAR, MIN_SIM_TIME_MS],
        [-Infinity, MIN_SIM_TIME_MS],
      ]) {
        time.setTime(ms)
        expect(time.simTime).toBe(bound)
        expect(time.atLimit).toBe(true)
        expect(strs[strs.length - 1]).toBe(timeToDateStr(bound))
        expect(strs[strs.length - 1]).not.toContain('NaN')
      }
      const inRange = Date.UTC(1500, 0, 1)
      time.setTime(inRange)
      expect(time.simTime).toBe(inRange)
      expect(time.atLimit).toBe(false)
    })


    it('ignores a NaN date', () => {
      const {time} = clocked()
      const before = time.simTime
      time.setTime(NaN)
      expect(time.simTime).toBe(before)
    })


    it('stops at the bounds under repeated jumps and the fastest rate, and never gives NaN', () => {
      const {time, tick} = clocked()
      for (let i = 0; i < 100; i++) {
        time.changeTimeScale(1)
      }
      expect(time.timeScaleSteps).toBe(MAX_TIME_SCALE_STEPS)
      expect(Number.isFinite(time.timeScale)).toBe(true)
      for (const sign of [1, -1]) {
        if (Math.sign(time.timeScale) !== sign) {
          time.invertTimeScale()
        }
        for (let i = 0; i < 1000; i++) {
          // Frames of 0 to 50 ms, and a jump of a million years every tenth.
          tick(i % 3 === 0 ? 0 : 50)
          if (i % 10 === 0) {
            time.setTime(time.simTime + (sign * 1e6 * MS_PER_YEAR))
          }
          const jd = time.simTimeJulianDay()
          expect(Number.isFinite(jd)).toBe(true)
          expect(time.simTime).toBeGreaterThanOrEqual(MIN_SIM_TIME_MS)
          expect(time.simTime).toBeLessThanOrEqual(MAX_SIM_TIME_MS)
        }
        expect(time.simTime).toBe(sign > 0 ? MAX_SIM_TIME_MS : MIN_SIM_TIME_MS)
        expect(time.atLimit).toBe(true)
      }
      // Reversed, it leaves the bound.
      time.invertTimeScale()
      tick(1)
      expect(time.simTime).toBeGreaterThan(MIN_SIM_TIME_MS)
      expect(time.atLimit).toBe(false)
    })
  })
})


describe('the rate while paused', () => {
  afterEach(() => {
    nowSpy?.mockRestore()
    nowSpy = null
  })

  let nowSpy = null


  /**
   * A paused Time on a wall clock the test advances.
   *
   * @returns {{time: Time, tick: Function}}
   */
  function pausedClock() {
    let now = Date.UTC(2026, 8, 30)
    nowSpy = spyOn(Date, 'now').mockImplementation(() => now)
    const time = new Time
    time.togglePause()
    return {time, tick: (ms) => {
      now += ms
      time.updateTime()
    }}
  }


  it('j, k and l (reverse, slower, faster) change the step while paused, without resuming', () => {
    const {time, tick} = pausedClock()
    const start = time.simTime
    time.changeTimeScale(1)
    time.changeTimeScale(1)
    expect(time.timeScale).toBe(4)
    time.changeTimeScale(-1)
    expect(time.timeScale).toBe(2)
    time.invertTimeScale()
    expect(time.timeScale).toBe(-2)
    expect(time.timeScaleSteps).toBe(-1)
    tick(1000)
    expect(time.isPaused).toBe(true)
    expect(time.simTime).toBe(start)
    // And the backslash key, back to real time.
    time.changeTimeScale(0)
    expect(time.timeScale).toBe(1)
  })

  it('resuming runs at the step set while paused', () => {
    const {time, tick} = pausedClock()
    const start = time.simTime
    for (let i = 0; i < 3; i++) {
      time.changeTimeScale(1)
    }
    expect(time.timeScale).toBe(8)
    time.togglePause()
    tick(1000)
    expect(time.simTime - start).toBe(8000)
    time.togglePause()
    time.invertTimeScale()
    time.togglePause()
    tick(1000)
    expect(time.simTime - start).toBe(0)
  })

  it('tells listeners of each change, paused or not, until they stop listening', () => {
    const {time} = pausedClock()
    let heard = 0
    const stop = time.onTimeScaleChange(() => heard++)
    time.changeTimeScale(1)
    time.changeTimeScale(-1)
    time.invertTimeScale()
    time.changeTimeScale(0)
    time.setTimeToNow()
    expect(heard).toBe(5)
    stop()
    time.changeTimeScale(1)
    expect(heard).toBe(5)
  })
})


describe('setRate and setPaused (a link\'s clock)', () => {
  it('sets the rate the keys reach, and says so', () => {
    const time = new Time
    let heard = 0
    time.onTimeScaleChange(() => heard++)
    time.setRate(8)
    expect([time.timeScale, time.timeScaleSteps]).toEqual([8, 3])
    time.setRate(-4)
    expect([time.timeScale, time.timeScaleSteps]).toEqual([-4, -2])
    time.setRate(1)
    expect([time.timeScale, time.timeScaleSteps]).toEqual([1, 0])
    expect(heard).toBe(3)
  })

  it('l and k go on from it, as from the keys\' own', () => {
    const time = new Time
    time.setRate(16)
    time.changeTimeScale(1)
    expect(time.timeScale).toBe(32)
    time.setRate(-16)
    time.changeTimeScale(-1)
    expect(time.timeScale).toBe(-32)
  })

  it('snaps to a power of two, within the range, and a bad one is real time', () => {
    const time = new Time
    time.setRate(10)
    expect(time.timeScale).toBe(8)
    time.setRate(1e30)
    expect(time.timeScale).toBe(2 ** MAX_TIME_SCALE_STEPS)
    time.setRate(0.2)
    expect(time.timeScale).toBe(1)
    for (const bad of [0, NaN, Infinity, undefined]) {
      time.setRate(8)
      time.setRate(bad)
      expect([time.timeScale, time.timeScaleSteps]).toEqual([1, 0])
    }
  })

  it('pauses and resumes to a given state, saying so once per change', () => {
    const time = new Time
    let heard = 0
    time.onTimeScaleChange(() => heard++)
    time.setPaused(false)
    expect(heard).toBe(0)
    time.setPaused(true)
    time.setPaused(true)
    expect(time.isPaused).toBe(true)
    expect(heard).toBe(1)
    time.setRate(4)
    time.setPaused(false)
    expect(time.isPaused).toBe(false)
    expect(time.timeScale).toBe(4)
  })

  it('setting the date says so too, for the link', () => {
    const time = new Time
    let heard = 0
    time.onTimeScaleChange(() => heard++)
    time.setTime(0)
    expect(heard).toBe(1)
  })
})
