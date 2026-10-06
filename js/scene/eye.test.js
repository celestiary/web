import {
  ARCSEC2_SR, DARK_SKY_MAG, DISPLAY_STEP, EXPOSURE_UNIT_CD_M2, EXTENDED_GAIN_DARK, LARGE_FIELD_THRESHOLD_CONTRAST,
  POINT_THRESHOLD_CONTRAST, RICCO_DIAMETER_RAD, adaptationLuminance, extendedGain, extendedToDisplay, magPerArcsec2,
  pipersEndRad, s10Value, scotopicWeight, displaySum, surfaceBrightnessValue, thresholdContrast,
} from './eye.js'
import {
  EYE_PATCH_SR, EYE_POINT_RAD, LIMIT_VALUE, LIMITING_MAGNITUDE, METER_GAIN_MAX, illuminanceRatio,
} from './exposure.js'
import {DISPLAY_GAIN} from '../shared.js'
import {neutral} from './hdr.js'


const DEG = Math.PI / 180
const grey = (v) => [v, v, v]


describe('surface brightness in exposure units', () => {
  it('puts the dark site\'s sky, 22 mag/arcsec², at 6.4e-9, 1.7e-4 cd/m²', () => {
    expect(surfaceBrightnessValue(22)).toBeCloseTo(6.4e-9, 10)
    expect(surfaceBrightnessValue(22) * EXPOSURE_UNIT_CD_M2).toBeCloseTo(1.72e-4, 6)
    // A sunlit white surface, DISPLAY_GAIN, is E/π: 4e4 cd/m².
    expect(DISPLAY_GAIN * EXPOSURE_UNIT_CD_M2).toBeCloseTo(4.04e4, -2)
    for (const m of [18, 22, 26.4]) {
      expect(magPerArcsec2(surfaceBrightnessValue(m))).toBeCloseTo(m, 9)
    }
    expect(magPerArcsec2(s10Value(1))).toBeCloseTo(27.78, 2)
  })

  it('agrees with a star\'s light over the eye\'s patch (HDR.md, "Physical stars")', () => {
    const star = DISPLAY_GAIN * Math.PI * illuminanceRatio(6.5) / EYE_PATCH_SR
    const patchArcsec2 = EYE_PATCH_SR / ARCSEC2_SR
    expect(surfaceBrightnessValue(6.5 + (2.5 * Math.log10(patchArcsec2))) / star).toBeCloseTo(1, 9)
  })
})


describe('the eye\'s threshold for extended light', () => {
  it('needs a point\'s patch 4.7× the dark sky: the star calibration', () => {
    expect(POINT_THRESHOLD_CONTRAST).toBeCloseTo(LIMIT_VALUE / (METER_GAIN_MAX * surfaceBrightnessValue(DARK_SKY_MAG)), 12)
    expect(POINT_THRESHOLD_CONTRAST).toBeGreaterThan(4.5)
    expect(POINT_THRESHOLD_CONTRAST).toBeLessThan(5)
    expect(LIMITING_MAGNITUDE).toBe(6.5)
    expect(thresholdContrast(EYE_POINT_RAD)).toBeCloseTo(POINT_THRESHOLD_CONTRAST, 9)
  })

  it('falls with the field: as its area to Ricco\'s half degree, as its diameter to 2.5°, then holds', () => {
    // Ricco: contrast × area constant.
    expect(thresholdContrast(RICCO_DIAMETER_RAD / 2) / thresholdContrast(RICCO_DIAMETER_RAD)).toBeCloseTo(4, 9)
    // Piper: contrast × diameter constant.
    expect(thresholdContrast(RICCO_DIAMETER_RAD * 2) / thresholdContrast(RICCO_DIAMETER_RAD)).toBeCloseTo(0.5, 9)
    expect(pipersEndRad() / DEG).toBeGreaterThan(2)
    expect(pipersEndRad() / DEG).toBeLessThan(3)
    expect(thresholdContrast(5 * DEG)).toBe(LARGE_FIELD_THRESHOLD_CONTRAST)
    expect(thresholdContrast(30 * DEG)).toBe(LARGE_FIELD_THRESHOLD_CONTRAST)
    // The rods' summation from a point to a large field: about 50×.
    expect(POINT_THRESHOLD_CONTRAST / LARGE_FIELD_THRESHOLD_CONTRAST).toBeGreaterThan(40)
    let last = Infinity
    for (let d = 1; d < 3000; d *= 1.3) {
      const c = thresholdContrast(d / 60 * DEG)
      expect(c).toBeLessThanOrEqual(last)
      last = c
    }
  })

  it('maps the eye\'s large-field threshold over the dark sky to one display step, at a gain of about 2', () => {
    const sky = surfaceBrightnessValue(DARK_SKY_MAG) * METER_GAIN_MAX
    const step = extendedToDisplay(grey(sky * (1 + LARGE_FIELD_THRESHOLD_CONTRAST)), METER_GAIN_MAX, EXTENDED_GAIN_DARK)[1] -
      extendedToDisplay(grey(sky), METER_GAIN_MAX, EXTENDED_GAIN_DARK)[1]
    expect(step / DISPLAY_STEP).toBeGreaterThan(0.9)
    expect(step / DISPLAY_STEP).toBeLessThan(1.2)
    expect(EXTENDED_GAIN_DARK).toBeGreaterThan(2)
    expect(EXTENDED_GAIN_DARK).toBeLessThan(2.5)
    // At the stars' own gain the same difference is a twentieth of a step.
    const bare = neutral(grey(sky * (1 + LARGE_FIELD_THRESHOLD_CONTRAST)))[1] - neutral(grey(sky))[1]
    expect(bare / DISPLAY_STEP).toBeLessThan(0.25)
  })
})


