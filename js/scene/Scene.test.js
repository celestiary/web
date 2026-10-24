import {describe, expect, it} from 'bun:test'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {Object3D, PerspectiveCamera, Quaternion, Scene as ThreeScene, Vector3} from 'three'
import {SETTINGS_DEFAULTS} from '../permalink.js'
import * as Shared from '../shared.js'
import bltData from '../../public/data/blt.json'
import periodicData from '../../public/data/periodicOrbits.json'

// SpriteSheet (used by Scene._setTempMarker) reaches for document.* —
// stub the canvas APIs it touches.  Same pattern as Places.test.js.
global.document = global.document ?? {
  createElement: () => ({
    setAttribute: () => {},
    getContext: () => ({
      fillStyle: '',
      font: '',
      textBaseline: '',
      fillRect: () => {},
      fill: () => {},
      fillText: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      measureText: () => ({width: 100, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2}),
    }),
    width: 0,
    height: 0,
  }),
  body: {appendChild: () => {}},
}

const Scene = (await import('./Scene.js')).default
const {formatLatLng} = await import('./Scene.js')


function makeScene() {
  const ui = {
    scene: new ThreeScene(),
    addClickCb: () => {},
  }
  return new Scene(ui)
}


/**
 * Build a Scene with a fake camera/platform plus a fake "earth" body
 * registered as a rotating Object3D under the world.  Mirrors the
 * structure Planet.newPlanet creates: scene.objects[name] = the rotating
 * planet Object3D, with .props.radius.scalar set.
 */
function makeSceneWithEarth() {
  const scene = new ThreeScene()
  const camera = new PerspectiveCamera(45, 1, 1, 1e12)
  camera.platform = new Object3D()
  camera.platform.name = 'CameraPlatform'
  camera.platform.add(camera)
  scene.add(camera.platform)

  const earth = new Object3D()
  earth.name = 'earth'
  earth.props = {name: 'earth', radius: {scalar: 6.371e6}}
  scene.add(earth)

  const stateBag = {dragMode: 'orbit', landed: false}
  const useStore = {
    getState: () => ({
      setCommittedPath: () => {},
      setDragMode: (m) => {
        stateBag.dragMode = m
      },
      setLanded: (v) => {
        stateBag.landed = v
      },
      dragMode: stateBag.dragMode,
      landed: stateBag.landed,
    }),
  }

  const ui = {
    scene, camera, useStore,
    addClickCb: () => {},
  }
  const s = new Scene(ui)
  s.objects['earth'] = earth
  return {scene: s, ui, earth, camera, stateBag}
}


// Several toggle methods reach into scene.objects['sun'] / scene.stars; the
// tests below wire up the smallest possible fakes that the toggle paths
// actually touch (a label-LOD child for togglePlanetLabels, an LOD with a
// boolean .visible for toggleStarLabels, etc).  fakeStars also satisfies
// the contract toggleAsterisms expects: onCatalogReady never fires in
// these tests, so asterisms construction is deferred forever — perfect for
// exercising the bookkeeping (_asterismsPending, _settings.a flip) without
// actually building Three.js geometry.
function fakeStars() {
  return {
    labelLOD: {visible: false},
    onCatalogReady: () => {},
    add: () => {},
  }
}
function fakeSunWithLabelLOD() {
  // visitToggleProperty walks children searching for an object with
  // name='label LOD' and toggles the boolean .visible.  The fake mirrors
  // that contract.
  return {
    children: [{name: 'label LOD', visible: true}],
  }
}
function fakeSunWithOrbit() {
  return {
    children: [{name: 'orbit', visible: true}],
  }
}


describe('Scene._pathFor', () => {
  it('returns just [name] for milkyway root', () => {
    const s = makeScene()
    expect(s._pathFor('milkyway')).toEqual(['milkyway'])
  })

  it('builds a single-element path for sun', () => {
    const s = makeScene()
    s.objects['sun'] = {props: {parent: 'milkyway'}}
    expect(s._pathFor('sun')).toEqual(['sun'])
  })

  it('walks parent chain for a planet', () => {
    const s = makeScene()
    s.objects['sun'] = {props: {parent: 'milkyway'}}
    s.objects['earth'] = {props: {parent: 'sun'}}
    expect(s._pathFor('earth')).toEqual(['sun', 'earth'])
  })

  it('walks parent chain for a moon', () => {
    const s = makeScene()
    s.objects['sun'] = {props: {parent: 'milkyway'}}
    s.objects['earth'] = {props: {parent: 'sun'}}
    s.objects['moon'] = {props: {parent: 'earth'}}
    expect(s._pathFor('moon')).toEqual(['sun', 'earth', 'moon'])
  })

  it('stops walking if parent is not in objects (e.g., milkyway → universe)', () => {
    const s = makeScene()
    // milkyway.parent='universe' which isn't loaded — loop terminates there
    s.objects['sun'] = {props: {parent: 'milkyway'}}
    expect(s._pathFor('sun')).toEqual(['sun'])
  })

  it('returns empty for unknown target (no crash)', () => {
    const s = makeScene()
    expect(s._pathFor('unknown')).toEqual([])
  })

  it('handles a parent-chain cycle without looping forever', () => {
    // Defensive: two entries pointing at each other shouldn't spin.
    const s = makeScene()
    s.objects['a'] = {props: {parent: 'b'}}
    s.objects['b'] = {props: {parent: 'a'}}
    const path = s._pathFor('a')
    expect(path.length).toBeLessThanOrEqual(2)
  })
})


describe('Scene settings tracking', () => {
  it('initial _settings reflects the runtime state, not the SETTINGS_DEFAULTS', () => {
    // The default table is "what the user expects after firstTime" — but
    // _settings starts from the constructor-fresh state (asterisms not yet
    // built, star labels hidden, etc).  These intentionally differ for the
    // a/l keys.
    const s = makeScene()
    expect(s.getSettings().a).toBe(false)
    expect(s.getSettings().l).toBe(false)
    expect(s.getSettings().p).toBe(true)
    expect(s.getSettings().o).toBe(true)
    expect(s.getSettings().e).toBe(false)
    expect(s.getSettings().c).toBe(false)
    expect(s.getSettings().g).toBe(false)
    expect(s.getSettings().v).toBe(true)
  })

  it('every key in SETTINGS_DEFAULTS has a slot in Scene._settings', () => {
    const s = makeScene()
    const have = s.getSettings()
    for (const key of Object.keys(SETTINGS_DEFAULTS)) {
      expect(have).toHaveProperty(key)
    }
  })

  it('expansion lines follow the x setting, before and after they exist', () => {
    const s = makeScene()
    expect(s.getColonization()).toBeNull() // no stars yet
    s.stars = fakeStars()
    let fired = 0
    s.onSettingsChange = () => fired++
    s.toggleColonization()
    expect(s.getSettings().x).toBe(false)
    expect(fired).toBe(1)
    s.overlays.finish()
    const lines = s.getColonization()
    expect(lines.visible).toBe(false)
    expect(s.getColonization()).toBe(lines)
    s.applySettings({x: true})
    expect(lines.visible).toBe(true)
  })

  it('removeColonization takes the lines out, and a later use builds new ones', () => {
    const s = makeScene()
    s.stars = new Object3D()
    const lines = s.getColonization()
    expect(lines.parent).toBe(s.stars)
    s.removeColonization()
    expect(s.colonization).toBeNull()
    expect(lines.parent).toBeNull()
    s.removeColonization() // idempotent
    expect(s.getColonization()).not.toBe(lines)
  })

  it('toggleColonization mirrors x into the store, for the drawer\'s switch', () => {
    const s = makeScene()
    const states = []
    s.ui.useStore = {setState: (st) => states.push(st)}
    s.toggleColonization()
    s.toggleColonization()
    expect(states).toEqual([{isColonizationVisible: false}, {isColonizationVisible: true}])
  })

  it('toggleStarLabels flips the l flag and notifies onSettingsChange', () => {
    const s = makeScene()
    s.stars = fakeStars()
    let fired = 0
    s.onSettingsChange = () => fired++
    s.toggleStarLabels()
    expect(s.getSettings().l).toBe(true)
    expect(s.stars.labelLOD.visible).toBe(true)
    expect(fired).toBe(1)
  })

  it('toggleStarLabels before the stars exist sets l, and the stars take it when they come', () => {
    // Settings are decided before the scene is built (initSettings), so a
    // toggle needn't wait for what it shows.
    const s = makeScene()
    let fired = 0
    s.onSettingsChange = () => fired++
    s.toggleStarLabels()
    expect(s.getSettings().l).toBe(true)
    expect(fired).toBe(1)
    expect(s.overlayShown('l')).toBe(true)
  })

  it('toggleOrbits flips o, and the attached orbits fade out, hidden once faded', () => {
    const s = makeScene()
    s.objects['sun'] = fakeSunWithOrbit()
    s.toggleOrbits()
    expect(s.getSettings().o).toBe(false)
    // Fading: still drawn, at falling opacity.
    expect(s.objects['sun'].children[0].visible).toBe(true)
    s.overlays.tick(0)
    s.overlays.tick(200)
    expect(s.fades.o.opacity).toBeGreaterThan(0)
    expect(s.fades.o.opacity).toBeLessThan(1)
    expect(s.objects['sun'].children[0].visible).toBe(true)
    s.overlays.tick(1000)
    expect(s.fades.o.opacity).toBe(0)
    expect(s.orbitsVisible).toBe(false)
    expect(s.objects['sun'].children[0].visible).toBe(false)
    expect(s.overlays.moving).toBe(false)
  })

  it('togglePlanetLabels flips p and fades the attached planet label LODs', () => {
    const s = makeScene()
    s.objects['sun'] = fakeSunWithLabelLOD()
    s.togglePlanetLabels()
    expect(s.getSettings().p).toBe(false)
    s.overlays.finish()
    expect(s.objects['sun'].children[0].visible).toBe(false)
    // On: drawn from the first frame of the fade in.
    s.togglePlanetLabels()
    expect(s.objects['sun'].children[0].visible).toBe(true)
    expect(s.fades.p.opacity).toBe(0)
  })

  it('togglePlanetLabels also flips surface place groups (planet+place labels share the p group)', () => {
    // Surface places (cities, craters, landing sites) belong to the same
    // 'p' overlay group as planet name labels.  Planet.newPlanet stashes
    // the Places ref on the rotating planet Object3D as `.places`, and
    // togglePlanetLabels walks scene.objects to flip those alongside the
    // 'label LOD' visit.  See DESIGN.md "Overlays & visibility groups".
    const s = makeScene()
    s.objects['sun'] = fakeSunWithLabelLOD()
    s.objects['earth'] = {places: {visible: true}}
    s.togglePlanetLabels()
    s.overlays.finish()
    expect(s.objects['earth'].places.visible).toBe(false)
    s.togglePlanetLabels()
    expect(s.objects['earth'].places.visible).toBe(true)
  })

  it('toggleGridEquatorial / Ecliptic / Galactic flip e / c / g respectively', () => {
    const s = makeScene()
    s.toggleGridEquatorial()
    s.toggleGridEcliptic()
    s.toggleGridGalactic()
    expect(s.getSettings().e).toBe(true)
    expect(s.getSettings().c).toBe(true)
    expect(s.getSettings().g).toBe(true)
    expect(s.grids.equatorial.visible).toBe(true)
    expect(s.grids.ecliptic.visible).toBe(true)
    expect(s.grids.galactic.visible).toBe(true)
  })
})


