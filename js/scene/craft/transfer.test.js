import {describe, expect, it} from 'bun:test'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {geocentricTracks} from './ephemeris.js'
import {EARTH_RADIUS, GM, SECONDS_PER_DAY, dopri5, ratesOf} from './integrator.js'
import {TOLERANCES, earthModel, lunarTransfer} from './transfer.js'


const vsop87c = await vsop87cLoader
const MOON_RADIUS = 1737400
// 2026 Nov 1 and 10, Dec 1, TT.
const DATES = [2461345.5, 2461354.5, 2461375.5]


describe('a transfer to the Moon', () => {
  const tracks = geocentricTracks({vsop: vsop87c})

  it('reaches a 100 km perilune from a 185 km parking orbit', () => {
    for (const jde of DATES) {
      const t = lunarTransfer(tracks, jde)
      expect(t).not.toBeNull()
      expect(t.perilune.r - MOON_RADIUS).toBeCloseTo(100e3, -1)
      expect(t.days).toBeCloseTo(4.5, 3)
      // The Hohmann ellipse's burn to the Moon's distance then, from 185 km:
      // the full model's is within 1%.
      const rp = EARTH_RADIUS + 185e3
      const ra = Math.hypot(...tracks.moon.at(jde + 4.5))
      const hohmann = Math.sqrt(2 * GM.earth * ra / (rp * (rp + ra))) - Math.sqrt(GM.earth / rp)
      expect(Math.abs((t.dv / hohmann) - 1)).toBeLessThan(0.01)
      expect(t.dv).toBeGreaterThan(3100)
      expect(t.dv).toBeLessThan(3170)
      // Flown again from the burn, it passes the Moon where it was aimed.
      const {y} = dopri5(ratesOf(earthModel(tracks, jde)), t.state, 0, t.perilune.t, TOLERANCES)
      const m = tracks.moon.at(jde + (t.perilune.t / SECONDS_PER_DAY))
      expect(Math.hypot(y[0] - m[0], y[1] - m[1], y[2] - m[2]) - MOON_RADIUS).toBeCloseTo(100e3, -2)
    }
  })

  it('arrives as fast as Apollo did: a lunar orbit insertion of 800 to 900 m/s', () => {
    // Apollo 11's: about 3.18 km/s from 185 km for a three-day flight, and
    // 889 m/s into a 111 by 313 km orbit (its mission report, quoted
    // second-hand: Craft.md).  Impulsive here, so a little less than its
    // six-minute burn's.
    const t = lunarTransfer(tracks, DATES[0], {days: 3, height: 111e3})
    expect(t.dv).toBeGreaterThan(3120)
    expect(t.dv).toBeLessThan(3185)
    const rp = t.perilune.r
    const ra = MOON_RADIUS + 313e3
    const loi = Math.hypot(...t.perilune.relV) - Math.sqrt(2 * GM.moon * ra / (rp * (rp + ra)))
    expect(loi).toBeGreaterThan(780)
    expect(loi).toBeLessThan(900)
  })
})
