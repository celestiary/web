import {describe, expect, it} from 'bun:test'
import {Vector3} from 'three'
import {enuToBodyFixedQuat, enuTriadAtLatLng} from './enuFrame.js'


// Body-fixed convention (from coords.js):
//   +Y = north pole, +X = prime meridian, east winds toward −Z.
// ENU convention (from enuFrame.js):
//   +X = East, +Y = North, +Z = Up.


describe('enuTriadAtLatLng — geometric properties', () => {
  it('produces an orthonormal right-handed triad at non-polar lat/lng', () => {
    // Pick a deliberately off-axis observer; orthogonality + normality must
    // hold regardless.  San Francisco-ish.
    const {east, north, up} = enuTriadAtLatLng(37.77, -122.42)
    expect(east.length()).toBeCloseTo(1, 9)
    expect(north.length()).toBeCloseTo(1, 9)
    expect(up.length()).toBeCloseTo(1, 9)
    expect(east.dot(north)).toBeCloseTo(0, 9)
    expect(east.dot(up)).toBeCloseTo(0, 9)
    expect(north.dot(up)).toBeCloseTo(0, 9)
    // Right-handed: E × N = U.
    const cross = new Vector3().crossVectors(east, north)
    expect(cross.x).toBeCloseTo(up.x, 9)
    expect(cross.y).toBeCloseTo(up.y, 9)
    expect(cross.z).toBeCloseTo(up.z, 9)
  })


  it('at (0°, 0°) Up is +X (prime meridian outward)', () => {
    const {up} = enuTriadAtLatLng(0, 0)
    expect(up.x).toBeCloseTo(1, 9)
    expect(up.y).toBeCloseTo(0, 9)
    expect(up.z).toBeCloseTo(0, 9)
  })


  it('at (0°, 0°) North is +Y (toward the celestial pole)', () => {
    // On the equator, "north" is exactly the rotational axis direction.
    const {north} = enuTriadAtLatLng(0, 0)
    expect(north.x).toBeCloseTo(0, 9)
    expect(north.y).toBeCloseTo(1, 9)
    expect(north.z).toBeCloseTo(0, 9)
  })


  it('at (0°, 0°) East is −Z (east winds toward −Z)', () => {
    // Direction-of-east lock-in — matches the prime-meridian / east-positive
    // convention enshrined in coords.js.
    const {east} = enuTriadAtLatLng(0, 0)
    expect(east.x).toBeCloseTo(0, 9)
    expect(east.y).toBeCloseTo(0, 9)
    expect(east.z).toBeCloseTo(-1, 9)
  })


  it('at (0°, 90°E) Up is −Z (90° east of prime meridian)', () => {
    const {up} = enuTriadAtLatLng(0, 90)
    expect(up.x).toBeCloseTo(0, 9)
    expect(up.y).toBeCloseTo(0, 9)
    expect(up.z).toBeCloseTo(-1, 9)
  })


  it('at (0°, 90°E) East is −X (still east, now in the −X direction)', () => {
    // From (0, 90°E), continuing east takes you to (0, 180°), which is
    // body-fixed −X.
    const {east} = enuTriadAtLatLng(0, 90)
    expect(east.x).toBeCloseTo(-1, 9)
    expect(east.y).toBeCloseTo(0, 9)
    expect(east.z).toBeCloseTo(0, 9)
  })


  it('at (45°N, 0°) Up is the bisector of +X and +Y', () => {
    const {up} = enuTriadAtLatLng(45, 0)
    expect(up.x).toBeCloseTo(Math.SQRT1_2, 9)
    expect(up.y).toBeCloseTo(Math.SQRT1_2, 9)
    expect(up.z).toBeCloseTo(0, 9)
  })


  it('at (45°N, 0°) North tilts toward the pole', () => {
    // North on the (lat, lng) = (45, 0) tangent plane is the unit vector
    // perpendicular to Up that points more toward +Y than -Y.  Closed form:
    // (-sin lat · cos lng, cos lat, sin lat · sin lng) = (-√2/2, √2/2, 0).
    const {north} = enuTriadAtLatLng(45, 0)
    expect(north.x).toBeCloseTo(-Math.SQRT1_2, 9)
    expect(north.y).toBeCloseTo(Math.SQRT1_2, 9)
    expect(north.z).toBeCloseTo(0, 9)
  })


  it('handles the north pole gracefully (no NaN)', () => {
    const {east, north, up} = enuTriadAtLatLng(90, 0)
    expect(up.y).toBeCloseTo(1, 9)
    expect(Number.isFinite(north.x) && Number.isFinite(north.y) && Number.isFinite(north.z)).toBe(true)
    expect(Number.isFinite(east.x) && Number.isFinite(east.y) && Number.isFinite(east.z)).toBe(true)
    expect(north.length()).toBeCloseTo(1, 9)
    expect(east.length()).toBeCloseTo(1, 9)
    // Triad is still orthonormal at the pole.
    expect(east.dot(north)).toBeCloseTo(0, 9)
    expect(east.dot(up)).toBeCloseTo(0, 9)
    expect(north.dot(up)).toBeCloseTo(0, 9)
  })


  it('handles the south pole gracefully (no NaN, right-handed)', () => {
    const {east, north, up} = enuTriadAtLatLng(-90, 0)
    expect(up.y).toBeCloseTo(-1, 9)
    const cross = new Vector3().crossVectors(east, north)
    expect(cross.x).toBeCloseTo(up.x, 9)
    expect(cross.y).toBeCloseTo(up.y, 9)
    expect(cross.z).toBeCloseTo(up.z, 9)
  })
})