describe('Scene.applySettings', () => {
  it('runs each toggle whose requested value differs from current', () => {
    const s = makeScene()
    s.stars = fakeStars()
    s.objects['sun'] = {children: [
      {name: 'label LOD', visible: true},
      {name: 'orbit', visible: true},
    ]}
    s.applySettings({...SETTINGS_DEFAULTS, l: true, o: false})
    expect(s.getSettings().l).toBe(true)
    expect(s.getSettings().o).toBe(false)
    expect(s.stars.labelLOD.visible).toBe(true)
    s.overlays.finish()
    expect(s.objects['sun'].children[1].visible).toBe(false)
  })

  it('is idempotent — re-applying the same state is a no-op', () => {
    const s = makeScene()
    s.stars = fakeStars()
    s.applySettings({...SETTINGS_DEFAULTS, l: true})
    expect(s.stars.labelLOD.visible).toBe(true)
    let fired = 0
    s.onSettingsChange = () => fired++
    s.applySettings({...SETTINGS_DEFAULTS, l: true})
    expect(fired).toBe(0)
  })

  it('applies at once, without waiting for the stars, which take their settings when they come', () => {
    // It used to wait for the stars, drawing the default overlays meanwhile:
    // a link's hidden orbits showed, then went.
    const s = makeScene()
    s.objects['sun'] = {children: [{name: 'orbit', visible: true}]}
    s.applySettings({...SETTINGS_DEFAULTS, o: false}) // stars not yet set
    expect(s.getSettings().o).toBe(false)
    expect(s.getSettings().l).toBe(true)
    s.overlays.finish()
    expect(s.objects['sun'].children[0].visible).toBe(false)
  })

  it('dispatches custom appliers registered via registerSettingApplier', () => {
    const s = makeScene()
    s.stars = fakeStars()
    let called = 0
    s.registerSettingApplier('v', () => {
      called++
      s.flipSetting('v')
    })
    s.applySettings({...SETTINGS_DEFAULTS, v: false}) // current true → toggle
    expect(called).toBe(1)
    expect(s.getSettings().v).toBe(false)
  })

  it('round-trips a full settings map through getSettings → applySettings', () => {
    const s = makeScene()
    s.stars = fakeStars()
    s.objects['sun'] = {children: [
      {name: 'label LOD', visible: true},
      {name: 'orbit', visible: true},
    ]}
    // Add a fake MilkyWay so toggleGalaxy() finds it during dispatch.
    const milkyWay = new Object3D()
    milkyWay.name = 'MilkyWay'
    s.ui.scene.add(milkyWay)
    const target = {a: false, l: true, p: false, o: false, e: true, c: true, g: true, U: false, G: true, C: true, x: false,
      S: false, I: false, D: false, v: false}
    s.registerSettingApplier('v', () => s.flipSetting('v'))
    s.applySettings(target)
    s.overlays.finish()
    // L isn't in `target` but is added to getSettings by reading
    // Shared.targets.landed; pin it to the default (false) for this test.
    // A is also merged in by getSettings (default false for this Scene-
    // level snapshot — the live AR state is folded in at the permalink
    // writer in Celestiary, not here).
    Shared.targets.follow = null // going (a test elsewhere) turns it on
    expect(s.getSettings()).toEqual({...target, L: false, A: false, T: false, F: false})
    expect(milkyWay.visible).toBe(false)
  })
})


describe('Scene.onStarsReady', () => {
  it('fires synchronously when stars is already set', () => {
    const s = makeScene()
    s.stars = fakeStars()
    let fired = false
    s.onStarsReady(() => {
      fired = true
    })
    expect(fired).toBe(true)
  })

  it('queues callbacks until _markStarsReady is called', () => {
    const s = makeScene()
    let fired = 0
    s.onStarsReady(() => fired++)
    s.onStarsReady(() => fired++)
    expect(fired).toBe(0)
    s.stars = fakeStars()
    s._markStarsReady()
    expect(fired).toBe(2)
  })

  it('_markStarsReady is a no-op when no callbacks are queued', () => {
    const s = makeScene()
    expect(() => s._markStarsReady()).not.toThrow()
  })
})


describe('Scene.land', () => {
  it('reparents the camera platform to the rotating body', () => {
    const {scene, earth, camera, ui} = makeSceneWithEarth()
    expect(camera.platform.parent).toBe(ui.scene)
    scene.land('earth', 0, 0, 0, {instant: true})
    expect(camera.platform.parent).toBe(earth)
  })

  it('places the camera at body-fixed XYZ for (lat, lng, alt) — instant', () => {
    const {scene, camera} = makeSceneWithEarth()
    const r = 6.371e6
    scene.land('earth', 0, 0, 0, {instant: true})
    // lat=0, lng=0 → +X body-fixed (prime meridian, texture u=0.5)
    expect(camera.position.x).toBeCloseTo(r, 0)
    expect(camera.position.y).toBeCloseTo(0, 0)
    expect(camera.position.z).toBeCloseTo(0, 0)
  })

  it('lat=90 lands on the north pole (+Y)', () => {
    const {scene, camera} = makeSceneWithEarth()
    const r = 6.371e6
    scene.land('earth', 90, 0, 100, {instant: true})
    expect(camera.position.y).toBeCloseTo(r + 100, 0)
  })

  it('sets drag mode to pan: on the surface a drag looks around', () => {
    const {scene, stateBag} = makeSceneWithEarth()
    scene.land('earth', 0, 0, 0, {instant: true})
    expect(stateBag.dragMode).toBe('pan')
  })

  it('marks landed=true in store and Shared.targets', () => {
    const {scene, stateBag} = makeSceneWithEarth()
    Shared.targets.landed = false
    scene.land('earth', 0, 0, 0, {instant: true})
    expect(stateBag.landed).toBe(true)
    expect(Shared.targets.landed).toBe(true)
  })

  it('throws on unknown body', () => {
    const {scene} = makeSceneWithEarth()
    expect(() => scene.land('nonsense', 0, 0)).toThrow(/no body/)
  })

  it('throws when body lacks a radius', () => {
    const {scene} = makeSceneWithEarth()
    scene.objects['noradius'] = {props: {name: 'noradius'}}
    expect(() => scene.land('noradius', 0, 0)).toThrow(/radius/)
  })

  it('round-trips into the same body-fixed XYZ via worldToLatLngAlt', async () => {
    // Recovers the lat/lng/alt by reading the camera's world position back
    // through the world→body-fixed transform — proves the storage chain
    // (orbit → planetTilt → planet local) is consistent end-to-end.
    const {scene, earth, camera, ui} = makeSceneWithEarth()
    const lat = -33.8688
    const lng = 151.2093
    const alt = 50
    scene.land('earth', lat, lng, alt, {instant: true})
    ui.scene.updateMatrixWorld(true)

    const camWorld = new Vector3()
    camera.getWorldPosition(camWorld)
    const earthWorld = new Vector3()
    earth.getWorldPosition(earthWorld)
    const earthQuat = new Quaternion()
    earth.getWorldQuaternion(earthQuat)

    const {worldToLatLngAlt} = await import('../coords.js')
    const back = worldToLatLngAlt(camWorld, earthWorld, earthQuat, earth.props.radius.scalar)
    expect(back.lat).toBeCloseTo(lat, 4)
    expect(back.lng).toBeCloseTo(lng, 4)
    expect(back.alt).toBeCloseTo(alt, 1)
  })
})


/**
 * Scene's AR mode hooks: enterAR snapshots prior settings + the ThreeUI
 * `_arMode` flag, applies the AR preset, and returns the snapshot for
 * exitAR to restore.  These tests exercise the bookkeeping; the actual
 * scene-graph effects (asterism visibility, atmosphere uniform) are
 * covered by their respective subsystem tests.
 */
