import {describe, expect, it} from 'bun:test'
import {neutral, neutralInverse} from './neutral.js'
import {SCREEN_STEP, sceneOfScreen, screenOf, screenSlope} from './screen.js'
import {srgbDecode, srgbEncode} from './srgb.js'


const grey = (v) => [v, v, v]


describe('the output transform for a grey', () => {
  it('is the tone map, then sRGB\'s encoding', () => {
    for (const v of [0, 1e-4, 0.004, 0.03, 0.08, 0.12, 0.3, 1.5, 20]) {
      expect(screenOf(v)).toBeCloseTo(srgbEncode(neutral(grey(v))[0]), 12)
    }
    expect(screenOf(0)).toBe(0)
    expect(screenOf(1e6)).toBeGreaterThan(0.999)
  })

  it('inverts exactly, through the toe, the linear part and the shoulder', () => {
    for (const d of [0.5 * SCREEN_STEP, SCREEN_STEP, 0.02, 0.08, 0.3, 0.6, 0.9, 0.99]) {
      expect(screenOf(sceneOfScreen(d))).toBeCloseTo(d, 9)
    }
    for (const d of [0, 1e-4, 0.08, 0.3, 0.8, 0.95, 0.9995, 1]) {
      expect(sceneOfScreen(d)).toBeCloseTo(neutralInverse(grey(srgbDecode(d)))[0], 9)
    }
  })

  it('is monotone', () => {
    let last = -1
    for (let v = 0; v < 4; v += 0.001) {
      const s = screenOf(v)
      expect(s).toBeGreaterThanOrEqual(last)
      last = s
    }
  })

  it('has the slope its differences give, in each of its pieces', () => {
    // The toe with sRGB's linear part (N under 0.0031308), the toe with its
    // power part, Neutral's linear part, its shoulder.
    for (const v of [0.005, 0.02, 0.05, 0.1, 0.5, 1.2, 5]) {
      const h = v * 1e-6
      const diff = (screenOf(v + h) - screenOf(v - h)) / (2 * h)
      expect(screenSlope(v) / diff).toBeCloseTo(1, 5)
    }
  })

  it('is quadratic deep in the toe: 12.92 × 6.25 × v²', () => {
    expect(screenOf(0.01)).toBeCloseTo(12.92 * 6.25 * 1e-4, 12)
    expect(screenSlope(0.01) * 0.01).toBeCloseTo(2 * screenOf(0.01), 12)
  })
})
