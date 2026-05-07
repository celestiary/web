import {describe, expect, it} from 'bun:test'
import {Euler, Quaternion, Vector3} from 'three'
import DeviceOrientationPoseSource, {
  DEFAULT_ALPHA_DAMPING,
  composeDeviceToEnu,
  getAlphaDampingNames,
} from './DeviceOrientationPoseSource.js'


/**
 * Sanity check for the pure-math composer exported from
 * DeviceOrientationPoseSource.  These tests verify the geometric meaning
 * of (alpha, beta, gamma) by transforming each device-axis basis vector
 * through the resulting quaternion and checking which ENU direction it
 * lands on.
 *
 * Frame conventions:
 *   - Device:  +X right, +Y top of phone, +Z out of screen toward user
 *   - ENU:     +X East,   +Y North,        +Z Up
 *
 * The conventions and rotation order (Z-X-Y intrinsic) come from the W3C
 * Device Orientation spec.
 */


function quatFor(alpha, beta, gamma) {
  const e = new Euler()
  const q = new Quaternion()
  composeDeviceToEnu(e, q, alpha, beta, gamma)
  return q
}


describe('composeDeviceToEnu — anchor poses', () => {
  it('zero angles produce identity quaternion', () => {
    // Phone laid face-up on a table, top of phone pointing north — by spec,
    // device axes are aligned with ENU axes, so the quaternion is identity.
    const q = quatFor(0, 0, 0)
    expect(q.x).toBeCloseTo(0, 9)
    expect(q.y).toBeCloseTo(0, 9)
    expect(q.z).toBeCloseTo(0, 9)
    expect(q.w).toBeCloseTo(1, 9)
  })


  it('alpha=90° rotates the device-Y axis from North to West', () => {
    // Phone face-up, rotated 90° CCW (looking down at it).  Top of phone
    // (device +Y) now points west.  alpha is right-handed around +Z.
    const q = quatFor(90, 0, 0)
    const top = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(top.x).toBeCloseTo(-1, 9) // West = -X (East)
    expect(top.y).toBeCloseTo(0, 9)
    expect(top.z).toBeCloseTo(0, 9)
  })


  it('alpha=90°: device-X (right edge) lands on North', () => {
    const q = quatFor(90, 0, 0)
    const right = new Vector3(1, 0, 0).applyQuaternion(q)
    expect(right.x).toBeCloseTo(0, 9)
    expect(right.y).toBeCloseTo(1, 9) // North
    expect(right.z).toBeCloseTo(0, 9)
  })


  it('beta=90° rotates phone around device-X by +90°: top edge points Up', () => {
    // Pure Rx(+90°): right-hand rule about +X earth (East) rotates
    // device-Y from North up to Up.  Equivalently device-Z (out of screen)
    // rotates from Up to South — matching the spec's "screen tilts toward
    // the user" intuition (user south of phone).
    const q = quatFor(0, 90, 0)
    const top = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(top.x).toBeCloseTo(0, 9)
    expect(top.y).toBeCloseTo(0, 9)
    expect(top.z).toBeCloseTo(1, 9) // Up
  })


  it('beta=90°: device-Z (out of screen) ends up pointing South (−Y)', () => {
    const q = quatFor(0, 90, 0)
    const out = new Vector3(0, 0, 1).applyQuaternion(q)
    expect(out.x).toBeCloseTo(0, 9)
    expect(out.y).toBeCloseTo(-1, 9) // South
    expect(out.z).toBeCloseTo(0, 9)
  })


  it('gamma=90° rotates phone around device-Y by +90°: device-X points Down', () => {
    // Pure Ry(+90°) by right-hand rule rotates +X (East) toward −Z.  In
    // ENU coords −Z is Down.  This is the math definition of the formula
    // we use; physical-pose interpretations of the W3C sign convention
    // for gamma vary across implementations and don't matter here so long
    // as the formula and the browser agree on the encoding.
    const q = quatFor(0, 0, 90)
    const right = new Vector3(1, 0, 0).applyQuaternion(q)
    expect(right.x).toBeCloseTo(0, 9)
    expect(right.y).toBeCloseTo(0, 9)
    expect(right.z).toBeCloseTo(-1, 9) // Down
  })


  it('gamma=90°: device-Z (out of screen) flips to East (+X)', () => {
    const q = quatFor(0, 0, 90)
    const out = new Vector3(0, 0, 1).applyQuaternion(q)
    expect(out.x).toBeCloseTo(1, 9) // East
    expect(out.y).toBeCloseTo(0, 9)
    expect(out.z).toBeCloseTo(0, 9)
  })


  it('preserves orthonormality (rotation, not scale)', () => {
    const q = quatFor(45, 30, -20)
    // Transform the three device axes; their lengths must remain 1, and
    // their pairwise dot products 0.
    const x = new Vector3(1, 0, 0).applyQuaternion(q)
    const y = new Vector3(0, 1, 0).applyQuaternion(q)
    const z = new Vector3(0, 0, 1).applyQuaternion(q)
    expect(x.length()).toBeCloseTo(1, 9)
    expect(y.length()).toBeCloseTo(1, 9)
    expect(z.length()).toBeCloseTo(1, 9)
    expect(x.dot(y)).toBeCloseTo(0, 9)
    expect(x.dot(z)).toBeCloseTo(0, 9)
    expect(y.dot(z)).toBeCloseTo(0, 9)
  })


  it('phone held vertically pointing east-on-the-horizon: device-Z = East', () => {
    // Real-world AR pose: user holds phone upright, screen toward them,
    // back of phone pointing east toward the rising sun.  alpha=270°
    // (phone "facing" west, since alpha is the heading offset of the top
    // edge from north going east), beta=90° (vertical), gamma=0.
    //
    // Result: device −Z (out the back) points East.  Equivalently, +Z
    // points West.
    const q = quatFor(270, 90, 0)
    const back = new Vector3(0, 0, -1).applyQuaternion(q)
    expect(back.x).toBeCloseTo(1, 6)
    expect(back.y).toBeCloseTo(0, 6)
    expect(back.z).toBeCloseTo(0, 6)
  })
})