describe('Scene.enterAR / exitAR', () => {
  function makeArScene() {
    const ui = {
      scene: new ThreeScene(),
      addClickCb: () => {},
    }
    const s = new Scene(ui)
    // Stand-in stars so applySettings doesn't defer.
    s.stars = {
      labelLOD: {visible: false},
      onCatalogReady: () => {},
      add: () => {},
    }
    // applySettings dispatches to toggleOrbits / togglePlanetLabels which
    // walk the 'sun' Object3D — give it a children-bearing fake with both
    // 'orbit' and 'label LOD' so both toggles can do their walk in one
    // pass without throwing.
    s.objects['sun'] = {
      children: [
        {name: 'orbit', visible: true},
        {name: 'label LOD', visible: true},
      ],
    }
    return {scene: s, ui}
  }

  it('flips ui._arMode true on enter, restores on exit', () => {
    const {scene, ui} = makeArScene()
    expect(ui._arMode).toBeFalsy()
    const snap = scene.enterAR()
    expect(ui._arMode).toBe(true)
    scene.exitAR(snap)
    expect(ui._arMode).toBeFalsy()
  })

  it('returns a snapshot containing prior settings and arMode', () => {
    const {scene} = makeArScene()
    const before = {...scene.getSettings()}
    const snap = scene.enterAR()
    expect(snap).toBeDefined()
    expect(snap.settings).toBeDefined()
    // Snapshot captures pre-enter values, not post-enter.
    expect(snap.settings.o).toBe(before.o)
    expect(snap.settings.p).toBe(before.p)
  })

  it('applies the AR preset (orbits off, grids off) on enter', () => {
    const {scene} = makeArScene()
    scene._settings.o = true // make sure orbits would actually flip
    scene.enterAR()
    expect(scene.getSetting('o')).toBe(false)
    expect(scene.getSetting('e')).toBe(false)
    expect(scene.getSetting('c')).toBe(false)
    expect(scene.getSetting('g')).toBe(false)
  })

  it('restores prior settings on exit', () => {
    const {scene} = makeArScene()
    // Set a non-trivial pre-enter state.
    scene._settings.o = true
    scene._settings.e = true
    scene._settings.p = false
    const snap = scene.enterAR()
    // Confirm the preset took effect.
    expect(scene.getSetting('o')).toBe(false)
    expect(scene.getSetting('e')).toBe(false)
    scene.exitAR(snap)
    expect(scene.getSetting('o')).toBe(true)
    expect(scene.getSetting('e')).toBe(true)
    expect(scene.getSetting('p')).toBe(false)
  })

  it('exitAR with null/undefined snapshot is a no-op', () => {
    const {scene} = makeArScene()
    expect(() => scene.exitAR(null)).not.toThrow()
    expect(() => scene.exitAR(undefined)).not.toThrow()
  })
})


describe('formatLatLng', () => {
  it('formats positive lat/lng as N/E with two decimals', () => {
    expect(formatLatLng(30.2672, 97.7431)).toBe('30.27°N, 97.74°E')
  })

  it('formats negative lat as S, negative lng as W', () => {
    expect(formatLatLng(-33.8688, -151.2093)).toBe('33.87°S, 151.21°W')
  })

  it('handles equator and prime meridian as N / E (sign convention: >= 0)', () => {
    expect(formatLatLng(0, 0)).toBe('0.00°N, 0.00°E')
  })

  it('handles mixed signs (Austin: N latitude, W longitude)', () => {
    expect(formatLatLng(30.2672, -97.7431)).toBe('30.27°N, 97.74°W')
  })
})


/**
 * Scene wires the ui.addDblClickCb when the ui supports it (the new
 * pointer-drag dblclick path).  These tests verify the constructor binding
 * and the per-call onDblClick early-out conditions without firing the
 * actual ray-sphere intersect (mocking the raycaster is out of scope —
 * Picker.test.js covers that).
 */
describe('Scene.onDblClick wiring', () => {
  it('registers a dblclick callback when ui exposes addDblClickCb', () => {
    let registered = null
    const ui = {
      scene: new ThreeScene(),
      addClickCb: () => {},
      addDblClickCb: (cb) => {
        registered = cb
      },
    }
    new Scene(ui)
    expect(typeof registered).toBe('function')
  })

  it('is graceful when ui has no addDblClickCb (back-compat)', () => {
    expect(() => makeScene()).not.toThrow()
  })

  it('onDblClick is a no-op when there is no current target', () => {
    const s = makeScene()
    Shared.targets.cur = null
    expect(() => s.onDblClick({clientX: 100, clientY: 100})).not.toThrow()
  })

  it('onDblClick is a no-op when current target has no radius', () => {
    const s = makeScene()
    Shared.targets.cur = {props: {name: 'noradius'}}
    expect(() => s.onDblClick({clientX: 100, clientY: 100})).not.toThrow()
  })

  it('onDblClick is a no-op when current target is a star (has spectralType)', () => {
    // Stars are excluded so dblclicking the Sun doesn't teleport the user
    // to its photosphere.  Mirrors landableBodyName in Celestiary.js.
    const s = makeScene()
    Shared.targets.cur = {
      props: {name: 'sun', radius: {scalar: 6.957e8}, spectralType: 'G2V'},
    }
    expect(() => s.onDblClick({clientX: 100, clientY: 100})).not.toThrow()
  })
})


/**
 * The temporary lat/lng marker is dropped at the dblclick spot.  These
 * tests build the marker directly via `_setTempMarker` (skipping the
 * raycast) to exercise the scene-graph attachment, the replace-on-second
 * call invariant, the 'p' overlay-group binding, and dispose cleanliness.
 */
describe('Scene._setTempMarker', () => {
  function makeWithEarth() {
    return makeSceneWithEarth()
  }

  it('attaches the marker as a child of the rotating body', () => {
    const {scene, earth} = makeWithEarth()
    scene._setTempMarker(earth, 30.27, -97.74)
    expect(earth._tempMarker).toBeDefined()
    expect(earth.children.includes(earth._tempMarker)).toBe(true)
  })

  it('replaces the prior marker on the next call', () => {
    const {scene, earth} = makeWithEarth()
    scene._setTempMarker(earth, 30.27, -97.74)
    const first = earth._tempMarker
    scene._setTempMarker(earth, 51.51, -0.13)
    const second = earth._tempMarker
    expect(second).not.toBe(first)
    expect(earth.children.includes(first)).toBe(false)
    expect(earth.children.includes(second)).toBe(true)
  })

  it('marker visibility tracks the "p" group at creation time', () => {
    const {scene, earth} = makeWithEarth()
    scene.initSettings({p: false})
    scene._setTempMarker(earth, 0, 0)
    expect(earth._tempMarker.visible).toBe(false)
    scene.initSettings({p: true})
    scene._setTempMarker(earth, 0, 0)
    expect(earth._tempMarker.visible).toBe(true)
  })

  it('stashes the SpriteSheet on userData so disposal can find it', () => {
    // The sheet ref is intended for the marker-replace path in
    // _setTempMarker, which calls _disposeTempMarker to free the prior
    // GPU resources.  We only check that the field exists — the sheet's
    // internal `positions` array isn't introspected because Celestiary
    // tests `mock.module('./scene/SpriteSheet')` process-globally, so a
    // direct assertion on sheet.positions would fail when tests run
    // together (the stub returns a plain Object3D from compile()).
    const {scene, earth} = makeWithEarth()
    scene._setTempMarker(earth, 0, 0)
    expect(earth._tempMarker.userData.sheet).toBeDefined()
  })

  it('uses the formatted lat/lng string as the label text', () => {
    const {scene, earth} = makeWithEarth()
    scene._setTempMarker(earth, 30.27, -97.74)
    // The label name lives in the marker group's name suffix.
    expect(earth._tempMarker.name).toBe('earth.tempMarker')
    expect(earth._tempMarker.userData.isTempMarker).toBe(true)
  })

  it('togglePlanetLabels flips the temp marker visibility along with named places', () => {
    const {scene, earth} = makeWithEarth()
    scene._setTempMarker(earth, 0, 0)
    expect(earth._tempMarker.visible).toBe(true)
    // togglePlanetLabels visits scene.objects['sun'] for the label-LOD walk;
    // make sure that doesn't crash by adding a minimal sun fake.
    scene.objects['sun'] = fakeSunWithLabelLOD()
    scene.togglePlanetLabels()
    scene.overlays.finish()
    expect(earth._tempMarker.visible).toBe(false)
    scene.togglePlanetLabels()
    expect(earth._tempMarker.visible).toBe(true)
  })

  it('_disposeTempMarker is safe when called on a body with no marker', () => {
    const {scene, earth} = makeWithEarth()
    expect(() => scene._disposeTempMarker(earth)).not.toThrow()
  })

  it('_disposeTempMarker removes the marker from the scene graph and clears the field', () => {
    const {scene, earth} = makeWithEarth()
    scene._setTempMarker(earth, 0, 0)
    const marker = earth._tempMarker
    scene._disposeTempMarker(earth)
    expect(earth._tempMarker).toBeNull()
    expect(earth.children.includes(marker)).toBe(false)
  })
})


