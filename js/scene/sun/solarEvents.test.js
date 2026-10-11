import {describe, expect, it} from 'bun:test'
import {activeRegionsAt} from './activeRegions.js'
import {MS_PER_DAY, monthIndex, msAtMonths, sunspotNumber} from './solarCycle.js'
import {
  CME_RATE_PER_DAY,
  CYCLE23_M_FLARES,
  CYCLE23_X_FLARES,
  FLARE_M_FLUX,
  FLARE_X_FLUX,
  cmeRate,
  cmesAt,
  flareRate,
  flaresAt,
  goesClass,
  prominencesAt,
} from './solarEvents.js'


/**
 * @param {string} from
 * @param {string} to
 * @param {number} flux
 * @returns {number} The model's flares over the flux between two months
 */
function flaresBetween(from, to, flux) {
  let n = 0
  for (let m = monthIndex(from); m < monthIndex(to); m++) {
    n += flareRate(sunspotNumber(msAtMonths(m + 0.5)), flux) * (msAtMonths(1) / MS_PER_DAY)
  }
  return n
}


describe('flares', () => {
  it('come at cycle 23\'s rate: its 1,442 M flares, and its 126 X ones from the power law', () => {
    expect(flaresBetween('1996-05', '2008-12', FLARE_M_FLUX) - flaresBetween('1996-05', '2008-12', FLARE_X_FLUX))
        .toBeCloseTo(CYCLE23_M_FLARES, -2)
    const x = flaresBetween('1996-05', '2008-12', FLARE_X_FLUX)
    expect(x / CYCLE23_X_FLARES).toBeGreaterThan(0.8)
    expect(x / CYCLE23_X_FLARES).toBeLessThan(1.4)
    // Cycle 24, half as active, had 733 M and 49 X: the model's within 40%.
    const m24 = flaresBetween('2008-12', '2019-12', FLARE_M_FLUX)
    expect(m24 / (733 + 49)).toBeGreaterThan(0.6)
    expect(m24 / (733 + 49)).toBeLessThan(1.4)
  })


  it('are named by their GOES class', () => {
    expect(goesClass(2.3e-5)).toBe('M2.3')
    expect(goesClass(1e-4)).toBe('X1.0')
    expect(goesClass(5e-6)).toBe('C5.0')
  })


  it('under way at a date are the same in every session, with white light in some', () => {
    const start = Date.parse('2014-02-01T00:00Z')
    let seen = 0
    let white = 0
    for (let k = 0; k < 400; k++) {
      const ms = start + (k * 3600e3 * 7)
      const regions = activeRegionsAt(ms, 0)
      const flares = flaresAt(ms, regions, 0)
      seen += flares.length
      white += flares.filter((f) => f.whiteLight).length
      expect(flaresAt(ms, regions, 0)).toEqual(flares)
      for (const f of flares) {
        expect(ms).toBeGreaterThanOrEqual(f.start)
        expect(f.contrast).toBeLessThan(0.5)
      }
    }
    expect(seen).toBeGreaterThan(0)
    expect(white).toBeLessThan(seen)
  })
})


describe('CMEs', () => {
  it('half a day at minimum, about six at a strong maximum (Yashiro et al. 2004)', () => {
    expect(cmeRate(Date.parse('2008-12-15'))).toBeCloseTo(CME_RATE_PER_DAY[0], 0)
    expect(cmeRate(Date.parse('2001-11-15'))).toBeGreaterThan(5)
  })


  it('fly out at their speed from their launch', () => {
    const ms = Date.parse('2002-03-01T00:00Z')
    const cmes = cmesAt(ms, 0)
    expect(cmes.length).toBeGreaterThan(2)
    for (const c of cmes) {
      const hours = (ms - c.launch) / 3600e3
      expect(c.front).toBeCloseTo(1 + (c.speed * hours * 3600 / 695700), 6)
      expect(c.width).toBeLessThan(Math.PI / 2)
    }
    expect(cmesAt(ms, 0)).toEqual(cmes)
  })
})


describe('prominences', () => {
  it('more at maximum than minimum, and quiescent ones 15-100 Mm high', () => {
    const min = prominencesAt(Date.parse('2008-12-15T00:00Z'), 0)
    const max = prominencesAt(Date.parse('2001-11-15T00:00Z'), 0)
    expect(max.length).toBeGreaterThan(min.length * 1.5)
    for (const p of max.filter((x) => x.kind === 'quiescent')) {
      expect(p.height * 695.7).toBeGreaterThanOrEqual(15)
      expect(p.height * 695.7).toBeLessThanOrEqual(100)
      // The tangent lies along the surface.
      const dot = p.tangent.reduce((s, t, i) => s + (t * p.centre[i]), 0)
      expect(Math.abs(dot)).toBeLessThan(1e-9)
    }
  })
})
