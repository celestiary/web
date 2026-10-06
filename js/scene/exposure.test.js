import {ASTRO_UNIT_METER, DISPLAY_GAIN, SUN_LIGHT_DECAY, SUN_LUMINOUS_INTENSITY} from '../shared.js'
import {
  METER_BLOWN_VALUE, METER_FLOOR, METER_GAIN_MAX, METER_GAIN_MIN, METER_HIGHLIGHT, METER_HIGHLIGHT_MAX, METER_KEY,
  easeExposure, exposureAt,
  EYE_POINT_RAD, LIMITING_MAGNITUDE, LIMIT_VALUE, exposureRelative, illuminanceRatio, irradianceAt, limitingMagnitude,
  frameCanBeEmpty, meanLogLuminance, meteredGain, pointSolidAngle, skyExposure, starGainForLimit, starSprite,
  luminousDiscGain, starClipZ, sunDiscValue, sunlitBodyCap, sunlitBodyGain, HIGHLIGHT_ALBEDO_FACTOR,
  METER_HIGHLIGHT_FRACTION, STAR_GLARE_CORE_PATCHES, SUNLIT_FRAME_WEIGHT, SUNLIT_FRAME_FRACTION,
  STAR_MAX_SIZE_PX, STAR_PEAK_OVER_RADIANCE, STAR_VISIBLE_VALUE, SUN_DISC_RADIANCE, MILKY_WAY_RADIANCE,
} from './exposure.js'
import {readFileSync} from 'fs'
import {HDR_MAX_VALUE, HDR_MIN_NORMAL, emitted, neutral} from './hdr.js'


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

  it('falls below 1 only for a twentieth of the frame over 20 whites: the Sun\'s disc', () => {
    // A sunlit white (1.5) is the keyed exposure's own: left alone.
    expect(meteredGain(m(0.5, METER_HIGHLIGHT_MAX, 1.5, 1.5), 1)).toBe(1)
    // The sky round a low Sun: 2% of the frame at 6, a twentieth at 4.
    // A clipped highlight, not a frame to darken.
    expect(meteredGain(m(0.4, 6, 12, 4), 1)).toBe(1)
    expect(meteredGain(m(0.4, 6, 12, METER_BLOWN_VALUE), 1)).toBe(1)
    // The Sun's disc, 46,000 whites, over a twentieth of the frame: brought
    // to a sunlit surface (0.6), where the tone map keeps its
    // granulation's contrast; at a white (1.5) the shoulder flattened it.
    expect(meteredGain(m(100, 6.9e4, 6.9e4, 6.9e4), 1)).toBeCloseTo(METER_HIGHLIGHT / 6.9e4, 12)
    expect(meteredGain(m(100, 1e9, 1e9, 1e9), 1)).toBe(METER_GAIN_MIN)
    // Rendered at that gain, the disc reads as it did and asks for the same.
    const g = METER_HIGHLIGHT / 6.9e4
    expect(meteredGain(m(100 * g, 6.9e4 * g, 6.9e4 * g, 6.9e4 * g), g)).toBeCloseTo(g, 12)
  })

  it('meters the Sun\'s disc from a readback like the M2\'s: a fifth of the taps at the buffer\'s ceiling, some non-finite', () => {
    // The user's view from 2.5 radii: the disc 22% of the frame (a quarter
    // of it missed the old 25% rule, gain 1, a flat white disc).  Taps on
    // the disc read 46,000-65,504; its glow shell can overflow the
    // half-float buffer to Inf, and a NaN can come through the tone map.
    const n = 32 * 32
    const taps = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      let v = 0
      if (i % 100 < 22) {
        v = i % 7 === 0 ? 65504 : 46810
        if (i % 50 === 1) {
          v = Infinity
        }
        if (i % 50 === 2) {
          v = NaN
        }
      }
      taps[i * 4] = taps[(i * 4) + 1] = taps[(i * 4) + 2] = v
      taps[(i * 4) + 3] = 1
    }
    const read = meanLogLuminance(taps, n)
    // A non-finite tap counts as the buffer's ceiling; a finite 65,504 as itself.
    expect(read.max).toBeGreaterThanOrEqual(HDR_MAX_VALUE)
    expect(read.highlight).toBeGreaterThan(4e4)
    expect(read.blown).toBeGreaterThan(4e4)
    expect(read.meanLog).toBeCloseTo((0.22 * Math.log(5e4)) + (0.78 * Math.log(METER_FLOOR)), 0)
    const gain = meteredGain(read, 1, false, 1)
    expect(gain).toBeLessThan(2e-5)
    expect(gain).toBeGreaterThan(5e-6)
    // At 5% of the taps it still fires; at 4% it doesn't: a white disc
    // in a frame that keeps its gain.
    const share = (fraction) => {
      const t = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        const v = i < fraction * n ? 6e4 : 0
        t[i * 4] = t[(i * 4) + 1] = t[(i * 4) + 2] = v
        t[(i * 4) + 3] = 1
      }
      return meteredGain(meanLogLuminance(t, n), 1, false, 1)
    }
    expect(share(0.06)).toBeCloseTo(METER_HIGHLIGHT / 6e4, 9)
    expect(share(0.04)).toBe(1)
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
    // 100 pixels: `blown` is what a twentieth of them, 5 pixels, exceed.
    const quarter = new Float32Array(400).fill(0)
    for (let i = 0; i < 5; i++) {
      quarter.set([2, 2, 2, 1], i * 4)
    }
    expect(meanLogLuminance(quarter, 100).blown).toBe(METER_FLOOR)
    quarter.set([2, 2, 2, 1], 5 * 4)
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