describe('DeviceOrientationPoseSource — alpha damping presets', () => {
  it('exposes valid preset names and a default that is one of them', () => {
    const names = getAlphaDampingNames()
    expect(names.length).toBeGreaterThanOrEqual(3)
    expect(names).toContain(DEFAULT_ALPHA_DAMPING)
  })

  it('defaults to DEFAULT_ALPHA_DAMPING after construction', () => {
    const ps = new DeviceOrientationPoseSource()
    expect(ps.getAlphaDamping()).toBe(DEFAULT_ALPHA_DAMPING)
  })

  it('setAlphaDamping switches preset and rebuilds the alpha pipeline', () => {
    const ps = new DeviceOrientationPoseSource()
    const beforeFilter = ps._alphaFilter
    const next = getAlphaDampingNames().find((n) => n !== ps.getAlphaDamping())
    ps.setAlphaDamping(next)
    expect(ps.getAlphaDamping()).toBe(next)
    expect(ps._alphaFilter).not.toBe(beforeFilter)
  })

  it('setAlphaDamping with the same name is a no-op (preserves filter state)', () => {
    const ps = new DeviceOrientationPoseSource()
    const beforeFilter = ps._alphaFilter
    ps.setAlphaDamping(ps.getAlphaDamping())
    expect(ps._alphaFilter).toBe(beforeFilter)
  })

  it('setAlphaDamping with an unknown name leaves the preset unchanged', () => {
    const ps = new DeviceOrientationPoseSource()
    const before = ps.getAlphaDamping()
    const beforeFilter = ps._alphaFilter
    ps.setAlphaDamping('not-a-real-preset')
    expect(ps.getAlphaDamping()).toBe(before)
    expect(ps._alphaFilter).toBe(beforeFilter)
  })
})
