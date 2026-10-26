import {afterEach, describe, expect, it, mock} from 'bun:test'
import {Group, Object3D, Vector3} from 'three'
import Animation from './Animation.js'
import {utcToTtJulianDay} from './celestialFrame.js'
import {clearModelCache, setGltfLoader} from './model.js'
import {Trajectory} from './trajectory.js'
import reifyMeasures from '../reify.js'
import table from '../../public/data/earth/spacecraft/webb/trajectory.json'
import webb from '../../public/data/earth/spacecraft/webb/index.json'


// No canvas in bun: the label's sheet is a stub, as Celestiary.test.js's
// (mock.module is process-global, and the two agree).
mock.module('./SpriteSheet', () => ({
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
const {default: Spacecraft} = await import('./Spacecraft.js')


const SECONDS_PER_DAY = 86400
// 2026-10-23 12:00 UTC: Webb near the Sun–Earth L2.
const JD = 2461337.0


/**
 * @param {object} props
 * @returns {object} props, its measures reified as Loader does
 */
function reified(props) {
  reifyMeasures(props)
  return props
}


/**
 * @returns {object} The bits of Scene a Spacecraft uses
 */
function fakeScene() {
  const scene = {objects: {}}
  scene.newGroup = (name) => {
    const g = new Object3D
    g.name = name
    scene.objects[name] = g
    return g
  }
  scene.overlayShown = () => true
  return scene
}


/**
 * @param {number} jd
 * @param {boolean} sceneUp Whether loadEphemeris has been called
 * @returns {Animation}
 */
function animationAt(jd, sceneUp = true) {
  const time = {simTimeJulianDay: () => jd, simTimeSecs: () => (jd - 2440587.5) * SECONDS_PER_DAY}
  const anim = new Animation(time, null)
  anim._sceneUp = sceneUp
  anim.setDate(jd)
  return anim
}


/**
 * Webb under a WorldGroup (the Sun at its origin) and an Earth 1 AU off on
 * +X, its table in place.
 *
 * @returns {{scene: object, craft: Spacecraft, world: Group, earth: Object3D}}
 */
function webbScene() {
  const scene = fakeScene()
  const world = new Group
  world.name = 'WorldGroup'
  const earth = new Object3D
  earth.name = 'earth.orbitPosition'
  earth.position.set(1.496e11, 0, 0)
  world.add(earth)
  const craft = new Spacecraft(scene, reified(structuredClone(webb)))
  earth.add(craft)
  scene.objects['webb.orbitPosition'].trajectory = new Trajectory(table)
  return {scene, craft, world, earth}
}


describe('Spacecraft', () => {
  afterEach(() => {
    setGltfLoader(null)
    clearModelCache()
  })

  it('is a body: a node with its props, its orbitPosition and a label', () => {
    const {scene} = webbScene()
    const node = scene.objects.webb
    expect(node.props.type).toBe('spacecraft')
    expect(node.props.radius.scalar).toBe(17)
    expect(node.orbitPosition).toBe(scene.objects['webb.orbitPosition'])
    expect(node.getObjectByName('label LOD')).toBeDefined()
    expect(node.getObjectByName('model LOD')).toBeDefined()
  })

  it('needs a radius with units', () => {
    const props = reified({...structuredClone(webb), radius: undefined})
    expect(() => new Spacecraft(fakeScene(), props)).toThrow()
  })

  it('is placed from its table, relative to its parent, and shown only over its span', () => {
    const {scene, world} = webbScene()
    const node = scene.objects.webb
    animationAt(JD).animateSystem(world)
    expect(node.visible).toBe(true)
    const pos = scene.objects['webb.orbitPosition'].position
    const want = new Trajectory(table).scenePositionAt(JD)
    expect(pos.distanceTo(want)).toBe(0)
    // Before launch: hidden, and left where it was.
    animationAt(2459500).animateSystem(world)
    expect(node.visible).toBe(false)
    expect(pos.distanceTo(want)).toBe(0)
  })

  it('asks for its table once the scene is up, not before, even with the ephemeris in', () => {
    const {scene, world} = webbScene()
    const orbitPosition = scene.objects['webb.orbitPosition']
    orbitPosition.trajectory = null
    let asks = 0
    orbitPosition.loadTrajectory = () => {
      asks++
    }
    // VSOP87C already in (an earlier page's import), the scene not yet up.
    const anim = animationAt(JD, false)
    anim._loadRequested = true
    anim.animateSystem(world)
    expect(asks).toBe(0)
    expect(scene.objects.webb.visible).toBe(false)
    // The reveal.
    anim.loadEphemeris()
    anim.animateSystem(world)
    expect(asks).toBe(1)
  })

  it('turns its sun axis to the Sun', () => {
    const {scene, world} = webbScene()
    const node = scene.objects.webb
    animationAt(JD).animateSystem(world)
    const toSun = new Vector3().sub(node.getWorldPosition(new Vector3)).normalize()
    const axis = node.attitude.sunAxis.clone().applyQuaternion(node.attitude.getWorldQuaternion(new Object3D().quaternion))
    expect(axis.angleTo(toSun)).toBeLessThan(1e-6)
  })

  it('loads its model when targeted, centred in its attitude node', async () => {
    const {scene, craft} = webbScene()
    craft.loadTrajectory = () => null
    const urls = []
    const {BoxGeometry, Mesh, MeshStandardMaterial} = await import('three')
    setGltfLoader((url) => {
      urls.push(url)
      const root = new Group
      const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial)
      // Off its origin, as JWST's is.
      box.position.set(5, 0, 0)
      root.add(box)
      return Promise.resolve(root)
    })
    const node = scene.objects.webb
    expect(node.surfaceReady()).toBe(false)
    node.preloadNear()
    node.preAnimCb()
    expect(urls).toEqual(['large/models/jwst/jwst.glb'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(node.surfaceReady()).toBe(true)
    const model = node.attitude.getObjectByName('model')
    model.updateMatrixWorld(true)
    const centre = model.children[0].getWorldPosition(new Vector3)
    expect(centre.distanceTo(node.attitude.getWorldPosition(new Vector3))).toBeLessThan(1e-3)
  })

  it('hides the Sun from behind its model, and nothing from beside it', async () => {
    const {scene, world, craft} = webbScene()
    craft.loadTrajectory = () => null
    const {BoxGeometry, Mesh, MeshStandardMaterial} = await import('three')
    // A 20 m slab, as a sunshield.
    setGltfLoader(() => {
      const root = new Group
      root.add(new Mesh(new BoxGeometry(20, 0.2, 20), new MeshStandardMaterial))
      return Promise.resolve(root)
    })
    const node = scene.objects.webb
    animationAt(JD).animateSystem(world)
    expect(node.sunBlocked(new Vector3, new Vector3, 0.005)).toBeNull()
    node.preloadNear()
    node.preAnimCb()
    await new Promise((resolve) => setTimeout(resolve, 0))
    world.updateMatrixWorld(true)
    const sun = new Vector3
    const here = node.getWorldPosition(new Vector3)
    const away = here.clone().sub(sun).normalize()
    const disc = Math.asin(6.957e8 / here.length())
    expect(node.sunBlocked(here.clone().addScaledVector(away, 30), sun, disc)).toEqual({fraction: 1, centre: true})
    // 100 m to the side the craft isn't over the disc: nothing tested.
    const side = new Vector3(0, 1, 0).cross(away).normalize()
    expect(node.sunBlocked(here.clone().addScaledVector(away, 30).addScaledVector(side, 100), sun, disc)).toBeNull()
    // Between it and the Sun: it's behind the camera.
    expect(node.sunBlocked(here.clone().addScaledVector(away, -30), sun, disc)).toBeNull()
  })

  it('takes TT for its table, as the Moon does', () => {
    // The table is in TDB; the 69 s of TT − UTC move Webb tens of km.
    const t = new Trajectory(table)
    const p = t.scenePositionAt(JD)
    const q = t.positionAt(utcToTtJulianDay(JD))
    expect(p.length() / 1000).toBeCloseTo(Math.hypot(...q), 3)
  })
})