describe('Scene stellar frame', () => {
  const LY = 9.4607304725808e15
  const star = {hipId: 32349, x: -1.613 * LY, y: -5.483 * LY, z: -6.428 * LY, radius: 1.2e9}


  /**
   * @param {Scene} s
   * @returns {Vector3} the star's world position, drawn through the frame
   */
  function starWorld(s) {
    s.ui.scene.updateMatrixWorld()
    return new Vector3(star.x, star.y, star.z).applyMatrix4(s.stellarFrame.matrixWorld)
  }


  it('parents the galaxy\'s catalogues to the stellar frame, and the Sun to worldGroup', () => {
    const {scene: s} = makeSceneWithEarth()
    s.newGalaxy({name: 'milkyway'})
    expect(s.objects['milkyway.orbitPosition']).toBe(s.stellarFrame)
    expect(s.stellarFrame.getObjectByName('MilkyWay')).toBeDefined()
    expect(s.stellarFrame.parent).toBe(s.objects['milkyway'])
  })


  it('goTo(star) rebases to where the frame draws the star, and keeps it there as the frame turns', () => {
    const {scene: s} = makeSceneWithEarth()
    const saved = {...Shared.targets}
    try {
      s.worldGroup.add(s.stellarFrame)
      s.stellarFrame.update(2461313.1)
      s.goTo(star)
      expect(starWorld(s).length()).toBeLessThan(1e3)
      // Year 2500: the frame turns ~6.7° about the Sun, and the star, 8.6 ly
      // out, would move ~1 ly.  The rebase follows it.
      s.stellarFrame.update(2634233.5)
      expect(starWorld(s).length()).toBeLessThan(1e3)
    } finally {
      Object.assign(Shared.targets, saved)
    }
  })


  it('goTo(galaxy) rebases to the galaxy, targets it, arrives at its view distance and zooms to its core', () => {
    const {scene: s} = makeSceneWithEarth()
    const saved = {...Shared.targets}
    try {
      s.worldGroup.add(s.stellarFrame)
      const MPC = 3.0857e22
      const galaxy = {isGalaxy: true, id: 'ngc2403', name: 'NGC 2403', x: 1.2 * MPC, y: 2.1 * MPC, z: -1.4 * MPC,
        radius: 2e18, viewDistance: 7e20}
      s.goTo(galaxy)
      s.ui.scene.updateMatrixWorld()
      expect(new Vector3(galaxy.x, galaxy.y, galaxy.z).applyMatrix4(s.stellarFrame.matrixWorld).length()).toBeLessThan(1e9)
      expect(s.getTarget()).toMatchObject({kind: 'galaxy', id: 'ngc2403', name: 'NGC 2403'})
      expect(s._catalogueStar).toBeFalsy()
      expect(s.galaxyHome().props.radius.scalar).toBe(galaxy.radius)
      // The travel ends viewDistance from it.
      const tween = Shared.targets.tween
      tween.update(tween._startTime + 1e7)
      expect(s.ui.camera.getWorldPosition(new Vector3).length() / galaxy.viewDistance).toBeCloseTo(1, 3)
    } finally {
      Object.assign(Shared.targets, saved)
    }
  })


  it('leaves worldGroup alone on a frame change once back at a planet', () => {
    const {scene: s, earth} = makeSceneWithEarth()
    const saved = {...Shared.targets}
    try {
      s.worldGroup.add(s.stellarFrame)
      s.goTo(star)
      earth.orbitPosition = new Object3D()
      Shared.targets.obj = earth
      s.goTo()
      expect(s.worldGroup.position.length()).toBe(0)
      s.stellarFrame.update(2634233.5)
      expect(s.worldGroup.position.length()).toBe(0)
    } finally {
      Object.assign(Shared.targets, saved)
    }
  })


  it('goTo(star) draws the star\'s disc where it is, one star at a time, for the meter and the zoom', () => {
    const {scene: s} = makeSceneWithEarth()
    const saved = {...Shared.targets}
    try {
      s.worldGroup.add(s.stellarFrame)
      s.goTo(star)
      const drawn = s._catalogueStar
      expect(drawn).toBeTruthy()
      expect(drawn.parent).toBe(s.stellarFrame)
      expect(drawn.props.type).toBe('star')
      expect(drawn.props.radius.scalar).toBe(star.radius)
      // Unlit: the Sun's light stays the Sun's.
      expect(drawn.children.some((c) => c.isLight)).toBe(false)
      // At the world's origin, where goTo rebased the star to.
      s.ui.scene.updateMatrixWorld()
      expect(drawn.getWorldPosition(new Vector3).length()).toBeLessThan(1e3)
      expect(Object.values(s.objects)).toContain(drawn)
      // Sirius is a measured star: its own temperature.
      expect(drawn.teff).toBe(9845)
      // Another star replaces it; the Sun (HIP 0) draws none of its own.
      const other = {...star, hipId: 70890, radius: 1.07e8}
      s.goTo(other)
      expect(drawn.parent).toBeNull()
      expect(Object.values(s.objects)).not.toContain(drawn)
      expect(s._catalogueStar.props.hipId).toBe(70890)
      expect(s.showCatalogueStar({...star, hipId: 0})).toBeNull()
    } finally {
      Object.assign(Shared.targets, saved)
    }
  })


  it('turns the galactic grid with the stars', () => {
    const {scene: s} = makeSceneWithEarth()
    const j2000 = s.grids.galactic.quaternion.clone()
    s.stellarFrame.update(2634233.5)
    const want = s.stellarFrame.quaternion.clone().multiply(j2000)
    expect(s.grids.galactic.quaternion.angleTo(want)).toBeLessThan(1e-12)
    expect(s.grids.ecliptic.quaternion.angleTo(new Quaternion)).toBe(0)
  })
})


describe('the overlays', () => {
  it('are on the overlay layer, every node of them, so the meter never sees them', async () => {
    const {OVERLAY_LAYER, overlay} = await import('../shared.js')
    const {Group, Mesh, Object3D: Node} = await import('three')
    const root = new Group()
    const child = new Mesh()
    const grandchild = new Node()
    child.add(grandchild)
    root.add(child)
    expect(overlay(root)).toBe(root)
    for (const node of [root, child, grandchild]) {
      expect(node.layers.mask).toBe(1 << OVERLAY_LAYER)
      expect(node.layers.isEnabled(0)).toBe(false)
    }
    // A built scene's grids are overlays.
    const s = makeScene()
    let nodes = 0
    s.grids.group.traverse((node) => {
      nodes++
      expect(node.layers.mask).toBe(1 << OVERLAY_LAYER)
    })
    expect(nodes).toBeGreaterThan(1)
  })
})


describe('the target star\'s label', () => {
  const star = {hipId: 46635, x: 1e18, y: 2e17, z: -3e17}

  it('is set when a star is targeted, and cleared when anything else is', () => {
    const s = makeScene()
    const seen = []
    s.stars = {...fakeStars(), setTargetStar: (st, name) => seen.push([st, name])}
    s.objects['earth'] = new Object3D()
    s.objects['earth'].props = {name: 'earth'}
    s.setTarget({kind: 'star', star, name: 'HIP 46635'}, {look: false})
    s.setTarget('earth', {look: false})
    expect(seen).toEqual([[star, 'HIP 46635'], [null, undefined]])
  })

  it('is left out for the Sun, which has its own label', () => {
    const s = makeScene()
    const seen = []
    s.stars = {...fakeStars(), setTargetStar: (st) => seen.push(st)}
    s.setTarget({kind: 'star', star: {hipId: 0, x: 0, y: 0, z: 0}, name: 'Sun'}, {look: false})
    expect(seen).toEqual([null])
  })
})