describe('the extended response', () => {
  it('applies where the eye is rod-adapted, not by day, in twilight or in a photograph of the galaxy', () => {
    expect(adaptationLuminance(METER_GAIN_MAX)).toBeCloseTo(2e-3, 4)
    expect(extendedGain(METER_GAIN_MAX)).toBeCloseTo(EXTENDED_GAIN_DARK, 12)
    expect(extendedGain(1)).toBe(1)
    expect(extendedGain(1000)).toBe(1)
    expect(extendedGain(1.2e8, 1)).toBe(1)
    const mesopic = extendedGain(1e5)
    expect(mesopic).toBeGreaterThan(1)
    expect(mesopic).toBeLessThan(EXTENDED_GAIN_DARK)
    expect(scotopicWeight(1e-4)).toBe(1)
    expect(scotopicWeight(10)).toBe(0)
  })

  it('shows the band over the dark sky above the toe, and the sky dark grey', () => {
    const gain = METER_GAIN_MAX
    const at = (mag) => surfaceBrightnessValue(mag) * gain
    const sky = extendedToDisplay(grey(at(DARK_SKY_MAG)), gain, EXTENDED_GAIN_DARK)[1] * 255
    const band = extendedToDisplay(grey(at(DARK_SKY_MAG) + at(20.5)), gain, EXTENDED_GAIN_DARK)[1] * 255
    const faint = extendedToDisplay(grey(at(DARK_SKY_MAG) + at(22.5)), gain, EXTENDED_GAIN_DARK)[1] * 255
    expect(sky).toBeGreaterThan(3)
    expect(sky).toBeLessThan(8)
    expect(band).toBeGreaterThan(40)
    expect(faint).toBeGreaterThan(sky + 3)
    // Without the eye's response, the stars' gain alone: the band in the
    // toe, half as bright, and the sky black.
    expect(neutral(grey(at(DARK_SKY_MAG) + at(20.5)))[1] * 255).toBeLessThan(band / 2)
    expect(neutral(grey(at(DARK_SKY_MAG)))[1] * 255).toBeLessThan(1.5)
  })

  it('greys rod-level light, and keeps a photograph\'s colours', () => {
    const blue = [0.02, 0.03, 0.06]
    const eye = extendedToDisplay(blue, METER_GAIN_MAX, EXTENDED_GAIN_DARK, 1)
    expect(eye[0]).toBeCloseTo(eye[2], 9)
    const photo = extendedToDisplay(blue, 1.2e8, 1, 0)
    expect(photo[2]).toBeGreaterThan(photo[0])
  })

  it('adds over the stars without hiding or raising them: a limit star keeps its step over the dark sky', () => {
    const sky = extendedToDisplay(grey(surfaceBrightnessValue(DARK_SKY_MAG) * METER_GAIN_MAX), METER_GAIN_MAX,
        EXTENDED_GAIN_DARK)
    const star = neutral(grey(LIMIT_VALUE))
    const over = displaySum(star, sky)
    expect(over[1] - sky[1]).toBeCloseTo(star[1], 12)
    displaySum([0, 0, 0], sky).forEach((v, i) => expect(v).toBeCloseTo(sky[i], 12))
    displaySum([0.99, 0.99, 0.99], sky).forEach((v) => expect(v).toBe(1))
    // Added under the toe in exposure units, the sky would have raised the
    // limit star's step by a quarter, and a magnitude 7.5 star's twofold.
    const pedestal = surfaceBrightnessValue(DARK_SKY_MAG) * METER_GAIN_MAX
    const raised = (v) => neutral(grey(v + pedestal))[1] - neutral(grey(pedestal))[1]
    expect(raised(LIMIT_VALUE) / star[1]).toBeGreaterThan(1.2)
    expect(raised(LIMIT_VALUE / 2.512) / neutral(grey(LIMIT_VALUE / 2.512))[1]).toBeGreaterThan(1.5)
  })
})