describe('the glare cap', () => {
  const mag = (m) => illuminanceRatio(m)

  it('bounds the saturated core at two patches from Sirius to the Sun at 5 AU, the halo growing with the log of the light', () => {
    // At 1080p (a 4 px patch): Sirius's core just reaches the cap; Venus,
    // the Sun from 52 AU and from 5 AU are held there, their halos wider.
    const sirius = starSprite(mag(-1.46), METER_GAIN_MAX, {heightPx: 1080})
    const venus = starSprite(mag(-4.6), METER_GAIN_MAX, {heightPx: 1080})
    const sun52 = starSprite(1 / (52 * 52), METER_GAIN_MAX, {heightPx: 1080})
    const sun5 = starSprite(1 / (5 * 5), METER_GAIN_MAX, {heightPx: 1080})
    for (const star of [sirius, venus, sun52, sun5]) {
      expect(star.coreRadiusPx).toBeLessThanOrEqual((STAR_GLARE_CORE_PATCHES * star.patchPx) + 1e-9)
      expect(star.sizePx).toBeLessThan(STAR_MAX_SIZE_PX)
      expect(Number.isFinite(star.peak) && star.peak > 0.76).toBe(true)
    }
    expect(venus.sizePx).toBeGreaterThan(sirius.sizePx)
    expect(sun52.sizePx).toBeGreaterThan(venus.sizePx)
    expect(sun5.sizePx).toBeGreaterThan(sun52.sizePx)
    // The Sun from 52 AU: a 16 px core in a halo under 60 px, not 120 px.
    expect(sun52.sizePx).toBeLessThan(60)
    // From 10 pc it is a star of its absolute magnitude, 4.8: no cap, a
    // point just at white (1.14 on a screen at the dark gain).
    const sunLy = starSprite(mag(4.83), METER_GAIN_MAX, {heightPx: 1080})
    expect(sunLy.glareCapped).toBe(false)
    expect(sunLy.coreRadiusPx).toBeLessThan(1.5)
  })

  it('leaves the fainter stars alone', () => {
    for (const m of [0, 1, 3, 6]) {
      expect(starSprite(mag(m), METER_GAIN_MAX, {heightPx: 1080}).glareCapped).toBe(false)
    }
  })
})


describe('a sunlit body in the frame', () => {
  const earth = exposureAt(ASTRO_UNIT_METER)
  const moonRad = 1.7381e6 / 3.844e8
  const moon = {angularRadius: moonRad, litFraction: 1, keyedExposure: earth, albedo: 0.12}

  it('anchors the gain so its brightest surface is a white: the full Moon from Earth\'s night side at 3.3', () => {
    const cap = sunlitBodyCap([moon], earth)
    expect(cap).toBeCloseTo(METER_HIGHLIGHT_MAX / (DISPLAY_GAIN * Math.min(HIGHLIGHT_ALBEDO_FACTOR * 0.12, 1)), 9)
    expect(cap).toBeCloseTo(3.33, 1)
    // The dark frame round it, which asked for 4e6, is held there.
    const dark = {meanLog: Math.log(1e-12), highlight: 1e-12, blown: 1e-12, max: 1e-6}
    expect(meteredGain(dark, 1, true, 1, cap)).toBeCloseTo(cap, 9)
    // A crescent Earth from 94,000 km, 3.9° across, albedo 0.37: about 1.1.
    const crescent = {angularRadius: 6.371e6 / 9.4e7, litFraction: 0.2, keyedExposure: earth, albedo: 0.367}
    expect(sunlitBodyCap([crescent], earth)).toBeCloseTo(1.09, 1)
  })

  it('is a point unless its disc is wider than the eye\'s patch, and dark at new', () => {
    // Jupiter from Earth, 40″: a star of the night.
    expect(sunlitBodyCap([{...moon, angularRadius: 20 / 3600 * Math.PI / 180}], earth)).toBe(Infinity)
    expect(sunlitBodyCap([{...moon, litFraction: 0}], earth)).toBe(Infinity)
    expect(sunlitBodyCap([], earth)).toBe(Infinity)
    // Infinity leaves meteredGain's own answer alone.
    const dark = {meanLog: Math.log(1e-12), highlight: 1e-12, blown: 1e-12, max: 1e-6}
    expect(meteredGain(dark, 1, true, 1, Infinity)).toBeCloseTo(METER_GAIN_MAX, 6)
  })

  it('needs the disc in the frame and a twentieth of it lit: not the ground from its night side, nor a limb crescent', () => {
    const halfFov = 22.5 * Math.PI / 180
    // Earth from 20 m up: a disc of 90°, far over the frame; its lit side
    // is beyond the horizon.
    expect(sunlitBodyCap([{...moon, angularRadius: 89 * Math.PI / 180, litFraction: 0.2}], earth, halfFov)).toBe(Infinity)
    // From 20,000 km (14°) it fits; at 64° phase it anchors, at 165°
    // (a limb crescent, 2% of the disc) it doesn't: the cities show.
    const orbit = {...moon, angularRadius: 14 * Math.PI / 180, albedo: 0.367}
    expect(sunlitBodyCap([{...orbit, litFraction: (1 + Math.cos(64 * Math.PI / 180)) / 2}], earth, halfFov)).toBeCloseTo(1.09, 1)
    expect(sunlitBodyCap([{...orbit, litFraction: (1 + Math.cos(165 * Math.PI / 180)) / 2}], earth, halfFov)).toBe(Infinity)
  })

  it('never takes the gain under 1: the target keeps its keyed exposure', () => {
    // From Pluto's keyed exposure (40× Earth's), a resolved Earth would ask
    // for 0.03; the floor is 1.
    const pluto = exposureAt(39.5 * ASTRO_UNIT_METER)
    expect(sunlitBodyCap([{...moon, albedo: 1}], pluto)).toBe(1)
  })
})


