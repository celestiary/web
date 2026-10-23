import {describe, expect, it} from 'bun:test'
import {sgp4, twoline2satrec} from 'satellite.js'
import {
  WINDOW_DAYS, inWindow, newSatRecord, parseCatalog, periodMinutes, rowToOmm, temePosition, temeToEquator,
  unixMsToJd,
} from './sgp4.js'


// Vallado's SGP4 verification case 00005 (Vanguard 1; Vallado, Crawford,
// Hujsak & Kelso 2006, "Revisiting Spacetrack Report #3", AIAA 2006-6753,
// sgp4-ver.tle and its tcppver.out): at the epoch, TEME, WGS-72.
const TLE_00005 = [
  '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
  '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
]
const VALLADO_00005_T0 = {x: 7022.46529266, y: -1400.08296755, z: 0.03995155}

// The same elements as CelesTrak's OMM JSON gives them.  2000 day
// 179.78495062 is June 27, 18:50:19.733568 UTC.
const OMM_00005 = {
  OBJECT_NAME: 'VANGUARD 1', OBJECT_ID: '1958-002B', NORAD_CAT_ID: 5,
  EPOCH: '2000-06-27T18:50:19.733568', MEAN_MOTION: 10.82419157, ECCENTRICITY: 0.1859667,
  INCLINATION: 34.2682, RA_OF_ASC_NODE: 348.7242, ARG_OF_PERICENTER: 331.7664, MEAN_ANOMALY: 19.3264,
  BSTAR: 0.28098e-4, MEAN_MOTION_DOT: 0.00000023, MEAN_MOTION_DDOT: 0,
}
const ROW_00005 = [5, 'VANGUARD 1', 'test', '1958-002B', '2000-06-27T18:50:19.733568', 10.82419157, 0.1859667,
  34.2682, 348.7242, 331.7664, 19.3264, 0.28098e-4, 0.00000023, 0]


const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)


describe('sgp4', () => {
  it('reproduces Vallado\'s verification case from the TLE (satellite.js)', () => {
    const p = sgp4(twoline2satrec(...TLE_00005), 0).position
    expect(dist(p, VALLADO_00005_T0)).toBeLessThan(1e-6)
  })

  it('starts from OMM as from the TLE, to metres, a day either side', () => {
    const rec = newSatRecord(OMM_00005, 'test')
    const tle = twoline2satrec(...TLE_00005)
    expect(rec.id).toBe(5)
    expect(rec.windowDays).toBe(WINDOW_DAYS.low)
    for (const minutes of [-1440, 0, 360, 1440]) {
      const jd = rec.epochJd + (minutes / 1440)
      const p = temePosition(rec, jd)
      expect(dist(p, sgp4(tle, minutes).position)).toBeLessThan(0.01)
    }
    expect(dist(temePosition(rec, rec.epochJd), VALLADO_00005_T0)).toBeLessThan(0.01)
  })

  it('reads a snapshot row as the OMM it came from', () => {
    expect(rowToOmm(ROW_00005)).toEqual(OMM_00005)
    const [rec] = parseCatalog({rows: [ROW_00005, [6, 'BAD', 'x', '', 'not a date', 0, 0, 0, 0, 0, 0, 0, 0, 0]]})
    expect(rec.name).toBe('VANGUARD 1')
    expect(rec.group).toBe('test')
    expect(rec.intlId).toBe('1958-002B')
    expect(periodMinutes(rec)).toBeCloseTo(133.04, 1)
  })

  it('draws a satellite only within its window round the epoch', () => {
    const rec = newSatRecord(OMM_00005)
    expect(inWindow(rec, rec.epochJd + 29.9)).toBe(true)
    expect(inWindow(rec, rec.epochJd - 30.1)).toBe(false)
    expect(temePosition(rec, rec.epochJd + 31)).toBeNull()
    expect(temePosition(rec, rec.epochJd + 31, true)).not.toBeNull()
    // GPS, 2 rev/day: a longer window.
    const gps = newSatRecord({...OMM_00005, MEAN_MOTION: 2.0056, ECCENTRICITY: 0.01})
    expect(gps.windowDays).toBe(WINDOW_DAYS.high)
  })

  it('takes TEME to the equator frame: x, z, -y in metres', () => {
    const out = {set(x, y, z) {
      Object.assign(this, {x, y, z})
      return this
    }}
    temeToEquator({x: 1, y: 2, z: 3}, out)
    expect([out.x, out.y, out.z]).toEqual([1000, 3000, -2000])
  })

  it('takes Unix time to the UTC Julian Day', () => {
    expect(unixMsToJd(0)).toBe(2440587.5)
    expect(unixMsToJd(Date.UTC(2000, 0, 1, 12))).toBe(2451545)
  })
})
