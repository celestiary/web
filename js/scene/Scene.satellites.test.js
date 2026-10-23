import {afterEach, describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Scene as ThreeScene, Vector3} from 'three'
import Population from './population/Population.js'
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
  constructor() {
    this.positions = []
    this.positionAttribute = null
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  add(x, y, z) {
    this.positions.push(x, y, z)
  }

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
  const mars = body('mars', 'sun', sun.orbitPosition, 3.3895e6)
  mars.orbitPosition.position.set(2.28e11, 0, 0)
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
  return {s, scene, camera, sun, earth, mars}
}


/**
 * A population of another body, its objects where the records say: what a
 * Mars-orbiter or Deep Space Network loader would add (addPopulation).
 */
class FixedPopulation extends Population {
  /**
   * @param {object} rec
   * @param {number} jd
   * @param {Vector3} out
   * @returns {boolean}
   */
  positionAt(rec, jd, out) {
    out.set(rec.x, 0, 0)
    return true
  }
}


/** @returns {FixedPopulation} two Mars orbiters in two groups */
const marsOrbiters = () => new FixedPopulation([
  {id: 1, name: 'MRO', group: 'nasa', x: 3.7e6, known: true},
  {id: 2, name: 'Mars Express', group: 'esa', x: 4e6},
], {body: 'mars', title: 'Orbiters', groups: {nasa: {label: 'NASA', color: '#ffffff'}, esa: {label: 'ESA'}},
  Sheet: StubSheet})


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

  it('arrives above a satellite on Earth\'s far side, not under it', async () => {
    const sys = solarSystem()
    await sys.s.loadSatellites()
    animate(sys, EPOCH_JD)
    const node = sys.s.satellites.node(25544)
    const earthAt = sys.earth.getWorldPosition(new Vector3)
    const up = node.getWorldPosition(new Vector3).sub(earthAt).normalize()
    // The camera far out on the other side of Earth.
    sys.camera.position.copy(earthAt).addScaledVector(up, -2e8)
    sys.scene.updateMatrixWorld()
    sys.s.setTarget(ISS, {look: false})
    sys.s.goTo()
    // Run the tween to its end: read where it puts the camera.
    Shared.targets.tween.update(Infinity)
    sys.scene.updateMatrixWorld()
    const cam = sys.camera.getWorldPosition(new Vector3)
    const satAt = node.getWorldPosition(new Vector3)
    expect(cam.distanceTo(earthAt)).toBeGreaterThan(satAt.distanceTo(earthAt))
    expect(cam.distanceTo(satAt)).toBeCloseTo(300e3, -3)
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

  it('takes another body\'s population the same way: hung from its tilt, in the orbits group, targetable', () => {
    const sys = solarSystem()
    const added = []
    sys.s.onPopulationAdded((p) => added.push(p.body))
    const pop = marsOrbiters()
    sys.s.addPopulation(pop)
    expect(added).toEqual(['mars'])
    expect(pop.parent).toBe(sys.s.objects['mars.planetTilt'])
    expect(sys.s.populationOf('mars')).toBe(pop)
    expect(sys.s._overlayNodes('o')).toContain(pop.marks)
    pop.update(EPOCH_JD)
    const mro = {kind: 'satellite', id: 1, name: 'MRO', body: 'mars'}
    sys.s.setTarget(mro, {look: false})
    expect(Shared.targets.obj).toBe(sys.mars)
    expect(pop._targetId).toBe(1)
    sys.scene.updateMatrixWorld()
    const at = sys.s.labelPosition(mro).sub(sys.mars.getWorldPosition(new Vector3))
    expect(at.length()).toBeCloseTo(3.7e6, -2)
    sys.s.goTo()
    const node = pop.node(1)
    expect(sys.camera.platform.parent).toBe(node)
    expect(Shared.targets.cur).toBe(sys.mars)
    // Following off leaves the camera with Mars, not Earth.
    Shared.targets.tween = null
    sys.s.setFollowing(false)
    expect(sys.camera.platform.parent).toBe(sys.mars.orbitPosition)
  })

  it('keeps each population\'s groups and names for the link, and puts a link\'s back, before or after it\'s in', () => {
    const sys = solarSystem()
    let changes = 0
    sys.s.onSettingsChange = () => changes++
    // A link's state for Mars before its population is in: kept, and written back as it was.
    const linkState = new Map([['mars', {shown: new Set(['esa']), labels: 2}]])
    sys.s.restorePopulations(linkState)
    expect(sys.s.getPopulationState()).toEqual(linkState)
    const pop = marsOrbiters()
    sys.s.addPopulation(pop)
    expect(pop.isGroupShown('nasa')).toBe(false)
    expect(pop.isGroupShown('esa')).toBe(true)
    // Its budget can't ask for more than the shown groups hold: one, which
    // is its default (one known), so the link no longer says it.
    expect(pop.labelBudget).toBe(1)
    expect(changes).toBe(0)
    expect(sys.s.getPopulationState()).toEqual(new Map([['mars', {shown: new Set(['esa']), labels: null, counts: null}]]))
    // The panel's controls rewrite the link.
    sys.s.setPopulationGroup('mars', 'nasa', true)
    sys.s.setPopulationLabels('mars', 2)
    expect(changes).toBe(2)
    expect(sys.s.getPopulationState()).toEqual(new Map([['mars', {shown: null, labels: 2, counts: null}]]))
    // Back to its default, the same budget again is no change.
    sys.s.setPopulationLabels('mars', pop.defaultLabelBudget)
    sys.s.setPopulationLabels('mars', pop.defaultLabelBudget)
    expect(changes).toBe(3)
    expect(sys.s.getPopulationState()).toEqual(new Map)
  })

  it('keeps how many of a counted group show for the link, and puts a link\'s back', () => {
    const sys = solarSystem()
    let changes = 0
    sys.s.onSettingsChange = () => changes++
    // A link's count, before the population is in, bounding its budget.
    sys.s.restorePopulations(new Map([['mars', {shown: null, labels: 2, counts: new Map([['fleet', 2]])}]]))
    const pop = new FixedPopulation([1, 2, 3, 4].map((id) => ({id, name: `Orbiter ${id}`, group: 'fleet', x: 4e6})),
        {body: 'mars', groups: {fleet: {label: 'Fleet', count: 1, orderedBy: 'number'}}, Sheet: StubSheet})
    sys.s.addPopulation(pop)
    expect(pop.groupCount('fleet')).toBe(2)
    expect(pop.labelBudget).toBe(2)
    expect(changes).toBe(0)
    // Its names behind Mars take no room: the scene gives it Mars's radius.
    expect(pop.bodyRadius).toBe(sys.mars.props.radius.scalar)
    sys.s.setPopulationCount('mars', 'fleet', 3)
    expect(changes).toBe(1)
    expect(sys.s.getPopulationState()).toEqual(new Map([['mars', {shown: null, labels: 2,
      counts: new Map([['fleet', 3]])}]]))
    sys.s.setPopulationCount('mars', 'fleet', 1)
    sys.s.setPopulationLabels('mars', 0)
    expect(sys.s.getPopulationState()).toEqual(new Map)
  })
})
