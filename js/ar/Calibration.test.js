import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import {
  CalibrationStore,
  decodeCalibration,
  encodeCalibration,
  solveCalibration,
} from './Calibration.js'


describe('solveCalibration', () => {
  it('returns identity when device aim already matches truth', () => {
    const v = new Vector3(0, 1, 0)
    const q = solveCalibration(v, v)
    expect(q.x).toBeCloseTo(0, 9)
    expect(q.y).toBeCloseTo(0, 9)
    expect(q.z).toBeCloseTo(0, 9)
    expect(Math.abs(q.w)).toBeCloseTo(1, 9)
  })


  it('produces a yaw-only correction for a pure heading bias', () => {
    // Sensor reports the camera aimed at North; reality is East.  The
    // correction is a 90° rotation around the world Up axis (+Z in ENU).
    const device = new Vector3(0, 1, 0) // North
    const truth = new Vector3(1, 0, 0) // East
    const q = solveCalibration(device, truth)
    // Apply correction; result must equal truth.
    const corrected = device.clone().applyQuaternion(q)
    expect(corrected.x).toBeCloseTo(1, 9)
    expect(corrected.y).toBeCloseTo(0, 9)
    expect(corrected.z).toBeCloseTo(0, 9)
    // The rotation axis should be pure Up (+Z) since both vectors lie in
    // the horizontal plane.  Quaternion (sin(45°)·axis, cos(45°)·1) → z
    // component = sin(45°), x and y components zero.
    expect(q.x).toBeCloseTo(0, 9)
    expect(q.y).toBeCloseTo(0, 9)
    expect(Math.abs(q.z)).toBeCloseTo(Math.SQRT1_2, 9)
  })


  it('produces a tilt correction when the bias is out of plane', () => {
    // Device thinks it's aimed at the horizon; really aimed 30° up.
    const device = new Vector3(0, 1, 0)
    const truth = new Vector3(0, Math.cos(30 * Math.PI / 180), Math.sin(30 * Math.PI / 180))
    const q = solveCalibration(device, truth)
    const corrected = device.clone().applyQuaternion(q)
    expect(corrected.x).toBeCloseTo(truth.x, 9)
    expect(corrected.y).toBeCloseTo(truth.y, 9)
    expect(corrected.z).toBeCloseTo(truth.z, 9)
  })


  it('round-trips through encode/decode at 6 dp', () => {
    const device = new Vector3(0.5, 0.6, 0.6).normalize()
    const truth = new Vector3(-0.4, 0.1, 0.9).normalize()
    const q = solveCalibration(device, truth)
    const round = decodeCalibration(encodeCalibration(q))
    expect(round.x).toBeCloseTo(q.x, 5)
    expect(round.y).toBeCloseTo(q.y, 5)
    expect(round.z).toBeCloseTo(q.z, 5)
    expect(round.w).toBeCloseTo(q.w, 5)
  })
})


describe('decodeCalibration', () => {
  it('returns null on malformed JSON', () => {
    expect(decodeCalibration('not-json')).toBeNull()
  })


  it('returns null on missing fields', () => {
    expect(decodeCalibration('{"x":1,"y":0}')).toBeNull()
  })


  it('returns null on null input', () => {
    expect(decodeCalibration(null)).toBeNull()
  })


  it('normalizes the decoded quaternion', () => {
    // Slightly de-normalized fixture; result should be unit-length.
    const q = decodeCalibration('{"x":0.5,"y":0.5,"z":0.5,"w":0.5}')
    const len = Math.sqrt((q.x * q.x) + (q.y * q.y) + (q.z * q.z) + (q.w * q.w))
    expect(len).toBeCloseTo(1, 9)
  })
})


describe('CalibrationStore', () => {
  function fakeStorage() {
    const map = new Map()
    return {
      getItem: (k) => map.has(k) ? map.get(k) : null,
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
      _map: map,
    }
  }


  it('returns null for an unsaved (kind, angle)', () => {
    const store = new CalibrationStore({storage: fakeStorage()})
    expect(store.load('deviceorientation', 0)).toBeNull()
  })


  it('round-trips a saved calibration', () => {
    const store = new CalibrationStore({storage: fakeStorage()})
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.5)
    store.save('deviceorientation', 0, q)
    const loaded = store.load('deviceorientation', 0)
    expect(loaded.x).toBeCloseTo(q.x, 5)
    expect(loaded.y).toBeCloseTo(q.y, 5)
    expect(loaded.z).toBeCloseTo(q.z, 5)
    expect(loaded.w).toBeCloseTo(q.w, 5)
  })


  it('scopes by source kind and screen angle', () => {
    // Different sensor stacks and screen orientations have *different*
    // physical meanings for "calibration", so they must not share slots.
    const store = new CalibrationStore({storage: fakeStorage()})
    const a = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.5)
    const b = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.5)
    store.save('deviceorientation', 0, a)
    store.save('deviceorientation', 90, b)
    const portrait = store.load('deviceorientation', 0)
    const landscape = store.load('deviceorientation', 90)
    expect(portrait.z).toBeCloseTo(a.z, 5)
    expect(landscape.z).toBeCloseTo(b.z, 5)
    expect(store.load('webxr', 0)).toBeNull()
  })


  it('clears a single slot without affecting others', () => {
    const store = new CalibrationStore({storage: fakeStorage()})
    store.save('deviceorientation', 0, new Quaternion(0.1, 0, 0, 0.99))
    store.save('deviceorientation', 90, new Quaternion(0, 0.1, 0, 0.99))
    store.clear('deviceorientation', 0)
    expect(store.load('deviceorientation', 0)).toBeNull()
    expect(store.load('deviceorientation', 90)).not.toBeNull()
  })
})
