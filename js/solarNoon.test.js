import {beforeAll, describe, expect, it} from 'bun:test'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import Time from './Time'
import {subsolarPoint} from './nightSide'
import {hourAngleDeg, solarNoonNear} from './solarNoon'


// The app's own ephemeris: VSOP87C's Earth, turned round to the Sun
// (Celestiary._sunAt).  From the package, not ./vsop.js, which
// Celestiary.test.js mocks for the whole process.
let vsopSun = null
beforeAll(async () => {
  const vsop87c = await vsop87cLoader
  vsopSun = (jd) => {
    const e = vsop87c(jd).earth
    return {x: -e.x, y: -e.y, z: -e.z}
  }
})

const DAY_MS = 86400000
const MIN_MS = 60000
const LNGS = [-122.4, 0, 70, 151.2]
const DATES = [Date.UTC(2026, 2, 20, 9), Date.UTC(2026, 5, 21, 23), Date.UTC(2026, 10, 3, 4), Date.UTC(2027, 1, 11, 15)]


describe('solarNoonNear', () => {
  it('puts the Sun on the meridian, within half a day of the date', () => {
    for (const lng of LNGS) {
      for (const ms of DATES) {
        const noon = solarNoonNear(ms, lng, vsopSun)
        // 1e-4 degrees is 0.024 s of time.
        expect(Math.abs(hourAngleDeg(noon, lng, vsopSun))).toBeLessThan(1e-4)
        expect(Math.abs(noon - ms)).toBeLessThanOrEqual(DAY_MS / 2)
      }
    }
  })

  it('is apparent noon: the equation of time\'s known days, at Greenwich', () => {
    // The Sun is 16.4 min fast on 3 November and 14.2 min slow on 11
    // February (the equation of time's extremes).
    const nov = solarNoonNear(Date.UTC(2026, 10, 3, 12), 0, vsopSun) - Date.UTC(2026, 10, 3, 12)
    const feb = solarNoonNear(Date.UTC(2027, 1, 11, 12), 0, vsopSun) - Date.UTC(2027, 1, 11, 12)
    expect(nov / MIN_MS).toBeCloseTo(-16.4, 0)
    expect(feb / MIN_MS).toBeCloseTo(14.2, 0)
  })
})


describe('day steps at solar noon (Time.setStepDays)', () => {
  /**
   * A Time on a wall clock the test advances, stepping by days at noon at
   * a meridian, on VSOP87C's Sun.
   *
   * @param {number} lng
   * @param {number} start
   * @returns {{time: Time, frame: Function, restore: Function}}
   */
  function stepping(lng, start) {
    let now = Date.UTC(2026, 8, 30)
    const real = Date.now
    Date.now = () => now
    const time = new Time
    time.setTime(start)
    time.noonNear = (ms) => solarNoonNear(ms, lng, vsopSun)
    return {time, frame: (ms) => {
      now += ms
      time.updateTime()
    }, restore: () => {
      Date.now = real
    }}
  }


  it('holds the Sun over the meridian through a year, its declination going round the seasons', () => {
    // VSOP87C is ~2 ms a call: one longitude, read on the frames that step.
    for (const lng of [70]) {
      const {time, frame, restore} = stepping(lng, Date.UTC(2026, 0, 1, 3))
      try {
        time.setStepDays(1)
        time.setRate(30 * 86400)
        let worst = 0
        const lats = []
        let days = 0
        const start = time.simTime
        // 30 days a second at 60 frames a second: a year in 12.2 s.
        for (let i = 0; i < 730; i++) {
          const before = time.simTime
          frame(1000 / 60)
          if (time.simTime === before) {
            continue
          }
          worst = Math.max(worst, Math.abs(hourAngleDeg(time.simTime, lng, vsopSun)))
          lats.push(subsolarPoint(time.simTime, vsopSun).lat)
          days = Math.round((time.simTime - start) / DAY_MS)
        }
        expect(worst).toBeLessThan(1e-4)
        expect(days).toBe(365)
        expect(Math.max(...lats)).toBeGreaterThan(23.4)
        expect(Math.min(...lats)).toBeLessThan(-23.4)
      } finally {
        restore()
      }
    }
  }, 30000)

  it('removes the equation of time, which steps of 86400 s leave', () => {
    const lng = 70
    const start = solarNoonNear(Date.UTC(2026, 0, 1, 7), lng, vsopSun)
    const fixed = []
    for (let d = 0; d < 365; d++) {
      fixed.push(hourAngleDeg(start + (d * DAY_MS), lng, vsopSun))
    }
    // Clock-time days: the Sun wanders 7.6 degrees east to west and back
    // (the equation of time's -14 to +16 minutes).
    expect(Math.max(...fixed) - Math.min(...fixed)).toBeGreaterThan(7)
    const {time, frame, restore} = stepping(lng, start)
    try {
      time.setStepDays(1)
      time.setRate(86400)
      let worst = 0
      for (let d = 0; d < 365; d++) {
        frame(1000)
        worst = Math.max(worst, Math.abs(hourAngleDeg(time.simTime, lng, vsopSun)))
      }
      expect(worst).toBeLessThan(1e-4)
    } finally {
      restore()
    }
  }, 30000)
})
