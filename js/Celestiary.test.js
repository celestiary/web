/**
 * Integration tests for Celestiary permalink restore.
 *
 * Verifies that initializing Celestiary with a permalink hash correctly
 * restores simulation time, camera position/orientation, and FOV without
 * playing the default GoTo navigation animation.
 *
 * Mocked: ThreeUI (no WebGL), ControlPanel, Keys, Loader (filesystem),
 *         scene/SpriteSheet (no canvas), vsop (fixed coordinates).
 */
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock} from 'bun:test'
import {readFileSync} from 'fs'
import {Object3D, PerspectiveCamera, Quaternion, Scene, Vector3} from 'three'
import {formatNavMode} from './navMode.js'
import {decodePermalink, encodePermalink, SETTINGS_DEFAULTS} from './permalink.js'
import {latLngAltToBodyFixed, worldToLatLngAlt} from './coords.js'
import * as Shared from './shared.js'


const EARTH_RADIUS = 6371000 // meters
const J2000_JD = 2451545.0

// Permalink values for the test scenario
const PL = {
  path: 'sun/earth',
  d2000: 9233.0,
  lat: 30.2638, // Austin TX
  lng: -97.7526,
  alt: 400000, // 400 km (ISS-like altitude)
  quat: {x: 0.1, y: 0.2, z: 0.3, w: 0.9},
  fov: 30,
}
const TEST_FRAGMENT =
  encodePermalink(PL.path, PL.d2000, PL.lat, PL.lng, PL.alt, PL.quat, PL.fov)

// ---- Minimal browser globals (no jsdom needed) ----

global.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: () => {},
}
global.document = {
  createElement: (tag) => ({
    style: {},
    offsetWidth: 1280,
    offsetHeight: 720,
    appendChild: () => {},
    addEventListener: () => {},
    setAttribute: () => {},
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect: () => {},
      fillText: () => {},
      measureText: () => ({width: 100, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2}),
      clearRect: () => {},
      drawImage: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      strokeRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      globalCompositeOperation: '',
      globalAlpha: 1,
      lineWidth: 1,
    }),
  }),
  getElementById: () => ({style: {}}),
  querySelectorAll: () => [],
  body: {appendChild: () => {}},
}
global.history = {replaceState: () => {}}
global.location = {hash: `#${TEST_FRAGMENT}`}
// Earth's `has_locations: true` triggers Planet.loadLocations → fetchPlaces;
// stub fetch to a no-content response so the warn-on-fail path doesn't spam
// the test output.  No test in this file exercises real catalog data.
global.fetch = () => Promise.resolve({ok: false, json: () => Promise.resolve({})})


// ---- ThreeUI stub: real Three.js camera/scene, no WebGL renderer ----

class StubThreeUI {
  constructor(container, animCb) {
    this.animCb = animCb
    this.scene = new Scene()
    this.camera = new PerspectiveCamera(45, 1, 1, 1e20)
    this.camera.platform = new Object3D()
    this.camera.platform.name = 'CameraPlatform'
    this.camera.platform.add(this.camera)
    this.scene.add(this.camera.platform)
    this.controls = {update: () => {}, handleResize: () => {}}
    this.onCameraChange = null
    this.layers = {}
  }
  configLargeScene() {}
  setFov(fov) {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    this.onCameraChange?.()
  }
  addClickCb() {}
  setLimitingMagnitude() {}
  setStarMagnitudeOffset(mag) {
    this._starMag = mag
  }

  starMagnitudeOffset() {
    return this._starMag ?? 0
  }

  setExposureCompensation(ev) {
    this._ev = ev
  }

  exposureCompensation() {
    return this._ev ?? 0
  }

  userLimitingMagnitude() {
    return 6.5
  }

  togglePerfPanel() {
    this.perfToggles = (this.perfToggles || 0) + 1
    return true
  }
  isPerfPanelVisible() {
    return !!this.perfToggles
  }
}


// ---- Loader stub: reads JSON from public/data/ synchronously ----

class StubLoader {
  constructor() {
    this.loaded = {}
    this.pathByName = {}
  }

  _read(name) {
    if (!this.loaded[name]) {
      this.loaded[name] = JSON.parse(readFileSync(`./public/data/${name}.json`, 'utf-8'))
    }
    return this.loaded[name]
  }

  loadShaders(material, cb) {
    cb()
  }

  loadPath(path, onLoad, onDone, _onErr) {
    if (path === 'milkyway') {
      const obj = this._read('milkyway')
      this.pathByName['milkyway'] = 'milkyway'
      onLoad('milkyway', obj)
      onDone('milkyway', obj)
      return
    }
    const parts = path.split('/')
    let loadedPath = ''
    for (const name of parts) {
      const obj = this._read(name)
      loadedPath = loadedPath ? `${loadedPath}/${name}` : name
      this.pathByName[name] = loadedPath
      onLoad(name, obj)
    }
    onDone(path, this.loaded[parts[parts.length - 1]])
  }
}


// ---- Module mocks (registered before Celestiary is imported) ----

mock.module('./ThreeUI', () => ({default: StubThreeUI}))
mock.module('./ControlPanel', () => ({
  default: class {
    showNavDisplay() {}
  },
}))
// Keys is NOT mocked: bun mock.module() is process-global, so mocking it here
// would leak into Keys.test.js and cause the real class's methods to be shadowed.
// The real Keys calls window.addEventListener, which is a no-op in our stub global.window.
mock.module('./Loader', () => ({default: StubLoader}))

// Avoid canvas dependency in Planet label sprites
mock.module('./scene/SpriteSheet', () => ({
  default: class {
    constructor() {}
    add() {
      return this
    }
    compile() {
      return new Object3D()
    }
    setTowardEye() {}
  },
}))

// Place earth at 1 AU from origin along the X axis; supply synchronously
mock.module('./vsop', () => ({
  loadVsop87c: (cb) => {
    cb((_jd) => ({
      mercury: {x: 0, y: 0, z: 0},
      venus: {x: 0, y: 0, z: 0},
      earth: {x: 1.0, y: 0, z: 0}, // 1 AU, X axis
      mars: {x: 0, y: 0, z: 0},
      jupiter: {x: 0, y: 0, z: 0},
      saturn: {x: 0, y: 0, z: 0},
      uranus: {x: 0, y: 0, z: 0},
      neptune: {x: 0, y: 0, z: 0},
    }))
  },
}))


// Zustand-like useStore stub: callable hook + getState/setState/subscribe.
// Real Celestiary reaches into store.getState() to push state (e.g. committedPath).
// Setters are arrow fns mutating the closed-over state object — matching real
// zustand's pattern where setters don't depend on `this`.
function makeStubStore() {
  const state = {
    setCommittedPath: () => {},
    dragMode: 'pan',
    // Recorded: tests can read state.dragModeCalls to assert auto-pick fired.
    dragModeCalls: [],
    // The widgets drawer at its defaults: no state tokens (appTokens.js).
    widgets: {isOpen: false, isDocked: false, view: null, running: [], pinned: [], appStates: {}},
  }
  state.setDragMode = (m) => {
    state.dragMode = m
    state.dragModeCalls.push(m)
  }
  const hook = () => ({})
  hook.getState = () => state
  hook.setState = () => {}
  hook.subscribe = () => () => {}
  return hook
}


// ---- Celestiary loaded dynamically so mocks are in place first ----