describe('Scene following', () => {
  const JUPITER_M = 7.78e11
  const MM = 1e-3

  /**
   * The Sun, Jupiter and Io as the app hangs them: each body node a
   * descendant of its `orbitPosition`, which the animation moves; Io's
   * under Jupiter's.  The camera platform is at the Sun, the camera 3e8 m
   * from Jupiter and turned to look off to one side, following nothing.
   */
  function makeSolarSystem() {
    const scene = new ThreeScene()
    const camera = new PerspectiveCamera(45, 1, 1, 1e12)
    camera.platform = new Object3D()
    camera.platform.name = 'CameraPlatform'
    camera.platform.add(camera)
    const ui = {scene, camera, addClickCb: () => {}}
    const s = new Scene(ui)
    const body = (name, parentName, parentNode) => {
      const orbitPosition = new Object3D()
      orbitPosition.name = `${name} orbitPosition`
      parentNode.add(orbitPosition)
      const node = new Object3D()
      node.name = name
      node.props = {name, parent: parentName, radius: {scalar: 1e6}}
      node.orbitPosition = orbitPosition
      orbitPosition.add(node)
      s.objects[name] = node
      return node
    }
    const sun = body('sun', undefined, s.worldGroup)
    const jupiter = body('jupiter', 'sun', sun.orbitPosition)
    const io = body('io', 'jupiter', jupiter.orbitPosition)
    jupiter.orbitPosition.position.set(JUPITER_M, 0, 0)
    io.orbitPosition.position.set(4.2e8, 0, 0)
    sun.orbitPosition.add(camera.platform)
    camera.position.set(JUPITER_M + 3e8, 1e8, -2e8)
    camera.quaternion.setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), 0.9)
    scene.updateMatrixWorld()
    Shared.targets.cur = sun
    Shared.targets.landed = false
    Shared.targets.tween = null
    Shared.targets.follow = null
    Shared.targets.label = null
    s.setTarget('jupiter', {look: false})
    return {s, ui, scene, camera, sun, jupiter, io}
  }

  /** @returns {Vector3} Where the camera is from the node, in the world's axes */
  const offsetFrom = (camera, node) =>
    camera.getWorldPosition(new Vector3).sub(node.getWorldPosition(new Vector3))

  /** One frame's animation: the body's orbit moves it. */
  const moveJupiter = (scene, jupiter, angle) => {
    jupiter.orbitPosition.position.set(JUPITER_M * Math.cos(angle), 0, -JUPITER_M * Math.sin(angle))
    scene.updateMatrixWorld()
  }

  /** @returns {object} The scene with the camera gone to Jupiter, tween done */
  function arrivedAtJupiter() {
    const sys = makeSolarSystem()
    sys.s.goTo()
    Shared.targets.tween = null
    sys.scene.updateMatrixWorld()
    return sys
  }

  it('rides the followed body: the camera keeps its offset and its orientation', () => {
    const {s, scene, camera, jupiter} = makeSolarSystem()
    const offset = offsetFrom(camera, jupiter)
    const quat = camera.getWorldQuaternion(new Quaternion)
    s.setFollowing(true)
    for (let i = 0; i <= 360; i++) {
      moveJupiter(scene, jupiter, i * Math.PI / 180 / 12)
      s.syncFollow()
      scene.updateMatrixWorld()
      expect(offsetFrom(camera, jupiter).distanceTo(offset)).toBeLessThan(MM)
    }
    expect(camera.getWorldQuaternion(new Quaternion).angleTo(quat)).toBeLessThan(1e-12)
    expect(camera.platform.parent).toBe(jupiter.orbitPosition)
  })

  it('leaves the camera behind when it is off', () => {
    const {s, scene, camera, jupiter} = makeSolarSystem()
    const offset = offsetFrom(camera, jupiter)
    moveJupiter(scene, jupiter, 0.3)
    s.syncFollow()
    scene.updateMatrixWorld()
    expect(offsetFrom(camera, jupiter).distanceTo(offset)).toBeGreaterThan(1e10)
  })

  it('still lets the user look around: a turn of the camera is kept', () => {
    const {s, scene, camera, jupiter} = makeSolarSystem()
    s.setFollowing(true)
    camera.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5))
    const quat = camera.quaternion.clone()
    moveJupiter(scene, jupiter, 0.2)
    s.syncFollow()
    expect(camera.quaternion.angleTo(quat)).toBe(0)
  })

  it('puts the camera back in its frame, where it is, when turned off after riding from there', () => {
    const {s, scene, camera, sun, jupiter} = makeSolarSystem()
    s.setFollowing(true)
    expect(Shared.targets.cur).toBe(jupiter)
    moveJupiter(scene, jupiter, 0.4)
    s.syncFollow()
    scene.updateMatrixWorld()
    const at = camera.getWorldPosition(new Vector3)
    s.setFollowing(false)
    scene.updateMatrixWorld()
    expect(camera.platform.parent).toBe(sun.orbitPosition)
    expect(Shared.targets.cur).toBe(sun)
    expect(camera.getWorldPosition(new Vector3).distanceTo(at)).toBeLessThan(MM)
    moveJupiter(scene, jupiter, 0.9)
    expect(camera.getWorldPosition(new Vector3).distanceTo(at)).toBeLessThan(MM)
  })

  describe('going', () => {
    it('turns following on for the body gone to, and says so', () => {
      const {s, jupiter} = makeSolarSystem()
      const seen = []
      s.onModeChange = (mode, on) => seen.push([mode, on])
      s.goTo()
      expect(Shared.targets.follow).toBe(jupiter.orbitPosition)
      expect(s.getSettings().F).toBe(true)
      expect(seen).toEqual([['follow', true]])
      // And going again, to another body, is still on, saying nothing more.
      s.setTarget('io', {look: false})
      s.goTo()
      expect(Shared.targets.follow).toBe(s.objects.io.orbitPosition)
      expect(seen).toEqual([['follow', true]])
    })

    it('hands the UI the approach, for every planet and moon alike: the body, where it arrives, the travel', () => {
      const {s, ui, jupiter, io} = makeSolarSystem()
      const seen = []
      ui.approach = (body, arrival, tween) => seen.push({body, arrival: arrival.clone(), tween})
      for (const body of [jupiter, io]) {
        s.setTarget(body.props.name, {look: false})
        s.goTo()
        const last = seen[seen.length - 1]
        expect(last.body).toBe(body)
        expect(last.tween).toBe(Shared.targets.tween)
        expect(last.tween.travelProgress()).toBe(0)
        // Arriving STEP_BACK (10) radii from its centre.
        const centre = body.getWorldPosition(new Vector3)
        expect(last.arrival.distanceTo(centre) / body.props.radius.scalar).toBeCloseTo(10, 6)
      }
      expect(seen.length).toBe(2)
      // A star has none: the meter has its exposure.
      s.worldGroup.add(s.stellarFrame)
      s.goTo({hipId: 11767, x: 1e18, y: 2e17, z: -3e17, radius: 1e9}, 'Polaris')
      expect(seen.length).toBe(2)
    })

    it('is off at a star, which has no orbit to ride', () => {
      const {s} = makeSolarSystem()
      s.worldGroup.add(s.stellarFrame)
      s.goTo()
      const star = {hipId: 11767, x: 1e18, y: 2e17, z: -3e17, radius: 1e9}
      s.goTo(star, 'Polaris')
      expect(Shared.targets.follow).toBeNull()
      expect(s.getSettings().F).toBe(false)
    })

    it('turns it on for a landing too', () => {
      const {s, jupiter} = makeSolarSystem()
      s.land('jupiter', 0, 0, 100, {instant: true})
      expect(Shared.targets.follow).toBe(jupiter.orbitPosition)
    })

    it('"f" turns it off by leaving the body: the camera stays, the body moves on', () => {
      const {s, scene, camera, sun, jupiter} = arrivedAtJupiter()
      const at = camera.getWorldPosition(new Vector3)
      const quat = camera.getWorldQuaternion(new Quaternion)
      const offset = offsetFrom(camera, jupiter)
      s.follow()
      scene.updateMatrixWorld()
      expect(Shared.targets.follow).toBeNull()
      expect(s.getSettings().F).toBe(false)
      // To the body's frame, the Sun's, which is now the camera's frame.
      expect(camera.platform.parent).toBe(sun.orbitPosition)
      expect(Shared.targets.cur).toBe(sun)
      expect(camera.getWorldPosition(new Vector3).distanceTo(at)).toBeLessThan(MM)
      expect(camera.getWorldQuaternion(new Quaternion).angleTo(quat)).toBeLessThan(1e-12)
      // Jupiter moves away from it.
      moveJupiter(scene, jupiter, 0.5)
      s.syncFollow()
      scene.updateMatrixWorld()
      expect(camera.getWorldPosition(new Vector3).distanceTo(at)).toBeLessThan(MM)
      expect(offsetFrom(camera, jupiter).distanceTo(offset)).toBeGreaterThan(1e10)
      // The controls' target is still the platform's origin, and the
      // camera's position is its offset from the Sun.
      expect(camera.platform.position.toArray()).toEqual([0, 0, 0])
      expect(camera.position.distanceTo(camera.getWorldPosition(new Vector3).sub(sun.getWorldPosition(new Vector3))))
          .toBeLessThan(MM)
    })

    it('"f" again rides the target, and off again goes back to where it was', () => {
      const {s, scene, camera, sun, jupiter} = arrivedAtJupiter()
      s.follow()
      moveJupiter(scene, jupiter, 0.5)
      scene.updateMatrixWorld()
      const offset = offsetFrom(camera, jupiter)
      s.follow()
      expect(Shared.targets.follow).toBe(jupiter.orbitPosition)
      expect(camera.platform.parent).toBe(jupiter.orbitPosition)
      for (let i = 1; i <= 10; i++) {
        moveJupiter(scene, jupiter, 0.5 + (i * 0.1))
        s.syncFollow()
        scene.updateMatrixWorld()
        expect(offsetFrom(camera, jupiter).distanceTo(offset)).toBeLessThan(MM)
      }
      s.follow()
      expect(camera.platform.parent).toBe(sun.orbitPosition)
      expect(Shared.targets.follow).toBeNull()
    })

    it('leaves a moon for its planet\'s frame', () => {
      const {s, scene, camera, jupiter, io} = makeSolarSystem()
      s.setTarget('io', {look: false})
      s.goTo()
      Shared.targets.tween = null
      expect(Shared.targets.follow).toBe(io.orbitPosition)
      const at = camera.getWorldPosition(new Vector3)
      s.follow()
      scene.updateMatrixWorld()
      expect(camera.platform.parent).toBe(jupiter.orbitPosition)
      expect(Shared.targets.cur).toBe(jupiter)
      expect(camera.getWorldPosition(new Vector3).distanceTo(at)).toBeLessThan(MM)
      io.orbitPosition.position.set(0, 0, 4.2e8)
      scene.updateMatrixWorld()
      expect(camera.getWorldPosition(new Vector3).distanceTo(at)).toBeLessThan(MM)
    })

    it('can\'t leave the Sun, which has nothing above it, and says so', () => {
      const {s, scene, camera, sun} = makeSolarSystem()
      s.setTarget('sun', {look: false})
      s.goTo()
      Shared.targets.tween = null
      const seen = []
      s.onModeChange = (...args) => seen.push(args)
      s.follow()
      expect(Shared.targets.follow).toBe(sun.orbitPosition)
      expect(camera.platform.parent).toBe(sun.orbitPosition)
      expect(seen).toEqual([['follow', true, 'root']])
      scene.updateMatrixWorld()
    })

    it('at the Sun, rides the target instead when another body is targeted, and off goes back', () => {
      const {s, scene, camera, sun, jupiter} = makeSolarSystem()
      s.setTarget('sun', {look: false})
      s.goTo()
      Shared.targets.tween = null
      s.setTarget('jupiter', {look: false})
      const offset = offsetFrom(camera, jupiter)
      s.follow()
      expect(Shared.targets.follow).toBe(jupiter.orbitPosition)
      expect(camera.platform.parent).toBe(jupiter.orbitPosition)
      moveJupiter(scene, jupiter, 0.5)
      s.syncFollow()
      scene.updateMatrixWorld()
      expect(offsetFrom(camera, jupiter).distanceTo(offset)).toBeLessThan(MM)
      s.follow()
      expect(Shared.targets.follow).toBeNull()
      expect(camera.platform.parent).toBe(sun.orbitPosition)
    })

    it('can\'t leave a surface it is landed on, and says so', () => {
      const {s, camera, jupiter} = makeSolarSystem()
      s.land('jupiter', 0, 0, 100, {instant: true})
      const seen = []
      s.onModeChange = (...args) => seen.push(args)
      s.follow()
      s.syncFollow()
      expect(Shared.targets.follow).toBe(jupiter.orbitPosition)
      expect(camera.platform.parent).toBe(jupiter)
      expect(seen).toEqual([['follow', true, 'landed']])
      Shared.targets.landed = false
    })

    it('waits while a go travels, then leaves from wherever the camera is', () => {
      const {s, scene, camera, sun} = arrivedAtJupiter()
      Shared.targets.tween = {travels: true, update: () => true}
      s.follow()
      expect(camera.platform.parent).not.toBe(sun.orbitPosition)
      Shared.targets.tween = null
      camera.position.x += 5e7
      scene.updateMatrixWorld()
      const at = camera.getWorldPosition(new Vector3)
      s.syncFollow()
      scene.updateMatrixWorld()
      expect(camera.platform.parent).toBe(sun.orbitPosition)
      expect(camera.getWorldPosition(new Vector3).distanceTo(at)).toBeLessThan(MM)
    })
  })

  it('goes to a body and rides it, whatever was riding before', () => {
    const {s, camera, io} = makeSolarSystem()
    s.setFollowing(true)
    s.setTarget('io', {look: false})
    s.goTo()
    Shared.targets.tween = null
    s.syncFollow()
    expect(camera.platform.parent).toBe(io.orbitPosition)
    expect(Shared.targets.follow).toBe(io.orbitPosition)
  })

  it('waits while a go travels, then rides from wherever the camera is', () => {
    const {s, scene, camera, jupiter} = makeSolarSystem()
    Shared.targets.tween = {travels: true, update: () => true}
    s.setFollowing(true)
    expect(camera.platform.parent).not.toBe(jupiter.orbitPosition)
    // The tween ended; the camera is where it got to.
    Shared.targets.tween = null
    camera.position.x += 5e7
    scene.updateMatrixWorld()
    const offset = offsetFrom(camera, jupiter)
    s.syncFollow()
    scene.updateMatrixWorld()
    expect(camera.platform.parent).toBe(jupiter.orbitPosition)
    expect(offsetFrom(camera, jupiter).distanceTo(offset)).toBeLessThan(MM)
  })

  it('does not wait for a look tween, which only turns the camera', () => {
    const {s, camera, jupiter} = makeSolarSystem()
    Shared.targets.tween = {update: () => true}
    s.setFollowing(true)
    expect(camera.platform.parent).toBe(jupiter.orbitPosition)
  })

  it('keeps riding the same body when the target changes: looking at another is not leaving', () => {
    const {s, scene, camera, jupiter, io} = arrivedAtJupiter()
    s.setTarget('io', {look: false})
    s.setTarget({kind: 'asterism', name: 'Orion', position: {x: 1e17, y: 0, z: 0}}, {look: false})
    s.setTarget({kind: 'place', body: 'io', name: 'X', lat: 0, lng: 0, alt: 0}, {look: false})
    expect(Shared.targets.follow).toBe(jupiter.orbitPosition)
    s.syncFollow()
    expect(camera.platform.parent).toBe(jupiter.orbitPosition)
    const offset = offsetFrom(camera, jupiter)
    moveJupiter(scene, jupiter, 0.5)
    s.syncFollow()
    scene.updateMatrixWorld()
    expect(offsetFrom(camera, jupiter).distanceTo(offset)).toBeLessThan(MM)
    // "f" turns that off, then on is of the target, Io.
    s.follow()
    s.follow()
    expect(Shared.targets.follow).toBe(io.orbitPosition)
  })

  it('does not follow from a star', () => {
    const {s, camera, jupiter} = makeSolarSystem()
    s.setFollowing(true)
    s._getOrCreateStarAnchor().add(camera.platform)
    s.syncFollow()
    expect(camera.platform.parent).toBe(s._starAnchor)
    expect(Shared.targets.follow).toBe(jupiter.orbitPosition)
  })

  it('has no body to follow with a star targeted', () => {
    const {s} = makeSolarSystem()
    s.setTarget({kind: 'asterism', name: 'Orion', position: {x: 1e17, y: 0, z: 0}}, {look: false})
    const err = console.error
    console.error = () => {}
    try {
      s.setFollowing(true)
    } finally {
      console.error = err
    }
    expect(Shared.targets.follow).toBeNull()
  })

  it('restores a link\'s state with the camera where the link put it', () => {
    const {s, camera, jupiter} = arrivedAtJupiter()
    const seen = []
    s.onModeChange = (mode, on) => seen.push([mode, on])
    s.restoreFollowing(false)
    s.syncFollow()
    expect(Shared.targets.follow).toBeNull()
    expect(camera.platform.parent).toBe(jupiter.orbitPosition) // not detached: where the link put it
    s.restoreFollowing(true)
    expect(Shared.targets.follow).toBe(jupiter.orbitPosition)
    expect(seen).toEqual([['follow', false], ['follow', true]])
  })

  it('says what it switched, for the readout, and only on a change', () => {
    const {s} = makeSolarSystem()
    const changes = []
    s.onModeChange = (mode, on) => changes.push([mode, on])
    s.follow()
    s.setFollowing(true)
    s.follow()
    s.track()
    s.setTracking(true)
    s.track()
    expect(changes).toEqual([['follow', true], ['follow', false], ['track', true], ['track', false]])
  })

  it('does nothing while following is off and nothing was taken', () => {
    const {s, camera, sun} = makeSolarSystem()
    s.syncFollow()
    s.syncFollow()
    expect(camera.platform.parent).toBe(sun.orbitPosition)
  })
})


