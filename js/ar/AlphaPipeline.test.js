import {describe, expect, it} from 'bun:test'
import AlphaPipeline from './AlphaPipeline.js'
import BiquadNotch from './BiquadNotch.js'
import OneEuroFilter from './OneEuroFilter.js'


describe('AlphaPipeline', () => {
  it('first sample passes through unchanged', () => {
    const p = new AlphaPipeline({
      BaseFilter: OneEuroFilter,
      oneEuroOpts: {minCutoff: 1.0, beta: 0.0},
    })
    expect(p.filter(180, 0)).toBe(180)
  })


  it('unwraps a 359° → 1° crossing as a small positive delta', () => {
    const p = new AlphaPipeline({
      BaseFilter: OneEuroFilter,
      oneEuroOpts: {minCutoff: 1.0, beta: 0.0},
    })
    const dt = 1 / 60
    let t = 0
    p.filter(359, t); t += dt
    p.filter(0, t); t += dt
    const out = p.filter(1, t)
    expect(out).toBeGreaterThan(358)
    expect(out).toBeLessThan(362)
  })


  it('with notch enabled, a steady 1 Hz oscillation in raw is suppressed', () => {
    // Apply a 1 Hz tone offset around a constant heading.  The pipeline's
    // notch should kill the oscillation before it reaches the 1€ stage,
    // leaving the filtered output close to the underlying mean.
    const p = new AlphaPipeline({
      BaseFilter: OneEuroFilter,
      oneEuroOpts: {minCutoff: 1.0, beta: 0.0}, // pure 1 Hz fixed LP
      notch: new BiquadNotch({f0Hz: 1.0, Q: 5}),
    })
    const fs = 60
    const dt = 1 / fs
    const baseAlpha = 100
    const noiseAmp = 5
    let t = 0
    let peak = 0
    // Settle the notch over many samples, then measure deviation.
    for (let i = 0; i < 3600; i++) {
      const x = baseAlpha + (noiseAmp * Math.sin(2 * Math.PI * 1.0 * t))
      const y = p.filter(x, t)
      if (i > 1800) {
        const dev = Math.abs(y - baseAlpha)
        if (dev > peak) {
          peak = dev
        }
      }
      t += dt
    }
    // Without notch the filtered output would track the 5° oscillation.
    // With notch + 1€ at minCutoff=1, residual should be << noise amp.
    expect(peak).toBeLessThan(0.5)
  })


  it('with notch enabled, a slow legitimate pan still gets through', () => {
    // 5°/s sustained pan — well outside the notch's 0.2 Hz bandwidth at
    // f0=1 Hz, Q=5.  Output should track the pan with at most ~filter lag,
    // not freeze near the seed value.
    const p = new AlphaPipeline({
      BaseFilter: OneEuroFilter,
      oneEuroOpts: {minCutoff: 1.0, beta: 0.5},
      notch: new BiquadNotch({f0Hz: 1.0, Q: 5}),
    })
    const fs = 60
    const dt = 1 / fs
    const seed = 100
    const panRate = 5
    let t = 0
    let last = seed
    for (let i = 0; i < 1200; i++) {
      last = p.filter(seed + (panRate * t), t)
      t += dt
    }
    // After 20 s of 5°/s pan = 100°, output should have tracked most of it.
    expect(last - seed).toBeGreaterThan(80)
  })


  it('reset() drops all state', () => {
    const p = new AlphaPipeline({
      BaseFilter: OneEuroFilter,
      oneEuroOpts: {minCutoff: 1.0, beta: 0.0},
      notch: new BiquadNotch({f0Hz: 1.0, Q: 5}),
    })
    const dt = 1 / 60
    p.filter(180, 0)
    p.filter(180, dt)
    p.reset()
    expect(p.filter(45, 2 * dt)).toBe(45)
  })
})
