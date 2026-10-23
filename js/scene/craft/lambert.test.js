import {describe, expect, it} from 'bun:test'
import {GM, dopri5, newForceModel, ratesOf} from './integrator.js'
import {lambert, stumpff} from './lambert.js'


const gm = GM.sun
const AU = 149597870700
const DAY = 86400
const TIGHT = {rtol: 1e-12, atol: [1, 1, 1, 1e-6, 1e-6, 1e-6]}


describe('Lambert\'s problem', () => {
  it('has Stumpff\'s functions continuous through zero', () => {
    for (const [z, c, s] of [[1e-9, 0.5, 1 / 6], [-1e-9, 0.5, 1 / 6]]) {
      const [C, S] = stumpff(z)
      expect(C).toBeCloseTo(c, 9)
      expect(S).toBeCloseTo(s, 9)
    }
    const [C, S] = stumpff(1e-7)
    expect(C).toBeCloseTo(stumpff(-1e-7)[0], 7)
    expect(S).toBeCloseTo(stumpff(-1e-7)[1], 7)
  })

  it('finds the arc that lands where and when it was asked', () => {
    // Earth to Mars, both ways round, and a hyperbolic hop.
    const accel = newForceModel({gm, epoch: 2451545})
    const r1 = [AU, 0, 0]
    for (const [r2, days] of [[[-1.2 * AU, 0.9 * AU, 0.05 * AU], 250], [[0.3 * AU, -1.5 * AU, 0], 300],
      [[0, 1.4 * AU, 0], 20]]) {
      const arc = lambert(r1, r2, days * DAY, gm)
      expect(arc).not.toBeNull()
      const {y} = dopri5(ratesOf(accel), [...r1, ...arc.v1], 0, days * DAY, TIGHT)
      expect(Math.hypot(y[0] - r2[0], y[1] - r2[1], y[2] - r2[2]) / AU).toBeLessThan(1e-8)
      // And the arrival velocity it gives.
      expect(Math.hypot(y[3] - arc.v2[0], y[4] - arc.v2[1], y[5] - arc.v2[2])).toBeLessThan(1e-3)
    }
  })

  it('goes the long way round when the motion asks', () => {
    // From +x to +y, prograde, is a quarter turn; retrograde (the pole
    // reversed), three quarters.
    const short = lambert([AU, 0, 0], [0, AU, 0], 100 * DAY, gm)
    const long = lambert([AU, 0, 0], [0, AU, 0], 100 * DAY, gm, [0, 0, -1])
    expect(short.v1[1]).toBeGreaterThan(0)
    expect(long.v1[1]).toBeLessThan(0)
  })

  it('matches Vallado\'s example 7-5', () => {
    // Vallado, "Fundamentals of Astrodynamics", 4th ed., example 7-5: from
    // (15945.34, 0, 0) km to (12214.83899, 10249.46731, 0) km in 76 min,
    // the short way: v1 (2.058913, 2.915965, 0) km/s.
    const arc = lambert([15945.34e3, 0, 0], [12214.83899e3, 10249.46731e3, 0], 76 * 60, GM.earth)
    expect(arc.v1[0] / 1000).toBeCloseTo(2.058913, 4)
    expect(arc.v1[1] / 1000).toBeCloseTo(2.915965, 4)
  })
})