let Celestiary
beforeAll(async () => {
  Celestiary = (await import('./Celestiary.js')).default
})


// ---- Tests ----

describe('Celestiary permalink restore', () => {
  let app

  beforeAll(async () => {
    global.location.hash = `#${TEST_FRAGMENT}`

    const canvasContainer = {
      style: {width: '', height: ''},
      appendChild: () => {},
      addEventListener: () => {},
    }
    app = new Celestiary(
        makeStubStore(), // useStore
        canvasContainer,
        {}, // navElt
        () => {}, // setTimeStr
        () => {}, // setIsPaused
    )

    // Loader fires synchronously so onDone is already called.
    // The restore runs in setTimeout(fn, 0) — wait for it.
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  // The debounced permalink update (1 s) would otherwise fire during a later
  // test file and read whatever Shared.targets.cur that file left behind.
  afterAll(() => clearTimeout(app._permalinkTimer))

  it('binds the backtick key to the performance panel toggle', () => {
    expect(app.keys.msgs['`']).toBe('Toggle performance panel')
    app.keys.onKeyDown({key: '`'})
    expect(app.ui.perfToggles).toBe(1)
    expect(app.keys.toggleStates['`']()).toBe(true)
  })

  it('cancels the GoTo navigation tween (no animation)', () => {
    expect(Shared.targets.tween).toBeNull()
  })

  it('restores simulation time to saved JD', () => {
    const jd = app.time.simTimeJulianDay()
    expect(jd).toBeCloseTo(PL.d2000 + J2000_JD, 2)
  })

  it('restores camera FOV', () => {
    expect(app.camera.fov).toBeCloseTo(PL.fov, 2)
  })

  it('restores camera orientation (quaternion), normalized', () => {
    // The permalink writes cq to 4 decimals, so the saved quaternion isn't
    // quite unit; set as it is, it scaled the camera's matrix (three's
    // compose doesn't normalize), and the atmosphere pass then saw the
    // planet's centre 30-80 m farther than it was: a camera 16 m under the
    // Dead Sea's datum read as 61 m over it.
    const q = app.camera.quaternion
    const n = Math.hypot(PL.quat.x, PL.quat.y, PL.quat.z, PL.quat.w)
    expect(q.x).toBeCloseTo(PL.quat.x / n, 6)
    expect(q.y).toBeCloseTo(PL.quat.y / n, 6)
    expect(q.z).toBeCloseTo(PL.quat.z / n, 6)
    expect(q.w).toBeCloseTo(PL.quat.w / n, 6)
    expect(q.length()).toBeCloseTo(1, 9)
  })

  it('places camera at saved altitude above Earth', () => {
    // Quaternion operations preserve vector magnitude, so camera.position.length()
    // must equal earthRadius + alt regardless of planet/platform orientations.
    const expected = EARTH_RADIUS + PL.alt
    expect(app.camera.position.length()).toBeCloseTo(expected, -2) // within 100 m
  })

  it('round-trips lat/lng from camera world position back to saved values', () => {
    // The ultimate correctness check: go from camera world pos back to geographic
    // coords via worldToLatLngAlt and compare with the saved permalink values.
    const earth = app.scene.objects['earth']
    const earthWorldPos = new Vector3()
    earth.getWorldPosition(earthWorldPos)
    const earthWorldQuat = new Quaternion()
    earth.getWorldQuaternion(earthWorldQuat)

    const camWorldPos = new Vector3()
    app.camera.getWorldPosition(camWorldPos)

    const {lat, lng, alt} = worldToLatLngAlt(
        camWorldPos, earthWorldPos, earthWorldQuat, EARTH_RADIUS,
    )

    expect(lat).toBeCloseTo(PL.lat, 3)
    expect(lng).toBeCloseTo(PL.lng, 3)
    // Relative error on alt (large absolute value)
    expect(alt / PL.alt).toBeCloseTo(1, 3)
  })

  it('gives a body a depth-tested far point', () => {
    // The body's LOD (Planet.newPlanet): mesh, then its point, then nothing.
    const lod = app.scene.objects['earth'].parent
    expect(lod.isLOD).toBe(true)
    const farPoint = lod.levels[1].object
    expect(farPoint.name).toBe('far point')
    expect(farPoint.material.depthTest).toBe(true)
    expect(farPoint.material.depthWrite).toBe(false)
  })
})


describe('Scene.goTo navigation', () => {
  let app2

  // Use a full permalink for 'sun' so _pendingPermalink is truthy → setTimeout delay = 0
  const SUN_FRAGMENT = encodePermalink('sun', 0, 0, 0, 0, {x: 0, y: 0, z: 0, w: 1}, 45)
  // A star far from the origin to make WorldGroup rebase assertions meaningful
  const FAKE_STAR = {x: 1e14, y: 2e14, z: 3e14, hipId: 99, radius: 7e8}

  beforeAll(async () => {
    global.location.hash = `#${SUN_FRAGMENT}`
    const canvasContainer = {
      style: {width: '', height: ''},
      appendChild: () => {},
      addEventListener: () => {},
    }
    app2 = new Celestiary(
        makeStubStore(),
        canvasContainer,
        {},
        () => {},
        () => {},
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  afterAll(() => clearTimeout(app2._permalinkTimer))

  // Bring the scene back to a clean, known state before each navigation test.
  // Camera world position is set to a non-trivial value so position-preservation
  // assertions are meaningful (not just "0 ≈ 0").
  function resetScene() {
    app2.ui.scene.add(app2.ui.camera.platform)
    app2.ui.camera.platform.position.set(0, 0, 0)
    app2.ui.camera.platform.quaternion.identity()
    app2.ui.camera.position.set(0, 0, 1e10)
    app2.ui.camera.quaternion.identity()
    app2.scene.worldGroup.position.set(0, 0, 0)
    Shared.targets.tween = null
    Shared.targets.tweenNextFn = null
    Shared.targets.cur = null
    Shared.targets.obj = null
    app2.ui.scene.updateMatrixWorld()
  }

  // No-op in the current one-tween design (goTo no longer sets tweenNextFn),
  // but kept so existing test blocks read consistently and any future reintroduction
  // of a deferred tween would wire through this helper.
  function fireTweenNext() {
    const fn = Shared.targets.tweenNextFn
    Shared.targets.tweenNextFn = null
    Shared.targets.tween = fn ? fn() : null
    app2.ui.scene.updateMatrixWorld()
  }

  // Invariant goTo must preserve: the camera's position in the WorldGroup frame
  // (= camera_world − wg_position) is the same before and after the rebase +
  // reparent.  Absolute camera world position deliberately changes by the wg
  // delta so the camera "moves with the universe" for meaningful travel distance.
  function camPosInWgFrame(camWorldPos, wgPos) {
    return camWorldPos.clone().sub(wgPos)
  }

  describe('planet navigation to sun', () => {
    let sunObj
    let camPosInWgBefore
    let camWorldQuatBefore

    beforeAll(() => {
      resetScene()
      sunObj = app2.scene.objects['sun']
      Shared.targets.obj = sunObj
      const camWorldPosBefore = new Vector3()
      app2.ui.camera.getWorldPosition(camWorldPosBefore)
      camPosInWgBefore = camPosInWgFrame(camWorldPosBefore, app2.scene.worldGroup.position)
      camWorldQuatBefore = new Quaternion()
      app2.ui.camera.getWorldQuaternion(camWorldQuatBefore)
      app2.scene.goTo()
      fireTweenNext()
    })

    it('tweenNextFn is consumed', () => {
      expect(Shared.targets.tweenNextFn).toBeNull()
    })

    it('preserves camera position in WorldGroup frame (< 1 m)', () => {
      const after = new Vector3()
      app2.ui.camera.getWorldPosition(after)
      const afterInWg = camPosInWgFrame(after, app2.scene.worldGroup.position)
      expect(afterInWg.distanceTo(camPosInWgBefore)).toBeLessThan(1)
    })

    it('preserves camera world orientation', () => {
      const after = new Quaternion()
      app2.ui.camera.getWorldQuaternion(after)
      expect(Math.abs(after.dot(camWorldQuatBefore))).toBeCloseTo(1, 4)
    })

    it('keeps WorldGroup at origin', () => {
      const {x, y, z} = app2.scene.worldGroup.position
      expect(x).toBe(0)
      expect(y).toBe(0)
      expect(z).toBe(0)
    })

    it('reparents camera platform to sun.orbitPosition', () => {
      expect(app2.ui.camera.platform.parent).toBe(sunObj.orbitPosition)
    })

    it('resets dragMode to \'auto\' on planet navigation', () => {
      // dragControls re-evaluates pickDragMode at the next pointerdown
      // against the actual final camera position — covers both the
      // normal goTo arrival (orbit altitude) and permalink restores
      // that land the camera on the surface.
      const calls = app2.useStore.getState().dragModeCalls
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[calls.length - 1]).toBe('auto')
    })
  })


  describe('star navigation', () => {
    let camPosInWgBefore
    let camWorldQuatBefore

    beforeAll(() => {
      resetScene()
      const camWorldPosBefore = new Vector3()
      app2.ui.camera.getWorldPosition(camWorldPosBefore)
      camPosInWgBefore = camPosInWgFrame(camWorldPosBefore, app2.scene.worldGroup.position)
      camWorldQuatBefore = new Quaternion()
      app2.ui.camera.getWorldQuaternion(camWorldQuatBefore)
      app2.scene.goTo(FAKE_STAR)
      fireTweenNext()
    })

    it('preserves camera position in WorldGroup frame (< 1 m)', () => {
      const after = new Vector3()
      app2.ui.camera.getWorldPosition(after)
      const afterInWg = camPosInWgFrame(after, app2.scene.worldGroup.position)
      expect(afterInWg.distanceTo(camPosInWgBefore)).toBeLessThan(1)
    })

    it('preserves camera world orientation', () => {
      const after = new Quaternion()
      app2.ui.camera.getWorldQuaternion(after)
      expect(Math.abs(after.dot(camWorldQuatBefore))).toBeCloseTo(1, 4)
    })

    it('rebases WorldGroup to negate star coordinates', () => {
      const {x, y, z} = app2.scene.worldGroup.position
      expect(x).toBe(-FAKE_STAR.x)
      expect(y).toBe(-FAKE_STAR.y)
      expect(z).toBe(-FAKE_STAR.z)
    })

    it('reparents camera platform to _starAnchor', () => {
      expect(app2.ui.camera.platform.parent).toBe(app2.scene._starAnchor)
    })
  })


  describe('star → sun regression (h key path)', () => {
    let sunObj
    let camPosInWgBefore
    let camWorldQuatBefore

    beforeAll(() => {
      // First navigate to the fake star (mimics arriving at a star via PickLabels)
      resetScene()
      app2.scene.goTo(FAKE_STAR)
      fireTweenNext()

      // Then navigate back to sun — this is the path the 'h' key takes
      sunObj = app2.scene.objects['sun']
      Shared.targets.obj = sunObj
      const camWorldPosBefore = new Vector3()
      app2.ui.camera.getWorldPosition(camWorldPosBefore)
      camPosInWgBefore = camPosInWgFrame(camWorldPosBefore, app2.scene.worldGroup.position)
      camWorldQuatBefore = new Quaternion()
      app2.ui.camera.getWorldQuaternion(camWorldQuatBefore)
      app2.scene.goTo()
      fireTweenNext()
    })

    it('preserves camera position in WorldGroup frame after star → sun (< 1 m)', () => {
      const after = new Vector3()
      app2.ui.camera.getWorldPosition(after)
      const afterInWg = camPosInWgFrame(after, app2.scene.worldGroup.position)
      expect(afterInWg.distanceTo(camPosInWgBefore)).toBeLessThan(1)
    })

    it('preserves camera world orientation after star → sun', () => {
      const after = new Quaternion()
      app2.ui.camera.getWorldQuaternion(after)
      expect(Math.abs(after.dot(camWorldQuatBefore))).toBeCloseTo(1, 4)
    })

    it('resets WorldGroup to origin after star → sun', () => {
      const {x, y, z} = app2.scene.worldGroup.position
      expect(x).toBe(0)
      expect(y).toBe(0)
      expect(z).toBe(0)
    })

    it('reparents camera platform to sun.orbitPosition after star → sun', () => {
      expect(app2.ui.camera.platform.parent).toBe(sunObj.orbitPosition)
    })
  })
  // The search bar's "Look at": turn in place, never travel.  Scene.setTarget
  // (bodies), lookAtStar and lookAtPlace share the rotation-only look tween.
  describe('search "look at" (turn in place)', () => {
    // Run the current look tween to its end.
    function finishTween() {
      Shared.targets.tween.update(performance.now() + 10000)
      Shared.targets.tween = null
    }

    // Angle (deg) between the camera's view direction and a world point.
    function angleTo(worldPos) {
      app2.ui.scene.updateMatrixWorld()
      const camPos = new Vector3()
      app2.ui.camera.getWorldPosition(camPos)
      const view = new Vector3(0, 0, -1)
          .applyQuaternion(app2.ui.camera.getWorldQuaternion(new Quaternion()))
      return view.angleTo(worldPos.clone().sub(camPos)) * 180 / Math.PI
    }

    beforeEach(() => {
      resetScene()
    })

    it('turns to a body, behind the camera too, without moving', () => {
      const sun = app2.scene.objects.sun
      const before = app2.ui.camera.position.clone()
      app2.scene.setTarget('sun')
      finishTween()
      const pos = new Vector3().setFromMatrixPosition(sun.matrixWorld)
      expect(angleTo(pos)).toBeLessThan(0.01)
      expect(app2.ui.camera.position.distanceTo(before)).toBe(0)
      // And from the other side: the camera faces away from the sun.
      app2.ui.camera.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
      app2.scene.setTarget('sun')
      finishTween()
      expect(angleTo(pos)).toBeLessThan(0.01)
      expect(app2.ui.camera.position.distanceTo(before)).toBe(0)
    })

    it('turns to a star at its rebased position, without moving', () => {
      app2.scene.worldGroup.position.set(1e12, 0, 0)
      app2.ui.scene.updateMatrixWorld()
      const before = app2.ui.camera.position.clone()
      app2.scene.lookAtStar(FAKE_STAR)
      finishTween()
      const world = app2.scene.worldGroup.localToWorld(app2.scene.starPosition(FAKE_STAR))
      expect(angleTo(world)).toBeLessThan(0.01)
      expect(app2.ui.camera.position.distanceTo(before)).toBe(0)
    })

    it('turns to a surface place, without moving', () => {
      const sun = app2.scene.objects.sun
      const before = app2.ui.camera.position.clone()
      app2.scene.lookAtPlace('sun', 48.8, 2.3, 0)
      finishTween()
      const world = sun.localToWorld(
          latLngAltToBodyFixed(48.8, 2.3, 0, sun.props.radius.scalar))
      expect(angleTo(world)).toBeLessThan(0.01)
      expect(app2.ui.camera.position.distanceTo(before)).toBe(0)
      expect(Shared.targets.obj).toBe(sun)
    })

    it('does not rebase or reparent', () => {
      const parent = app2.ui.camera.platform.parent
      app2.scene.worldGroup.position.set(5, 6, 7)
      app2.scene.setTarget('sun')
      app2.scene.lookAtStar(FAKE_STAR)
      expect(app2.ui.camera.platform.parent).toBe(parent)
      expect(app2.scene.worldGroup.position.toArray()).toEqual([5, 6, 7])
    })
  })

  // One picking model for every label (DESIGN.md, Picking): a click or tap
  // targets what it names and nothing else, so 'c' faces it and 'g' goes;
  // a double click goes.  The labels' hit test is labelPick.test.js; here
  // the hit is stubbed (Scene.pickLabel), to see what each kind does.
  describe('picking a label: click targets, double click goes', () => {
    const SUN_PLACE = {kind: 'place', body: 'sun', name: 'Spot', lat: 10, lng: 20}
    const STAR_LABEL = {kind: 'star', star: FAKE_STAR, name: 'Fake'}
    const ASTERISM = {kind: 'asterism', name: 'Fakus', position: {x: 4e13, y: 1e13, z: -2e13}}
    const EVENT = {clientX: 1, clientY: 1}
    const BODY_LABEL = {kind: 'body', name: 'sun'}
    let store
    let calls
    let saved

    function lookAngleTo(worldPos) {
      app2.ui.scene.updateMatrixWorld()
      const camPos = app2.ui.camera.getWorldPosition(new Vector3())
      const view = new Vector3(0, 0, -1).applyQuaternion(app2.ui.camera.getWorldQuaternion(new Quaternion()))
      return view.angleTo(worldPos.clone().sub(camPos)) * 180 / Math.PI
    }

    beforeEach(() => {
      resetScene()
      Shared.targets.label = null
      store = app2.useStore.getState()
      store.committedStar = null
      store.isStarsSelectActive = false
      store.setCommittedStar = (s) => {
        store.committedStar = s
      }
      calls = []
      // Travel, recorded: the click must not go anywhere.
      saved = {land: app2.scene.land, goTo: app2.scene.goTo, hash: global.location.hash}
      app2.scene.land = (...args) => calls.push(['land', ...args])
      app2.scene.goTo = (...args) => calls.push(['goTo', ...args])
      app2.scene.stars = {localToWorld: (v) => v}
    })

    afterEach(() => {
      Object.assign(app2.scene, {land: saved.land, goTo: saved.goTo})
      global.location.hash = saved.hash
      delete app2.scene.stars
      Shared.targets.label = null
      store.committedStar = null
    })

    const click = (label) => {
      app2.scene.pickLabel = () => label
      app2.scene.onClick(EVENT)
    }
    const dblClick = (label) => {
      app2.scene.pickLabel = () => label
      // dragControls: onClick on both clicks, then onDblClick.
      app2.scene.onClick(EVENT)
      app2.scene.onClick(EVENT)
      app2.scene.onDblClick(EVENT)
    }

    it('a click on a body label targets it, without turning or moving the camera', () => {
      const quat = app2.ui.camera.quaternion.clone()
      const pos = app2.ui.camera.position.clone()
      click(BODY_LABEL)
      expect(Shared.targets.obj).toBe(app2.scene.objects.sun)
      expect(Shared.targets.tween).toBe(null)
      expect(app2.ui.camera.quaternion.equals(quat)).toBe(true)
      expect(app2.ui.camera.position.equals(pos)).toBe(true)
      expect(calls).toEqual([])
    })

    it('a click on a star label commits it as the target, as the search does', () => {
      click(STAR_LABEL)
      expect(store.committedStar).toEqual({hipId: 99, displayName: 'Fake', star: FAKE_STAR})
      expect(Shared.targets.tween).toBe(null)
      expect(calls).toEqual([])
    })

    it('a click on a place label targets its body and the point, without landing', () => {
      click(SUN_PLACE)
      expect(Shared.targets.obj).toBe(app2.scene.objects.sun)
      expect(Shared.targets.label).toBe(SUN_PLACE)
      expect(Shared.targets.tween).toBe(null)
      expect(calls).toEqual([])
    })

    it('a click on an asterism label targets its point only', () => {
      Shared.targets.obj = app2.scene.objects.sun
      click(ASTERISM)
      expect(Shared.targets.label).toBe(ASTERISM)
      expect(Shared.targets.obj).toBe(app2.scene.objects.sun)
      expect(Shared.targets.tween).toBe(null)
      expect(calls).toEqual([])
    })

    it('a click on nothing, or with the star picker on, targets nothing', () => {
      click(null)
      expect(Shared.targets.obj).toBe(null)
      store.isStarsSelectActive = true
      click(SUN_PLACE)
      expect(Shared.targets.label).toBe(null)
    })

    it('"c" faces a targeted place, star and asterism, and "g" goes to them', () => {
      const sun = app2.scene.objects.sun
      click(SUN_PLACE)
      app2.scene.lookAtTarget()
      expect(lookAngleTo(sun.localToWorld(latLngAltToBodyFixed(10, 20, 0, sun.props.radius.scalar))))
          .toBeLessThan(0.01)
      app2.goTo()
      expect(calls).toEqual([['land', 'sun', 10, 20, undefined, {target: SUN_PLACE}]])

      calls.length = 0
      click(STAR_LABEL)
      app2.scene.lookAtTarget()
      expect(lookAngleTo(app2.scene.worldGroup.localToWorld(app2.scene.starPosition(FAKE_STAR)))).toBeLessThan(0.01)
      app2.goTo()
      expect(calls).toEqual([['goTo', FAKE_STAR, 'Fake']])

      click(ASTERISM)
      app2.scene.lookAtTarget()
      expect(lookAngleTo(new Vector3(4e13, 1e13, -2e13))).toBeLessThan(0.01)
      // Going to an asterism turns to face it: a look tween, no travel.
      calls.length = 0
      resetScene()
      Shared.targets.label = ASTERISM
      app2.goTo()
      expect(calls).toEqual([])
      expect(Shared.targets.tween).not.toBe(null)
    })

    it('a double click on a place or star goes to it, once', () => {
      dblClick(SUN_PLACE)
      expect(calls).toEqual([['land', 'sun', 10, 20, undefined, {target: SUN_PLACE}]])
      calls.length = 0
      dblClick(STAR_LABEL)
      expect(calls).toEqual([['goTo', FAKE_STAR, 'Fake']])
      expect(store.committedStar.hipId).toBe(99)
    })

    it('a double click on a body label goes to its path, as search Go does', () => {
      app2.loader.pathByName.sun = 'sun'
      const hadLocation = global.window.location
      global.window.location = {hash: ''}
      try {
        dblClick(BODY_LABEL)
        expect(global.window.location.hash).toBe('sun')
      } finally {
        global.window.location = hadLocation
      }
      expect(Shared.targets.obj).toBe(app2.scene.objects.sun)
    })

    it('a double click on an asterism turns to face it, without travelling', () => {
      dblClick(ASTERISM)
      expect(Shared.targets.label).toBe(ASTERISM)
      expect(Shared.targets.tween).not.toBe(null)
      expect(calls).toEqual([])
    })

    it('targeting a body drops a targeted point; targeting anything else replaces it', () => {
      click(SUN_PLACE)
      app2.scene.setTarget('sun')
      expect(Shared.targets.label).toBe(null)
      click(ASTERISM)
      app2.scene.lookAtStar(FAKE_STAR)
      expect(Shared.targets.label.kind).toBe('star')
      expect(Shared.targets.label.star).toBe(FAKE_STAR)
      expect(store.committedStar.hipId).toBe(99)
    })
  })
})


// The link's path names the target (targetPath.js); the camera stays in its
// frame, the body it's at (`from=` when that isn't the target's).  So
// targeting rewrites the link without moving the camera, and the new link,
// reloaded, shows the same view with the same target.
describe('the target in the link', () => {
  const AUSTIN = {kind: 'place', body: 'earth', name: 'Austin', lat: 30.2672, lng: -97.7431}
  const savedFetch = global.fetch
  const apps = []

  beforeAll(() => {
    // Earth's places, for a link to Austin.
    global.fetch = (url) => Promise.resolve(String(url).endsWith('places/earth.json') ?
      {ok: true, json: () => Promise.resolve({places: [{n: 'Austin', lat: AUSTIN.lat, lng: AUSTIN.lng}]})} :
      {ok: false, json: () => Promise.resolve({})})
  })

  afterAll(() => {
    global.fetch = savedFetch
    apps.forEach((a) => clearTimeout(a._permalinkTimer))
    Shared.targets.label = null
    Shared.targets.track = false
  })

  /**
   * @param {string} fragment
   * @param {Function} [setIsPaused] The time panel's setter
   * @returns {Promise<object>} A Celestiary loaded from #fragment, restored
   */
  async function open(fragment, setIsPaused = () => {}, onNavMode = null) {
    global.location.hash = `#${fragment}`
    const app = new Celestiary(makeStubStore(), {style: {}, appendChild: () => {}, addEventListener: () => {}},
        {}, () => {}, setIsPaused, () => {})
    if (onNavMode) {
      app.onNavMode(onNavMode)
    }
    apps.push(app)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return app
  }

  /**
   * @param {object} app
   * @returns {{pos: Vector3, quat: Quaternion}} The camera, world orientation,
   *   and position from Earth's centre, in Earth's body-fixed axes
   */
  function viewFromEarth(app) {
    app.ui.scene.updateMatrixWorld()
    const earth = app.scene.objects.earth
    const earthQuat = earth.getWorldQuaternion(new Quaternion())
    const pos = app.ui.camera.getWorldPosition(new Vector3())
        .sub(earth.getWorldPosition(new Vector3()))
        .applyQuaternion(earthQuat.clone().invert())
    // Orientation relative to Earth too: the scene's world axes are the
    // same in both apps, but this is what a reload must reproduce.
    const quat = earthQuat.clone().invert().multiply(app.ui.camera.getWorldQuaternion(new Quaternion()))
    return {pos, quat}
  }

  /**
   * Target in app, check the camera didn't move, and reload its link.
   *
   * @param {object} app
   * @param {string|object} target
   * @returns {Promise<{before: object, link: string, reloaded: object}>}
   */
  async function targetAndReload(app, target) {
    const before = viewFromEarth(app)
    const camPos = app.ui.camera.position.clone()
    const camQuat = app.ui.camera.quaternion.clone()
    app.scene.setTarget(target, {look: false})
    expect(app.ui.camera.position.equals(camPos)).toBe(true)
    expect(app.ui.camera.quaternion.equals(camQuat)).toBe(true)
    expect(Shared.targets.tween).toBe(null)
    const link = app.permalink()
    const reloaded = await open(link)
    return {before, link, reloaded}
  }

  /**
   * The view after a reload is the one before, within the link's
   * precision: 4 decimal places of a degree (12 m on Earth's surface), and
   * of the quaternion's components.
   *
   * @param {object} a viewFromEarth
   * @param {object} b
   */
  function expectSameView(a, b) {
    expect(a.pos.distanceTo(b.pos)).toBeLessThan(20)
    expect(Math.abs(a.quat.dot(b.quat))).toBeGreaterThan(1 - 1e-6)
  }

  it('a body elsewhere: its path, the camera from Earth', async () => {
    const app = await open(TEST_FRAGMENT)
    const {before, link, reloaded} = await targetAndReload(app, 'sun')
    expect(link.startsWith('sun@30.2638,-97.7526,400km;from=sun/earth;t=9233jd;')).toBe(true)
    expect(Shared.targets.obj).toBe(reloaded.scene.objects.sun)
    expect(Shared.targets.label).toBe(null)
    expect(Shared.targets.cur).toBe(reloaded.scene.objects.earth)
    expectSameView(before, viewFromEarth(reloaded))
  })

  it('a place on Earth: its path, no from', async () => {
    const app = await open(TEST_FRAGMENT)
    const {before, link, reloaded} = await targetAndReload(app, AUSTIN)
    expect(link.startsWith('sun/earth/austin@30.2638,-97.7526,400km;t=9233jd;')).toBe(true)
    expect(Shared.targets.obj).toBe(reloaded.scene.objects.earth)
    expect(Shared.targets.label).toEqual({...AUSTIN, alt: undefined})
    expectSameView(before, viewFromEarth(reloaded))
    // And back to Earth from the place's link: the same link as Earth's own.
    reloaded.scene.setTarget('earth', {look: false})
    expect(reloaded.permalink().startsWith('sun/earth@30.2638,-97.7526,400km;t=9233jd;')).toBe(true)
  })

  it('an old link, with no from: the path is the target and the frame', async () => {
    const app = await open(TEST_FRAGMENT)
    expect(Shared.targets.obj).toBe(app.scene.objects.earth)
    expect(Shared.targets.cur).toBe(app.scene.objects.earth)
    expect(app.permalink().startsWith('sun/earth@30.2638,-97.7526,400km;t=9233jd;')).toBe(true)
  })

  it('"t" tracks the target: a place, as Earth turns', async () => {
    const app = await open(TEST_FRAGMENT)
    app.scene.setTarget(AUSTIN, {look: false})
    app.keys.onKeyDown({key: 't'})
    expect(Shared.targets.track).toBe(true)
    const angleToAustin = () => {
      app.ui.scene.updateMatrixWorld()
      const camPos = app.ui.camera.getWorldPosition(new Vector3())
      const view = new Vector3(0, 0, -1).applyQuaternion(app.ui.camera.getWorldQuaternion(new Quaternion()))
      return view.angleTo(app.scene.labelPosition(AUSTIN).sub(camPos)) * 180 / Math.PI
    }
    expect(angleToAustin()).toBeGreaterThan(1)
    // Each hour Austin turns 15 degrees with Earth.  Each frame, Earth turns
    // (the animation, which here would build its surface), then the
    // tracking look (Celestiary's animCb).
    const earth = app.scene.objects.earth
    for (let hour = 0; hour < 3; hour++) {
      earth.rotateY(Math.PI / 12)
      app.ui.scene.updateMatrixWorld()
      expect(angleToAustin()).toBeGreaterThan(1)
      app.scene.lookAtTarget()
      expect(angleToAustin()).toBeLessThan(0.01)
    }
    app.keys.onKeyDown({key: 't'})
    expect(Shared.targets.track).toBe(false)
  })

  describe('tracking leaves the roll to the user', () => {
    /**
     * @param {object} app
     * @returns {number} Radians the camera is rolled about its view axis
     *   from the roll `lookAt` gives (the ecliptic's up)
     */
    function rollOf(app) {
      app.ui.scene.updateMatrixWorld()
      const cam = app.ui.camera
      const ref = cam.clone()
      ref.parent = cam.parent
      ref.lookAt(app.scene.labelPosition(AUSTIN))
      ref.updateMatrixWorld()
      const view = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion()))
      const up = (c) => new Vector3(0, 1, 0).applyQuaternion(c.getWorldQuaternion(new Quaternion()))
      const a = up(cam)
      const b = up(ref)
      return Math.atan2(a.clone().cross(b).dot(view), a.dot(b))
    }

    it('the animation callback centres the target and keeps a roll, where "c" squares the view', async () => {
      const app = await open(TEST_FRAGMENT)
      app.animation.animate = () => {} // Earth's surface builds in the real one
      app.scene.setTarget(AUSTIN, {look: false})
      app.keys.onKeyDown({key: 't'})
      app.ui.animCb(app.ui.scene)
      expect(Math.abs(rollOf(app))).toBeLessThan(1)
      // Roll the view as the arrow keys do, 0.5 radians.
      app.ui.camera.rotateZ(0.5)
      const rolled = rollOf(app)
      expect(Math.abs(rolled)).toBeGreaterThan(0.3)
      const earth = app.scene.objects.earth
      const worldQuat = () => app.ui.camera.getWorldQuaternion(new Quaternion())
      for (let step = 0; step < 4; step++) {
        const before = worldQuat()
        earth.rotateY(Math.PI / 48)
        app.ui.scene.updateMatrixWorld()
        app.ui.animCb(app.ui.scene)
        app.ui.scene.updateMatrixWorld()
        const camPos = app.ui.camera.getWorldPosition(new Vector3())
        const view = new Vector3(0, 0, -1).applyQuaternion(worldQuat())
        expect(view.angleTo(app.scene.labelPosition(AUSTIN).sub(camPos))).toBeLessThan(1e-4)
        // The camera turned to follow the target by a swing alone: about an
        // axis square to the view, no twist about it (where lookAt, resetting
        // the roll, twists).
        const turn = worldQuat().multiply(before.invert())
        const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)))
        expect(angle).toBeGreaterThan(0.01)
        const axis = new Vector3(turn.x, turn.y, turn.z).normalize()
        expect(Math.abs(axis.dot(view))).toBeLessThan(0.02)
      }
      // 'c' still squares the view to the ecliptic's up.
      app.keys.onKeyDown({key: 'c'})
      expect(Math.abs(rollOf(app))).toBeLessThan(1e-6)
    })
  })

  describe('the time step while paused', () => {
    it('j, k and l set it with the clock stopped, and resuming runs at it', async () => {
      const app = await open(TEST_FRAGMENT)
      const time = app.time
      time.togglePause()
      const start = time.simTime
      let heard = 0
      time.onTimeScaleChange(() => heard++)
      app.keys.onKeyDown({key: 'l'})
      app.keys.onKeyDown({key: 'l'})
      expect(time.timeScale).toBe(4)
      app.keys.onKeyDown({key: 'k'})
      expect(time.timeScale).toBe(2)
      app.keys.onKeyDown({key: 'j'})
      expect(time.timeScale).toBe(-2)
      expect(heard).toBe(4)
      expect(time.isPaused).toBe(true)
      expect(time.simTime).toBe(start)
      time.togglePause()
      expect(time.timeScale).toBe(-2)
    })
  })

  describe('the exposure compensation', () => {
    it('= and - step a third of a stop, + is =, e resets, and listeners hear each change', async () => {
      const app = await open(TEST_FRAGMENT)
      const heard = []
      const stop = app.onExposureCompensation((ev) => heard.push(ev))
      expect(app.ui.exposureCompensation()).toBe(0)
      for (let i = 0; i < 3; i++) {
        app.keys.onKeyDown({key: '='})
      }
      expect(app.ui.exposureCompensation()).toBe(1)
      app.keys.onKeyDown({key: '+'})
      expect(app.ui.exposureCompensation()).toBeCloseTo(4 / 3, 10)
      app.keys.onKeyDown({key: '-'})
      app.keys.onKeyDown({key: '-'})
      expect(app.ui.exposureCompensation()).toBeCloseTo(2 / 3, 10)
      app.keys.onKeyDown({key: 'e'})
      expect(app.ui.exposureCompensation()).toBe(0)
      // A reset at 0 changes nothing, and says nothing.
      app.keys.onKeyDown({key: 'e'})
      expect(heard.length).toBe(7)
      expect(heard[heard.length - 1]).toBe(0)
      stop()
      app.keys.onKeyDown({key: '='})
      expect(heard.length).toBe(7)
      clearTimeout(app._permalinkTimer)
    })

    it('[ and ] are the stars\' limiting magnitude, not the exposure', async () => {
      const app = await open(TEST_FRAGMENT)
      expect(app.keys.msgs['[']).toMatch(/stars/i)
      expect(app.keys.msgs[']']).toMatch(/stars/i)
      expect(app.keys.msgs['-']).toMatch(/exposure/i)
      expect(app.keys.msgs['=']).toMatch(/exposure/i)
      expect(app.keys.msgs['e']).toMatch(/exposure/i)
    })

    it('steps up and down land on exactly 0, with no ev= in the link', async () => {
      const app = await open(TEST_FRAGMENT)
      const keys = ['=', '=', '=', '=', '-', '-', '-', '-', '-', '=']
      for (const key of keys) {
        app.keys.onKeyDown({key})
        app.keys.onKeyDown({key})
        app.keys.onKeyDown({key})
      }
      // Thirds up and down.
      for (let i = 0; i < 7; i++) {
        app.keys.onKeyDown({key: '='})
      }
      for (let i = 0; i < 7; i++) {
        app.keys.onKeyDown({key: '-'})
      }
      app.stepExposureCompensation(-3)
      app.stepExposureCompensation(3)
      app.stepExposureCompensation(-7)
      app.stepExposureCompensation(7)
      expect(Object.is(app.ui.exposureCompensation(), 0)).toBe(true)
      expect(app.permalink()).not.toContain(';ev=')
      clearTimeout(app._permalinkTimer)
    })

    it('is in the link as ev=, and a link restores it, and one without sets it back to 0', async () => {
      const app = await open(TEST_FRAGMENT)
      expect(app.permalink()).not.toContain(';ev=')
      app.setExposureCompensation(4 / 3)
      const link = app.permalink()
      expect(link).toContain(';fov=30deg;ev=1.33')
      const reloaded = await open(link)
      expect(reloaded.ui.exposureCompensation()).toBeCloseTo(1.33, 10)
      // A hand-written one, with the sign.
      const typed = await open(`${TEST_FRAGMENT};ev=+2.5`)
      expect(typed.ui.exposureCompensation()).toBe(2.5)
      const cleared = await open(TEST_FRAGMENT)
      expect(cleared.ui.exposureCompensation()).toBe(0)
    })
  })

  describe('the stars\' setting', () => {
    it('[ and ] step half a magnitude over the naked eye\'s limit, and say so to the readout', async () => {
      const app = await open(TEST_FRAGMENT)
      const heard = []
      const stop = app.onStarMagnitude((mag) => heard.push(mag))
      expect(app.ui.starMagnitudeOffset()).toBe(0)
      app.keys.onKeyDown({key: ']'})
      app.keys.onKeyDown({key: ']'})
      app.keys.onKeyDown({key: ']'})
      expect(app.ui.starMagnitudeOffset()).toBe(1.5)
      app.keys.onKeyDown({key: '['})
      expect(heard).toEqual([0.5, 1, 1.5, 1])
      stop()
      app.keys.onKeyDown({key: ']'})
      expect(heard.length).toBe(4)
      clearTimeout(app._permalinkTimer)
    })

    it('steps back to exactly 0 and is then out of the link', async () => {
      const app = await open(TEST_FRAGMENT)
      for (let i = 0; i < 13; i++) {
        app.keys.onKeyDown({key: ']'})
      }
      expect(app.permalink()).toContain(';sm=6.5')
      for (let i = 0; i < 13; i++) {
        app.keys.onKeyDown({key: '['})
      }
      expect(Object.is(app.ui.starMagnitudeOffset(), 0)).toBe(true)
      expect(app.permalink()).not.toContain(';sm=')
      clearTimeout(app._permalinkTimer)
    })

    it('is in the link as sm=, the view restores it, and a link without one sets it back to 0', async () => {
      const app = await open(TEST_FRAGMENT)
      app.stepStarMagnitude(-3)
      const link = app.permalink()
      expect(link).toContain(';sm=-1.5')
      const reloaded = await open(link)
      expect(reloaded.ui.starMagnitudeOffset()).toBe(-1.5)
      const cleared = await open(TEST_FRAGMENT)
      expect(cleared.ui.starMagnitudeOffset()).toBe(0)
      clearTimeout(app._permalinkTimer)
    })
  })

  describe('the clock in the link', () => {
    it('a running clock at real time adds no token', async () => {
      const app = await open(TEST_FRAGMENT)
      expect(app.permalink()).not.toContain('time:')
      clearTimeout(app._permalinkTimer)
    })

    it('a paused clock reloads paused at its date, and resumes on unpausing', async () => {
      const app = await open(TEST_FRAGMENT)
      app.time.setPaused(true)
      const link = app.permalink()
      expect(link).toContain(';time:pause')
      expect(link).not.toContain('rate=')
      const heard = []
      const reloaded = await open(link, (paused) => heard.push(paused))
      expect(reloaded.time.isPaused).toBe(true)
      expect(heard.at(-1)).toBe(true)
      const jd = reloaded.time.simTimeJulianDay()
      await new Promise((resolve) => setTimeout(resolve, 30))
      reloaded.time.updateTime()
      expect(reloaded.time.simTimeJulianDay()).toBe(jd)
      expect(Math.abs((jd - 2451545.0) - PL.d2000)).toBeLessThan(1e-3)
      reloaded.time.togglePause()
      expect(reloaded.time.isPaused).toBe(false)
      clearTimeout(app._permalinkTimer)
    })

    it('the rate is in the link, paused or not, and a paused clock keeps it to resume at', async () => {
      const app = await open(TEST_FRAGMENT)
      app.keys.onKeyDown({key: 'l'})
      app.keys.onKeyDown({key: 'l'})
      app.keys.onKeyDown({key: 'l'})
      expect(app.permalink()).toContain(';time:rate=8')
      app.time.setPaused(true)
      const link = app.permalink()
      expect(link).toContain(';time:pause,rate=8')
      const reloaded = await open(link)
      expect(reloaded.time.isPaused).toBe(true)
      expect(reloaded.time.timeScale).toBe(8)
      expect(reloaded.time.timeScaleSteps).toBe(3)
      reloaded.time.togglePause()
      expect(reloaded.time.timeScale).toBe(8)
      // And backwards.
      app.time.setPaused(false)
      app.keys.onKeyDown({key: 'j'})
      expect(app.permalink()).toContain(';time:rate=-8')
      const back = await open(app.permalink())
      expect(back.time.isPaused).toBe(false)
      expect(back.time.timeScale).toBe(-8)
      clearTimeout(app._permalinkTimer)
    })

    it('a link without the token runs at real time, whatever the clock was doing', async () => {
      const app = await open(TEST_FRAGMENT)
      app.time.setPaused(true)
      app.time.setRate(4)
      const link = TEST_FRAGMENT
      app._restoreClock(decodePermalink(link))
      expect(app.time.isPaused).toBe(false)
      expect(app.time.timeScale).toBe(1)
      clearTimeout(app._permalinkTimer)
    })

    it('pausing, a rate and a date set each schedule the link', async () => {
      const app = await open(TEST_FRAGMENT)
      let scheduled = 0
      app._schedulePermalinkUpdate = () => scheduled++
      app.time.togglePause()
      app.time.changeTimeScale(1)
      app.time.setTime(app.time.simTime + 1000)
      expect(scheduled).toBe(3)
    })
  })

  describe('following in the link', () => {
    /**
     * @param {object} app
     * @returns {object} The camera platform's parent's name
     */
    const frameOf = (app) => app.ui.camera.platform.parent?.name

    it('is on on arrival, written as F, and "f" leaves the body for its frame', async () => {
      // The link's frame is Earth, the target Earth, and it has no F: it
      // rode Earth before there was an F, and does.
      const app = await open(TEST_FRAGMENT)
      const {sun, earth} = app.scene.objects
      expect(Shared.targets.follow).toBe(earth.orbitPosition)
      expect(app.keys.toggleStates['f']()).toBe(true)
      expect(app.permalink()).toMatch(/;s=[^;]*F/)
      expect(app.permalink()).not.toMatch(/;from=/)
      app.keys.onKeyDown({key: 'f'})
      expect(Shared.targets.follow).toBeNull()
      expect(app.keys.toggleStates['f']()).toBe(false)
      // The camera is in the Sun's frame now, and the link says so.
      expect(app.ui.camera.platform.parent).toBe(sun.orbitPosition)
      expect(Shared.targets.cur).toBe(sun)
      expect(app.permalink()).not.toMatch(/;s=[^;]*F/)
      expect(app.permalink()).toMatch(/;from=sun;/)
      clearTimeout(app._permalinkTimer)
    })

    it('a link made detached reloads detached, and "f" rides the target again', async () => {
      const app = await open(TEST_FRAGMENT)
      app.keys.onKeyDown({key: 'f'})
      const link = app.permalink()
      const pose = viewFromEarth(app)
      const reloaded = await open(link)
      expect(Shared.targets.follow).toBeNull()
      expect(frameOf(reloaded)).toBe(reloaded.scene.objects.sun.orbitPosition.name)
      expect(Shared.targets.obj).toBe(reloaded.scene.objects.earth)
      const again = viewFromEarth(reloaded)
      expect(again.pos.distanceTo(pose.pos)).toBeLessThan(5e5) // the link's four decimals of a degree, at 1 AU
      reloaded.keys.onKeyDown({key: 'f'})
      expect(Shared.targets.follow).toBe(reloaded.scene.objects.earth.orbitPosition)
      expect(reloaded.ui.camera.platform.parent).toBe(reloaded.scene.objects.earth.orbitPosition)
      // Riding again, in the link's frame.
      expect(reloaded.permalink()).toMatch(/;s=[^;]*F/)
      expect(reloaded.permalink()).not.toMatch(/;from=/)
      clearTimeout(app._permalinkTimer)
      clearTimeout(reloaded._permalinkTimer)
    })

    it('F is of the link\'s frame: with it that body is followed, without it, in another body\'s frame, nothing', async () => {
      const link = (settings) => encodePermalink('sun/earth', PL.d2000, 0, 0, 1.5e12, PL.quat, PL.fov, settings, undefined, 'sun')
      const withF = await open(link({...SETTINGS_DEFAULTS, F: true}))
      expect(Shared.targets.follow).toBe(withF.scene.objects.sun.orbitPosition)
      const without = await open(link({...SETTINGS_DEFAULTS}))
      expect(Shared.targets.follow).toBeNull()
      expect(Shared.targets.obj).toBe(without.scene.objects.earth)
      expect(without.ui.camera.platform.parent).toBe(without.scene.objects.sun.orbitPosition)
      clearTimeout(withF._permalinkTimer)
      clearTimeout(without._permalinkTimer)
    })

    it('a link made before F, in the target\'s own frame, rides it', async () => {
      const app = await open(TEST_FRAGMENT)
      expect(app.permalink()).not.toMatch(/;from=/)
      // TEST_FRAGMENT has no s= at all.
      expect(TEST_FRAGMENT).not.toMatch(/;s=/)
      expect(Shared.targets.follow).toBe(app.scene.objects.earth.orbitPosition)
      clearTimeout(app._permalinkTimer)
    })

    it('is independent of tracking, and a change schedules the link', async () => {
      const app = await open(TEST_FRAGMENT)
      let scheduled = 0
      app._schedulePermalinkUpdate = () => scheduled++
      app.keys.onKeyDown({key: 'f'})
      expect(scheduled).toBe(1)
      expect(Shared.targets.track).toBe(false)
      app.keys.onKeyDown({key: 't'})
      expect(Shared.targets.follow).toBeNull()
      expect(Shared.targets.track).toBe(true)
      app.keys.onKeyDown({key: 'f'})
      expect(Shared.targets.follow).not.toBeNull()
      expect(app.permalink()).toMatch(/;s=[^;]*T[^;]*F|;s=[^;]*F[^;]*T/)
      app.keys.onKeyDown({key: 't'})
    })

    it('stays off with no body to follow, and the link says so', async () => {
      const app = await open(TEST_FRAGMENT)
      app.keys.onKeyDown({key: 'f'})
      const obj = Shared.targets.obj
      Shared.targets.obj = null
      const err = console.error
      console.error = () => {}
      try {
        app.scene.setFollowing(true)
      } finally {
        console.error = err
        Shared.targets.obj = obj
      }
      expect(Shared.targets.follow).toBeNull()
      expect(app.permalink()).not.toMatch(/;s=[^;]*F/)
      clearTimeout(app._permalinkTimer)
    })

    it('"f" leaves the body in the animation callback and the body moves away; "f" rides it again', async () => {
      const app = await open(TEST_FRAGMENT)
      app.animation.animate = () => {} // the test moves the bodies itself
      const {earth} = app.scene.objects
      const camera = app.ui.camera
      const worldPos = (node) => node.getWorldPosition(new Vector3())
      const frame = (angle) => {
        earth.orbitPosition.position.applyAxisAngle(new Vector3(0, 1, 0), angle)
        app.ui.animCb(app.ui.scene)
        app.ui.scene.updateMatrixWorld()
      }
      const quat = camera.getWorldQuaternion(new Quaternion())
      // Arrived: riding Earth.
      app.ui.scene.updateMatrixWorld()
      const offset = worldPos(camera).sub(worldPos(earth))
      for (let step = 0; step < 5; step++) {
        frame(0.2)
        expect(worldPos(camera).sub(worldPos(earth)).distanceTo(offset)).toBeLessThan(1e-3)
      }
      // Off: the camera stays where it is, and Earth moves away.
      app.keys.onKeyDown({key: 'f'})
      app.ui.animCb(app.ui.scene)
      app.ui.scene.updateMatrixWorld()
      const at = worldPos(camera)
      const left = worldPos(earth)
      for (let step = 0; step < 5; step++) {
        frame(0.2)
        expect(worldPos(camera).distanceTo(at)).toBeLessThan(1e-3)
      }
      expect(worldPos(earth).distanceTo(left)).toBeGreaterThan(1e9)
      // On again: rides from where it is now, keeping its offset from Earth.
      const away = worldPos(camera).sub(worldPos(earth))
      app.keys.onKeyDown({key: 'f'})
      for (let step = 0; step < 5; step++) {
        frame(0.2)
        expect(worldPos(camera).sub(worldPos(earth)).distanceTo(away)).toBeLessThan(1e-3)
      }
      expect(camera.getWorldQuaternion(new Quaternion()).angleTo(quat)).toBeLessThan(1e-12)
      clearTimeout(app._permalinkTimer)
    })

    it('shows on the readout, as the other keys do, and in Settings as a checkbox', async () => {
      const app = await open(TEST_FRAGMENT)
      const shown = []
      const stop = app.onNavMode((mode, on, note) => shown.push(formatNavMode(mode, on, note)))
      app.keys.onKeyDown({key: 'f'})
      app.keys.onKeyDown({key: 't'})
      expect(app.keys.toggleStates['f']()).toBe(false)
      expect(app.keys.toggleStates['t']()).toBe(true)
      app.keys.onKeyDown({key: 'f'})
      app.keys.onKeyDown({key: 't'})
      expect(app.keys.toggleStates['f']()).toBe(true)
      expect(app.keys.toggleStates['t']()).toBe(false)
      expect(shown).toEqual(['Following off', 'Tracking on', 'Following on', 'Tracking off'])
      stop()
      app.keys.onKeyDown({key: 'f'})
      expect(shown.length).toBe(4)
      clearTimeout(app._permalinkTimer)
    })

    it('says nothing of following while a link is put back, unless the link doesn\'t follow', async () => {
      const heard = []
      const listen = (mode, on) => heard.push([mode, on])
      const detached = encodePermalink('sun/earth', PL.d2000, 0, 0, 1.5e12, PL.quat, PL.fov, SETTINGS_DEFAULTS, undefined, 'sun')
      await open(TEST_FRAGMENT, () => {}, listen)
      expect(heard).toEqual([])
      await open(detached, () => {}, listen)
      expect(heard).toEqual([['follow', false]])
    })
  })

  describe('tracking in the link', () => {
    it('is the T setting, on after \'t\', and a link restores it', async () => {
      const app = await open(TEST_FRAGMENT)
      expect(app.permalink()).not.toMatch(/;s=[^;]*T/)
      app.keys.onKeyDown({key: 't'})
      expect(app.permalink()).toMatch(/;s=[^;]*T/)
      const link = app.permalink()
      app.keys.onKeyDown({key: 't'})
      expect(Shared.targets.track).toBe(false)
      const reloaded = await open(link)
      expect(Shared.targets.track).toBe(true)
      const off = await open(TEST_FRAGMENT)
      expect(Shared.targets.track).toBe(false)
      expect(off).toBeDefined()
      expect(reloaded).toBeDefined()
      clearTimeout(app._permalinkTimer)
    })
  })
})
