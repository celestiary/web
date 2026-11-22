import {describe, expect, it} from 'bun:test'
import {PerspectiveCamera} from 'three'


// Celestiary.test.js replaces './ThreeUI' with a stub for the whole run, in
// the same process; the query makes this the real module.
const REAL_THREE_UI = './ThreeUI.js?real'
const {default: ThreeUi} = await import(REAL_THREE_UI)


/**
 * @param {boolean} sky Whether sky imagery is in the frame
 * @returns {object} A ThreeUi with a camera at 1°, and the scene's answer
 */
function uiWith(sky) {
  const ui = Object.create(ThreeUi.prototype)
  ui.camera = new PerspectiveCamera(1, 1.6, 1, 1e20)
  ui.sceneManager = {skyInView: () => sky}
  ui.fieldLimit = false
  ui.setFov = (fov) => {
    ui.camera.fov = fov
  }
  return ui
}


describe('the wheel over sky imagery', () => {
  it('narrows and widens the field, a notch about a fifth, and is taken', () => {
    const ui = uiWith(true)
    expect(ui.wheelField(-100)).toBe(true)
    expect(ui.camera.fov).toBeCloseTo(Math.exp(-0.2), 12)
    expect(ui.wheelField(100)).toBe(true)
    expect(ui.camera.fov).toBeCloseTo(1, 12)
    // A trackpad's small steps add up to the same; one wild event counts for a notch and a bit.
    for (let i = 0; i < 50; i++) {
      ui.wheelField(-2)
    }
    expect(ui.camera.fov).toBeCloseTo(Math.exp(-0.2), 12)
    ui.camera.fov = 1
    ui.wheelField(-5000)
    expect(ui.camera.fov).toBeCloseTo(Math.exp(-0.24), 12)
  })

  it('leaves the wheel to the camera\'s move with no imagery in the frame', () => {
    const ui = uiWith(false)
    expect(ui.wheelField(-100)).toBe(false)
    expect(ui.camera.fov).toBe(1)
    const none = uiWith(true)
    none.sceneManager = {}
    expect(none.wheelField(-100)).toBe(false)
    expect(uiWith(true).wheelField(0)).toBe(false)
    expect(uiWith(true).wheelField(NaN)).toBe(false)
  })
})


describe('a picture of the sky in view', () => {
  it('is sky imagery in the frame, at any field', () => {
    const ui = uiWith(true)
    expect(ui.pictureInView()).toBe(true)
    ui.camera.fov = 45
    expect(ui.pictureInView()).toBe(true)
    expect(uiWith(false).pictureInView()).toBe(false)
  })
})
