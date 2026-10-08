import {describe, expect, it} from 'bun:test'
import {BufferGeometry, Float32BufferAttribute, Object3D, Points, ShaderMaterial, Texture, Vector3} from 'three'

// A sheet with no canvas: Celestiary.test.js mocks SpriteSheet for the whole
// process, so the real one can't be relied on here.  It has what TargetLabel
// reads of one: a compiled Points with the RTE position split, a map to
// dispose and a canvas to remove.
let canvasesRemoved = 0
class FakeSheet {
  constructor() {
    this.pos = null
    this.canvas = {remove: () => canvasesRemoved++}
  }

  add(x, y, z) {
    this.pos = [x, y, z]
  }

  compile() {
    const high = this.pos.map(Math.fround)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(high, 3))
    geometry.setAttribute('positionLow', new Float32BufferAttribute(this.pos.map((v, i) => v - high[i]), 3))
    const material = new ShaderMaterial({uniforms: {
      map: {value: new Texture()},
      uCamPosWorldHigh: {value: new Vector3()},
      uCamPosWorldLow: {value: new Vector3()},
    }})
    const points = new Points(geometry, material)
    points.userData.sheet = this
    return points
  }
}


const {default: TargetLabelClass, targetLabelShown} = await import('./TargetLabel.js')

class TargetLabel extends TargetLabelClass {
  constructor(parent) {
    super(parent, FakeSheet)
  }
}


const STAR = {hipId: 46635, x: 1.2e18, y: -3.4e17, z: 5.6e17}
const OTHER = {hipId: 32349, x: 8e16, y: 1e16, z: -7e16}


describe('targetLabelShown', () => {
  const base = {wanted: true, starLabels: false, bodyLabels: false, inCatalogue: false}

  it('is off with no star targeted', () => {
    expect(targetLabelShown({...base, wanted: false, starLabels: true, bodyLabels: true})).toBe(false)
  })

  it('shows a star the catalogue sheet lacks, with star labels on', () => {
    expect(targetLabelShown({...base, starLabels: true})).toBe(true)
  })

  it('leaves a star the catalogue sheet names to that sheet, with star labels on', () => {
    expect(targetLabelShown({...base, starLabels: true, bodyLabels: true, inCatalogue: true})).toBe(false)
  })

  it('shows a named star when star labels are off but the body labels are on', () => {
    expect(targetLabelShown({...base, bodyLabels: true, inCatalogue: true})).toBe(true)
  })

  it('shows a faint star with star labels off but the body labels on (the link s=loL)', () => {
    expect(targetLabelShown({...base, bodyLabels: true})).toBe(true)
  })

  it('is off with every label group off (presentation mode)', () => {
    expect(targetLabelShown(base)).toBe(false)
  })
})


describe('TargetLabel', () => {
  it('builds nothing on set: the DOM work waits for update', () => {
    const parent = new Object3D()
    const t = new TargetLabel(parent)
    t.set(STAR, 'HIP 46635')
    expect(parent.children.length).toBe(0)
    expect(t.hipId).toBe(46635)
  })

  it('builds the label at the star, in the stars\' frame, once shown', () => {
    const parent = new Object3D()
    const t = new TargetLabel(parent)
    t.set(STAR, 'HIP 46635')
    const label = t.update(true)
    expect(label.parent).toBe(parent)
    expect(label.visible).toBe(true)
    const pos = label.geometry.attributes.position
    const low = label.geometry.attributes.positionLow
    expect(pos.getX(0) + low.getX(0)).toBeCloseTo(STAR.x, -2)
    expect(pos.getZ(0) + low.getZ(0)).toBeCloseTo(STAR.z, -2)
    expect(label.userData.labelTargets[0].name).toBe('HIP 46635')
    expect(label.userData.labelTargets[0].star).toBe(STAR)
  })

  it('builds nothing while it is not to be shown', () => {
    const parent = new Object3D()
    const t = new TargetLabel(parent)
    t.set(STAR, 'HIP 46635')
    expect(t.update(false)).toBe(null)
    expect(parent.children.length).toBe(0)
  })

  it('hides and shows the same label with the toggles', () => {
    const parent = new Object3D()
    const t = new TargetLabel(parent)
    t.set(STAR, 'HIP 46635')
    const label = t.update(true)
    expect(t.update(false)).toBe(label)
    expect(label.visible).toBe(false)
    expect(t.update(true)).toBe(label)
    expect(label.visible).toBe(true)
    expect(parent.children.length).toBe(1)
  })

  it('replaces the label with the next target\'s, and drops it for a target that is no star', () => {
    const parent = new Object3D()
    const t = new TargetLabel(parent)
    t.set(STAR, 'HIP 46635')
    const first = t.update(true)
    t.set(OTHER, 'Sirius')
    const second = t.update(true)
    expect(second).not.toBe(first)
    expect(first.parent).toBe(null)
    expect(parent.children).toEqual([second])
    const removed = canvasesRemoved
    t.set(null)
    expect(t.update(true)).toBe(null)
    expect(parent.children.length).toBe(0)
    expect(canvasesRemoved).toBe(removed + 1)
    expect(t.hipId).toBe(null)
  })
})
