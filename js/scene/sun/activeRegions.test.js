import {describe, expect, it} from 'bun:test'
import {
  GW_MSH_PER_DAY,
  MEAN_GROUP_AREA_DAYS,
  MEAN_GROUP_LIFE_DAYS,
  MSH_PER_SN,
  SN_PER_VISIBLE_GROUP,
  activeRegionsAt,
  bodyUnit,
  emergenceRate,
  groupArea,
  groupTimes,
  regionsBornOn,
  spotRadius,
} from './activeRegions.js'
import {MS_PER_DAY, cyclesAt, sunspotNumber} from './solarCycle.js'


describe('a sunspot group', () => {
  it('grows, then decays parabolically over A0 / (10 MSH a day)', () => {
    const {growth, life} = groupTimes(500)
    expect(life).toBeCloseTo(500 / GW_MSH_PER_DAY, 9)
    expect(groupArea(500, growth, life, growth)).toBeCloseTo(500, 9)
    expect(groupArea(500, growth, life, growth + (life / 2))).toBeCloseTo(125, 9)
    expect(groupArea(500, growth, life, growth + life + 0.1)).toBe(0)
    expect(groupArea(500, growth, life, -1)).toBe(0)
  })


  it('a spot of A MSH is a cap of 2πA·10⁻⁶ sr', () => {
    const r = spotRadius(1000)
    // (radius² for its sine: within 0.02%)
    expect(2 * Math.PI * (1 - Math.cos(r)) / (2 * Math.PI * 1e-3)).toBeCloseTo(1, 3)
  })
})


describe('the active regions at a date', () => {
  it('are calibrated: at a steady number R, R/20.1 groups and 10 R MSH of spots on the visible disc', () => {
    // Steady state: the visible hemisphere holds half of the emergence
    // rate times the mean life (groups) and the mean area-days (area).
    const sn = 150
    const groups = emergenceRate(sn) / 2 * MEAN_GROUP_LIFE_DAYS
    expect(groups).toBeCloseTo(sn / SN_PER_VISIBLE_GROUP, 9)
    const area = emergenceRate(sn) / 2 * MEAN_GROUP_AREA_DAYS
    expect(area / (MSH_PER_SN * sn)).toBeGreaterThan(0.9)
    expect(area / (MSH_PER_SN * sn)).toBeLessThan(1.1)
  })


  it('over a year of a maximum, the drawn regions hold that area and number', () => {
    let groups = 0
    let area = 0
    let sn = 0
    const n = 60
    const start = Date.parse('2001-06-01T00:00Z')
    for (let k = 0; k < n; k++) {
      const ms = start + (k * 6 * MS_PER_DAY)
      const regions = activeRegionsAt(ms, 3)
      groups += regions.length / 2
      area += regions.reduce((s, r) => s + r.area, 0) / 2
      sn += sunspotNumber(ms)
    }
    // A heavy-tailed area distribution: a year's mean within 40%.
    expect((groups / n) / (sn / n / SN_PER_VISIBLE_GROUP)).toBeGreaterThan(0.75)
    expect((groups / n) / (sn / n / SN_PER_VISIBLE_GROUP)).toBeLessThan(1.25)
    expect((area / n) / (sn / n * MSH_PER_SN)).toBeGreaterThan(0.6)
    expect((area / n) / (sn / n * MSH_PER_SN)).toBeLessThan(1.4)
  })


  it('emerge in their cycle\'s zone (Spörer), and the same date gives the same Sun', () => {
    const ms = Date.parse('2023-01-15T00:00Z')
    const regions = activeRegionsAt(ms, 0)
    expect(regions.length).toBeGreaterThan(3)
    const zone = cyclesAt(ms).reduce((a, c) => (c.share > a.share ? c : a))
    const meanLat = regions.reduce((s, r) => s + Math.abs(r.lat), 0) / regions.length
    expect(Math.abs(meanLat - zone.latitude)).toBeLessThan(6)
    expect(activeRegionsAt(ms, 0)).toEqual(regions)
    // A different seed, a different Sun.
    expect(activeRegionsAt(ms, 1)).not.toEqual(regions)
    // At a deep minimum, few or none.
    expect(activeRegionsAt(Date.parse('2008-12-15T00:00Z'), 0).length).toBeLessThan(4)
  })


  it('are carried by the differential rotation, the leader ahead and nearer the equator', () => {
    const [r] = regionsBornOn(Math.floor(Date.parse('2014-02-01T00:00Z') / MS_PER_DAY), 2)
    const birthDay = r.birth / MS_PER_DAY
    const at = (days) => activeRegionsAt((birthDay + days) * MS_PER_DAY, 2).find((x) => x.id === r.id)
    const a = at(r.growth)
    const b = at(r.growth + 1)
    if (a && b) {
      const drift = ((b.lon - a.lon + 540) % 360) - 180
      expect(Math.abs(drift)).toBeLessThan(1)
    }
    const lead = a.leading.unit
    const follow = a.following.unit
    expect(Math.abs(Math.asin(lead[1]))).toBeLessThan(Math.abs(Math.asin(follow[1])))
    // Ahead: greater east longitude in the body frame.
    const lon = (u) => Math.atan2(-u[2], u[0])
    expect(((lon(lead) - lon(follow) + (3 * Math.PI)) % (2 * Math.PI)) - Math.PI).toBeGreaterThan(0)
  })


  it('places directions in the body frame: +Y north, +X the prime meridian, east toward −Z', () => {
    expect(bodyUnit(90, 0)[1]).toBeCloseTo(1, 9)
    expect(bodyUnit(0, 0)[0]).toBeCloseTo(1, 9)
    expect(bodyUnit(0, 90)[2]).toBeCloseTo(-1, 9)
  })
})
