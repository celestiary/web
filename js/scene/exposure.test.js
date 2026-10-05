import {ASTRO_UNIT_METER, DISPLAY_GAIN, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'
import {
  METER_FLOOR, METER_GAIN_MAX, METER_GAIN_MIN, METER_HIGHLIGHT, METER_HIGHLIGHT_MAX, METER_KEY, easeExposure, exposureAt,
  EYE_POINT_RAD, LIMITING_MAGNITUDE, LIMIT_VALUE, exposureRelative, illuminanceRatio, irradianceAt, limitingMagnitude,
  frameCanBeEmpty, meanLogLuminance, meteredGain, pointSolidAngle, skyExposure, starGainForLimit, starSprite,
  STAR_MAX_SIZE_PX,
} from './exposure.js'
import {readFileSync} from 'fs'
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

  it('reaches the same dark exposure wherever the camera is: the ceiling is over Earth\'s keyed one', () => {
    // At Pluto the keyed exposure is 40× Earth's: a black frame asks for
    // 1e5 over it, 4e6 over Earth's; at Mercury 0.4×: 1e7 over it.
    expect(meteredGain(m(1e-12, 1e-12, 1e-6), 1, true, 40)).toBeCloseTo(METER_GAIN_MAX / 40, 6)
    expect(meteredGain(m(1e-12, 1e-12, 1e-6), 1, true, 0.4)).toBeCloseTo(METER_GAIN_MAX / 0.4, 6)
    // The sunlit end stays keyed: Pluto's lit disc at 0.6 holds 1.
    expect(meteredGain(m(0.01, 0.6), 1, true, 40)).toBe(1)
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

  it('the limiting magnitude: the naked eye\'s at the dark-adapted gain, moving with the exposure', () => {
    expect(limitingMagnitude(METER_GAIN_MAX)).toBeCloseTo(LIMITING_MAGNITUDE, 12)
    // A magnitude is 2.5× in light: 2.5× the gain is a magnitude fainter.
    expect(limitingMagnitude(METER_GAIN_MAX * 2.512)).toBeCloseTo(LIMITING_MAGNITUDE + 1, 3)
    expect(limitingMagnitude(METER_GAIN_MAX, 2.512)).toBeCloseTo(LIMITING_MAGNITUDE + 1, 3)
    // By day, at the keyed exposure: the Sun, the Moon and Venus (−4.5).
    expect(limitingMagnitude(1)).toBeLessThan(-4.5)
    expect(limitingMagnitude(1)).toBeGreaterThan(-13)
    expect(starGainForLimit(LIMITING_MAGNITUDE)).toBeCloseTo(1, 12)
    expect(starGainForLimit(LIMITING_MAGNITUDE + 2.5)).toBeCloseTo(10, 9)
    // The eye's patch follows: a star at the limit shows LIMIT_VALUE at the
    // dark-adapted gain, and the patch is the dark-adapted eye's 10 arcmin.
    const value = DISPLAY_GAIN * Math.PI * illuminanceRatio(LIMITING_MAGNITUDE) / (EYE_POINT_RAD * EYE_POINT_RAD) * METER_GAIN_MAX
    expect(value).toBeCloseTo(LIMIT_VALUE, 12)
    expect(EYE_POINT_RAD * 180 / Math.PI * 60).toBeCloseTo(10, 0)
    // Sirius is 7.9e-11 of the Sun; the Sun is magnitude −26.74.
    expect(illuminanceRatio(-1.46)).toBeCloseTo(7.73e-11, 13)
  })

  it('a point\'s solid angle: a pixel, or the eye\'s patch where a pixel is finer', () => {
    // 45 degrees over 200 pixels: 3.9e-3 rad a pixel, coarser than the eye.
    expect(pointSolidAngle(45, 200)).toBeCloseTo(1.54e-5, 7)
    // Over 1080 pixels: 0.73e-3 rad a pixel; the eye's 2.9e-3 rad stands.
    expect(pointSolidAngle(45, 1080)).toBeCloseTo(EYE_POINT_RAD * EYE_POINT_RAD, 9)
    expect(pointSolidAngle(45, 300)).toBeCloseTo(EYE_POINT_RAD * EYE_POINT_RAD, 9)
  })
})


describe('an empty frame', () => {
  it('can only be the scene loading: once the stars and the target\'s surface are in, black is dark', () => {
    expect(frameCanBeEmpty(true, false, true)).toBe(true)
    expect(frameCanBeEmpty(true, true, false)).toBe(true)
    expect(frameCanBeEmpty(true, true, true)).toBe(false)
    // The LDR fallback's bytes can't tell empty from dark: never empty.
    expect(frameCanBeEmpty(false, false, false)).toBe(false)
  })

  it('a loaded star field the meter read as zeros still asks for the dark-adapted gain', () => {
    // The user's M2 Mac: every meter tap missed the 2 px points, or Metal
    // flushed their half-float values (Sirius 4e-5, under 6.1e-5) to zero,
    // so the frame read exactly zero.  Loaded, that is dark, not empty.
    const zeros = {meanLog: Math.log(METER_FLOOR), highlight: METER_FLOOR, blown: METER_FLOOR, max: 0}
    expect(meteredGain(zeros, 1, frameCanBeEmpty(true, true, true))).toBeCloseTo(METER_GAIN_MAX, 6)
    // Loading, it asks nothing and the gain holds.
    expect(meteredGain(zeros, 1, frameCanBeEmpty(true, false, true))).toBeNull()
  })
})


describe('the star sprite', () => {
  const mag = (m) => illuminanceRatio(m)
  const sunDiscFromEarth = 2 * 6.957e8 / 1.496e11

  it('at the dark-adapted gain: the limit a pixel just over black, a bright star a round core in a halo', () => {
    const faint = starSprite(mag(LIMITING_MAGNITUDE), METER_GAIN_MAX)
    expect(faint.peak).toBeCloseTo(LIMIT_VALUE, 2)
    expect(faint.coreRadiusPx).toBe(0)
    expect(faint.sizePx).toBeGreaterThanOrEqual(1)
    expect(faint.sizePx).toBeLessThan(6)
    const six = starSprite(mag(6), METER_GAIN_MAX)
    expect(six.peak).toBeGreaterThan(faint.peak)
    expect(six.peak).toBeLessThan(0.5)
    const first = starSprite(mag(1), METER_GAIN_MAX)
    expect(first.peak).toBeGreaterThan(1)
    expect(first.coreRadiusPx).toBeGreaterThan(1)
    expect(first.coreRadiusPx).toBeLessThan(first.sizePx / 2)
    expect(first.sizePx).toBeLessThan(STAR_MAX_SIZE_PX)
    // Every size and peak is finite and positive.
    for (const m of [-1.46, 0, 1, 3, 5, 6.5, 8]) {
      const star = starSprite(mag(m), METER_GAIN_MAX)
      expect(Number.isFinite(star.sizePx) && star.sizePx >= 1).toBe(true)
      expect(Number.isFinite(star.peak) && star.peak > 0).toBe(true)
    }
  })

  it('by day only the planets: a first-magnitude star is under a pixel\'s black', () => {
    expect(starSprite(mag(1), 1).peak).toBeLessThan(0.004)
  })

  it('the Sun: a point from Pluto, its disc from Earth', () => {
    const fromPluto = starSprite(1 / (39.5 * 39.5), METER_GAIN_MAX, {discRad: 2 * 6.957e8 / 5.9e12})
    expect(fromPluto.peak).toBe(HDR_MAX_VALUE)
    expect(fromPluto.sizePx).toBeGreaterThan(60)
    expect(fromPluto.sizePx).toBeLessThanOrEqual(STAR_MAX_SIZE_PX)
    expect(fromPluto.coreRadiusPx).toBeLessThan(fromPluto.sizePx / 2)
    // From Earth the disc is 32 arcmin, over the patch's 10: the point
    // fades by (10/32)², and the mesh draws the disc.
    const point = starSprite(1, 1)
    const fromEarth = starSprite(1, 1, {discRad: sunDiscFromEarth})
    expect(fromEarth.value / point.value).toBeCloseTo((EYE_POINT_RAD / sunDiscFromEarth) ** 2, 9)
    // An ordinary star's disc is far under the patch: no fade.
    const sirius = starSprite(mag(-1.46), METER_GAIN_MAX, {discRad: 2 * 1.2e9 / 8.1e16})
    expect(sirius.value).toBeCloseTo(starSprite(mag(-1.46), METER_GAIN_MAX).value, 9)
  })

  it('a dark frame reaches the same absolute exposure at Earth and at Pluto', () => {
    const dark = {meanLog: Math.log(1e-12), highlight: 1e-12, blown: 1e-12, max: 1e-6}
    for (const keyedOverEarth of [1, 40, 0.4]) {
      const gain = meteredGain(dark, 1, true, keyedOverEarth)
      expect(gain * keyedOverEarth).toBeCloseTo(METER_GAIN_MAX, 6)
    }
  })
})


describe('the shaders', () => {
  // GLSL ES reserves words it doesn't use; `half` as a variable failed the
  // stars' fragment shader to compile and drew no stars at all.
  const RESERVED = ['half', 'fixed', 'double', 'long', 'short', 'input', 'output', 'sizeof', 'cast', 'namespace',
    'using', 'asm', 'class', 'union', 'enum', 'typedef', 'template', 'this', 'goto', 'inline', 'noinline', 'volatile',
    'public', 'static', 'extern', 'external', 'interface', 'unsigned', 'superp', 'hvec2', 'hvec3', 'hvec4', 'fvec2',
    'fvec3', 'fvec4', 'filter', 'packed', 'sampler1D', 'sampler3D', 'sampler1DShadow', 'sampler2DShadow',
    'sampler2DRect', 'sampler3DRect', 'sampler2DRectShadow', 'sizeof', 'switch', 'default']
  for (const file of ['stars.vert', 'stars.frag']) {
    it(`${file} declares no GLSL reserved word`, () => {
      const source = readFileSync(`./js/shaders/${file}`, 'utf8').replace(/\/\/.*$/gm, '')
      for (const word of RESERVED) {
        expect(source).not.toMatch(new RegExp(`\\b(float|int|vec[234]|bool)\\s+${word}\\b`))
      }
    })
  }
})
