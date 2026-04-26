import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Quaternion, Scene as ThreeScene, Vector3} from 'three'
import {SETTINGS_DEFAULTS} from '../permalink.js'
import * as Shared from '../shared.js'
import Scene from './Scene.js'


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

  const stateBag = {dragMode: 'auto', landed: false}
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

  it('toggleStarLabels is a no-op when stars is null and does not fire', () => {
    const s = makeScene()
    let fired = 0
    s.onSettingsChange = () => fired++
    s.toggleStarLabels()
    expect(s.getSettings().l).toBe(false)
    expect(fired).toBe(0)
  })

  it('toggleOrbits flips o, drives orbitsVisible, and walks attached planet orbits', () => {
    const s = makeScene()
    s.objects['sun'] = fakeSunWithOrbit()
    s.toggleOrbits()
    expect(s.getSettings().o).toBe(false)
    expect(s.orbitsVisible).toBe(false)
    expect(s.objects['sun'].children[0].visible).toBe(false)
  })

  it('togglePlanetLabels flips p and walks attached planet label LODs', () => {
    const s = makeScene()
    s.objects['sun'] = fakeSunWithLabelLOD()
    s.togglePlanetLabels()
    expect(s.getSettings().p).toBe(false)
    expect(s.objects['sun'].children[0].visible).toBe(false)
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

  it('defers the entire pass when this.stars is null, then runs once it is set', () => {
    const s = makeScene()
    s.objects['sun'] = {children: [{name: 'orbit', visible: true}]}
    s.applySettings({...SETTINGS_DEFAULTS, o: false}) // stars not yet set
    expect(s.objects['sun'].children[0].visible).toBe(true) // still visible — deferred
    s.stars = fakeStars()
    s._markStarsReady()
    expect(s.objects['sun'].children[0].visible).toBe(false)
    expect(s.getSettings().o).toBe(false)
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
    const target = {a: false, l: true, p: false, o: false, e: true, c: true, g: true, v: false}
    s.registerSettingApplier('v', () => s.flipSetting('v'))
    s.applySettings(target)
    // L isn't in `target` but is added to getSettings by reading
    // Shared.targets.landed; pin it to the default (false) for this test.
    expect(s.getSettings()).toEqual({...target, L: false})
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

  it('resets drag mode to auto so it picks pan here and orbit on zoom-out', () => {
    // Earlier rev forced dragMode='pan' on land; that stayed sticky and
    // never flipped back to orbit when the user later zoomed away from
    // the surface.  'auto' resolves to pan at touchdown via pickDragMode
    // and naturally flips to orbit past the auto-switch threshold.
    const {scene, stateBag} = makeSceneWithEarth()
    scene.land('earth', 0, 0, 0, {instant: true})
    expect(stateBag.dragMode).toBe('auto')
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