describe('Scene.initSettings', () => {
  it('sets a page\'s settings before anything is built, announcing nothing', () => {
    const s = makeScene()
    const milkyWay = new Object3D()
    milkyWay.name = 'MilkyWay'
    s.ui.scene.add(milkyWay)
    let fired = 0
    s.onSettingsChange = () => fired++
    s.initSettings({...SETTINGS_DEFAULTS, e: true, o: false, U: false})
    expect(fired).toBe(0)
    expect(s.getSettings().e).toBe(true)
    expect(s.getSettings().o).toBe(false)
    // At their end states, no fade.
    expect(s.grids.equatorial.visible).toBe(true)
    expect(s.fades.e.opacity).toBe(1)
    expect(s.overlayShown('o')).toBe(false)
    expect(milkyWay.visible).toBe(false)
    expect(s.overlays.moving).toBe(false)
  })

  it('held, nothing is shown until revealed; what the settings hide is never shown', () => {
    const s = makeScene()
    s.objects['sun'] = {children: [{name: 'orbit', visible: true}, {name: 'label LOD', visible: true}]}
    const shown = []
    for (const key of Object.keys(s.fades)) {
      const onShow = s.fades[key].onShow
      s.fades[key].onShow = (v) => {
        shown.push([key, v])
        onShow(v)
      }
    }
    s.initSettings({...SETTINGS_DEFAULTS, o: false, l: false}, {hold: true})
    const [orbit, label] = s.objects['sun'].children
    expect(orbit.visible).toBe(false)
    expect(label.visible).toBe(false)
    expect(s.getSetting('p')).toBe(true)
    // A body built now (Scene.add) starts hidden too.
    expect(s.overlayShown('p')).toBe(false)
    s.revealOverlays(['o', 'p', 'l', 'a', 'e', 'c', 'g', 'G', 'x'])
    s.overlays.tick(0)
    s.overlays.tick(1000)
    expect(label.visible).toBe(true)
    expect(s.fades.p.opacity).toBe(1)
    expect(orbit.visible).toBe(false)
    const on = shown.filter(([, v]) => v).map(([k]) => k)
    expect(on).not.toContain('o')
    expect(on).not.toContain('l')
    // The grids are off by default: not shown either.
    expect(on).not.toContain('e')
    expect(on).toContain('p')
    expect(on).toContain('a')
  })
})


describe('orbital elements lit on the orbits', () => {
  /**
   * A scene with a body's orbitPosition as Planet makes it: under a group,
   * holding the body's orbit block.
   *
   * @param {object} s Scene
   * @param {string} name
   * @param {object} orbit
   * @returns {Object3D}
   */
  function addBody(s, name, orbit) {
    const plane = new Object3D()
    const node = new Object3D()
    node.name = `${name}.orbitPosition`
    node.orbit = orbit
    plane.add(node)
    s.objects[node.name] = node
    return node
  }

  const PLANET = {eccentricity: 0.0167, semiMajorAxis: 1.496e11}
  const MOON = {eccentricity: 0.004, referencePole: {ra: 268.1, dec: 64.5}}

  it('keeps each body\'s elements, several at once, and shows their diagrams', () => {
    const s = makeScene()
    const earth = addBody(s, 'earth', PLANET)
    const venus = addBody(s, 'venus', PLANET)
    let changes = 0
    s.onSettingsChange = () => changes++
    s.toggleOrbitElement('earth', 'i')
    s.toggleOrbitElement('earth', 'peri')
    s.toggleOrbitElement('venus', 'i')
    expect(s.orbitElementsOf('earth')).toEqual(new Set(['i', 'peri']))
    expect(earth.orbitDiagram.visible && venus.orbitDiagram.visible).toBe(true)
    expect(earth.orbitDiagram.keys).toEqual(new Set(['inclination', 'longitudeOfPericenter']))
    expect(changes).toBe(3)
    // Off again: the last one off puts the diagram away.
    s.toggleOrbitElement('venus', 'i')
    expect(venus.orbitDiagram.visible).toBe(false)
    expect(s.getOrbitElements()).toEqual(new Map([['earth', new Set(['i', 'peri'])]]))
    s.clearOrbitElements()
    expect(earth.orbitDiagram.visible).toBe(false)
  })

  it('reads a code as the body lists it: ω and M for a moon', () => {
    const s = makeScene()
    const io = addBody(s, 'io', MOON)
    s.setOrbitElements('io', ['peri', 'at', 'bogus'])
    expect(s.orbitElementsOf('io')).toEqual(new Set(['peri', 'at']))
    expect(io.orbitDiagram.keys).toEqual(new Set(['argumentOfPericenter', 'meanAnomaly']))
  })

  it('previews a hovered element without keeping it', () => {
    const s = makeScene()
    const earth = addBody(s, 'earth', PLANET)
    s.previewOrbitElement('earth', 'e')
    expect(earth.orbitDiagram.visible).toBe(true)
    expect(s.getOrbitElements().size).toBe(0)
    s.previewOrbitElement(null, null)
    expect(earth.orbitDiagram.visible).toBe(false)
  })

  it('names the Earth-Moon barycentre once when both diagrams would', () => {
    const s = makeScene()
    const earth = addBody(s, 'earth', PLANET)
    const moon = addBody(s, 'moon', {eccentricity: 0.055, semiMajorAxis: 384400e3})
    s.objects.earth = {props: {name: 'earth', parent: 'sun', mass: 5.97e27}}
    s.objects.moon = {props: {name: 'moon', parent: 'earth', mass: 7.35e25}}
    s.setOrbitElements('earth', ['at'])
    expect(earth.orbitDiagram._hiddenLabels?.has('body') ?? false).toBe(false)
    s.setOrbitElements('moon', ['at'])
    expect(earth.orbitDiagram._hiddenLabels.has('body')).toBe(true)
    expect(moon.orbitDiagram.litLabel('barycentre')).toBe('Earth–Moon barycentre')
    s.setOrbitElements('moon', [])
    expect(earth.orbitDiagram._hiddenLabels.has('body')).toBe(false)
  })

  it('fades every diagram to the far side\'s opacity it\'s set to, made before or after', () => {
    const s = makeScene()
    const earth = addBody(s, 'earth', PLANET)
    s.setOrbitElements('earth', ['i'])
    let changes = 0
    s.onSettingsChange = () => changes++
    s.setOrbitFade(0.2)
    expect(earth.orbitDiagram.parts.orbit.material.uniforms.uFadeMin.value).toBeCloseTo(0.2, 9)
    expect(changes).toBe(1)
    const venus = addBody(s, 'venus', PLANET)
    s.setOrbitElements('venus', ['i'])
    expect(venus.orbitDiagram.fills.reference.material.uniforms.uFadeMin.value).toBeCloseTo(0.2, 9)
    s.setOrbitFade(1, true)
    expect(changes).toBe(2)
    expect(s.getOrbitFade()).toBe(1)
  })

  it('shows a link\'s elements on a body that loads later', () => {
    const s = makeScene()
    s.restoreOrbitElements(new Map([['mars', new Set(['node'])]]))
    const mars = addBody(s, 'mars', PLANET)
    expect(mars.orbitDiagram).toBeUndefined()
    // Scene.add's hook, as a body arrives.
    s._syncOrbitDiagrams()
    expect(mars.orbitDiagram.visible).toBe(true)
  })
})


