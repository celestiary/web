import {
  DECODE_DISTANCE_GLSL, DISTANCE_SCALE_M, DISTANCE_STAGE_GLSL, decodeDistance, distanceScale, encodeDistance,
} from './distance.js'


describe('distance encoding', () => {
  it('round-trips through 8 bits to within a haze step', () => {
    const scale = distanceScale(1500)
    for (const d of [50, 500, 2e3, 1e4, 3e4, 8e4]) {
      const a = Math.round(encodeDistance(d, scale) * 255) / 255
      const back = decodeDistance(a, scale)
      // One 8-bit step is 1/254 of the haze fraction 1 − e^(−d/D).
      const haze = (x) => 1 - Math.exp(-x / scale)
      expect(Math.abs(haze(back) - haze(d))).toBeLessThan(1 / 254)
    }
  })

  it('keeps 0 for "no globe"', () => {
    expect(encodeDistance(0, 2e4)).toBeCloseTo(1 / 255, 10)
    expect(encodeDistance(1e12, 2e4)).toBeLessThanOrEqual(1)
  })

  it('stays finite at the top of the range', () => {
    expect(Number.isFinite(decodeDistance(1, 2e4))).toBe(true)
  })

  it('grows the scale with height, up to a cap', () => {
    expect(distanceScale(0)).toBe(DISTANCE_SCALE_M)
    expect(distanceScale(9e3)).toBeGreaterThan(3 * DISTANCE_SCALE_M)
    expect(distanceScale(1e6)).toBe(2e6)
  })

  it('declares the shader functions', () => {
    expect(DISTANCE_STAGE_GLSL).toContain('czm_windowToEyeCoordinates(gl_FragCoord.xy, depth)')
    expect(DISTANCE_STAGE_GLSL).toContain('uniform float distanceScale')
    expect(DECODE_DISTANCE_GLSL).toContain('float decodeDistance(float a, float scale)')
  })
})
