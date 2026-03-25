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
import {beforeAll, describe, expect, it, mock} from 'bun:test'
import {readFileSync} from 'fs'
import {Object3D, PerspectiveCamera, Quaternion, Scene, Vector3} from 'three'
import {encodePermalink} from './permalink.js'
import {worldToLatLngAlt} from './coords.js'
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
  }
  configLargeScene() {}
  setFov(fov) {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    this.onCameraChange?.()
  }
  addClickCb() {}
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
mock.module('./Keys', () => ({
  default: class {
    constructor() {
      this.msgs = {}
    }
    map() {}
  },
}))
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
        () => ({}), // useStore
        canvasContainer,
        {}, // navElt
        () => {}, // setTimeStr
        () => {}, // setIsPaused
    )

    // Loader fires synchronously so onDone is already called.
    // The restore runs in setTimeout(fn, 0) — wait for it.
    await new Promise((resolve) => setTimeout(resolve, 50))
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

  it('restores camera orientation (quaternion)', () => {
    const q = app.camera.quaternion
    expect(q.x).toBeCloseTo(PL.quat.x, 3)
    expect(q.y).toBeCloseTo(PL.quat.y, 3)
    expect(q.z).toBeCloseTo(PL.quat.z, 3)
    expect(q.w).toBeCloseTo(PL.quat.w, 3)
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
})