describe('the target\'s Lagrange points', () => {
  /**
   * A body as Planet makes it, with its props: its orbitPosition under its
   * orbit plane, its planetTilt under that.
   *
   * @param {object} s Scene
   * @param {object} props
   */
  function addBody(s, props) {
    s.objects[props.name] = {props}
    if (!props.orbit) {
      return
    }
    const plane = new Object3D()
    const node = new Object3D()
    node.name = `${props.name}.orbitPosition`
    node.orbit = props.orbit
    plane.add(node)
    const tilt = new Object3D()
    node.add(tilt)
    s.objects[node.name] = node
    s.objects[`${props.name}.planetTilt`] = tilt
  }

  /** @returns {object} Scene with the Sun, Earth, Moon and Mars */
  function solarScene() {
    const s = makeScene()
    addBody(s, {name: 'sun', parent: 'milkyway', mass: '1.9891E33 g', radius: 6.957e8,
      system: ['earth', 'mars']})
    addBody(s, {name: 'earth', parent: 'sun', mass: '5.97219e27 g', radius: 6.37101e6,
      siderealRotationPeriod: 86164.1, system: ['moon'],
      orbit: {semiMajorAxis: 1.496e11, eccentricity: 0.0167}})
    addBody(s, {name: 'moon', parent: 'earth', mass: '7.34767309E25 g', radius: 1.7381e6,
      siderealRotationPeriod: 2360591.5, system: [], orbit: {semiMajorAxis: 3.844e8, eccentricity: 0.0549}})
    addBody(s, {name: 'mars', parent: 'sun', mass: '6.4171E26 g', radius: 3.3895e6,
      siderealRotationPeriod: 88642.7, system: [], orbit: {semiMajorAxis: 2.279e11, eccentricity: 0.0934}})
    return s
  }

  const withTarget = (s, name, fn) => {
    const before = Shared.targets.obj
    Shared.targets.obj = s.objects[name]
    try {
      s._syncLagrange()
      fn()
    } finally {
      Shared.targets.obj = before
    }
  }

  it('shows the target\'s pair with its primary and with its biggest moon', () => {
    const s = solarScene()
    expect(s.lagrangePairsOf('earth')).toEqual([['sun', 'earth'], ['earth', 'moon']])
    expect(s.lagrangePairsOf('moon')).toEqual([['earth', 'moon']])
    expect(s.lagrangePairsOf('sun')).toEqual([['sun', 'earth']])
    expect(s.lagrangePairsOf('nowhere')).toEqual([])
  })

  it('builds the Earth\'s marks with the Moon in its mass, and GEO in its equator', () => {
    const s = solarScene()
    withTarget(s, 'earth', () => {
      const earth = s.objects['earth.orbitPosition']
      const marks = earth.lagrange
      expect(marks.parent).toBe(earth.parent)
      // μ for the Sun and the Earth-Moon pair, 3.04e-6; the Earth alone's
      // would be 3.00e-6.
      expect(marks.mu).toBeCloseTo(3.04e-6, 8)
      expect(marks.hillRadius / 1e9).toBeCloseTo(1.47, 1)
      expect(marks.syncRing.parent).toBe(s.objects['earth.planetTilt'])
      expect(marks.sync.radius / 1e3).toBeCloseTo(42164, -1)
      // The Moon can't hold a selenosynchronous orbit: no ring.
      expect(s.objects['moon.orbitPosition'].lagrange.syncRing).toBeNull()
      expect(s.objects['moon.orbitPosition'].lagrange.sync.why).toBe('beyondHill')
    })
  })

  it('takes a pair out of the scene when the target moves on, and back', () => {
    const s = solarScene()
    let earthMarks
    withTarget(s, 'earth', () => {
      earthMarks = s.objects['earth.orbitPosition'].lagrange
    })
    withTarget(s, 'mars', () => {
      expect(earthMarks.parent).toBeNull()
      expect(earthMarks.syncRing.parent).toBeNull()
      expect(s.objects['earth.orbitPosition'].lagrange).toBeUndefined()
      expect(s.objects['mars.orbitPosition'].lagrange.sync.why).toBeNull()
    })
    withTarget(s, 'earth', () => {
      expect(s.objects['earth.orbitPosition'].lagrange).toBe(earthMarks)
      expect(earthMarks.parent).not.toBeNull()
    })
  })

  it('hides and shows them with the orbits', () => {
    const s = solarScene()
    withTarget(s, 'earth', () => {
      const marks = s.objects['earth.orbitPosition'].lagrange
      expect(s._overlayNodes('o')).toContain(marks)
      expect(s._overlayNodes('o')).toContain(marks.syncRing)
      s._showOverlay('o', false)
      expect(marks.visible || marks.syncRing.visible).toBe(false)
    })
  })
})


describe('the target\'s orbital regimes', () => {
  /**
   * @param {object} s Scene
   * @param {object} props
   */
  function addBody(s, props) {
    s.objects[props.name] = {props}
    if (!props.orbit) {
      return
    }
    const plane = new Object3D()
    const node = new Object3D()
    node.name = `${props.name}.orbitPosition`
    node.orbit = props.orbit
    plane.add(node)
    const tilt = new Object3D()
    node.add(tilt)
    s.objects[node.name] = node
    s.objects[`${props.name}.planetTilt`] = tilt
  }

  /** @returns {object} Scene with the Sun, Earth, the Moon and Mars */
  function solarScene() {
    const s = makeScene()
    addBody(s, {name: 'sun', parent: 'milkyway', mass: '1.9891E33 g', radius: 6.957e8, system: ['earth', 'mars']})
    addBody(s, {name: 'earth', parent: 'sun', mass: '5.97219e27 g', radius: 6.37101e6, siderealRotationPeriod: 86164.1,
      system: ['moon'], orbit: {semiMajorAxis: 1.496e11, eccentricity: 0.0167, siderealOrbitPeriod: 31558149.8}})
    addBody(s, {name: 'moon', parent: 'earth', mass: '7.34767309E25 g', radius: 1.7381e6,
      siderealRotationPeriod: 2360591.5, system: [], orbit: {semiMajorAxis: 3.844e8, eccentricity: 0.0549}})
    addBody(s, {name: 'mars', parent: 'sun', mass: '6.4171E26 g', radius: 3.3895e6, siderealRotationPeriod: 88642.7,
      system: [], orbit: {semiMajorAxis: 2.279e11, eccentricity: 0.0934, siderealOrbitPeriod: 59354294.4}})
    return s
  }

  const withTarget = (s, name, fn) => {
    const before = Shared.targets.obj
    Shared.targets.obj = s.objects[name]
    try {
      s._syncRegimes()
      fn()
    } finally {
      Shared.targets.obj = before
    }
  }

  it('hangs the target\'s regimes in its equator, and takes them out when it moves on', () => {
    const s = solarScene()
    let earthRegimes
    withTarget(s, 'earth', () => {
      earthRegimes = s.objects['earth.orbitPosition'].regimes
      expect(earthRegimes.parent).toBe(s.objects['earth.planetTilt'])
      expect(earthRegimes.bands.map((b) => Math.round((b.outer - 6378137) / 1e3))).toEqual([2000, 35786])
      // Cislunar space reaches the Earth-Moon L2: 1.168 of the Moon's distance.
      const cislunar = earthRegimes.outlines.find((o) => o.label !== null && o.radius > 4e8)
      expect(cislunar.radius / 3.844e8).toBeCloseTo(1.168, 2)
      // GPS's six planes.
      expect(earthRegimes.orbits.find((o) => o.spec.planes === 6).frames).toHaveLength(6)
      expect(s._overlayNodes('o')).toContain(earthRegimes)
    })
    withTarget(s, 'mars', () => {
      expect(earthRegimes.parent).toBeNull()
      expect(s.objects['mars.orbitPosition'].regimes.orbits[0].i).toBeCloseTo(92.6, 0)
    })
    withTarget(s, 'moon', () => {
      // The Moon's, over its 1,737.4 km reference sphere.
      const moonRegimes = s.objects['moon.orbitPosition'].regimes
      expect(moonRegimes.parent).toBe(s.objects['moon.planetTilt'])
      expect(moonRegimes.bands.map((b) => Math.round((b.outer - 1737400) / 1e3))).toEqual([100])
      expect(moonRegimes.orbits.filter((o) => o.spec.label.startsWith('frozen')).map((o) => o.i))
          .toEqual([27, 50, 76, 86])
    })
  })

  it('turns a sun-synchronous dawn-dusk orbit to face the Sun', () => {
    const s = solarScene()
    withTarget(s, 'earth', () => {
      const marks = s.objects['earth.orbitPosition'].regimes
      const sso = marks.orbits.find((o) => o.spec.sunSync)
      for (const sun of [new Vector3(1, 0, 0), new Vector3(0.6, 0, -0.8)]) {
        marks.place(sun)
        // Its pole points nearly at the Sun: the plane is the terminator's.
        const pole = new Vector3(0, 1, 0).applyQuaternion(sso.frames[0].quaternion)
        expect(Math.abs(pole.dot(sun))).toBeGreaterThan(0.95)
      }
    })
  })

  it('lists the regimes in the panel\'s space around', () => {
    const s = solarScene()
    const lines = s.spaceAround('earth').regimes
    expect(lines).toContain('low Earth orbit (LEO): 160 km to 2,000 km up')
    expect(lines.find((l) => l.startsWith('sun-synchronous'))).toMatch(/inclined 98\.2°$/)
    const moonLines = s.spaceAround('moon').regimes
    expect(moonLines).toContain('low lunar orbit (LLO): 20 km to 100 km up')
    expect(moonLines.find((l) => l.startsWith('why most low lunar orbits'))).toMatch(/mascons/)
    expect(s.spaceAround('venus')).toBeNull()
  })
})


