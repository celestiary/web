import {beforeEach, describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Scene as ThreeScene, Vector3} from 'three'
import ARController from './ARController.js'
import {CalibrationStore} from './Calibration.js'
import NullPoseSource from './NullPoseSource.js'
import {enuToBodyFixedQuat} from './enuFrame.js'


/**
 * Build a minimal ARController harness:
 *   - real ThreeScene + PerspectiveCamera + camera.platform
 *   - fake Scene exposing only enterAR / exitAR (no `land` — AR no
 *     longer teleports on entry; the camera is left wherever the user
 *     left it before tapping AR)
 *   - fake Time (records what gets called)
 *   - in-memory CalibrationStore
 *   - injectable PoseSource so we can drive deterministic poses in tests
 */
function makeHarness({poseSource} = {}) {
  const threeScene = new ThreeScene()
  const camera = new PerspectiveCamera(45, 1, 1, 1e12)
  camera.platform = new Object3D()
  camera.platform.add(camera)
  threeScene.add(camera.platform)

  const earth = new Object3D()
  earth.name = 'earth'
  earth.props = {name: 'earth', radius: {scalar: 6.371e6}}
  threeScene.add(earth)

  const sceneCalls = []
  const fakeScene = {
    enterAR() {
      sceneCalls.push({op: 'enterAR'})
      return {snapshot: 'fake'}
    },
    exitAR(prior) {
      sceneCalls.push({op: 'exitAR', prior})
    },
  }

  const time = {
    timeScale: 1,
    timeScaleSteps: 0,
    simTime: 1234,
    isPaused: false,
    setTimeToNowCalls: 0,
    togglePause() {
      this.isPaused = !this.isPaused
    },
    setTimeToNow() {
      this.setTimeToNowCalls += 1
      this.timeScale = 1
      this.timeScaleSteps = 0
    },
  }

  // Minimal store with the AR slice setter.
  const arState = {value: null}
  const useStore = {
    getState: () => ({setARMode: (v) => {
      arState.value = v
    }}),
  }

  const calibrationStore = new CalibrationStore({storage: makeFakeStorage()})
  const ps = poseSource ?? new NullPoseSource()
  const ctrl = new ARController({
    scene: fakeScene,
    ui: {camera},
    time,
    useStore,
    calibrationStore,
    poseSourceFactory: () => Promise.resolve(ps),
  })
  return {ctrl, threeScene, camera, earth, fakeScene, sceneCalls, time, calibrationStore, arState, poseSource: ps}
}


function makeFakeStorage() {
  const map = new Map()
  return {
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  }
}


async function enterWith(ctrl, opts) {
  // Pose-source factory is injected via the constructor in makeHarness,
  // so enter() runs straight through with the harness-supplied source.
  await ctrl.enter(opts)
}


describe('ARController.enter / exit', () => {
  let harness
  beforeEach(() => {
    harness = makeHarness()
  })


  it('does NOT call scene.land — AR engages wherever the camera is', async () => {
    // Removing the implied goto was an explicit decision: AR should
    // never silently teleport the camera away from the spot the user
    // chose (e.g. landed at Cairo, then taps AR — they should stay at
    // Cairo, not get warped to their device-geolocation).  The math
    // composition still uses the supplied lat/lng for ENU→body-fixed,
    // so callers should pass the user's intended observer position.
    const {ctrl, sceneCalls} = harness
    await enterWith(ctrl, {body: 'earth', lat: 37.77, lng: -122.42, alt: 2})
    expect(ctrl.isActive()).toBe(true)
    expect(sceneCalls.some((c) => c.op === 'land')).toBe(false)
  })


  it('switches sim-time to real-time on enter', async () => {
    const {ctrl, time} = harness
    time.timeScaleSteps = 5 // some weird non-real-time state
    time.timeScale = 32
    await enterWith(ctrl, {lat: 0, lng: 0})
    expect(time.setTimeToNowCalls).toBe(1)
  })


  it('rejects when lat/lng are not numbers', async () => {
    const {ctrl} = harness
    let threw = false
    try {
      await ctrl.enter({lat: 'oops', lng: 0})
    } catch (e) {
      threw = true
      expect(e.message).toMatch(/lat\/lng required/)
    }
    expect(threw).toBe(true)
    expect(ctrl.isActive()).toBe(false)
  })


  it('publishes AR state to the store on enter and exit', async () => {
    const {ctrl, arState} = harness
    await enterWith(ctrl, {body: 'earth', lat: 1, lng: 2, alt: 0})
    expect(arState.value.active).toBe(true)
    expect(arState.value.body).toBe('earth')
    expect(arState.value.lat).toBe(1)
    expect(arState.value.lng).toBe(2)
    ctrl.exit()
    expect(ctrl.isActive()).toBe(false)
    expect(arState.value.active).toBe(false)
  })


  it('calls scene.enterAR on enter and scene.exitAR on exit', async () => {
    const {ctrl, sceneCalls} = harness
    await enterWith(ctrl, {lat: 0, lng: 0})
    expect(sceneCalls.some((c) => c.op === 'enterAR')).toBe(true)
    ctrl.exit()
    expect(sceneCalls.some((c) => c.op === 'exitAR')).toBe(true)
  })
})


