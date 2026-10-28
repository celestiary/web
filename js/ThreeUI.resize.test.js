import {describe, expect, it} from 'bun:test'
import {PerspectiveCamera} from 'three'


// Celestiary.test.js replaces './ThreeUI' with a stub for the whole run, in
// one process: the real one by a name the mock doesn't take (AGENTS.md).
const REAL_THREE_UI = './ThreeUI.js?real'
const {default: ThreeUi} = await import(REAL_THREE_UI)


describe('ThreeUi.onResize', () => {
  it('keeps width and height the container\'s, which the Cesium layers\' view is sized by', () => {
    const sizes = []
    const ui = {
      container: {offsetWidth: 480, offsetHeight: 241},
      camera: new PerspectiveCamera(45, 1, 1, 10),
      renderer: {setSize: (w, h) => sizes.push(['renderer', w, h]), getPixelRatio: () => 1},
      _sceneRT: {setSize: (w, h) => sizes.push(['scene', w, h])},
      controls: {handleResize: () => {}},
      width: 480,
      height: 300,
    }
    ThreeUi.prototype.onResize.call(ui)
    expect([ui.width, ui.height]).toEqual([480, 241])
    expect(ui.camera.aspect).toBeCloseTo(480 / 241, 12)
    ui.container.offsetHeight = 141
    ThreeUi.prototype.onResize.call(ui)
    expect([ui.width, ui.height]).toEqual([480, 141])
    expect(sizes.at(-1)).toEqual(['scene', 480, 141])
  })
})
