import {describe, expect, it} from 'bun:test'
import {
  LOG_DECODE_GLSL,
  LOG_ENCODE_GLSL,
  LOG_STOPS,
  earthshineFraction,
  logDecode,
  logEncode,
} from './encoding.js'


const toRad = Math.PI / 180


describe('the log encoding of a tileset\'s frame', () => {
  it('keeps black black, and 1 at the top code', () => {
    expect(logEncode(0)).toBe(0)
    expect(logDecode(0)).toBe(0)
    expect(logEncode(1)).toBe(255)
    expect(logDecode(255)).toBeCloseTo(1, 12)
  })

  it('round-trips every level from its floor to 1 within half a step (2.8%)', () => {
    for (let stops = 0; stops <= LOG_STOPS; stops += 0.37) {
      const v = 2 ** -stops
      const back = logDecode(logEncode(v))
      expect(Math.abs(back - v) / v).toBeLessThan(0.029)
    }
  })

  it('is monotonic', () => {
    let last = -1
    for (let code = 0; code <= 255; code++) {
      const v = logDecode(code)
      expect(v).toBeGreaterThan(last)
      last = v
    }
  })

  it('gives the Moon\'s earthlit night side tens of codes, where 8 linear bits gave it none', () => {
    // A mare (stored 0.1) and highland (0.3) under earthshine at #192's crescent.
    const shine = earthshineFraction(52.5 * toRad, 3.844e8)
    for (const stored of [0.1, 0.3]) {
      const v = stored * shine
      expect(Math.round(v * 255)).toBe(0)
      expect(logEncode(v)).toBeGreaterThan(30)
    }
    // The old floor's night side (0.02 of full sun) was 1-2 linear codes.
    expect(Math.round(0.02 * 0.3 * 255)).toBeLessThanOrEqual(2)
  })

  it('a step is the same ratio at every level, 2^(1/12.7)', () => {
    const ratio = logDecode(101) / logDecode(100)
    expect(ratio).toBeCloseTo(2 ** (LOG_STOPS / 254), 9)
    expect(ratio - 1).toBeLessThan(0.06)
  })

  it('the GLSL carries the same stops', () => {
    expect(LOG_ENCODE_GLSL).toContain(`/ ${LOG_STOPS.toFixed(1)} + 1.0`)
    expect(LOG_DECODE_GLSL).toContain(`* ${LOG_STOPS.toFixed(1)});`)
    expect(LOG_ENCODE_GLSL).toContain('* 254.0 + 1.0')
    expect(LOG_DECODE_GLSL).toContain('/ 254.0')
  })
})


describe('earthshine', () => {
  const d = 3.844e8

  it('is 1e-4 of sunlight at full Earth (new Moon)', () => {
    expect(earthshineFraction(0, d)).toBeCloseTo(1.0e-4, 5)
  })

  it('is 7e-5 at #192\'s crescent (Earth at 52.5° phase seen from the Moon)', () => {
    expect(earthshineFraction(52.5 * toRad, d)).toBeCloseTo(6.9e-5, 6)
  })

  it('falls to nothing as Earth goes new (full Moon)', () => {
    expect(earthshineFraction(90 * toRad, d)).toBeCloseTo(1.0e-4 / Math.PI, 6)
    expect(earthshineFraction(Math.PI, d)).toBeCloseTo(0, 12)
  })
})
