import {afterEach, describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Scene as ThreeScene, Vector3} from 'three'
import Satellites from './satellites/Satellites.js'
import {parseCatalog} from './satellites/sgp4.js'
import * as Shared from '../shared.js'


// Scene's side of Earth's satellites (satellites/Satellites.md): loading
// them near Earth, hanging them in its equator, targeting, going, riding.


const Scene = (await import('./Scene.js')).default

// An ISS-like orbit, elements of 2026 Oct 22 12:00 UTC (made up).
const EPOCH_JD = 2461336.0
const SNAPSHOT = {rows: [
  [25544, 'ISS (ZARYA)', 'stations', '1998-067A', '2026-10-22T12:00:00.000000', 15.5, 0.0005, 51.64, 100, 90, 0,
    1.5e-4, 1e-4, 0],
]}
const EARTH_M = 1.496e11
const OBLIQUITY = 23.44 * Math.PI / 180


/** A label sheet without a canvas. */
class StubSheet {
  /** */
  add() {/* no canvas */}

  /** @returns {Object3D} */
  compile() {
    return new Object3D
  }
}


/** @returns {object} The Sun and Earth, the camera at the Sun's frame, satellites loadable */
function solarSystem() {
  const scene = new ThreeScene()
  const camera = new PerspectiveCamera(45, 1, 1, 1e13)
  camera.platform = new Object3D()
  camera.platform.add(camera)
  const ui = {scene, camera, addClickCb: () => {}, useStore: {getState: () => ({})}}
  const s = new Scene(ui)
  scene.add(s.worldGroup)
  const body = (name, parent, parentNode, radius) => {
    const orbitPosition = new Object3D()
    orbitPosition.name = `${name}.orbitPosition`
    parentNode.add(orbitPosition)
    const tilt = new Object3D()
    orbitPosition.add(tilt)
    const node = new Object3D()
    node.name = name
    node.props = {name, parent, radius: {scalar: radius}}
    node.orbitPosition = orbitPosition
    tilt.add(node)
    s.objects[name] = node
    s.objects[orbitPosition.name] = orbitPosition
    s.objects[`${name}.planetTilt`] = tilt
    return node
  }
  const sun = body('sun', undefined, s.worldGroup, 6.957e8)
  const earth = body('earth', 'sun', sun.orbitPosition, 6.371e6)
  earth.orbitPosition.position.set(EARTH_M, 0, 0)
  s.objects['earth.planetTilt'].rotateX(-OBLIQUITY)
  sun.orbitPosition.add(camera.platform)
  camera.position.set(EARTH_M + 3e7, 1e7, 2e7)
  scene.updateMatrixWorld()
  Object.assign(Shared.targets, {cur: sun, landed: false, tween: null, follow: null, label: null, obj: null})
  s.importSatellites = () => Promise.resolve({
    loadSatellites: (opts) => Promise.resolve({
      satellites: new Satellites(parseCatalog(SNAPSHOT), {...opts, Sheet: StubSheet}),
      data: {fetched: '2026-10-22T13:00:00Z'},
    }),
  })
  // The regimes and Lagrange marks draw labels to a canvas; not wanted here.
  s._syncRegimes = () => {/* none */}
  s._syncLagrange = () => {/* none */}
  s._watchForSatellites()
  return {s, scene, camera, sun, earth}
}


/**
 * @param {object} sys solarSystem()
 * @param {number} jd
 */
function animate({s, scene}, jd) {
  s.satellites.update(jd)
  scene.updateMatrixWorld()
}


const ISS = {kind: 'satellite', id: 25544, name: 'ISS', body: 'earth'}


