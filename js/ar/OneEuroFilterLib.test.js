import {describe, expect, it} from 'bun:test'
import OneEuroFilter, {AngleOneEuroFilter} from './OneEuroFilterLib.js'


// Smoke tests for the lib-backed OneEuroFilter wrapper — the math itself
// is owned by the upstream `1eurofilter` package, so we don't re-prove
// the 1€ algorithm here.  We just verify the wrapper preserves our
// constructor / filter / reset surface and that the angle-unwrap
// adapter behaves the same as in `OneEuroFilter.js`, since callers swap
// between the two via a single import line.

describe('OneEuroFilterLib', () => {
  it('first sample passes through unchanged', () => {
    const f = new OneEuroFilter()
    expect(f.filter(7.0, 0)).toBe(7.0)
  })

  it('reset() restores fresh-sample behaviour', () => {
    const f = new OneEuroFilter()
    f.filter(5.0, 0)
    f.filter(5.0, 0.1)
    f.reset()
    expect(f.filter(99.0, 0.2)).toBe(99.0)
  })
})


describe('AngleOneEuroFilter (lib-backed) — circular handling', () => {
  it('passes a 359° → 1° wrap as a small positive delta', () => {
    const f = new AngleOneEuroFilter({minCutoff: 1.0, beta: 0.0})
    const dt = 1 / 60
    let t = 0
    f.filter(359, t); t += dt
    f.filter(0, t); t += dt
    const out = f.filter(1, t)
    expect(out).toBeGreaterThan(358)
    expect(out).toBeLessThan(362)
  })
})