describe('a sunlit body in the frame, continuously in its size on screen', () => {
  const earth = exposureAt(ASTRO_UNIT_METER)
  const jupiterKeyed = exposureAt(5.2 * ASTRO_UNIT_METER)
  const [width, height] = [2000, 1140]
  const fovDeg = 0.04
  // Jupiter in the user's telescope view (#153 follow-up 10): the frame's
  // target Earth, Jupiter 0.52 albedo, nearly full, diameterPx tall on a
  // 1140 px frame at a 0.04° field.
  const jupiter = (diameterPx) => ({
    angularRadius: (diameterPx / 2) * (fovDeg * Math.PI / 180) / height,
    litFraction: 0.99,
    keyedExposure: jupiterKeyed,
    albedo: 0.52,
    diameterPx,
    frameFraction: (Math.PI * ((diameterPx / 2) ** 2)) / (width * height),
  })
  const halfFov = fovDeg * Math.PI / 360
  const white = DISPLAY_GAIN * earth / jupiterKeyed
  const dark = METER_GAIN_MAX
  const gainAt = (px) => sunlitBodyGain(dark, [jupiter(px)], earth, halfFov)

  it('holds Jupiter\'s disc at a sunlit surface over the user\'s three steps of zoom, within 10% of each other', () => {
    // 313 px: 3% of the frame, the 2% rule's own case; 275 and 255 px over
    // 2%; 230 px (1.8%) under it, where the first cut let the gain go to
    // 4e6 and the disc went flat white.
    const gains = [313, 275, 255, 230].map(gainAt)
    for (const g of gains) {
      expect(g * white).toBeGreaterThanOrEqual(METER_HIGHLIGHT * 0.999)
      expect(g * white).toBeLessThanOrEqual(0.61)
    }
    expect(Math.max(...gains) / Math.min(...gains)).toBeLessThan(1.1)
    // Where the disc fills the 2%, the cap is what the 2% rule gives: 0.6.
    expect(gainAt(313) * white).toBeCloseTo(METER_HIGHLIGHT, 6)
  })

  it('is continuous and monotone in the disc\'s diameter: no step over a ±15% change in size', () => {
    // Up to the frame's height: a disc past the frame doesn't anchor (the
    // lit part may be out of it), and the 2% rule holds it by then.
    let prev = gainAt(0.5)
    let worst15 = 1
    for (let px = 0.5; px * 1.15 < height; px *= 1.01) {
      const g = gainAt(px)
      expect(Number.isFinite(g)).toBe(true)
      expect(g).toBeLessThanOrEqual(prev * (1 + 1e-9))
      // A 1% step in size moves the gain by at most 20%: continuous, where
      // the first cut stepped 0.6 to 4e6 at once.
      expect(prev / g).toBeLessThan(1.2)
      const g15 = gainAt(px * 1.15)
      worst15 = Math.max(worst15, g / g15)
      prev = g
    }
    // The steepest ±15% step is where the anchor weighs in (0.01% to 0.2%
    // of the frame), and even there under three stops.
    expect(worst15).toBeLessThan(8)
    // Over the anchored disc, a ±15% step of zoom moves the gain under 20%
    // (a quarter stop): the target's blend over the share of the frame.
    for (const px of [200, 230, 255, 275, 313, 500, 900]) {
      expect(gainAt(px) / gainAt(px * 1.15)).toBeLessThan(1.2)
      expect(gainAt(px / 1.15) / gainAt(px)).toBeLessThan(1.2)
    }
  })

  it('weighs in by the disc\'s share of the frame, 0.01% to 0.2%, not its size in pixels', () => {
    const [wLo, wHi] = SUNLIT_FRAME_WEIGHT
    const pxFor = (fraction) => 2 * Math.sqrt(fraction * width * height / Math.PI)
    // A point, and a disc that is a speck of the field: left to the frame.
    expect(gainAt(1)).toBe(dark)
    expect(gainAt(6)).toBe(dark)
    expect(gainAt(pxFor(wLo))).toBe(dark)
    expect(gainAt(pxFor(Math.sqrt(wLo * wHi)))).toBeLessThan(dark)
    expect(gainAt(pxFor(Math.sqrt(wLo * wHi)))).toBeGreaterThan(gainAt(pxFor(wHi)))
    // By 0.2% the cap holds fully, at the target its share gives (a white
    // there), and from there the gain follows the target alone, down to 0.6.
    const full = gainAt(pxFor(wHi)) * white
    expect(full).toBeCloseTo(METER_HIGHLIGHT_MAX, 6)
    const past = gainAt(pxFor(wHi * 1.5)) * white
    expect(past).toBeGreaterThan(METER_HIGHLIGHT)
    expect(past).toBeLessThan(full)
    // The same share of the frame gives the same gain on any screen: the
    // weight is a solid angle, not a pixel count.
    const small = {...jupiter(pxFor(wHi)), diameterPx: 3}
    expect(sunlitBodyGain(dark, [small], earth, halfFov)).toBeCloseTo(gainAt(pxFor(wHi)), 9)
  })

  it('the Moon from Earth at 45°: a speck of the field, the stars stay near dark-adapted at any phase', () => {
    // 0.5° in a 45° × 72° field is 0.006% of it; on a 300 px viewport a
    // 4 px disc, on 1080 px 7 px.  The second cut's pixel weight took the
    // 4 px disc to gain 40 and showed none of the field's 975 stars.
    const moonRad = 1.7381e6 / 3.844e8
    const [w, h] = [480, 300]
    const pxRad = (45 * Math.PI / 180) / h
    const diameterPx = 2 * moonRad / pxRad
    const frameFraction = (Math.PI * ((diameterPx / 2) ** 2)) / (w * h)
    expect(diameterPx).toBeCloseTo(3.5, 0)
    expect(frameFraction).toBeLessThan(1e-4)
    for (const litFraction of [1, 0.5, 0.2, 0.06]) {
      const moon = {angularRadius: moonRad, litFraction, keyedExposure: earth, albedo: 0.12, diameterPx, frameFraction}
      const g = sunlitBodyGain(dark, [moon], earth, 22.5 * Math.PI / 180)
      expect(g).toBeGreaterThan(dark * 0.99)
      expect(limitingMagnitude(g)).toBeGreaterThan(LIMITING_MAGNITUDE - 0.02)
    }
    // At 1080p the same Moon is 7 px and the same share: the same gain.
    const hd = {angularRadius: moonRad, litFraction: 1, keyedExposure: earth, albedo: 0.12, diameterPx: 7,
      frameFraction: (Math.PI * 3.5 * 3.5) / (1920 * 1080)}
    expect(sunlitBodyGain(dark, [hd], earth, 22.5 * Math.PI / 180)).toBeGreaterThan(dark * 0.99)
    // The hard cap, kept for starsDebug, still says 3.3 for this Moon.
    expect(sunlitBodyCap([hd], earth)).toBeCloseTo(3.33, 1)
  })

  it('the Moon filling a narrow field is anchored: 1° shows its surface, 10° a small suppression', () => {
    const moonRad = 1.7381e6 / 3.844e8
    const moonAt = (fieldDeg, [w, h] = [1920, 1080]) => {
      const diameterPx = 2 * moonRad / ((fieldDeg * Math.PI / 180) / h)
      return {angularRadius: moonRad, litFraction: 1, keyedExposure: earth, albedo: 0.12, diameterPx,
        frameFraction: (Math.PI * ((diameterPx / 2) ** 2)) / (w * h)}
    }
    const cap = sunlitBodyCap([moonAt(1)], earth)
    expect(cap).toBeCloseTo(3.33, 1)
    // 1°: the disc is 12% of the 16:9 frame, over the 2% rule's share: the
    // anchor at the 2% rule's own target, its highlands at 0.6 (the hard
    // cap's white, 3.33, is what starsDebug logs).
    const one = moonAt(1)
    const anchored = METER_HIGHLIGHT / (DISPLAY_GAIN * Math.min(HIGHLIGHT_ALBEDO_FACTOR * 0.12, 1))
    expect(one.frameFraction).toBeGreaterThan(0.1)
    expect(sunlitBodyGain(dark, [one], earth, 0.5 * Math.PI / 180)).toBeCloseTo(anchored, 9)
    // 2°: 3%, anchored too.
    expect(sunlitBodyGain(dark, [moonAt(2)], earth, Math.PI / 180)).toBeCloseTo(anchored, 9)
    // 10°: 0.12% of the frame, most of the way into the weight: the gain
    // comes down from 4e6 to within a few times the anchor, the Moon a
    // bright disc with its highlands over white, the brightest stars left.
    // Monotone in the field.
    const ten = sunlitBodyGain(dark, [moonAt(10)], earth, 5 * Math.PI / 180)
    expect(ten).toBeLessThan(cap * 5)
    expect(ten).toBeGreaterThan(cap)
    const gains = [1, 2, 4, 6, 10, 20, 45].map((fov) => sunlitBodyGain(dark, [moonAt(fov)], earth, fov * Math.PI / 360))
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeGreaterThanOrEqual(gains[i - 1] * (1 - 1e-9))
    }
    expect(gains[gains.length - 1]).toBeGreaterThan(dark * 0.99)
  })

  it('exposes the disc from a white to a sunlit surface as its share of the frame grows to the 2% rule\'s', () => {
    const [fLo, fHi] = SUNLIT_FRAME_FRACTION
    const [, wHi] = SUNLIT_FRAME_WEIGHT
    expect(fHi).toBe(METER_HIGHLIGHT_FRACTION)
    expect(wHi).toBeLessThan(fHi)
    const pxFor = (fraction) => 2 * Math.sqrt(fraction * width * height / Math.PI)
    // The weight's blend ends where the target's begins (0.2%): there the
    // anchor holds fully at a white, and from there its target falls,
    // monotone, to 0.6 at the 2% the highlight rule keys on.
    expect(wHi).toBe(fLo)
    expect(gainAt(pxFor(fLo)) * white).toBeCloseTo(METER_HIGHLIGHT_MAX, 6)
    expect(gainAt(pxFor(fHi)) * white).toBeCloseTo(METER_HIGHLIGHT, 6)
    const mid = gainAt(pxFor(Math.sqrt(fLo * fHi))) * white
    expect(mid).toBeGreaterThan(METER_HIGHLIGHT)
    expect(mid).toBeLessThan(METER_HIGHLIGHT_MAX)
    let prev = gainAt(pxFor(fLo)) * white
    for (let f = fLo * 1.05; f <= fHi; f *= 1.05) {
      const target = gainAt(pxFor(f)) * white
      expect(target).toBeLessThanOrEqual(prev * (1 + 1e-9))
      prev = target
    }
    // Under 0.2% the weight fades the anchor out toward the frame's gain.
    expect(gainAt(pxFor(fLo / 2))).toBeGreaterThan(gainAt(pxFor(fLo)))
  })

  it('keeps Earth\'s crescent from 94,000 km anchored: 1.3% of a 45° frame', () => {
    // Follow-up 5's case: the lit crescent 0.3% of the pixels, the disc
    // 1.3%; the percentile rules miss it and ran the frame to 4e6.
    const angularRadius = 3.6 * Math.PI / 180
    const [w, h] = [480, 300]
    const diameterPx = 2 * angularRadius / ((45 * Math.PI / 180) / h)
    const crescent = {angularRadius, litFraction: 0.3, keyedExposure: earth, albedo: 0.367, diameterPx,
      frameFraction: (Math.PI * ((diameterPx / 2) ** 2)) / (w * h)}
    expect(crescent.frameFraction).toBeGreaterThan(0.01)
    const g = sunlitBodyGain(dark, [crescent], earth, 22.5 * Math.PI / 180)
    expect(g).toBeLessThan(1.5)
    expect(g).toBeGreaterThanOrEqual(1)
  })

  it('keeps the hard cap\'s guards: the disc in the frame, a twentieth lit, never under 1, and a cap only', () => {
    const wide = 22.5 * Math.PI / 180
    const moon = {angularRadius: 14 * Math.PI / 180, litFraction: 1, keyedExposure: earth, albedo: 0.367, diameterPx: 700,
      frameFraction: 0.3}
    expect(sunlitBodyGain(dark, [{...moon, angularRadius: 89 * Math.PI / 180}], earth, wide)).toBe(dark)
    expect(sunlitBodyGain(dark, [{...moon, litFraction: 0.02}], earth, wide)).toBe(dark)
    expect(sunlitBodyGain(dark, [], earth, wide)).toBe(dark)
    expect(sunlitBodyGain(null, [moon], earth, wide)).toBe(null)
    expect(sunlitBodyGain(0, [moon], earth, wide)).toBe(0)
    // A gain under the cap stays: the meter's 0.5 with Earth in view.
    expect(sunlitBodyGain(0.5, [moon], earth, wide)).toBe(0.5)
    // From Pluto's keyed exposure a resolved Earth asks for 0.03: the floor is 1.
    const pluto = exposureAt(39.5 * ASTRO_UNIT_METER)
    expect(sunlitBodyGain(dark, [{...moon, albedo: 1}], pluto, wide)).toBe(1)
  })
})


