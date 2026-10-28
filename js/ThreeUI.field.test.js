import {describe, expect, it} from 'bun:test'
import {PerspectiveCamera} from 'three'
import {NAKED_EYE, RUBIN} from './scene/observer/instrument.js'


// Celestiary.test.js replaces './ThreeUI' with a stub for the whole run, in
// the same process; the query makes this the real module.
const REAL_THREE_UI = './ThreeUI.js?real'
const {default: ThreeUi} = await import(REAL_THREE_UI)


/**
 * @param {number} heightPx The canvas's height, device pixels
 * @returns {object} A ThreeUi with only what the field's methods use
 */
function fakeUi(heightPx = 1000) {
  const ui = Object.create(ThreeUi.prototype)
  ui.camera = new PerspectiveCamera(45, 1.6, 1, 1e20)
  ui.renderer = {domElement: {height: heightPx}, getContext: () => null}
  ui.instrument = NAKED_EYE
  ui.fieldLimit = true
  ui._starMag = 0
  ui.changes = 0
  ui.onCameraChange = () => ui.changes++
  return ui
}


const pixelLimit = 0.2 * 1000 / 3600


describe('ThreeUi field of view, held to the instrument\'s range', () => {
  it('is free with the naked eye', () => {
    const ui = fakeUi()
    ui.setFov(1e-4)
    expect(ui.camera.fov).toBe(1e-4)
    ui.setFov(120)
    expect(ui.camera.fov).toBe(120)
  })

  it('is held to Rubin\'s field when its camera is the observer, from the instrument\'s arrival', () => {
    const ui = fakeUi()
    ui.setInstrument(RUBIN)
    expect(ui.instrument).toBe(RUBIN)
    expect(ui.camera.fov).toBe(3.5)
    // A link's fov= past the pixel limit, and the keys (multFov) at each end.
    ui.setFov(0.0001615)
    expect(ui.camera.fov).toBeCloseTo(pixelLimit, 12)
    ui.multFov(0.9)
    expect(ui.camera.fov).toBeCloseTo(pixelLimit, 12)
    ui.multFov(1.1)
    expect(ui.camera.fov).toBeCloseTo(pixelLimit * 1.1, 12)
    for (let i = 0; i < 100; i++) {
      ui.multFov(1.1)
    }
    expect(ui.camera.fov).toBe(3.5)
    ui.resetFov()
    expect(ui.camera.fov).toBe(3.5)
    expect(ui.camera.projectionMatrix.elements[5]).toBeCloseTo(1 / Math.tan(1.75 * Math.PI / 180), 6)
  })

  it('follows the canvas\'s height in device pixels for the pixel limit', () => {
    const ui = fakeUi(2000)
    ui.setInstrument(RUBIN)
    ui.setFov(1e-4)
    expect(ui.camera.fov).toBeCloseTo(2 * pixelLimit, 12)
  })

  it('is free with the limit off, and held again when it comes back on', () => {
    const ui = fakeUi()
    ui.setFieldLimit(false)
    ui.setInstrument(RUBIN)
    expect(ui.camera.fov).toBe(45)
    expect(ui.fieldRange()).toBe(null)
    ui.setFov(0.0001615)
    expect(ui.camera.fov).toBe(0.0001615)
    ui.setFieldLimit(true)
    expect(ui.camera.fov).toBeCloseTo(pixelLimit, 12)
  })

  it('is free again once the naked eye is back (the app stopped)', () => {
    const ui = fakeUi()
    ui.setInstrument(RUBIN)
    ui.setInstrument(null)
    expect(ui.instrument).toBe(NAKED_EYE)
    ui.setFov(1e-4)
    expect(ui.camera.fov).toBe(1e-4)
    ui.resetFov()
    expect(ui.camera.fov).toBe(45)
  })
})
