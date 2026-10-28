import {
  EXPOSURE_TAU_SECONDS, METER_TAU_DOWN_SECONDS, METER_TAU_UP_SECONDS, adaptMeterGain, easeExposure,
} from '../exposure.js'
import {
  ADAPTATION, NAKED_EYE, RUBIN, clampField, fieldEnd, instrumentFieldRange, instrumentStarGain,
} from './instrument.js'


describe('an instrument\'s field', () => {
  it('Rubin\'s: 3.5° wide, 0.2″ pixels, 0.7″ seeing, 8.4 m, and the eye\'s light and PSF for now', () => {
    expect(RUBIN.fieldMaxDeg).toBe(3.5)
    expect(RUBIN.pixelScaleArcsec).toBe(0.2)
    expect(RUBIN.resolutionArcsec).toBe(0.7)
    expect(RUBIN.apertureM).toBe(8.4)
    // Everything the star field and the meter read of ui.instrument is there.
    for (const key of Object.keys(NAKED_EYE)) {
      expect(key in RUBIN).toBe(true)
    }
    expect(RUBIN.psf).toBe(NAKED_EYE.psf)
    expect(RUBIN.adaptation).toBe(ADAPTATION)
    expect(instrumentStarGain(RUBIN, 1)).toBe(instrumentStarGain(NAKED_EYE, 1))
    expect(Object.isFrozen(RUBIN)).toBe(true)
  })

  it('the eye has no range: the field is free', () => {
    expect(instrumentFieldRange(NAKED_EYE, 1000)).toBe(null)
    expect(clampField(1e-4, null)).toBe(1e-4)
    expect(fieldEnd(45, null)).toBe(null)
  })

  it('runs from the widest field to where a detector pixel is a screen pixel', () => {
    // 0.2″ × 1,000 px = 200″, 0.056°.
    const range = instrumentFieldRange(RUBIN, 1000)
    expect(range.maxDeg).toBe(3.5)
    expect(range.minDeg).toBeCloseTo(200 / 3600, 12)
    expect(instrumentFieldRange(RUBIN, 2000).minDeg).toBeCloseTo(400 / 3600, 12)
    // A canvas so tall the pixel limit passes the widest field: the range is that one field.
    expect(instrumentFieldRange(RUBIN, 1e5)).toEqual({minDeg: 3.5, maxDeg: 3.5})
  })

  it('clamps the field to the range, and says which end it is at', () => {
    const range = instrumentFieldRange(RUBIN, 1000)
    expect(clampField(45, range)).toBe(3.5)
    expect(clampField(1e-4, range)).toBe(range.minDeg)
    expect(clampField(1, range)).toBe(1)
    expect(fieldEnd(3.5, range)).toBe('max')
    expect(fieldEnd(range.minDeg, range)).toBe('min')
    expect(fieldEnd(1, range)).toBe(null)
  })
})


describe('the observer\'s adaptation', () => {
  it('is the instrument\'s, half the first constants (1.5 s, 0.3 s and 0.5 s)', () => {
    expect(NAKED_EYE.adaptation).toBe(ADAPTATION)
    expect(ADAPTATION).toEqual({upSeconds: 0.75, downSeconds: 0.15, exposureSeconds: 0.25})
    expect(Object.isFrozen(ADAPTATION)).toBe(true)
    // exposure.js keeps the calibration's names, as the instrument's values.
    expect(METER_TAU_UP_SECONDS).toBe(ADAPTATION.upSeconds)
    expect(METER_TAU_DOWN_SECONDS).toBe(ADAPTATION.downSeconds)
    expect(EXPOSURE_TAU_SECONDS).toBe(ADAPTATION.exposureSeconds)
  })

  it('eases the metered gain up slowly and down fast, by the naked eye\'s by default', () => {
    // Up to the dark: 63% of the way, in stops, in upSeconds.
    const up = adaptMeterGain(1, 2 ** 10, ADAPTATION.upSeconds)
    expect(Math.log2(up)).toBeCloseTo(10 * (1 - Math.exp(-1)), 10)
    // Down to the light: the same in downSeconds.
    const down = adaptMeterGain(2 ** 10, 1, ADAPTATION.downSeconds)
    expect(Math.log2(down)).toBeCloseTo(10 * Math.exp(-1), 10)
    expect(easeExposure(1, 8, ADAPTATION.exposureSeconds)).toBeCloseTo(easeExposure(1, 8, 1, 1), 12)
  })

  it('follows another instrument\'s adaptation when given one', () => {
    const slow = {upSeconds: 3, downSeconds: 0.6}
    expect(adaptMeterGain(1, 2 ** 10, 3, slow)).toBeCloseTo(adaptMeterGain(1, 2 ** 10, 0.75), 10)
    expect(adaptMeterGain(2 ** 10, 1, 0.6, slow)).toBeCloseTo(adaptMeterGain(2 ** 10, 1, 0.15), 10)
  })

  it('takes the dark-adapted gain from the Sun\'s stopped-down disc to within a stop in about 2 s', () => {
    // 17 stops, eased each 1/60 s: the old constant took 4.25 s.
    const goal = 2 ** 17
    let gain = 1
    let t = 0
    const dt = 1 / 60
    while (Math.log2(goal / gain) > 1) {
      gain = adaptMeterGain(gain, goal, dt)
      t += dt
    }
    expect(t).toBeCloseTo(ADAPTATION.upSeconds * Math.log(17), 1)
    expect(t).toBeLessThan(2.2)
  })
})
