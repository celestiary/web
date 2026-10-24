import {describe, expect, it} from 'bun:test'
import {Group, Object3D, PerspectiveCamera} from 'three'
import {
  BODY_LABELS, PLACE_LABELS, SATELLITE_LABELS, STAR_LABELS, labelFont, labelLook, prominence, resetRange, styleLabels,
  viewRange,
} from './labelStyle.js'


describe('label styles', () => {
  it('maps a measure to prominence, by its logarithm between near and far', () => {
    const style = {near: 1e6, far: 1e8, size: [10, 20], brightness: [0.5, 1]}
    expect(prominence(1e6, style)).toBe(1)
    expect(prominence(1e5, style)).toBe(1)
    expect(prominence(1e8, style)).toBe(0)
    expect(prominence(1e9, style)).toBe(0)
    // Halfway in decades.
    expect(prominence(1e7, style)).toBeCloseTo(0.5, 10)
    expect(prominence(5.05e7, {...style, interpolation: 'linear'})).toBeCloseTo(0.5, 10)
    expect(prominence(0, style)).toBe(1)
    // A linear measure under 0 (a magnitude): mapped as it is.
    const mags = {near: -1.5, far: 6.5, size: [9, 13], brightness: [0.7, 1], interpolation: 'linear'}
    expect(prominence(-1.46, mags)).toBeCloseTo(0.995, 3)
    expect(prominence(2.5, mags)).toBeCloseTo(0.5, 10)
  })

  it('runs size and brightness from the group\'s least to its most, the dimmest 0.7 of the brightest', () => {
    expect(labelLook(0, SATELLITE_LABELS)).toEqual({size: 11, scale: 11 / 14, brightness: 0.7})
    expect(labelLook(1, SATELLITE_LABELS)).toEqual({size: 14, scale: 1, brightness: 1})
    expect(labelLook(0.5, SATELLITE_LABELS).size).toBe(12.5)
    expect(labelFont(SATELLITE_LABELS)).toBe('14px arial')
  })

  it('takes a view range from the nearest and farthest in view, the style\'s own while none is', () => {
    expect(viewRange([3e6, 9e6, 5e6], SATELLITE_LABELS)).toEqual({near: 3e6, far: 9e6})
    expect(viewRange([], SATELLITE_LABELS)).toEqual({near: 1e6, far: 5e7})
    // A lone name, or a tight cluster: at least a tenth between the ends.
    expect(viewRange([4e6], SATELLITE_LABELS)).toEqual({near: 4e6, far: 4.4e6})
    expect(viewRange([3e6, 9e6], {...SATELLITE_LABELS, range: 'fixed'})).toEqual({near: 1e6, far: 5e7})
    // Magnitudes: linear, at least a magnitude between the ends.
    expect(viewRange([-1.46, 0.03, 1.2], STAR_LABELS)).toEqual({near: -1.46, far: 1.2})
    expect(viewRange([0.5], STAR_LABELS)).toEqual({near: 0.5, far: 1.5})
  })
})


describe('styleLabels', () => {
  /**
   * @param {Array<number>} at [x, y, z], world
   * @param {number} radius
   * @returns {Object3D} a body's name as Planet.js gives it, with a stub sheet
   */
  function bodyName(at, radius) {
    const obj = new Object3D()
    obj.position.fromArray(at)
    obj.updateMatrixWorld()
    obj.userData.sheet = {
      labelCount: 1, positions: [0, 0, 0], styles: [],
      setStyle(i, scale, brightness) {
        this.styles[i] = [scale, brightness]
      },
    }
    obj.userData.labelRank = [0]
    obj.userData.labelStyle = BODY_LABELS
    obj.userData.labelMeasure = (i, cam, p) => cam.distanceTo(p) / radius
    obj.userData.labelRankOf = (p) => 1000 + (11 * p)
    return obj
  }

  /** @returns {PerspectiveCamera} at the origin, looking down -z */
  function camera() {
    const cam = new PerspectiveCamera(60, 1, 1, 1e13)
    cam.updateMatrixWorld()
    return cam
  }

  it('sizes a group\'s names from the largest-looking in view to the smallest, and ranks them so', () => {
    resetRange(BODY_LABELS)
    const root = new Group()
    // A big body near, a small one far, both ahead; one behind the camera.
    const near = bodyName([0, 0, -7e7], 7e6)
    const far = bodyName([1e8, 0, -1e9], 1e6)
    const behind = bodyName([0, 0, 1e7], 1e6)
    root.add(near, far, behind)
    styleLabels(root, camera())
    expect(near.userData.sheet.styles[0]).toEqual([1, 1])
    expect(far.userData.sheet.styles[0][0]).toBeCloseTo(10 / 18, 6)
    expect(far.userData.sheet.styles[0][1]).toBeCloseTo(0.7, 6)
    expect(near.userData.labelRank[0]).toBeCloseTo(1011, 6)
    expect(far.userData.labelRank[0]).toBeCloseTo(1000, 6)
    // The one behind doesn't set the range: it looks larger than either
    // (10 radii off), so it comes out at the largest, clamped.
    expect(behind.userData.sheet.styles[0]).toEqual([1, 1])
  })

  it('leaves out a surface label on its body\'s far side, and eases the range when the view changes', () => {
    resetRange(PLACE_LABELS)
    const root = new Group()
    const body = new Object3D()
    body.position.set(0, 0, -2e7)
    root.add(body)
    const places = new Object3D()
    body.add(places)
    root.updateMatrixWorld()
    const R = 6.4e6
    // Two places on the near side, one on the far side (nearer the camera's
    // line, farther away).
    places.userData.sheet = {
      labelCount: 3, positions: [0, 0, R, 0, R * 0.6, R * 0.8, 0, 0, -R], styles: [],
      setStyle(i, scale, brightness) {
        this.styles[i] = [scale, brightness]
      },
    }
    places.userData.labelBody = body
    places.userData.labelStyle = PLACE_LABELS
    places.userData.labelMeasure = (i, cam, p) => cam.distanceTo(p)
    styleLabels(root, camera())
    const s = places.userData.sheet.styles
    expect(s[0]).toEqual([1, 1])
    expect(s[1][0]).toBeCloseTo(10 / 14, 6)
    // The far side's is farther than the farthest in view: at the least.
    expect(s[2][0]).toBeCloseTo(10 / 14, 6)
    // The body moved off: the range eases toward the new one.
    body.position.z = -4e7
    root.updateMatrixWorld()
    styleLabels(root, camera())
    expect(places.userData.sheet.styles[0][0]).toBeLessThan(1)
  })
})
