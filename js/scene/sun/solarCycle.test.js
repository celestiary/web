import {afterEach, describe, expect, it} from 'bun:test'
import data from './sunspots.json'
import {
  CARRINGTON_DEG_PER_DAY,
  HANDOVER_MONTHS,
  KNOWN_CYCLES,
  MEAN_CYCLE_MONTHS,
  ZONE_DECAY_MONTHS,
  ZONE_START_DEG,
  activityLevel,
  cycle,
  cyclesAt,
  modelSunspotNumber,
  monthIndex,
  msAtMonths,
  rotationRate,
  setObservedSeries,
  smoothedSunspotNumber,
  spotZone,
  sunspotNumber,
  sunspotSource,
} from './solarCycle.js'


const mid = (tag) => msAtMonths(monthIndex(tag) + 0.5)


describe('the sunspot number by date', () => {
  afterEach(() => setObservedSeries(null))


  it('is SWPC\'s observed count from 1997, its forecast after, the model before and beyond', () => {
    expect(data.observed.start).toBe('1997-01')
    expect(sunspotSource(mid('1996-12'))).toBe('model')
    expect(sunspotSource(mid('1997-02'))).toBe('observed')
    expect(sunspotSource(mid('2024-04'))).toBe('observed')
    expect(sunspotSource(mid(data.predicted.start))).toBe('predicted')
    expect(sunspotSource(mid('2032-06'))).toBe('model')
    // A month's middle is its own value.
    const i = monthIndex('2014-04') - monthIndex(data.observed.start)
    expect(sunspotNumber(mid('2014-04'))).toBeCloseTo(data.observed.ssn[i], 6)
  })


  it('hands over to the model past the forecast without a step', () => {
    const end = monthIndex(data.predicted.start) + data.predicted.ssn.length
    let prev = sunspotNumber(msAtMonths(end - 1))
    for (let m = end - 1; m < end + HANDOVER_MONTHS + 2; m += 0.25) {
      const v = sunspotNumber(msAtMonths(m))
      expect(Math.abs(v - prev)).toBeLessThan(3)
      prev = v
    }
  })


  it('the model reproduces the cycles it is given, and the known ones\' minima', () => {
    for (const c of KNOWN_CYCLES) {
      expect(c.peak).toBeGreaterThan(100)
      // At its maximum the cycle's own number is its peak; the sum with
      // its neighbours' tails a little more.
      const atMax = modelSunspotNumber(msAtMonths(c.maximum))
      expect(atMax / c.peak).toBeGreaterThan(0.99)
      expect(atMax / c.peak).toBeLessThan(1.1)
    }
    // Cycles 24 and 25 began at SWPC's smoothed minima: November 2008 (on
    // SILSO's series, December) and December 2019.
    expect(KNOWN_CYCLES.find((c) => c.cycle === 24).minimum).toBe(monthIndex('2008-11'))
    expect(KNOWN_CYCLES.find((c) => c.cycle === 25).minimum).toBe(monthIndex('2019-12'))
    // A modelled cycle is the mean one, the mean length on.
    expect(cycle(26).minimum - cycle(25).minimum).toBeCloseTo(MEAN_CYCLE_MONTHS, 9)
    expect(cycle(26).modelled).toBe(true)
    expect(cycle(20).maximum).toBeLessThan(cycle(21).minimum)
  })


  it('the smoothed number and the level follow the cycle', () => {
    expect(smoothedSunspotNumber(mid('2008-12'))).toBeLessThan(10)
    expect(smoothedSunspotNumber(mid('2014-04'))).toBeGreaterThan(100)
    expect(activityLevel(mid('2001-11'))).toBeGreaterThan(0.9)
    expect(activityLevel(mid('2019-12'))).toBeLessThan(0.05)
  })


  it('takes another observed series through the hook', () => {
    setObservedSeries({start: '1990-01', ssn: [100, 200, null, 300]})
    expect(sunspotSource(mid('1990-01'))).toBe('observed')
    expect(sunspotNumber(mid('1990-01'))).toBe(100)
    expect(sunspotNumber(msAtMonths(monthIndex('1990-01') + 1))).toBeCloseTo(150, 6)
    // A gap takes its neighbour.
    expect(sunspotNumber(mid('1990-03'))).toBe(300)
    setObservedSeries(null)
    expect(sunspotSource(mid('1990-01'))).toBe('model')
  })
})


describe('the spot zones and the rotation', () => {
  it('Spörer\'s law: 28° at a cycle\'s start, falling by e in 90 months', () => {
    expect(spotZone(0, 0).latitude).toBe(ZONE_START_DEG)
    expect(spotZone(ZONE_DECAY_MONTHS, 1).latitude).toBeCloseTo(ZONE_START_DEG / Math.E, 9)
    expect(spotZone(0, 0).width).toBeLessThan(spotZone(0, 1).width)
  })


  it('at a minimum two cycles overlap: the old one\'s spots low, the new one\'s high', () => {
    const zones = cyclesAt(mid('2020-06')).filter((c) => c.share > 0.05)
    expect(zones.length).toBe(2)
    const [old, young] = zones.sort((a, b) => a.cycle - b.cycle)
    expect(old.latitude).toBeLessThan(8)
    expect(young.latitude).toBeGreaterThan(20)
  })


  it('turns faster at the equator; the Carrington rate is 26° latitude\'s by this fit', () => {
    expect(rotationRate(0)).toBeCloseTo(14.713, 6)
    expect(rotationRate(60)).toBeLessThan(rotationRate(30))
    let lat = 0
    while (rotationRate(lat) > CARRINGTON_DEG_PER_DAY) {
      lat += 0.1
    }
    expect(lat).toBeGreaterThan(25)
    expect(lat).toBeLessThan(27)
  })
})
