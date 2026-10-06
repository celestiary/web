import {describe, expect, it} from 'bun:test'
import {PerspectiveCamera, Scene} from 'three'
import {getSunProps} from '../scene/StarsCatalog.js'
import {addStarToScene, frameDistance, frameStar} from './starScene.js'


/** A catalogue holding the Sun and a smaller K star. */
function catalog() {
  return {
    starByHip: new Map([
      [0, getSunProps()],
      [8102, {...getSunProps(), hipId: 8102, spectralType: 5, radius: 5.8e8}],
    ]),
  }
}


/** @returns {object} The parts of a ThreeUI the star page and its metering use. */
function fakeUi() {
  const camera = new PerspectiveCamera(45, 1, 1, 1e30)
  camera.position.z = 35 * 695700000
  camera.updateMatrixWorld()
  return {scene: new Scene, camera, height: 400}
}


describe('guide star page', () => {
  it('registers the star with the scene manager, typed as a star', () => {
    const ui = fakeUi()
    const star = addStarToScene(ui, catalog(), 0, 'Sol')
    expect(ui.scene.children).toContain(star)
    expect(ui.sceneManager.objects.Sol).toBe(star)
    expect(star.props.type).toBe('star')
    expect(star.props.radius.scalar).toBe(695700000)
  })


  it('has what ThreeUI._luminousDiscs reads to meter its disc', () => {
    // It reads sceneManager.objects (a mocked ThreeUI in other test files
    // keeps this from calling it): each object's props.type, props.radius
    // and visible, and skips the `.orbitPosition` aliases.
    const ui = fakeUi()
    addStarToScene(ui, catalog(), 0, 'Sol')
    const discs = Object.entries(ui.sceneManager.objects)
        .filter(([name, o]) => o.props.type === 'star' && o.props.radius && o.visible && !name.endsWith('.orbitPosition'))
    expect(discs.length).toBe(1)
    expect(discs[0][1].props.radius.scalar).toBe(695700000)
  })


  it('frames the disc at 90% of the canvas\'s smaller dimension', () => {
    const r = 6.957e8
    // The projected radius, in canvas heights: tan(asin(r / d)) / (2 tan(fov / 2)).
    const projected = (d, fov) => Math.tan(Math.asin(r / d)) / (2 * Math.tan(fov * Math.PI / 360))
    // Wide canvas: the height is the smaller dimension.
    expect(projected(frameDistance(r, 45, 16 / 9), 45) * 2).toBeCloseTo(0.9, 6)
    // Tall canvas: the width is, and it is 0.5 of a height at aspect 0.5.
    expect(projected(frameDistance(r, 45, 0.5), 45) * 2).toBeCloseTo(0.9 * 0.5, 6)
    // A narrower field puts the camera farther out.
    expect(frameDistance(r, 20, 1)).toBeGreaterThan(frameDistance(r, 45, 1))
  })


  it('reframes on resize until the camera is zoomed', () => {
    const ui = fakeUi()
    const star = addStarToScene(ui, catalog(), 0, 'Sol')
    const reframe = frameStar(ui, star)
    const z0 = ui.camera.position.z
    expect(z0).toBeCloseTo(frameDistance(695700000, 45, 1), 3)
    ui.camera.aspect = 0.5
    reframe()
    expect(ui.camera.position.z).toBeCloseTo(frameDistance(695700000, 45, 0.5), 3)
    // Zoomed by the user: a resize leaves it.
    ui.camera.position.z = 1e10
    ui.camera.aspect = 2
    reframe()
    expect(ui.camera.position.z).toBe(1e10)
  })


  it('replaces the star on show and wraps the radius once', () => {
    const ui = fakeUi()
    const cat = catalog()
    const first = addStarToScene(ui, cat, 0, 'Sol')
    const second = addStarToScene(ui, cat, 0, 'Sol', first)
    expect(ui.scene.children).not.toContain(first)
    expect(ui.scene.children).toContain(second)
    expect(second.props.radius.scalar).toBe(695700000)
    expect(Object.keys(ui.sceneManager.objects)).toContain('Sol')
  })
})
