import {describe, expect, it} from 'bun:test'
import BiquadNotch from './BiquadNotch.js'


describe('BiquadNotch', () => {
  it('first sample passes through unchanged', () => {
    const f = new BiquadNotch({f0Hz: 1.0})
    expect(f.filter(7.0, 1 / 60)).toBe(7.0)
  })


  it('passes DC unchanged at steady state', () => {
    const f = new BiquadNotch({f0Hz: 1.0})
    const dt = 1 / 60
    let last = 0
    for (let i = 0; i < 200; i++) {
      last = f.filter(5.0, dt)
    }
    expect(Math.abs(last - 5.0)).toBeLessThan(0.001)
  })


  it('attenuates a tone at the notch frequency to deep null (≥ 50 dB) at steady state', () => {
    const fs = 60
    const f0 = 1.0
    const dt = 1 / fs
    const f = new BiquadNotch({f0Hz: f0, Q: 5})
    let t = 0
    let peak = 0
    // Q=5 settles in ~Q/(π·f0) = 1.6 s per time-constant, but reaching
    // a deep null takes many τ.  Run for 60 s, observe last 30 s.
    for (let i = 0; i < 3600; i++) {
      const x = Math.sin(2 * Math.PI * f0 * t)
      const y = f.filter(x, dt)
      if (i > 1800 && Math.abs(y) > peak) {
        peak = Math.abs(y)
      }
      t += dt
    }
    // Input amplitude 1.0 → ≥ 50 dB rejection means |y| ≤ 0.00316.
    expect(peak).toBeLessThan(0.00316)
  })


  it('passes frequencies well below the notch nearly unchanged', () => {
    // Compare peak ratio (output/input) to handle discrete-sampling
    // artifacts: at 0.05 Hz with fs=60 the samples don't always land
    // on the analog peak, so absolute output peak < amplitude even
    // for unity gain.  RMS or pre-sample comparison would also work.
    const fs = 60
    const f0 = 1.0
    const dt = 1 / fs
    const f = new BiquadNotch({f0Hz: f0, Q: 5})
    let t = 0
    let inPeak = 0
    let outPeak = 0
    for (let i = 0; i < 1200; i++) {
      const x = Math.sin(2 * Math.PI * 0.05 * t) // 0.05 Hz, 20× below notch
      const y = f.filter(x, dt)
      if (i > 600) {
        if (Math.abs(x) > inPeak) {
          inPeak = Math.abs(x)
        }
        if (Math.abs(y) > outPeak) {
          outPeak = Math.abs(y)
        }
      }
      t += dt
    }
    expect(outPeak / inPeak).toBeGreaterThan(0.95)
  })


  it('passes frequencies well above the notch nearly unchanged', () => {
    const fs = 60
    const f0 = 1.0
    const dt = 1 / fs
    const f = new BiquadNotch({f0Hz: f0, Q: 5})
    let t = 0
    let inPeak = 0
    let outPeak = 0
    for (let i = 0; i < 1200; i++) {
      const x = Math.sin(2 * Math.PI * 10.0 * t) // 10 Hz, 10× above notch
      const y = f.filter(x, dt)
      if (i > 600) {
        if (Math.abs(x) > inPeak) {
          inPeak = Math.abs(x)
        }
        if (Math.abs(y) > outPeak) {
          outPeak = Math.abs(y)
        }
      }
      t += dt
    }
    expect(outPeak / inPeak).toBeGreaterThan(0.95)
  })


  it('reset() clears state', () => {
    const f = new BiquadNotch({f0Hz: 1.0})
    f.filter(5.0, 1 / 60)
    f.filter(5.0, 1 / 60)
    f.reset()
    expect(f.filter(99.0, 1 / 60)).toBe(99.0)
  })


  it('throws on invalid f0Hz', () => {
    expect(() => new BiquadNotch({f0Hz: 0})).toThrow()
    expect(() => new BiquadNotch({f0Hz: -1})).toThrow()
  })


  it('throws on invalid Q', () => {
    expect(() => new BiquadNotch({f0Hz: 1, Q: 0})).toThrow()
    expect(() => new BiquadNotch({f0Hz: 1, Q: -1})).toThrow()
  })
})
