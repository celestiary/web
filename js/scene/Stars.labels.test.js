import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera} from 'three'
import Stars from './Stars.js'
import {STAR_RANK_SPAN} from './labelDeclutter.js'


const LY = 9.4607e15
// Down -z from the Sun, where the camera looks: a Sirius (8.6 ly, M 1.42:
// V -1.46), a Vega-like star (25 ly, M 0.58: V 0.0), a faint one (100 ly,
// M 10: V 13) and, behind the camera, an Arcturus-like one (37 ly, M -0.3:
// V -0.05).
const STARS = [
  {hipId: 32349, x: 0, y: 0, z: -8.6 * LY, absMag: 1.42},
  {hipId: 91262, x: 0.5 * LY, y: 0, z: -25 * LY, absMag: 0.58},
  {hipId: 1, x: 0, y: 1 * LY, z: -100 * LY, absMag: 10},
  {hipId: 69673, x: 0, y: 0, z: 37 * LY, absMag: -0.3},
]


/** A label sheet as Stars uses it, without a canvas. */
class StubSheet {
  /** @param {number} n */
  constructor(n) {
    this.wanted = new Uint8Array(n)
    this.styles = []
    this.sprites = new Object3D
    this.sprites.userData.labelRank = new Array(n).fill(0)
    this.fades = 0
  }

  /**
   * @param {number} i
   * @param {number} scale
   * @param {number} brightness
   */
  setStyle(i, scale, brightness) {
    this.styles[i] = [scale, brightness]
  }

  /** */
  stepFade() {
    this.fades++
  }
}


/**
 * @param {?Function} labelState
 * @returns {object} what Stars._syncLabels reads, the camera at the Sun looking down -z
 */
function starsLike(labelState) {
  const camera = new PerspectiveCamera(60, 1, 1, 1e12)
  camera.updateMatrixWorld()
  return {
    starLabelSpriteSheet: new StubSheet(STARS.length),
    ui: {camera},
    labelLOD: {visible: true},
    labelState,
    _labelStars: STARS,
    _labelRange: null,
    _fadeAt: NaN,
  }
}


describe('star names', () => {
  it('wants a star\'s name while the star is bright enough to see, and the target\'s always', () => {
    const s = starsLike(() => ({limit: 6.5, target: null}))
    Stars.prototype._syncLabels.call(s)
    expect(Array.from(s.starLabelSpriteSheet.wanted)).toEqual([1, 1, 0, 1])
    // A brighter sky (a daytime exposure): only the brightest.
    s.labelState = () => ({limit: -1, target: null})
    Stars.prototype._syncLabels.call(s)
    expect(Array.from(s.starLabelSpriteSheet.wanted)).toEqual([1, 0, 0, 0])
    // The target, however faint.
    s.labelState = () => ({limit: -1, target: {hipId: 1}})
    Stars.prototype._syncLabels.call(s)
    expect(Array.from(s.starLabelSpriteSheet.wanted)).toEqual([1, 0, 1, 0])
    expect(s.starLabelSpriteSheet.styles[2]).toEqual([1, 1])
    expect(s.starLabelSpriteSheet.fades).toBe(3)
  })

  it('sizes and dims from the brightest wanted in view to the faintest, the brighter ranked higher', () => {
    const s = starsLike(() => ({limit: 6.5, target: null}))
    Stars.prototype._syncLabels.call(s)
    // In view (down -z): Sirius, the brightest, and the Vega-like star, a
    // magnitude and a half fainter; the one behind doesn't set the range.
    expect(s._labelRange.near).toBeCloseTo(-1.46, 1)
    expect(s._labelRange.far).toBeCloseTo(0.0, 1)
    const [sirius, vega] = s.starLabelSpriteSheet.styles
    expect(sirius).toEqual([1, 1])
    expect(vega[0]).toBeCloseTo(9 / 13, 6)
    expect(vega[1]).toBeCloseTo(0.7, 6)
    const rank = s.starLabelSpriteSheet.sprites.userData.labelRank
    expect(rank[0]).toBeCloseTo(STAR_RANK_SPAN, 6)
    expect(rank[1]).toBeCloseTo(0, 6)
  })

  it('wants every name where no one says how faint it can see (the guide\'s scene)', () => {
    const s = starsLike(null)
    Stars.prototype._syncLabels.call(s)
    expect(Array.from(s.starLabelSpriteSheet.wanted)).toEqual([1, 1, 1, 1])
  })

  it('does nothing while the names are off', () => {
    const s = starsLike(() => ({limit: 6.5, target: null}))
    s.labelLOD.visible = false
    Stars.prototype._syncLabels.call(s)
    expect(Array.from(s.starLabelSpriteSheet.wanted)).toEqual([0, 0, 0, 0])
  })
})
