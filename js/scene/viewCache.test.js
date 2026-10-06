import {describe, expect, it} from 'bun:test'
import {Matrix3} from 'three'
import {raysAllHitSphere, rotationAngle, viewChanged} from './viewCache.js'


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


describe('raysAllHitSphere', () => {
  const R = 6.371e6
  const centre = [0, 0, 0]
  const eye = [0, R + 2, 0]
  const tilt = (deg) => [Math.sin(deg * Math.PI / 180), -Math.cos(deg * Math.PI / 180), 0]
  it('holds looking down from the surface, and fails once a ray reaches the horizon (#187)', () => {
    expect(raysAllHitSphere(eye, [tilt(-20), tilt(20), tilt(0)], centre, R)).toBe(true)
    // From 2 m the horizon is 0.045° under level: 89.9° from the nadir still
    // hits, 90.1° misses.
    expect(raysAllHitSphere(eye, [tilt(89.9)], centre, R)).toBe(true)
    expect(raysAllHitSphere(eye, [tilt(-20), tilt(90.1)], centre, R)).toBe(false)
    // Away from the sphere, and from inside it.
    expect(raysAllHitSphere(eye, [[0, 1, 0]], centre, R)).toBe(false)
    expect(raysAllHitSphere([0, R - 1, 0], [tilt(0)], centre, R)).toBe(false)
  })
})
