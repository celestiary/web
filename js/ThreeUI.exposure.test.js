import {afterEach, beforeEach, describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Vector3} from 'three'
import {METER_GAIN_MAX, arrivalGain, exposureAt} from './scene/exposure.js'
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
  return Object.assign(Object.create(ThreeUi.prototype), {
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
  })
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


describe('ThreeUi exposure on the way to a body', () => {
  const AU = 1.495978707e11
  const R = 3.3895e6
  let body
  let tween
  let progress

  /**
   * A ThreeUi with the real methods and no renderer, as stopped down at the
   * Sun (gain 1e-5), keyed already to Mars (targeting it keys it).
   *
   * @returns {object}
   */
  function stoppedDown() {
    const ui = fakeUi(0)
    ui._exposureGoal = exposureAt(1.52 * AU)
    ui._meterGain = 1e-5
    ui._meterGainGoal = 1e-5
    ui.renderer.toneMappingExposure = ui._exposureGoal * 1e-5
    ui._lastExposureMs = performance.now()
    ui.camera = new PerspectiveCamera(45, 1.5, 1, 1e20)
    ui.width = 480
    ui.height = 320
    ui._exposureBodyPos = new Vector3()
    ui._exposureSunPos = new Vector3()
    return ui
  }

  beforeEach(() => {
    body = new Object3D()
    body.props = {name: 'mars', type: 'planet', radius: {scalar: R}, albedo: 0.25}
    body.position.set(1.52 * AU, 0, 0)
    body.updateMatrixWorld()
    progress = 0
    tween = {travelProgress: () => progress}
    targets.obj = body
    targets.tween = tween
  })

  afterEach(() => {
    targets.obj = null
    targets.tween = null
  })

  // Arriving 10 radii out on the sunward side: the disc lit, 3% of the frame.
  const sunward = () => new Vector3((1.52 * AU) - (10 * R), 0, 0)

  it('works out the arrival\'s gain when the travel starts, from its pose', () => {
    const ui = stoppedDown()
    ui.approach(body, sunward(), tween)
    const keyed = exposureAt(1.52 * AU)
    const arrival = ui._sunlitEntry(body.props, body.position, sunward(), new Vector3())
    expect(arrival.litFraction).toBeCloseTo(1, 9)
    expect(ui._approach.gain).toBeCloseTo(
        arrivalGain([arrival], keyed, 22.5 * Math.PI / 180, keyed / exposureAt(AU)), 9)
    expect(ui._approach.gain).toBeGreaterThanOrEqual(1)
    expect(ui._approach.gain).toBeLessThan(2)
  })

  it('follows the destination on the way, and arrives at its exposure, not at the meter\'s lag', () => {
    const ui = stoppedDown()
    const live = ui.renderer.toneMappingExposure
    ui.approach(body, sunward(), tween)
    const arrive = ui._exposureGoal * ui._approach.gain
    const seen = []
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      progress = p
      ThreeUi.prototype._updateExposure.call(ui)
      seen.push(ui.renderer.toneMappingExposure)
    }
    expect(seen[0] / live).toBeCloseTo(1, 6)
    expect(seen[4] / arrive).toBeCloseTo(1, 12)
    // Evenly in stops by the travel's progress.
    expect(Math.log(seen[2])).toBeCloseTo((Math.log(live) + Math.log(arrive)) / 2, 4)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1])
    }
    // The meter divides its reading by the gain the frame was drawn at.
    expect(ui._renderedGain).toBeCloseTo(ui._approach.gain, 9)
  })

  it('hands the meter the arrival\'s gain on arriving, so nothing moves after', () => {
    const ui = stoppedDown()
    ui.approach(body, sunward(), tween)
    const gain = ui._approach.gain
    progress = 1
    ThreeUi.prototype._updateExposure.call(ui)
    const arrived = ui.renderer.toneMappingExposure
    // The tween ends (ThreeUi.renderLoop nulls it), its last update at 1.
    targets.tween = null
    ThreeUi.prototype._updateExposure.call(ui)
    expect(ui._approach).toBeNull()
    expect(ui._meterGain).toBe(gain)
    expect(ui._meterGainGoal).toBe(gain)
    for (let i = 0; i < 10; i++) {
      ThreeUi.prototype._updateExposure.call(ui)
      expect(ui.renderer.toneMappingExposure / arrived).toBeCloseTo(1, 12)
    }
  })

  it('an interrupted travel leaves the meter its own gain, and eases back from where it was', () => {
    const ui = stoppedDown()
    ui.approach(body, sunward(), tween)
    progress = 0.4
    ThreeUi.prototype._updateExposure.call(ui)
    const mid = ui.renderer.toneMappingExposure
    targets.tween = {}
    ThreeUi.prototype._updateExposure.call(ui)
    expect(ui._approach).toBeNull()
    expect(ui._meterGainGoal).toBe(1e-5)
    // Eased from the blend, not stepped back to the live exposure.
    expect(ui.renderer.toneMappingExposure).toBeLessThanOrEqual(mid)
    expect(ui.renderer.toneMappingExposure).toBeGreaterThan(mid * 0.5)
  })

  it('a night-side arrival is exposed for the dark', () => {
    const ui = stoppedDown()
    const nightward = new Vector3((1.52 * AU) + (10 * R), 0, 0)
    ui.approach(body, nightward, tween)
    const keyedOverEarth = ui._exposureGoal / exposureAt(AU)
    expect(ui._approach.gain / (METER_GAIN_MAX / keyedOverEarth)).toBeCloseTo(1, 9)
  })

  it('the meter\'s readings on the way don\'t set its goal: the arrival does', () => {
    const ui = stoppedDown()
    const pixels = new Float32Array(32 * 32 * 4).fill(1e-3)
    const ctx = {renderedOverKeyed: 1, exposureGoal: ui._exposureGoal, halfFov: 0.39, canBeEmpty: false,
      sunlit: [], luminous: [], galaxyWeight: 0, pixelRatio: 1}
    ThreeUi.prototype._meterApply.call(ui, pixels, {...ctx, approach: true})
    expect(ui._meterGainGoal).toBe(1e-5)
    ThreeUi.prototype._meterApply.call(ui, pixels, {...ctx, approach: false})
    expect(ui._meterGainGoal).not.toBe(1e-5)
  })

  it('counts what else is in the arrival\'s frame, as the meter will: Earth behind the Moon', () => {
    const moonR = 1.7374e6
    const earth = new Object3D()
    earth.props = {name: 'earth', type: 'planet', radius: {scalar: 6.371e6}, albedo: 0.37}
    // Near behind the Moon (nearer than it is), so its disc weighs fully.
    earth.position.set(AU, 3.844e8 - 4e7, 0)
    const moon = new Object3D()
    moon.props = {name: 'moon', type: 'moon', radius: {scalar: moonR}, albedo: 0.12}
    moon.position.set(AU, 3.844e8, 0)
    earth.updateMatrixWorld()
    moon.updateMatrixWorld()
    targets.obj = moon
    // Coming in over the Moon from beyond it, Earth behind it in the frame.
    const arrival = new Vector3(AU, 3.844e8 + (10 * moonR), 0)
    const alone = stoppedDown()
    alone.sceneManager = {objects: {moon}}
    alone.approach(moon, arrival, tween)
    const withEarth = stoppedDown()
    withEarth.sceneManager = {objects: {moon, earth}}
    withEarth.approach(moon, arrival, tween)
    expect(withEarth._sunlitBodies(withEarth._arrivalView, moon).length).toBe(1)
    expect(withEarth._approach.gain).toBeLessThan(alone._approach.gain)
    expect(withEarth._approach.gain).toBeCloseTo(1, 9)
  })

  it('a travel to a star, or no travel, leaves the exposure to the meter', () => {
    const ui = stoppedDown()
    ui.approach({props: {type: 'star', radius: {scalar: 7e8}}}, sunward(), tween)
    expect(ui._approach).toBeNull()
    ui.approach(body, sunward(), null)
    expect(ui._approach).toBeNull()
  })
})
