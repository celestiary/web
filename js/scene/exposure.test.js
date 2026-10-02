import {ASTRO_UNIT_METER, DISPLAY_GAIN, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'
import {
  METER_FLOOR, METER_GAIN_MAX, METER_HIGHLIGHT, METER_KEY, easeExposure, exposureAt, exposureRelative, irradianceAt, meanLogLuminance,
  meteredGain, pixelSolidAngle, skyExposure,
} from './exposure.js'


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
  const m = (luma, highlight = luma) => ({meanLog: Math.log(luma), highlight})

  it('leaves a sunlit scene at the keyed exposure, and lifts a dim one to the key', () => {
    expect(meteredGain(m(0.4), 1)).toBe(1)
    expect(meteredGain(m(METER_KEY, 0.1), 1)).toBeCloseTo(1, 12)
    expect(meteredGain(m(METER_KEY / 2, 0.1), 1)).toBeCloseTo(2, 12)
    expect(meteredGain(m(1e-4, 1e-4), 1)).toBeCloseTo(METER_KEY / 1e-4, 6)
  })

  it('caps a black frame at the floor\'s gain', () => {
    expect(meteredGain(m(METER_FLOOR), 1)).toBeCloseTo(METER_GAIN_MAX, 6)
    expect(meteredGain(m(1e-12), 1)).toBeCloseTo(METER_GAIN_MAX, 6)
    expect(METER_GAIN_MAX).toBeCloseTo(3e6, 0)
  })

  it('keeps a sunlit body on black space anchored: its highlight stays under METER_HIGHLIGHT', () => {
    // The Moon at quarter: 20% of the frame at ~0.4, the rest black.  The
    // mean asks for 5e4; the highlight (the luminance 2% of the frame
    // exceeds, 0.4) allows less than 1, so the keyed exposure stands.
    expect(meteredGain({meanLog: Math.log(3.5e-6), highlight: 0.4}, 1)).toBe(1)
    // A dimmer body, 0.1: the highlight allows 3.
    expect(meteredGain({meanLog: Math.log(3.5e-6), highlight: 0.1}, 1)).toBeCloseTo(METER_HIGHLIGHT / 0.1, 9)
    // A star field: its sprites are under 2% of the frame, so the
    // highlight is the floor, and the dark-adapted gain stands.
    expect(meteredGain({meanLog: Math.log(3e-7), highlight: METER_FLOOR}, 1)).toBeCloseTo(METER_KEY / 3e-7, 6)
  })

  it('asks the same of a scene whatever exposure it was rendered at: no feedback loop', () => {
    // Rendered at gain 100 the frame reads 100× brighter; the gain asked for
    // is the scene's, not the frame's.
    expect(meteredGain(m(1e-3), 1)).toBeCloseTo(meteredGain(m(1e-3 * 100), 100), 9)
    expect(meteredGain({meanLog: Math.log(3.5e-6), highlight: 0.4}, 1))
        .toBeCloseTo(meteredGain({meanLog: Math.log(3.5e-5), highlight: 4}, 10), 9)
  })

  it('averages the log luminance, floored, skipping NaN, and finds the highlight', () => {
    const px = new Float32Array([1, 1, 1, 1, 0, 0, 0, 1, NaN, 0, 0, 1])
    const want = (Math.log(1) + Math.log(METER_FLOOR)) / 2
    const got = meanLogLuminance(px, 3)
    expect(got.meanLog).toBeCloseTo(want, 12)
    // Two pixels: 2% of them is the brightest.
    expect(got.highlight).toBe(1)
    expect(meanLogLuminance(new Float32Array(0), 0)).toEqual({meanLog: Math.log(METER_FLOOR), highlight: METER_FLOOR})
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

  it('a pixel\'s solid angle', () => {
    // 45 degrees over 300 pixels: 2.6e-3 rad a pixel.
    expect(pixelSolidAngle(45, 300)).toBeCloseTo(6.85e-6, 8)
  })
})