describe('ARController.updateFrame — pose composition', () => {
  it('composes camera.quaternion = enu_to_bodyFixed · q_cal · q_cam_to_enu', async () => {
    // Use a Null pose source (identity quat) so the chain reduces to:
    //   camera.quaternion = enu_to_bodyFixed(lat, lng) · I · I
    //                     = enu_to_bodyFixed(lat, lng)
    // We can compare element-by-element.
    const harness = makeHarness()
    const {ctrl, camera} = harness
    const lat = 30
    const lng = 60
    await enterWith(ctrl, {lat, lng})
    ctrl.updateFrame()
    const expected = enuToBodyFixedQuat(lat, lng)
    expect(camera.quaternion.x).toBeCloseTo(expected.x, 9)
    expect(camera.quaternion.y).toBeCloseTo(expected.y, 9)
    expect(camera.quaternion.z).toBeCloseTo(expected.z, 9)
    expect(camera.quaternion.w).toBeCloseTo(expected.w, 9)
  })


  it('is a no-op when AR is inactive', () => {
    const harness = makeHarness()
    const {ctrl, camera} = harness
    camera.quaternion.set(0.1, 0.2, 0.3, 0.9)
    ctrl.updateFrame()
    expect(camera.quaternion.x).toBe(0.1)
    expect(camera.quaternion.y).toBe(0.2)
    expect(camera.quaternion.z).toBe(0.3)
    expect(camera.quaternion.w).toBe(0.9)
  })


  it('camera-forward (0,0,−1) lands on body-fixed Up at observer location', async () => {
    // With a Null source (camera→ENU identity), the camera is by
    // construction "looking straight up" in ENU.  Composing with
    // enu_to_bodyFixed(lat, lng) should map camera-forward to the body's
    // outward radial at that observer location — i.e. body-fixed Up.
    const harness = makeHarness()
    const {ctrl, camera} = harness
    const lat = 45
    const lng = -90
    await enterWith(ctrl, {lat, lng})
    ctrl.updateFrame()
    // Camera forward is local −Z = camera frame (0, 0, -1), but
    // applyQuaternion gives the world-frame direction in the camera
    // platform's frame.  Since platform is at body-origin with identity,
    // platform-local = body-fixed.
    const fwd = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    // Wait — for a NullPoseSource, the camera→ENU rotation is identity,
    // meaning the camera's −Z forward equals ENU −Z = "Down".  In body-
    // fixed coords at (45, -90), Down points toward planet center, the
    // negation of the up vector at that location.
    // Recover Up via the helper to compare against.
    const {up} = await import('./enuFrame.js').then((m) => ({
      up: m.enuTriadAtLatLng(lat, lng).up,
    }))
    // fwd should equal -up.
    expect(fwd.x).toBeCloseTo(-up.x, 9)
    expect(fwd.y).toBeCloseTo(-up.y, 9)
    expect(fwd.z).toBeCloseTo(-up.z, 9)
  })
})


describe('ARController calibration', () => {
  it('captureCalibration aligns sensor-aimed direction to a true direction', async () => {
    const harness = makeHarness()
    const {ctrl, camera} = harness
    await enterWith(ctrl, {lat: 0, lng: 0})

    // After capture-calibration with deviceAim = ENU forward, trueDir =
    // ENU North, the next frame's camera-forward (in ENU) should equal
    // North.
    //
    // With a NullPoseSource the device's idea of camera-forward (in ENU)
    // is camera-forward * camToEnu(=I) = camera (0,0,-1) → ENU (0,0,-1)
    // which is straight Down.  We *tell* the controller the true
    // direction is North = (0,1,0) → calibration solves rotation Down→
    // North = 90° about ENU +X.
    ctrl.captureCalibration(new Vector3(0, 1, 0))
    ctrl.updateFrame()

    // Camera-forward in body-fixed coords after compose:
    //   body = enu_to_bodyFixed(0,0) · q_cal · q_cam_to_enu · (0,0,-1)
    //        = enu_to_bodyFixed(0,0) · q_cal · (0,0,-1) ENU
    // q_cal rotates (0,0,-1) ENU into (0,1,0) ENU (= North), so the
    // bracketed term equals (0,1,0) ENU.  Then enu_to_bodyFixed(0,0)
    // maps ENU (0,1,0) = North to body-fixed +Y (the rotation axis).
    const fwd = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    expect(fwd.x).toBeCloseTo(0, 6)
    expect(fwd.y).toBeCloseTo(1, 6) // body-fixed +Y = north pole
    expect(fwd.z).toBeCloseTo(0, 6)
  })


  it('clearCalibration resets to identity', async () => {
    const harness = makeHarness()
    const {ctrl} = harness
    await enterWith(ctrl, {lat: 0, lng: 0})
    ctrl.captureCalibration(new Vector3(1, 0, 0))
    ctrl.clearCalibration()
    expect(ctrl._qCalibration.x).toBeCloseTo(0, 9)
    expect(ctrl._qCalibration.y).toBeCloseTo(0, 9)
    expect(ctrl._qCalibration.z).toBeCloseTo(0, 9)
    expect(Math.abs(ctrl._qCalibration.w)).toBeCloseTo(1, 9)
  })


  it('persists calibration across enter/exit/enter', async () => {
    const harness = makeHarness()
    const {ctrl} = harness
    await enterWith(ctrl, {lat: 0, lng: 0})
    ctrl.captureCalibration(new Vector3(0, 1, 0))
    const savedX = ctrl._qCalibration.x
    const savedY = ctrl._qCalibration.y
    const savedZ = ctrl._qCalibration.z
    const savedW = ctrl._qCalibration.w
    ctrl.exit()
    await enterWith(ctrl, {lat: 0, lng: 0})
    expect(ctrl._qCalibration.x).toBeCloseTo(savedX, 5)
    expect(ctrl._qCalibration.y).toBeCloseTo(savedY, 5)
    expect(ctrl._qCalibration.z).toBeCloseTo(savedZ, 5)
    expect(ctrl._qCalibration.w).toBeCloseTo(savedW, 5)
  })
})