describe('a self-luminous disc in the frame', () => {
  const sun = (diameterPx) => [{diameterPx, radianceAtEarthKeyed: SUN_DISC_RADIANCE}]
  const discGain = METER_HIGHLIGHT / SUN_DISC_RADIANCE

  it('brings the gain to what shows the disc\'s surface once it is 32 px across, none at 4 px', () => {
    expect(luminousDiscGain(METER_GAIN_MAX, sun(4), 1)).toBe(METER_GAIN_MAX)
    expect(luminousDiscGain(METER_GAIN_MAX, sun(8), 1)).toBe(METER_GAIN_MAX)
    // The Sun from 50 Gm on a 2000 px window: 70 px.  Its disc, 69,357 at
    // Earth's keyed exposure, shows at 0.6.
    const g70 = luminousDiscGain(METER_GAIN_MAX, sun(70), 1)
    expect(g70).toBeCloseTo(discGain, 12)
    expect(g70 * SUN_DISC_RADIANCE).toBeCloseTo(METER_HIGHLIGHT, 9)
    expect(g70).toBeGreaterThan(METER_GAIN_MIN)
    // At Pluto's keyed exposure (37× Earth's) the disc is 37× brighter in
    // keyed units: the gain 37× lower, the disc still at 0.6.
    expect(luminousDiscGain(1e5, sun(70), 36.9) * SUN_DISC_RADIANCE * 36.9).toBeCloseTo(METER_HIGHLIGHT, 9)
  })

  it('is monotone and continuous in the disc\'s diameter, from the field\'s gain to the disc\'s', () => {
    let last = METER_GAIN_MAX
    let maxStep = 0
    for (let px = 0; px <= 40; px += 0.25) {
      const g = luminousDiscGain(METER_GAIN_MAX, sun(px), 1)
      expect(g).toBeLessThanOrEqual(last * (1 + 1e-9))
      maxStep = Math.max(maxStep, Math.abs(Math.log10(last / g)))
      last = g
    }
    // 11.6 decades over 24 px in steps of a quarter pixel: under 0.2 a step.
    expect(maxStep).toBeLessThan(0.2)
    expect(luminousDiscGain(METER_GAIN_MAX, sun(20), 1)).toBeCloseTo(Math.sqrt(METER_GAIN_MAX * discGain), 6)
  })

  it('scales its diameters by the pixel ratio, never lifts the gain, and leaves a frame without a disc alone', () => {
    expect(luminousDiscGain(METER_GAIN_MAX, sun(16), 1, 2)).toBe(METER_GAIN_MAX)
    expect(luminousDiscGain(1e-5, sun(70), 1)).toBeCloseTo(discGain, 12)
    expect(luminousDiscGain(METER_GAIN_MAX, [], 1)).toBe(METER_GAIN_MAX)
    expect(luminousDiscGain(null, sun(70), 1)).toBeNull()
  })
})


