import {
  EXPOSURE_TAU_SECONDS, METER_TAU_DOWN_SECONDS, METER_TAU_UP_SECONDS, adaptMeterGain, easeExposure,
} from '../exposure.js'
import {ADAPTATION, NAKED_EYE} from './instrument.js'


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
