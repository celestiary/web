import {describe, expect, it} from 'bun:test'
import {
  STAR_MAG_MAX, clampStarMag, formatStarMag, roundStarMag, starMagGain, stepStarMag,
} from './starMagnitude.js'


describe('starMagGain', () => {
  it('is 2.5x the light a magnitude, 1 at the default', () => {
    expect(starMagGain(0)).toBe(1)
    expect(starMagGain(1)).toBeCloseTo(2.5119, 4)
    expect(starMagGain(5)).toBeCloseTo(100, 10)
    expect(starMagGain(-2.5)).toBeCloseTo(0.1, 10)
  })

  it('holds to the range', () => {
    expect(starMagGain(99)).toBeCloseTo(10 ** (0.4 * STAR_MAG_MAX), 6)
    expect(starMagGain(NaN)).toBe(1)
  })
})


describe('stepStarMag', () => {
  it('steps by half magnitudes and lands on exactly 0 coming back', () => {
    let mag = 0
    for (let i = 0; i < 17; i++) {
      mag = stepStarMag(mag, 1)
    }
    expect(mag).toBe(8.5)
    for (let i = 0; i < 17; i++) {
      mag = stepStarMag(mag, -1)
    }
    expect(Object.is(mag, 0)).toBe(true)
    // Down first, then up.
    for (let i = 0; i < 9; i++) {
      mag = stepStarMag(mag, -1)
    }
    expect(mag).toBe(-4.5)
    for (let i = 0; i < 9; i++) {
      mag = stepStarMag(mag, 1)
    }
    expect(Object.is(mag, 0)).toBe(true)
  })

  it('is never -0, which would read "-0.0" and put sm=-0 in the link', () => {
    expect(Object.is(stepStarMag(-0.5, 1), 0)).toBe(true)
    expect(Object.is(stepStarMag(0.5, -1), 0)).toBe(true)
    expect(Object.is(roundStarMag(-0.001), 0)).toBe(true)
  })

  it('snaps a linked value to the halves', () => {
    expect(stepStarMag(1.3, 1)).toBe(2)
    expect(stepStarMag(1.3, -1)).toBe(1)
    expect(stepStarMag(-1.3, -1)).toBe(-2)
  })

  it('stops at the range', () => {
    expect(stepStarMag(STAR_MAG_MAX, 1)).toBe(STAR_MAG_MAX)
    expect(stepStarMag(-STAR_MAG_MAX, -1)).toBe(-STAR_MAG_MAX)
  })
})


describe('roundStarMag and clampStarMag', () => {
  it('rounds to the link\'s two places', () => {
    expect(roundStarMag(1 / 3)).toBe(0.33)
    expect(roundStarMag(-2.5)).toBe(-2.5)
    expect(clampStarMag(-1e9)).toBe(-STAR_MAG_MAX)
    expect(clampStarMag(Infinity)).toBe(0)
    expect(clampStarMag(undefined)).toBe(0)
  })
})


describe('formatStarMag', () => {
  it('reads as EV does: signed, one decimal, "Stars 0 mag" at the default', () => {
    expect(formatStarMag(0)).toBe('Stars 0 mag')
    expect(formatStarMag(1)).toBe('Stars +1.0 mag')
    expect(formatStarMag(-1.5)).toBe('Stars -1.5 mag')
    expect(formatStarMag(0.04)).toBe('Stars 0 mag')
    expect(formatStarMag(-0.04)).toBe('Stars 0 mag')
  })
})