describe('the Sun\'s disc in the buffer', () => {
  it('is finite under the ceiling at any exposure, and 0.6 at the luminous-disc gain', () => {
    for (const gain of [1e-6, 1, 4e6, 1e9]) {
      const v = sunDiscValue(gain)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeLessThanOrEqual(HDR_MAX_VALUE)
    }
    const discGain = luminousDiscGain(METER_GAIN_MAX, [{diameterPx: 70, radianceAtEarthKeyed: SUN_DISC_RADIANCE}], 1)
    expect(sunDiscValue(discGain)).toBeCloseTo(METER_HIGHLIGHT, 9)
    expect(sunDiscValue(1)).toBeGreaterThan(sunDiscValue(1e-2))
  })
})


describe('pre-exposure: the buffer holds emitted radiance at the gain the frame renders with', () => {
  // HDR.md, "Pre-exposure".  uExposureRelative is keyedOverEarth × the
  // metered gain; each source's value in the buffer is its radiance at
  // Earth's keyed exposure times it.  Half-float holds 6.1e-5 to 65,504
  // as normal values; the sources that matter land well inside.
  const mag = (m) => illuminanceRatio(m)
  const inRange = (v) => {
    expect(v).toBeGreaterThanOrEqual(HDR_MIN_NORMAL)
    expect(v).toBeLessThanOrEqual(HDR_MAX_VALUE)
  }

  it('a star field at the dark-adapted gain: magnitude 6 to Sirius, on the test viewport and a screen', () => {
    for (const heightPx of [300, 1080, 2160]) {
      const six = starSprite(mag(6), METER_GAIN_MAX, {heightPx})
      inRange(six.value)
      inRange(six.peak)
      expect(six.value).toBeGreaterThan(0.1)
      const sirius = starSprite(mag(-1.46), METER_GAIN_MAX, {heightPx})
      inRange(sirius.value)
      inRange(sirius.peak)
      expect(sirius.value).toBeGreaterThan(100)
      expect(sirius.value).toBeLessThan(1000)
      // The limit star itself, and the faintest that shows at all (a
      // display step, 1 of 255, is 0.004 in exposure units): both normal.
      inRange(starSprite(mag(LIMITING_MAGNITUDE), METER_GAIN_MAX, {heightPx}).peak)
      inRange(starSprite(mag(10), METER_GAIN_MAX, {heightPx}).peak)
    }
    // From Pluto, where the keyed exposure is 37× Earth's, the dark gain
    // is 4e6 / 37 over it, the same absolute exposure: the same values.
    const keyedOverEarth = 36.9
    const gain = meteredGain({meanLog: Math.log(1e-12), highlight: 1e-12, blown: 1e-12, max: 1e-6}, 1, true, keyedOverEarth)
    expect(starSprite(mag(6), gain * keyedOverEarth).value).toBeCloseTo(starSprite(mag(6), METER_GAIN_MAX).value, 6)
  })

  it('the Sun\'s disc at the luminous-disc gain, and the Milky Way at the dark gain', () => {
    const discGain = luminousDiscGain(METER_GAIN_MAX, [{diameterPx: 70, radianceAtEarthKeyed: SUN_DISC_RADIANCE}], 1)
    inRange(sunDiscValue(discGain))
    expect(sunDiscValue(discGain)).toBeCloseTo(METER_HIGHLIGHT, 9)
    // A dark field with the Sun a point in it: the disc's mesh is under a
    // pixel but still drawn, at 1e9 over white, through the shoulder.
    inRange(sunDiscValue(METER_GAIN_MAX))
    inRange(MILKY_WAY_RADIANCE * METER_GAIN_MAX)
    expect(MILKY_WAY_RADIANCE * METER_GAIN_MAX).toBeCloseTo(0.078, 2)
  })

  it('at the keyed exposure the same stars are subnormal, and invisible: why frameCanBeEmpty stays for the loading frame', () => {
    // The loading frame renders at gain 1; a star field there is under
    // half-float's smallest normal value (a GPU may flush it to zero) and
    // under a display step through the tone map, so the meter can't tell
    // it from nothing drawn and the scene has to say (frameCanBeEmpty).
    for (const m of [6, 1.7, 0]) {
      const star = starSprite(mag(m), 1, {heightPx: 1080})
      expect(star.peak).toBeLessThan(HDR_MIN_NORMAL)
      expect(star.peak).toBeLessThan(STAR_VISIBLE_VALUE)
      expect(neutral([star.peak, star.peak, star.peak])[0] * 255).toBeLessThan(0.02)
    }
    // Sirius alone peaks over the floor on a screen (1.2e-4, the kernel's
    // 2.5× over its 4.4e-5), still 1/35 of a display step.
    const sirius = starSprite(mag(-1.46), 1, {heightPx: 1080}).peak
    expect(sirius).toBeGreaterThan(HDR_MIN_NORMAL)
    expect(sirius).toBeLessThan(STAR_VISIBLE_VALUE / 30)
    // Emitted radiance under the floor is written as zero (hdr.js emitted):
    // what Metal does to it anyway, and nothing visible.
    const alnilam = starSprite(mag(1.7), 1, {heightPx: 1080}).peak
    expect(emitted([alnilam, alnilam, alnilam])).toEqual([0, 0, 0])
    expect(emitted([HDR_MIN_NORMAL, 0.12, 1.5])).toEqual([HDR_MIN_NORMAL, 0.12, 1.5])
    expect(neutral([HDR_MIN_NORMAL, HDR_MIN_NORMAL, HDR_MIN_NORMAL])[0] * 255).toBeLessThan(1 / 60)
  })

  it('the meter divides its readback by the gain the frame rendered with: not the goal, not the eased meter gain', () => {
    // A scene whose mean luminance at the keyed exposure is 1e-3 and whose
    // highlight 0.02, rendered while the gain eases: the frame holds the
    // scene times the rendered gain, and only that divisor gives the
    // scene's own answer back.
    const scene = (gain) => ({meanLog: Math.log(1e-3 * gain), highlight: 0.02 * gain, blown: 1e-4 * gain, max: 0.5 * gain})
    const want = meteredGain(scene(1), 1)
    expect(want).toBeCloseTo(METER_HIGHLIGHT / 0.02, 9)
    const rendered = 37.2 // toneMappingExposure / keyed, mid-ease
    const meterGain = 120 // _meterGain, ahead of the exposure's own easing
    const goal = 4e6 // _meterGainGoal
    expect(meteredGain(scene(rendered), rendered)).toBeCloseTo(want, 9)
    expect(meteredGain(scene(rendered), meterGain)).toBeCloseTo(want * meterGain / rendered, 6)
    expect(meteredGain(scene(rendered), goal)).not.toBeCloseTo(want, 0)
    // Through the dark end too: a black frame rendered at any gain asks
    // for the ceiling, whichever divisor (the floor is in keyed units).
    const dark = (gain) => ({meanLog: Math.log(1e-12 * gain), highlight: 1e-12 * gain, blown: 1e-12 * gain, max: 1e-6 * gain})
    expect(meteredGain(dark(rendered), rendered)).toBeCloseTo(METER_GAIN_MAX, 6)
  })
})


