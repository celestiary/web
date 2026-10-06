import {describe, expect, it} from 'bun:test'
import {Matrix3} from 'three'
import {rotationAngle, viewChanged} from './viewCache.js'


const turned = (rad) => new Matrix3().set(
    Math.cos(rad), 0, Math.sin(rad),
    0, 1, 0,
    -Math.sin(rad), 0, Math.cos(rad))


describe('viewCache', () => {
  it('measures the angle between two rotations', () => {
    expect(rotationAngle(turned(0), turned(0))).toBeCloseTo(0, 6)
    expect(rotationAngle(turned(0.3), turned(0))).toBeCloseTo(0.3, 9)
    expect(rotationAngle(turned(0.1), turned(-0.2))).toBeCloseTo(0.3, 9)
  })

  it('renders again when the view turns half a texel, moves or is reprojected, not for less (#187)', () => {
    const texel = 1e-3
    const last = {position: [1, 2, 3], view: turned(0), proj: [1, 2, 0, 0]}
    expect(viewChanged(null, [1, 2, 3], turned(0), [1, 2, 0, 0], 1e-3, texel)).toBe(true)
    expect(viewChanged(last, [1, 2, 3], turned(0), [1, 2, 0, 0], 1e-3, texel)).toBe(false)
    // The sky turning with time: a frame's 1.5e-4 rad is under half a texel.
    expect(viewChanged(last, [1, 2, 3], turned(1.5e-4), [1, 2, 0, 0], 1e-3, texel)).toBe(false)
    expect(viewChanged(last, [1, 2, 3], turned(6e-4), [1, 2, 0, 0], 1e-3, texel)).toBe(true)
    expect(viewChanged(last, [1, 2, 3.0005], turned(0), [1, 2, 0, 0], 1e-3, texel)).toBe(false)
    expect(viewChanged(last, [1, 2, 3.002], turned(0), [1, 2, 0, 0], 1e-3, texel)).toBe(true)
    expect(viewChanged(last, [1, 2, 3], turned(0), [1, 2.1, 0, 0], 1e-3, texel)).toBe(true)
  })
})
