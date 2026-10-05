import {describe, expect, it} from 'bun:test'
import {noiseTime} from './Star.js'


describe('the Sun\'s surface noise time', () => {
  it('is finite for any simulated time, before the start as after it', () => {
    // A permalink with a past t= puts the simulated time before the app
    // started: log(1 + negative) was NaN from 21 minutes back.
    for (const ms of [0, 1e3, -1e3, -1.3e6, -1e9, -1e13, 1e13, Infinity, -Infinity, NaN]) {
      expect(Number.isFinite(noiseTime(ms))).toBe(true)
    }
    expect(noiseTime(0)).toBe(0)
    expect(noiseTime(-1e9)).toBe(noiseTime(1e9))
    expect(noiseTime(1e9)).toBeGreaterThan(noiseTime(1e6))
    // The old law, where it was finite.
    expect(noiseTime(1e6)).toBeCloseTo(4 * Math.log(1 + (1e6 * 8e-7)), 9)
  })
})