describe('a star\'s clip z', () => {
  // The camera as ThreeUi.configLargeScene sets it: near 6e5 m, far six
  // galaxy radii.
  const near = 6e5
  const far = 9.461e15 * 5e4 * 6
  const ly = 9.461e15

  it('is on the far-plane boundary for every star, by float32: Alnilam, Sirius, the nearest', () => {
    for (const d of [1985 * ly, 8.6 * ly, 4.2 * ly, 0.01 * ly]) {
      const {z, w, onFarPlane} = starClipZ(d, near, far)
      expect(onFarPlane).toBe(true)
      expect(z).toBe(w)
    }
  })

  it('is pulled 8 ulps inside, 8 steps of the depth buffer, by stars.vert', () => {
    for (const d of [1985 * ly, 4.2 * ly]) {
      const {w, zInside, ulpsInside} = starClipZ(d, near, far)
      expect(zInside).toBeLessThan(w)
      expect(ulpsInside).toBeGreaterThanOrEqual(7)
      expect(ulpsInside).toBeLessThanOrEqual(10)
    }
    // A planet 1e9 m out is well inside already (its own depth, untouched).
    const planet = starClipZ(1e9, near, far)
    expect(planet.onFarPlane).toBe(false)
    expect(planet.zInside).toBe(planet.z)
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

  it('on a coarse viewport the pixel is the patch: one flat pixel at the radiance, wherever the star falls', () => {
    // 300 px at 45°: a 9′ pixel, the 10′ patch is 1 px.  Under white the
    // sprite is that pixel at L (no Gaussian sampled off its centre), so
    // the limit star reads LIMIT_VALUE whatever its sub-pixel position.
    for (const m of [LIMITING_MAGNITUDE, 6, 5, 4.5]) {
      const star = starSprite(mag(m), METER_GAIN_MAX)
      expect(star.flat).toBe(true)
      expect(star.sizePx).toBe(1)
      expect(star.sigma).toBe(0)
      expect(star.peak).toBeCloseTo(star.value, 9)
    }
    // Over white the bloom takes over: a Gaussian whose peak is white.
    const bright = starSprite(mag(2), METER_GAIN_MAX)
    expect(bright.flat).toBe(false)
    expect(bright.peak).toBeGreaterThan(1)
    expect(bright.sigma).toBeGreaterThan(0.6)
  })

  it('on a screen the kernel is a quarter of the patch: the peak 2.5 × the radiance, the same from 1080 to 2160 px', () => {
    // The patch is 4 px at 1080 and 8 px at 2160; the kernel's sum is
    // 2π(patch/4)² = 0.39 patch², so a limit star peaks at 2.5 × 0.12 =
    // 0.3 (as it did at 7cb678a, where σ was a quarter of the sprite),
    // not at 0.12 with a halo lost in the tone map's toe.
    expect(STAR_PEAK_OVER_RADIANCE).toBeCloseTo(2.546, 2)
    for (const heightPx of [1080, 1440, 2160]) {
      const faint = starSprite(mag(LIMITING_MAGNITUDE), METER_GAIN_MAX, {heightPx})
      expect(faint.flat).toBe(false)
      expect(faint.peak / faint.value).toBeCloseTo(STAR_PEAK_OVER_RADIANCE, 6)
      expect(faint.peak).toBeCloseTo(LIMIT_VALUE * STAR_PEAK_OVER_RADIANCE, 3)
      expect(faint.sigma).toBeCloseTo(faint.patchPx / 4, 9)
      // Its light is conserved: the kernel's sum is the patch's pixels times L.
      expect(faint.peak * 2 * Math.PI * faint.sigma * faint.sigma).toBeCloseTo(faint.value * faint.patchPx * faint.patchPx, 6)
    }
    // A 2 px patch (a 600 px viewport) keeps the kernel at its least
    // width, 0.6 px, for a peak that doesn't depend on the star's position.
    const two = starSprite(mag(LIMITING_MAGNITUDE), METER_GAIN_MAX, {heightPx: 600})
    expect(two.patchPx).toBe(2)
    expect(two.sigma).toBe(0.6)
    expect(two.peak).toBeGreaterThan(LIMIT_VALUE)
  })

  it('by day only the planets: a first-magnitude star is under a pixel\'s black', () => {
    expect(starSprite(mag(1), 1).peak).toBeLessThan(0.004)
  })

  it('the Sun: a point from Pluto, its disc from Earth', () => {
    const fromPluto = starSprite(1 / (39.5 * 39.5), METER_GAIN_MAX, {discRad: 2 * 6.957e8 / 5.9e12, heightPx: 1080})
    // 1e9 over white: the glare cap holds its core to two patches (8 px at
    // 1080p) with the halo falling off round it, not a 120 px disc.
    expect(fromPluto.glareCapped).toBe(true)
    expect(fromPluto.coreRadiusPx).toBeCloseTo(STAR_GLARE_CORE_PATCHES * fromPluto.patchPx, 6)
    expect(fromPluto.sizePx).toBeGreaterThan(2 * fromPluto.coreRadiusPx)
    expect(fromPluto.sizePx).toBeLessThan(STAR_MAX_SIZE_PX)
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

  it('stars.frag floors emitted radiance at the buffer\'s smallest normal value, the same constant as hdr.js', () => {
    // The shader is a file, not a template, so it carries its own copy.
    const source = readFileSync('./js/shaders/stars.frag', 'utf8')
    const declared = source.match(/const float HDR_MIN_NORMAL = ([0-9.e+-]+);/)
    expect(declared).not.toBeNull()
    expect(Number(declared[1])).toBeCloseTo(HDR_MIN_NORMAL, 10)
    expect(source).toMatch(/gl_FragColor = vec4\(emitted\(/)
  })
})
