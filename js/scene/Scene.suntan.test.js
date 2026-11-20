import {describe, expect, it} from 'bun:test'
import {BufferGeometry, Float32BufferAttribute, Object3D, PerspectiveCamera, Points, Scene as ThreeScene,
  Vector3} from 'three'
import * as Shared from '../shared.js'
// Scene's side of the Suntan app (suntan/Suntan.md): building the mission
// under the Sun, its craft as targets, going to one and riding it, and
// leaving it when the app stops.
const Scene = (await import('./Scene.js')).default
const {installSuntan} = await import('./suntan/install.js')


/** @returns {object} rings without a shader: a point whose place the track sets */
function stubRings() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(3), 3))
  return new Points(geometry)
}


/** @returns {object} The Sun, a Scene and the camera in the Sun's frame */
function sunOnly() {
  const scene = new ThreeScene()
  const camera = new PerspectiveCamera(45, 1, 1, 1e13)
  camera.platform = new Object3D()
  camera.platform.add(camera)
  const ui = {scene, camera, addClickCb: () => {}, useStore: {getState: () => ({})}}
  const s = new Scene(ui)
  scene.add(s.worldGroup)
  const orbitPosition = new Object3D()
  orbitPosition.name = 'sun.orbitPosition'
  s.worldGroup.add(orbitPosition)
  const sun = new Object3D()
  sun.name = 'sun'
  sun.props = {name: 'sun', radius: {scalar: 6.957e8}}
  sun.orbitPosition = orbitPosition
  orbitPosition.add(sun)
  s.objects.sun = sun
  s.objects['sun.orbitPosition'] = orbitPosition
  orbitPosition.add(camera.platform)
  camera.position.set(0, 3e11, 1e11)
  scene.updateMatrixWorld()
  Object.assign(Shared.targets, {cur: sun, landed: false, tween: null, follow: null, label: null, obj: sun})
  s._syncRegimes = () => {/* none */}
  s._syncLagrange = () => {/* none */}
  // The real feature, with stand-ins for what draws to a canvas or a shader.
  s.loadSuntan = () => Promise.resolve({
    installSuntan: (sc, deps) => installSuntan(sc, {
      ...deps,
      newRings: stubRings,
      newLabels: () => ({sheet: {positionAttribute: null}, sprites: new Object3D()}),
      newWideLineStrip: () => new Object3D(),
    }),
  })
  return {s, scene, camera, sun}
}

const RELEASE_S = Date.parse('2027-04-29T12:00:00Z') / 1000


describe('Scene and the Suntan app', () => {
  it('builds the mission under the Sun, its craft nodes beside it, and says so', async () => {
    const {s, sun} = sunOnly()
    let changes = 0
    s.onSuntanChange = () => changes++
    const suntan = await s.getSuntan()
    expect(suntan.track.parent).toBe(sun.orbitPosition)
    expect(suntan.track.nodes.relay.parent).toBe(sun.orbitPosition)
    expect(s._overlayNodes('o')).toContain(suntan.track)
    expect(changes).toBe(1)
    // Before launch neither craft has a place to go to.
    suntan.track.place(suntan.mission.tStart - 1)
    expect(suntan.nodeOf('relay')).toBe(null)
  })

  it('goes to a craft and rides it, the Sun the body', async () => {
    const {s, scene, camera, sun} = sunOnly()
    const suntan = await s.getSuntan()
    suntan.track.place(RELEASE_S)
    scene.updateMatrixWorld()
    s.setTarget(suntan.craft.lander, {look: false})
    expect(Shared.targets.obj).toBe(sun)
    expect(s.labelPosition(suntan.craft.lander).length()).toBeGreaterThan(1e10)
    s.goTo()
    const node = suntan.nodeOf('lander')
    expect(camera.platform.parent).toBe(node)
    expect(Shared.targets.follow).toBe(node)
    Shared.targets.tween = null
    // As time runs the camera moves with it.
    camera.position.set(0, 0, 3e9)
    scene.updateMatrixWorld()
    const offset = () => camera.getWorldPosition(new Vector3).sub(node.getWorldPosition(new Vector3))
    const before = offset()
    suntan.track.place(RELEASE_S + 86400)
    scene.updateMatrixWorld()
    expect(offset().distanceTo(before)).toBeLessThan(1)
  })

  it('leaves the craft for the Sun\'s frame when the app stops, the camera where it was', async () => {
    const {s, scene, camera, sun} = sunOnly()
    const suntan = await s.getSuntan()
    suntan.track.place(RELEASE_S)
    scene.updateMatrixWorld()
    s.setTarget(suntan.craft.relay, {look: false})
    s.goTo()
    Shared.targets.tween = null
    scene.updateMatrixWorld()
    const world = camera.getWorldPosition(new Vector3)
    let changes = 0
    s.onSuntanChange = () => changes++
    s.removeSuntan()
    scene.updateMatrixWorld()
    expect(camera.platform.parent).toBe(sun.orbitPosition)
    expect(camera.getWorldPosition(new Vector3).distanceTo(world)).toBeLessThan(1)
    expect(Shared.targets.label).toBe(null)
    expect(s.suntan).toBe(null)
    expect(changes).toBe(1)
  })
})
