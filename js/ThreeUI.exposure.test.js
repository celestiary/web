import {beforeEach, describe, expect, it} from 'bun:test'
import {targets} from './shared'


// Celestiary.test.js replaces './ThreeUI' with a stub for the whole run, in
// the same process; the query makes this the real module.
const REAL_THREE_UI = './ThreeUI.js?real'
const {default: ThreeUi} = await import(REAL_THREE_UI)


/**
 * The parts of a ThreeUi that `_updateExposure` reads and writes, without a
 * renderer: it eases the renderer's exposure toward the goal at once on its
 * first call (no earlier frame to ease from).
 *
 * @param {number} ev The user's compensation, stops
 * @returns {object}
 */
function fakeUi(ev) {
  return {
    _exposureGoal: 2e-5,
    _meterGain: 3,
    _meterGainGoal: 3,
    _renderedGain: 1,
    _evStops: ev,
    _lastExposureMs: null,
    _worldGroup: null,
    scene: {getObjectByName: () => null},
    renderer: {toneMappingExposure: 1},
    camera: {fov: 45},
    height: 100,
  }
}


describe('ThreeUi exposure compensation', () => {
  beforeEach(() => {
    targets.obj = null
  })

  it('multiplies the metered exposure by 2^EV', () => {
    for (const ev of [0, 1, -1, 4 / 3, -2 / 3, 5]) {
      const ui = fakeUi(ev)
      ThreeUi.prototype._updateExposure.call(ui)
      expect(ui.renderer.toneMappingExposure / (2e-5 * 3)).toBeCloseTo(2 ** ev, 10)
    }
  })

  it('leaves the meter its reading: the rendered gain it divides out carries the compensation', () => {
    const plain = fakeUi(0)
    const boosted = fakeUi(2)
    ThreeUi.prototype._updateExposure.call(plain)
    ThreeUi.prototype._updateExposure.call(boosted)
    // The gain the frame rendered with, over the keyed exposure (what the
    // meter divides its readback by): the metered 3, times the compensation.
    expect(plain._renderedGain).toBeCloseTo(3, 10)
    expect(boosted._renderedGain).toBeCloseTo(12, 10)
    // The metered gain itself is untouched.
    expect(boosted._meterGain).toBe(plain._meterGain)
  })

  it('is set, read and held to the range by the public pair', () => {
    const ui = fakeUi(0)
    ThreeUi.prototype.setExposureCompensation.call(ui, 1.5)
    expect(ThreeUi.prototype.exposureCompensation.call(ui)).toBe(1.5)
    ThreeUi.prototype.setExposureCompensation.call(ui, 100)
    expect(ui._evStops).toBe(10)
    ThreeUi.prototype.setExposureCompensation.call(ui, NaN)
    expect(ui._evStops).toBe(0)
  })
})