describe('enuToBodyFixedQuat', () => {
  it('maps ENU "Up" to the body-fixed outward radial', () => {
    // Spot check at a non-degenerate location.
    const lat = 30
    const lng = -60
    const q = enuToBodyFixedQuat(lat, lng)
    const upBody = new Vector3(0, 0, 1).applyQuaternion(q)
    const {up} = enuTriadAtLatLng(lat, lng)
    expect(upBody.x).toBeCloseTo(up.x, 9)
    expect(upBody.y).toBeCloseTo(up.y, 9)
    expect(upBody.z).toBeCloseTo(up.z, 9)
  })


  it('maps ENU "North" to the body-fixed north tangent', () => {
    const lat = 30
    const lng = -60
    const q = enuToBodyFixedQuat(lat, lng)
    const nBody = new Vector3(0, 1, 0).applyQuaternion(q)
    const {north} = enuTriadAtLatLng(lat, lng)
    expect(nBody.x).toBeCloseTo(north.x, 9)
    expect(nBody.y).toBeCloseTo(north.y, 9)
    expect(nBody.z).toBeCloseTo(north.z, 9)
  })


  it('maps ENU "East" to the body-fixed east tangent', () => {
    const lat = 30
    const lng = -60
    const q = enuToBodyFixedQuat(lat, lng)
    const eBody = new Vector3(1, 0, 0).applyQuaternion(q)
    const {east} = enuTriadAtLatLng(lat, lng)
    expect(eBody.x).toBeCloseTo(east.x, 9)
    expect(eBody.y).toBeCloseTo(east.y, 9)
    expect(eBody.z).toBeCloseTo(east.z, 9)
  })


  it('at (lat=0, lng=0): ENU and body-fixed differ by a known reorientation', () => {
    // ENU at the prime meridian on the equator:
    //   East = bodyFixed −Z
    //   North = bodyFixed +Y
    //   Up = bodyFixed +X
    // Therefore q maps  (1,0,0)_ENU → (0,0,-1)_body
    //                   (0,1,0)_ENU → (0,1,0)_body
    //                   (0,0,1)_ENU → (1,0,0)_body
    const q = enuToBodyFixedQuat(0, 0)
    const e = new Vector3(1, 0, 0).applyQuaternion(q)
    const n = new Vector3(0, 1, 0).applyQuaternion(q)
    const u = new Vector3(0, 0, 1).applyQuaternion(q)
    expect(e.x).toBeCloseTo(0, 9); expect(e.y).toBeCloseTo(0, 9); expect(e.z).toBeCloseTo(-1, 9)
    expect(n.x).toBeCloseTo(0, 9); expect(n.y).toBeCloseTo(1, 9); expect(n.z).toBeCloseTo(0, 9)
    expect(u.x).toBeCloseTo(1, 9); expect(u.y).toBeCloseTo(0, 9); expect(u.z).toBeCloseTo(0, 9)
  })


  it('preserves vector lengths (rotation, not scale)', () => {
    const q = enuToBodyFixedQuat(48.86, 2.35) // Paris-ish
    const v = new Vector3(3, -7, 2)
    const lenBefore = v.length()
    const out = v.clone().applyQuaternion(q)
    expect(out.length()).toBeCloseTo(lenBefore, 9)
  })
})
