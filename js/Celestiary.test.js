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
import {encodePermalink} from './permalink.js'
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
