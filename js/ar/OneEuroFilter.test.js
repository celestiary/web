import {describe, expect, it} from 'bun:test'
import OneEuroFilter, {AngleOneEuroFilter, smoothingAlpha} from './OneEuroFilter.js'


describe('smoothingAlpha', () => {
  it('returns α in (0, 1) for typical inputs', () => {
    expect(smoothingAlpha(1.0, 1 / 60)).toBeGreaterThan(0)
    expect(smoothingAlpha(1.0, 1 / 60)).toBeLessThan(1)
  })

  it('grows monotonically with cutoff at fixed dt', () => {
    const dt = 1 / 60
    expect(smoothingAlpha(0.5, dt)).toBeLessThan(smoothingAlpha(2.0, dt))
    expect(smoothingAlpha(2.0, dt)).toBeLessThan(smoothingAlpha(10.0, dt))
  })

  it('grows monotonically with dt at fixed cutoff', () => {
    const c = 1.0
    expect(smoothingAlpha(c, 1 / 240)).toBeLessThan(smoothingAlpha(c, 1 / 60))
    expect(smoothingAlpha(c, 1 / 60)).toBeLessThan(smoothingAlpha(c, 1 / 10))
  })
})


describe('OneEuroFilter — basic behaviour', () => {
  it('first sample passes through unchanged', () => {
    const f = new OneEuroFilter()
    expect(f.filter(7.0, 0)).toBe(7.0)
  })

  it('non-monotonic timestamp is a no-op (returns last filtered)', () => {
    const f = new OneEuroFilter()
    f.filter(1.0, 0)
    const a = f.filter(2.0, 0.1)
    const b = f.filter(99.0, 0.05) // earlier than tPrev
    expect(b).toBe(a)
  })

  it('smooths a constant-with-jitter signal toward the mean', () => {
    // Stationary 10 ± 1 jitter at 60 Hz, minCutoff 0.5 Hz, beta low.
    const f = new OneEuroFilter({minCutoff: 0.5, beta: 0.0})
    const dt = 1 / 60
    let t = 0
    let last = 0
    // Warm up — first sample is identity, so iterate plenty.
    for (let i = 0; i < 200; i++) {
      const x = 10 + ((i % 2) ? 1 : -1) // ±1 square jitter
      last = f.filter(x, t)
      t += dt
    }
    // After convergence the filter should be very close to the mean (10).
    expect(Math.abs(last - 10)).toBeLessThan(0.2)
  })

  it('tracks a fast ramp without lagging far behind', () => {
    // Linear ramp: x = 10·t, sampled at 60 Hz.  With beta > 0 the
    // adaptive cutoff opens up and the filter follows.
    const f = new OneEuroFilter({minCutoff: 1.0, beta: 0.5})
    const dt = 1 / 60
    let t = 0
    let filtered = 0
    let truth = 0
    for (let i = 0; i < 60; i++) {
      truth = 10 * t
      filtered = f.filter(truth, t)
      t += dt
    }
    // After 1 s of ramp, filtered should be within ~1 unit of truth (10).
    expect(Math.abs(filtered - truth)).toBeLessThan(1.0)
  })

  it('reset() restores fresh-sample behaviour', () => {
    const f = new OneEuroFilter()
    f.filter(5.0, 0)
    f.filter(5.0, 0.1)
    f.reset()
    expect(f.filter(99.0, 0.2)).toBe(99.0)
  })
})


describe('AngleOneEuroFilter — circular handling', () => {
  it('passes a 359° → 1° wrap as a small positive delta, not −358°', () => {
    // Constant near-360 with a tiny wrap-crossing.  After warm-up the
    // unwrapped sequence should be ~ 359, 360, 361, 362, ... so the
    // filter sees a smooth positive ramp, not a giant negative jump.
    const f = new AngleOneEuroFilter({minCutoff: 1.0, beta: 0.0})
    const dt = 1 / 60
    let t = 0
    f.filter(359, t); t += dt
    f.filter(0, t); t += dt
    const out = f.filter(1, t)
    // Filter is heavily smoothed (beta=0, low cutoff) — it'll lag behind
    // the unwrapped sequence (359, 360, 361), but it should be at least
    // > 359 and well above the un-unwrapped naive value of ~0.
    expect(out).toBeGreaterThan(358)
    expect(out).toBeLessThan(362)
  })

  it('reset() clears wrap state', () => {
    const f = new AngleOneEuroFilter()
    f.filter(180, 0)
    f.filter(190, 0.1)
    f.reset()
    expect(f.filter(45, 0.2)).toBe(45)
  })
})