describe('Scene and the satellites', () => {
  afterEach(() => {
    Object.assign(Shared.targets, {cur: null, follow: null, label: null, obj: null, tween: null})
  })

  it('loads them once, hangs them in Earth\'s equator and puts them in the orbits group', async () => {
    const sys = solarSystem()
    let ready = null
    sys.s.onSatellitesReady((sats) => {
      ready = sats
    })
    const [a, b] = await Promise.all([sys.s.loadSatellites(), sys.s.loadSatellites()])
    expect(a).toBe(b)
    expect(ready).toBe(a)
    expect(a.parent).toBe(sys.s.objects['earth.planetTilt'])
    expect(sys.s._overlayNodes('o')).toContain(a.marks)
    expect(sys.s.satelliteData.fetched).toBe('2026-10-22T13:00:00Z')
  })

  it('loads them when the camera nears Earth with the orbits shown, not while they\'re held', async () => {
    const sys = solarSystem()
    const watch = sys.s._satelliteWatch
    sys.s.holdOverlays()
    sys.s.overlays.finish()
    watch.preAnimCb()
    expect(sys.s._satellitesPending ?? null).toBeNull()
    sys.s.revealOverlays(['o'])
    sys.s.overlays.finish()
    // Far: 10 AU off.
    sys.camera.position.set(1.5e12, 0, 0)
    sys.scene.updateMatrixWorld()
    watch.preAnimCb()
    expect(sys.s._satellitesPending ?? null).toBeNull()
    sys.camera.position.set(EARTH_M + 3e7, 0, 0)
    sys.scene.updateMatrixWorld()
    watch.preAnimCb()
    expect(await sys.s._satellitesPending).toBe(sys.s.satellites)
    expect(watch.parent).toBeNull()
  })

  it('targets a satellite as a place is: Earth the body, the satellite the label', async () => {
    const sys = solarSystem()
    await sys.s.loadSatellites()
    animate(sys, EPOCH_JD)
    sys.s.setTarget(ISS, {look: false})
    expect(Shared.targets.obj).toBe(sys.earth)
    expect(Shared.targets.label).toEqual(ISS)
    expect(sys.s.getTarget()).toEqual(ISS)
    expect(sys.s.satellites._targetId).toBe(25544)
    // Where it is: SGP4's place, turned by Earth's equator, 400 km up.
    const at = sys.s.labelPosition(ISS)
    const fromEarth = at.clone().sub(sys.earth.getWorldPosition(new Vector3))
    const altKm = (fromEarth.length() / 1e3) - 6378
    expect(altKm).toBeGreaterThan(300)
    expect(altKm).toBeLessThan(500)
    sys.s.setTarget('earth', {look: false})
    expect(sys.s.satellites._targetId).toBeNull()
  })

  it('goes to a satellite: arrives beside it, riding it, in Earth\'s frame', async () => {
    const sys = solarSystem()
    await sys.s.loadSatellites()
    animate(sys, EPOCH_JD)
    sys.s.setTarget(ISS, {look: false})
    sys.s.goTo()
    const node = sys.s.satellites.node(25544)
    expect(sys.camera.platform.parent).toBe(node)
    expect(Shared.targets.cur).toBe(sys.earth)
    expect(Shared.targets.follow).toBe(node)
    expect(Shared.targets.label).toEqual(ISS)
    // The tween's end: ARRIVAL_DIST from it.
    const tween = Shared.targets.tween
    expect(tween).toBeTruthy()
    Shared.targets.tween = null
    // As time runs the camera rides it: its offset holds.
    sys.camera.position.set(0, 0, 3e5)
    sys.scene.updateMatrixWorld()
    const offset = () => sys.camera.getWorldPosition(new Vector3).sub(node.getWorldPosition(new Vector3))
    const before = offset()
    animate(sys, EPOCH_JD + (10 / 1440))
    expect(offset().distanceTo(before)).toBeLessThan(1)
  })

  it('leaves a satellite for Earth\'s frame when following goes off', async () => {
    const sys = solarSystem()
    await sys.s.loadSatellites()
    animate(sys, EPOCH_JD)
    sys.s.setTarget(ISS, {look: false})
    sys.s.goTo()
    Shared.targets.tween = null
    const node = sys.s.satellites.node(25544)
    const camWorld = sys.camera.getWorldPosition(new Vector3)
    sys.s.setFollowing(false)
    expect(Shared.targets.follow).toBeNull()
    expect(sys.camera.platform.parent).toBe(sys.earth.orbitPosition)
    expect(Shared.targets.cur).toBe(sys.earth)
    expect(sys.camera.getWorldPosition(new Vector3).distanceTo(camWorld)).toBeLessThan(1)
    // 'f' on again rides the satellite.
    sys.s.setFollowing(true)
    expect(Shared.targets.follow).toBe(node)
    expect(sys.camera.platform.parent).toBe(node)
  })

  it('goes to Earth for a satellite with no elements for the date', async () => {
    const sys = solarSystem()
    await sys.s.loadSatellites()
    animate(sys, EPOCH_JD + 60)
    sys.s.setTarget(ISS, {look: false})
    expect(sys.s.labelPosition(ISS)).toBeNull()
    sys.s.goTo()
    expect(sys.camera.platform.parent).toBe(sys.earth.orbitPosition)
    expect(Shared.targets.label).toBeNull()
    expect(sys.s.getTarget()).toEqual({kind: 'body', name: 'earth'})
  })
})
