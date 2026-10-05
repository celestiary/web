import {ASTRO_UNIT_METER, DISPLAY_GAIN, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'
import {
  METER_FLOOR, METER_GAIN_MAX, METER_GAIN_MIN, METER_HIGHLIGHT, METER_HIGHLIGHT_MAX, METER_KEY, easeExposure, exposureAt,
  exposureRelative, irradianceAt, meanLogLuminance, meteredGain, pointSolidAngle, skyExposure,
} from './exposure.js'
import {HDR_MAX_VALUE} from './hdr.js'


describe('exposureAt', () => {
  it('renders a surface facing the Sun at its albedo, times the display gain', () => {
    for (const d of [0.39, 1, 1.52, 5.2, 30].map((au) => au * ASTRO_UNIT_METER)) {
      const irradiance = SUN_LUMINOUS_INTENSITY / Math.pow(d, SUN_LIGHT_DECAY)
      const albedo = 0.25
      expect(irradiance * albedo / Math.PI * exposureAt(d)).toBeCloseTo(albedo * DISPLAY_GAIN, 10)
    }
  })

  it('grows with distance from the Sun', () => {
    expect(exposureAt(5.2 * ASTRO_UNIT_METER)).toBeGreaterThan(exposureAt(ASTRO_UNIT_METER))
  })
})


describe('skyExposure', () => {
  it('is 1 at the body\'s own exposure, wherever it is', () => {
    for (const d of [0.72, 1, 1.52, 9.5].map((au) => au * ASTRO_UNIT_METER)) {
      expect(skyExposure(d, exposureAt(d))).toBeCloseTo(1, 12)
    }
  })

  it('is the ratio of irradiances at another body\'s exposure', () => {
    const earth = ASTRO_UNIT_METER
    const mars = 1.52 * ASTRO_UNIT_METER
    // Earth's sky seen at Mars's exposure: Earth is lit more, so brighter.
    expect(skyExposure(earth, exposureAt(mars))).toBeCloseTo(irradianceAt(earth) / irradianceAt(mars), 12)
    expect(skyExposure(earth, exposureAt(mars))).toBeGreaterThan(1)
  })

  it('scales with the exposure, as a lit surface does', () => {
    const d = ASTRO_UNIT_METER
    expect(skyExposure(d, 4 * exposureAt(d))).toBeCloseTo(4, 12)
  })
})


describe('easeExposure', () => {
  it('snaps to the goal on the first step', () => {
    expect(easeExposure(1, 8, Infinity)).toBe(8)
    expect(easeExposure(0, 8, 0.1)).toBe(8)
  })

  it('moves evenly in stops, ~63% of the way per time constant', () => {
    const e = easeExposure(1, 8, 0.5, 0.5)
    expect(Math.log2(e)).toBeCloseTo(3 * (1 - Math.exp(-1)), 10)
  })

  it('stays put with no time elapsed', () => {
    expect(easeExposure(2, 8, 0)).toBe(2)
  })
})


describe('metered exposure', () => {
  const m = (luma, highlight = luma, max = Math.max(luma, highlight), blown = Math.min(luma, highlight)) =>
    ({meanLog: Math.log(luma), highlight, blown, max})

  it('leaves a sunlit scene at the keyed exposure, and lifts a dim one to the key', () => {
    expect(meteredGain(m(0.4), 1)).toBe(1)
    expect(meteredGain(m(METER_KEY, 0.1), 1)).toBeCloseTo(1, 12)
    expect(meteredGain(m(METER_KEY / 2, 0.1), 1)).toBeCloseTo(2, 12)
    expect(meteredGain(m(1e-4, 1e-4), 1)).toBeCloseTo(METER_KEY / 1e-4, 6)
  })

  it('caps a dark frame at the floor\'s gain, and asks nothing of an empty one', () => {
    expect(meteredGain(m(METER_FLOOR, METER_FLOOR, 1e-7), 1)).toBeCloseTo(METER_GAIN_MAX, 6)
    expect(meteredGain(m(1e-12, 1e-12, 1e-6), 1)).toBeCloseTo(METER_GAIN_MAX, 6)
    expect(METER_GAIN_MAX).toBeCloseTo(4e6, 0)
    // Nothing drawn yet (a texture loading): the gain stays as it is.
    expect(meteredGain(m(1e-12, 1e-12, 0), 1)).toBeNull()
    // A star field the meter's samples mostly miss: dark, not empty.
    expect(meteredGain(m(1e-12, 1e-12, 6e-8), 1)).toBeCloseTo(METER_GAIN_MAX, 6)
    // The LDR fallback can't tell: its zeros are dark.
    expect(meteredGain(m(1e-12, 1e-12, 0), 1, false)).toBeCloseTo(METER_GAIN_MAX, 6)
  })

  it('keeps a sunlit body on black space anchored: its highlight stays under METER_HIGHLIGHT', () => {
    // The Moon at quarter: 20% of the frame at ~0.6, the rest black.  The
    // mean asks for 5e4; the highlight (the luminance 2% of the frame
    // exceeds, 0.6) allows no more than 1, so the keyed exposure stands.
    expect(meteredGain(m(3.5e-6, 0.6), 1)).toBe(1)
    expect(meteredGain(m(3.5e-6, 0.8), 1)).toBe(1)
    // A dimmer body, 0.1: the highlight allows 6.
    expect(meteredGain(m(3.5e-6, 0.1), 1)).toBeCloseTo(METER_HIGHLIGHT / 0.1, 9)
    // A star field: its sprites are under 2% of the frame, so the
    // highlight is the floor, and the dark-adapted gain stands.
    expect(meteredGain(m(3e-7, METER_FLOOR), 1)).toBeCloseTo(METER_KEY / 3e-7, 6)
  })

  it('falls below 1 only for a quarter of the frame brighter than a sunlit white: the Sun\'s disc', () => {
    // A sunlit white (1.5) is the keyed exposure's own: left alone.
    expect(meteredGain(m(0.5, METER_HIGHLIGHT_MAX, 1.5, 1.5), 1)).toBe(1)
    // The sky round a low Sun: 2% of the frame at 6, a quarter at 0.5.
    // A clipped highlight, not a frame to darken.
    expect(meteredGain(m(0.4, 6, 12, 0.5), 1)).toBe(1)
    // The Sun's disc, 46,000 whites, over a quarter of the frame: brought
    // to a white.
    expect(meteredGain(m(100, 6.9e4, 6.9e4, 6.9e4), 1)).toBeCloseTo(METER_HIGHLIGHT_MAX / 6.9e4, 12)
    expect(meteredGain(m(100, 1e9, 1e9, 1e9), 1)).toBe(METER_GAIN_MIN)
    // Rendered at that gain, the disc reads as a white and asks for the same.
    const g = METER_HIGHLIGHT_MAX / 6.9e4
    expect(meteredGain(m(100 * g, 6.9e4 * g, 6.9e4 * g, 6.9e4 * g), g)).toBeCloseTo(g, 12)
  })

  it('reads bytes as their value over 255', () => {
    const bytes = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255])
    const floats = new Float32Array([1, 1, 1, 1, 0, 0, 0, 1])
    const [b, f] = [meanLogLuminance(bytes, 2), meanLogLuminance(floats, 2)]
    expect(b.meanLog).toBeCloseTo(f.meanLog, 12)
    expect(b.highlight).toBeCloseTo(f.highlight, 12)
  })

  it('asks the same of a scene whatever exposure it was rendered at: no feedback loop', () => {
    // Rendered at gain 100 the frame reads 100× brighter; the gain asked for
    // is the scene's, not the frame's.
    expect(meteredGain(m(1e-3), 1)).toBeCloseTo(meteredGain(m(1e-3 * 100), 100), 9)
    expect(meteredGain(m(3.5e-6, 0.2), 1))
        .toBeCloseTo(meteredGain(m(3.5e-5, 2), 10), 9)
  })

  it('averages the log luminance, floored, and finds the highlight and the most', () => {
    const px = new Float32Array([1, 1, 1, 1, 0, 0, 0, 1])
    const want = (Math.log(1) + Math.log(METER_FLOOR)) / 2
    const got = meanLogLuminance(px, 2)
    expect(got.meanLog).toBeCloseTo(want, 12)
    // Two pixels: 2% of them is the brightest.
    expect(got.highlight).toBe(1)
    expect(got.max).toBe(1)
    expect(meanLogLuminance(new Float32Array(0), 0))
        .toEqual({meanLog: Math.log(METER_FLOOR), highlight: METER_FLOOR, blown: METER_FLOOR, max: 0})
    // 100 pixels: `blown` is what a quarter of them, 25 pixels, exceed.
    const quarter = new Float32Array(400).fill(0)
    for (let i = 0; i < 25; i++) {
      quarter.set([2, 2, 2, 1], i * 4)
    }
    expect(meanLogLuminance(quarter, 100).blown).toBe(METER_FLOOR)
    quarter.set([2, 2, 2, 1], 25 * 4)
    expect(meanLogLuminance(quarter, 100).blown).toBeCloseTo(2, 12)
    // An overflowed pixel (Inf, or NaN out of the tone map) is the buffer's most.
    const over = meanLogLuminance(new Float32Array([Infinity, 0, 0, 1, NaN, 0, 0, 1]), 2)
    expect(over.max).toBe(HDR_MAX_VALUE)
    expect(over.highlight).toBe(HDR_MAX_VALUE)
    // 100 pixels: the highlight is what 2% of them, two pixels, exceed.
    // Two bright pixels (a star or two) don't set it; three do.
    const many = new Float32Array(400).fill(0)
    const white = (i, v) => many.set([v, v, v, 1], i * 4)
    white(0, 1); white(1, 1)
    expect(meanLogLuminance(many, 100).highlight).toBe(METER_FLOOR)
    white(2, 0.5)
    expect(meanLogLuminance(many, 100).highlight).toBeCloseTo(0.5, 12)
  })

  it('scales absolute brightness by the exposure over Earth\'s keyed one', () => {
    expect(exposureRelative(exposureAt(ASTRO_UNIT_METER))).toBeCloseTo(1, 12)
    expect(exposureRelative(exposureAt(1.52 * ASTRO_UNIT_METER))).toBeGreaterThan(1)
  })

  it('a point\'s solid angle: a pixel, or the eye\'s 10 arcmin where a pixel is finer', () => {
    // 45 degrees over 200 pixels: 3.9e-3 rad a pixel, coarser than the eye.
    expect(pointSolidAngle(45, 200)).toBeCloseTo(1.54e-5, 7)
    // Over 1080 pixels: 0.73e-3 rad a pixel; the eye's 2.9e-3 rad stands.
    expect(pointSolidAngle(45, 1080)).toBeCloseTo(8.46e-6, 8)
    expect(pointSolidAngle(45, 300)).toBeCloseTo(8.46e-6, 8)
  })
})