describe('the three-body orbits at the target\'s pairs', () => {
  /**
   * @param {object} s Scene
   * @param {object} props
   */
  function addBody(s, props) {
    s.objects[props.name] = {props}
    if (!props.orbit) {
      return
    }
    const plane = new Object3D()
    const node = new Object3D()
    node.name = `${props.name}.orbitPosition`
    node.orbit = props.orbit
    plane.add(node)
    node.add(new Object3D())
    s.objects[node.name] = node
    s.objects[`${props.name}.planetTilt`] = node.children[0]
  }

  /** @returns {object} Scene with the Sun, Earth and the Moon */
  function solarScene() {
    const s = makeScene()
    addBody(s, {name: 'sun', parent: 'milkyway', mass: '1.9891E33 g', radius: 6.957e8, system: ['earth']})
    addBody(s, {name: 'earth', parent: 'sun', mass: '5.97219e27 g', radius: 6.37101e6, siderealRotationPeriod: 86164.1,
      system: ['moon'], orbit: {semiMajorAxis: 1.496e11, eccentricity: 0.0167, siderealOrbitPeriod: 31558149.8}})
    addBody(s, {name: 'moon', parent: 'earth', mass: '7.34767309E25 g', radius: 1.7381e6,
      siderealRotationPeriod: 2360591.5, system: [],
      orbit: {semiMajorAxis: 3.844e8, eccentricity: 0.0549, siderealOrbitPeriod: 2360591.5}})
    // JPL's catalogue members, as loaded (loadPeriodicData).
    s._periodicData = periodicData
    return s
  }

  const withTarget = (s, name, fn) => {
    const before = Shared.targets.obj
    Shared.targets.obj = s.objects[name]
    try {
      s._syncLagrange()
      fn()
    } finally {
      Shared.targets.obj = before
    }
  }

  it('offers each pair its families, the NRHO only at the Earth-Moon pair', () => {
    const s = solarScene()
    const pairs = s.periodicPairsOf('earth')
    expect(pairs.map((p) => [p.body, p.name])).toEqual([['earth', 'Sun–Earth'], ['moon', 'Earth–Moon']])
    expect(pairs[0].families.map((f) => f.code)).toEqual(['l1l', 'l2l', 'l1h', 'l2h', 'dro'])
    expect(pairs[1].families.map((f) => f.code)).toContain('nrho')
  })

  it('shows a family on the pair when it\'s turned on, and keeps it for the link', () => {
    const s = solarScene()
    let changes = 0
    s.onSettingsChange = () => changes++
    withTarget(s, 'earth', () => {
      s.togglePeriodic('moon', 'nrho')
      const marks = s.objects['moon.orbitPosition'].lagrange
      expect([...marks.families.keys()]).toEqual(['nrho'])
      expect(s.getPeriodic()).toEqual(new Map([['moon', new Set(['nrho'])]]))
      expect(changes).toBe(1)
      // Laid on the pair: the body on its orbit now, in the pair's frame.
      marks.place(new Vector3(3.844e8, 0, 0), new Vector3(0, 1, 0), undefined, 1.0)
      const nrho = marks.families.get('nrho')
      const at = nrho.marker.geometry.getAttribute('position')
      expect(Math.hypot(at.getX(0) - 1, at.getY(0), at.getZ(0))).toBeLessThan(0.2)
      // Fixed in space: the sweep is drawn instead, from where the body is.
      s.setPeriodicFrame('inertial')
      expect(nrho.rotating.visible).toBe(false)
      expect(nrho.sweep.visible).toBe(true)
      marks.place(new Vector3(3.844e8, 0, 0), new Vector3(0, 1, 0), undefined, 1.0)
      const sweep = nrho.sweep.geometry.getAttribute('position')
      expect(sweep.getX(0)).toBeCloseTo(at.getX(0), 5)
      s.togglePeriodic('moon', 'nrho')
      expect(marks.families.size).toBe(0)
      expect(s.getPeriodic().size).toBe(0)
    })
  })

  it('draws the manifolds of the families that have them, turning with the pair', () => {
    const s = solarScene()
    withTarget(s, 'earth', () => {
      s.togglePeriodic('moon', 'l1l')
      s.togglePeriodic('moon', 'dro')
      const marks = s.objects['moon.orbitPosition'].lagrange
      let changes = 0
      s.onSettingsChange = () => changes++
      s.setPeriodicManifolds(true)
      expect(changes).toBe(1)
      const l1l = marks.families.get('l1Lyapunov')
      // Stable and unstable, each one set of segments; the DRO has none.
      expect(l1l.manifolds.children.map((c) => c.name)).toEqual(['periodic.l1Lyapunov.stable',
        'periodic.l1Lyapunov.unstable'])
      expect(l1l.manifolds.children[0].geometry.getAttribute('position').count).toBeGreaterThan(1000)
      expect(marks.families.get('dro').manifolds).toBeNull()
      // Stopped at the Moon's surface, in units of the separation.
      expect(marks.radii.secondary).toBeCloseTo(1.7381e6 / 3.844e8, 8)
      // Made once: the same tubes when the family comes back.
      const tubes = s._tubes('moon', 'l1Lyapunov')
      s.togglePeriodic('moon', 'l1l')
      s.togglePeriodic('moon', 'l1l')
      expect(s._tubes('moon', 'l1Lyapunov')).toBe(tubes)
      // Not fixed in space.
      s.setPeriodicFrame('inertial')
      expect(marks.families.get('l1Lyapunov').manifolds.visible).toBe(false)
      s.setPeriodicManifolds(false)
      expect(marks.families.get('l1Lyapunov').manifolds).toBeNull()
    })
  })

  it('flies a craft to the Moon from the start of the day, about the Earth', async () => {
    const s = solarScene()
    let changes = 0
    s.onSettingsChange = () => changes++
    expect(s.craftOf('earth').map((c) => [c.code, c.on])).toEqual([['tli', false], ['blt', false]])
    expect(s.craftOf('mars')).toEqual([])
    s.toggleCraft('tli', 2461336.8)
    expect(changes).toBe(1)
    expect(s.getCraft()).toEqual(new Map([['tli', 2461336.5]]))
    // How it's made loads on first use, then it's flown.
    expect(s._craftTracks.size).toBe(0)
    await s._flights
    const track = s.objects['earth.orbitPosition'].children.find((c) => c.name === 'craft.tli')
    expect(track).toBeDefined()
    // In flight two days on, at the Moon's distance by the end.
    expect(track.place(2461338.5)).toBe(true)
    expect(track.marker.visible).toBe(true)
    expect(track.place(2461330)).toBe(false)
    const {t, xyz} = track.path
    const n = t.length - 1
    expect(Math.hypot(xyz[3 * n], xyz[(3 * n) + 1], xyz[(3 * n) + 2]) / 1e3).toBeGreaterThan(350e3)
    expect(s.craftOf('earth')[0].text).toMatch(/^leaves 2026-10-23 from 185 km, 3,1\d\d m\/s, 4.5 days to 100 km/)
    s.toggleCraft('tli', 2461336.8)
    expect(s.getCraft().size).toBe(0)
    expect(track.parent).toBeNull()
  })

  it('flies a ballistic lunar transfer once VSOP87C and the designs are in', async () => {
    // From the package: Celestiary.test.js mocks ./vsop for the process.
    const vsop87c = await vsop87cLoader
    const s = solarScene()
    let ready = false
    s.vsopReady = () => ready
    s.vsopAt = vsop87c
    let refreshed = 0
    s.onCraftChange = () => refreshed++
    let loads = 0
    s.loadCraftData = () => {
      loads++
      return Promise.resolve(bltData)
    }
    const first = Math.min(...bltData.designs.map((d) => d.departure))
    const day = first - 3
    s.toggleCraft('blt', day)
    await s._flights
    // Waiting for the ephemeris: neither drawn nor loading.
    expect(s._craftTracks.size).toBe(0)
    expect(loads).toBe(0)
    ready = true
    s._syncCraft()
    expect(loads).toBe(1)
    await new Promise((r) => setTimeout(r, 0))
    const track = s._craftTracks.get('blt')
    expect(track.path.facts.departure).toBe(first)
    // Drawn once the file came: the panel is told.
    expect(refreshed).toBe(1)
    expect(track.path.facts.apogee / 1e9).toBeLessThan(2)
    expect(s.craftOf('moon').find((c) => c.code === 'blt').text)
        .toMatch(/^leaves \d{4}-\d\d-\d\d from 185 km, 3,2\d\d m\/s, out to 1\.\d\d million km/)
    // No design from past the last: said so.
    s.toggleCraft('blt', day)
    s.toggleCraft('blt', Math.max(...bltData.designs.map((d) => d.departure)) + 10)
    expect(s._craftTracks.size).toBe(0)
    expect(s.craftOf('earth').find((c) => c.code === 'blt').text).toBe('none designed from this date')
    expect(loads).toBe(1)
  })

  it('shows a link\'s families once their pair is the target\'s', () => {
    const s = solarScene()
    s.restorePeriodic({families: new Map([['moon', new Set(['dro'])]]), frame: 'inertial'})
    withTarget(s, 'moon', () => {
      const marks = s.objects['moon.orbitPosition'].lagrange
      expect([...marks.families.keys()]).toEqual(['dro'])
      expect(marks.frame).toBe('inertial')
    })
    s.restorePeriodic({families: new Map([['moon', new Set(['l2h'])]]), frame: 'rotating', manifolds: true})
    expect(s.getPeriodicManifolds()).toBe(true)
  })

  it('draws JPL\'s member where its catalogue has the pair, loaded the first time, else its own', async () => {
    const s = solarScene()
    s._periodicData = undefined
    let resolve
    s.loadPeriodicData = () => new Promise((r) => {
      resolve = r
    })
    let marks
    withTarget(s, 'moon', () => {
      marks = s.objects['moon.orbitPosition'].lagrange
      s.togglePeriodic('moon', 'nrho')
      // Not yet: the file is loading.
      expect(marks.families.size).toBe(0)
    })
    const before = Shared.targets.obj
    Shared.targets.obj = s.objects.moon
    resolve(periodicData)
    await new Promise((r) => setTimeout(r, 0))
    Shared.targets.obj = before
    expect(marks.families.get('nrho').samples.source).toBe('JPL')
    // Where the file couldn't load, its own.
    const t = solarScene()
    t._periodicData = undefined
    t.loadPeriodicData = () => Promise.reject(new Error('offline'))
    withTarget(t, 'moon', () => t.togglePeriodic('moon', 'dro'))
    Shared.targets.obj = t.objects.moon
    await new Promise((r) => setTimeout(r, 0))
    Shared.targets.obj = before
    expect(t.objects['moon.orbitPosition'].lagrange.families.get('dro').samples.source).toBe('computed')
  })
})
