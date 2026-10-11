import {describe, expect, it} from 'bun:test'
import {TOTALITY_SKY, eclipsedSky, occluderSeen, ringCovered, visibleFraction} from './eclipse.js'


const R = 0.00465 // the Sun's angular radius from 1 AU, rad


describe('the visible share of a disc', () => {
  it('a ring inside, outside and across a circle', () => {
    expect(ringCovered(0.5, 0, 1)).toBe(1)
    expect(ringCovered(0.5, 3, 1)).toBe(0)
    expect(ringCovered(2, 0, 1)).toBe(0)
    // A ring through the circle's centre, of its radius: a third covered.
    expect(ringCovered(1, 1, 1)).toBeCloseTo(1 / 3, 9)
  })


  it('none past a larger concentric disc (totality), all with nothing in front', () => {
    expect(visibleFraction(R, [{separation: 0, radius: R * 1.05}])).toBe(0)
    expect(visibleFraction(R, [])).toBe(1)
    expect(visibleFraction(R, [{separation: 3 * R, radius: R}])).toBe(1)
  })


  it('an annular eclipse leaves the limb, darker by its limb darkening', () => {
    const uniform = visibleFraction(R, [{separation: 0, radius: R * 0.9}])
    // The annulus is 19% of the disc's area (the rings: within a ring's width).
    expect(Math.abs(uniform - 0.19)).toBeLessThan(0.012)
    const darkened = visibleFraction(R, [{separation: 0, radius: R * 0.9}], (mu) => 1 - (0.6 * (1 - mu)))
    expect(darkened).toBeLessThan(uniform)
  })


  it('a half-covered disc by an equal one passing its centre', () => {
    // Two equal discs a radius apart overlap by 39.1% of either.
    expect(visibleFraction(R, [{separation: R, radius: R}])).toBeCloseTo(1 - 0.391, 2)
  })


  it('an occluder from a point: its separation and angular radius; none behind', () => {
    const seen = occluderSeen([0, 0, 0], [0, 0, -1], [1e3, 0, -3.84e8], 1.7374e6)
    expect(seen.radius).toBeCloseTo(1.7374e6 / 3.84e8, 6)
    expect(seen.separation).toBeCloseTo(1e3 / 3.84e8, 9)
    expect(occluderSeen([0, 0, 0], [0, 0, -1], [0, 0, 3.84e8], 1.7e6)).toBeNull()
  })


  it('the sky in totality: ~1e-4 of the day\'s; uneclipsed or out of the air, as it was', () => {
    const sun = (f) => ({sunLayers: {visibleFractionExcept: () => f}})
    expect(eclipsedSky(sun(0), {}, true)).toBeCloseTo(TOTALITY_SKY, 12)
    expect(eclipsedSky(sun(1), {}, true)).toBe(1)
    expect(eclipsedSky(sun(0), {}, false)).toBe(1)
    expect(eclipsedSky(null, {}, true)).toBe(1)
    expect(eclipsedSky(sun(0.5), {}, true)).toBeCloseTo(0.5 + (TOTALITY_SKY / 2), 12)
  })
})
