import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Vector3} from 'three'
import * as Shared from './shared.js'


// Celestiary.test.js replaces './ThreeUI' with a stub for the whole run, in
// the same process; the query makes this the real module.
const REAL_THREE_UI = './ThreeUI.js?real'
const {default: ThreeUi} = await import(REAL_THREE_UI)


const AU = 1.496e11
const R = 6.371e6


/**
 * The camera left behind near Earth (#361): its platform at the Sun's
 * origin (the frame above, after `f` off), Earth 1 AU out, the camera
 * 10,000 km from Earth's centre on the side away from the Sun.
 *
 * @param {boolean} pivotOnEarth Whether the scene names Earth as the pivot
 *   (Scene.pivotBody), as it does left behind; false is the old pivot, the
 *   platform's origin
 * @returns {object}
 */
function leftBehind(pivotOnEarth) {
  const sun = new Object3D()
  sun.props = {name: 'sun', radius: {scalar: 6.96e8}}
  const earth = new Object3D()
  earth.props = {name: 'earth', radius: {scalar: R}}
  earth.position.set(AU, 0, 0)
  sun.add(earth)
  const platform = new Object3D()
  sun.add(platform)
  const camera = new PerspectiveCamera(45, 1, 1, 1e20)
  camera.platform = platform
  platform.add(camera)
  camera.position.set(AU + 1e7, 0, 0)
  sun.updateMatrixWorld(true)
  const ui = Object.create(ThreeUi.prototype)
  ui.camera = camera
  ui._pivot = new Vector3()
  ui.controls = {target: ui._pivot}
  ui._zoomEye = new Vector3()
  ui.layers = {groundHeight: () => null, groundPending: () => false}
  ui.sceneManager = {pivotBody: () => (pivotOnEarth ? earth : null)}
  ui.onCameraChange = () => {}
  Shared.targets.cur = sun
  Shared.targets.obj = earth
  return {ui, camera, earth}
}


/**
 * One wheel step as TrackballControls makes it, then the app's remap: the
 * camera's distance from the controls' target times `factor`.
 *
 * @param {object} ui
 * @param {number} factor
 */
function zoomStep(ui, factor) {
  ui._updatePivot()
  const distBefore = ui.camera.position.distanceTo(ui.controls.target)
  const eye = ui.camera.position.clone().sub(ui.controls.target).multiplyScalar(factor)
  ui.camera.position.copy(ui.controls.target).add(eye)
  ui._applyAsymptoticZoom(distBefore)
}


/** @returns {number} The camera's distance from Earth's centre, m */
const fromEarth = (camera, earth) =>
  camera.getWorldPosition(new Vector3).distanceTo(earth.getWorldPosition(new Vector3))


describe('ThreeUi: the pivot of a camera left behind (#361)', () => {
  it('zooms about the target: one step out stays near Earth', () => {
    const {ui, camera, earth} = leftBehind(true)
    const before = fromEarth(camera, earth)
    zoomStep(ui, 1.1)
    const after = fromEarth(camera, earth)
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThan(before * 1.5)
  })

  it('took the camera a tenth of an AU in one step about the frame\'s origin, as before', () => {
    const {ui, camera, earth} = leftBehind(false)
    zoomStep(ui, 1.1)
    expect(fromEarth(camera, earth)).toBeGreaterThan(0.05 * AU)
  })

  it('puts the pivot at the target in the platform\'s frame, and back at its origin after', () => {
    const {ui, earth} = leftBehind(true)
    ui._updatePivot()
    expect(ui._pivot.distanceTo(earth.position)).toBeLessThan(1e-3)
    ui.sceneManager.pivotBody = () => null
    ui._updatePivot()
    expect(ui._pivot.length()).toBe(0)
  })

  it('takes the target\'s ground as the floor: a zoom in stops over Earth, not the Sun', () => {
    const {ui, camera, earth} = leftBehind(true)
    for (let i = 0; i < 200; i++) {
      zoomStep(ui, 0.5)
    }
    const alt = fromEarth(camera, earth) - R
    expect(alt).toBeGreaterThan(0)
    expect(alt).toBeLessThan(10)
  })
})
