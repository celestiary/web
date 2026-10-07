import {afterEach, describe, expect, it} from 'bun:test'
import {PerspectiveCamera, Vector3} from 'three'
import {targets} from './shared'


// Celestiary.test.js replaces './ThreeUI' with a stub for the whole run, in
// the same process; the query makes this the real module.
const REAL_THREE_UI = './ThreeUI.js?real'
const {default: ThreeUi} = await import(REAL_THREE_UI)


/**
 * @param {object} keys Held arrow keys
 * @returns {object} The parts of a ThreeUi `_applyCameraArrowKeys` uses
 */
function fakeUi(keys) {
  return {
    camera: new PerspectiveCamera,
    _arrowKeys: {up: false, down: false, left: false, right: false, ...keys},
    onCameraChange: null,
  }
}


const forward = (camera) => new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
const up = (camera) => new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)


describe('ThreeUi arrow keys while tracking', () => {
  afterEach(() => {
    targets.track = false
  })

  it('pitch and roll as ever when not tracking', () => {
    const ui = fakeUi({up: true, left: true})
    ThreeUi.prototype._applyCameraArrowKeys.call(ui)
    expect(forward(ui.camera).y).toBeGreaterThan(0.005)
    expect(up(ui.camera).x).toBeLessThan(-0.005)
  })

  it('roll the view, which leaves the target centred', () => {
    targets.track = true
    const ui = fakeUi({left: true})
    ThreeUi.prototype._applyCameraArrowKeys.call(ui)
    ThreeUi.prototype._applyCameraArrowKeys.call(ui)
    expect(forward(ui.camera).distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-9)
    expect(up(ui.camera).x).toBeLessThan(-0.01)
  })

  it('do not pitch it, which would fight the tracking', () => {
    targets.track = true
    const ui = fakeUi({up: true, down: true})
    ThreeUi.prototype._applyCameraArrowKeys.call(ui)
    expect(ui.camera.quaternion.w).toBe(1)
    const pitched = fakeUi({up: true, right: true})
    ThreeUi.prototype._applyCameraArrowKeys.call(pitched)
    expect(forward(pitched.camera).distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-9)
    expect(up(pitched.camera).x).toBeGreaterThan(0.005)
  })
})
