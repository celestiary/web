import {describe, expect, it} from 'bun:test'
import {BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Line, Mesh, Object3D, PerspectiveCamera, Points,
  Scene as ThreeScene, Vector3} from 'three'
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


/**
 * @param {Float32Array} positions
 * @param {object} opts
 * @returns {object} a Line in a wide line strip's place: the same position
 *   attribute and draw range, which the track's BodyLines write
 */
function stubLine(positions, {name}) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const line = new Line(geometry)
  line.name = name
  return line
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
      newWideLineStrip: stubLine,
      loadModel: () => modelPromise,
    }),
  })
  return {s, scene, camera, sun}
}

const RELEASE_S = Date.parse('2027-04-29T12:00:00Z') / 1000
// The flight system's model as loadModel hands it over; never in unless a
// test says (there's no fetch or decoder in bun).
let modelPromise = new Promise(() => {})


/** @returns {Group} An assembly of the GLB's shape: a shield and a wheel of landers */
function assembly() {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(2.3, 0.1, 2.3)))
  const wheel = new Group()
  wheel.position.y = -7
  root.add(wheel)
  for (const y of [4, -4]) {
    const lander = new Group()
    lander.name = 'Lander'
    lander.position.y = y
    lander.add(new Mesh(new BoxGeometry(1.2, 1.2, 1.2)))
    wheel.add(lander)
  }
  return root
}


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
    // The craft, not the Sun, keys the exposure (ThreeUi._updateExposure).
    expect(s.targetCraftNode()).toBe(suntan.nodeOf('lander'))
    expect(s.labelPosition(suntan.craft.lander).length()).toBeGreaterThan(1e10)
    s.goTo()
    const node = suntan.nodeOf('lander')
    expect(camera.platform.parent).toBe(node)
    expect(Shared.targets.follow).toBe(node)
    // The zoom is about the craft (zoom.js homeBody), a few metres across.
    expect(node.isCraftNode).toBe(true)
    expect(node.props.radius.scalar).toBeLessThan(20)
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

  it('puts each mark at its craft by the object\'s position, the vertex at the origin', async () => {
    // A vertex at 2.5e10 m is a float32 good to 2 km: the mark jumped
    // about the model as the camera closed in.  Object positions stay
    // doubles until three takes the camera's out.
    const {s, scene} = sunOnly()
    const suntan = await s.getSuntan()
    suntan.track.place(RELEASE_S)
    scene.updateMatrixWorld()
    for (const id of ['relay', 'lander']) {
      const mark = suntan.track[id]
      const node = suntan.track.nodes[id]
      expect(mark.visible).toBe(true)
      expect(Array.from(mark.geometry.getAttribute('position').array)).toEqual([0, 0, 0])
      expect(mark.position.equals(node.position)).toBe(true)
      expect(mark.label.sprites.position.equals(node.position)).toBe(true)
    }
  })

  it('draws the line a craft is on through it, relative to it, as time runs', async () => {
    // Plain float32 vertices 2.5e10 m out are good to 2 km, and 720 chords
    // sag 235 km inside the orbit: close up the line jumped about the craft.
    const {s} = sunOnly()
    const suntan = await s.getSuntan()
    const lineOf = (id) => suntan.track.lines.find((l) => l.leg.id === id).drawn.line
    for (const t of [RELEASE_S + 3600, RELEASE_S + 3601, RELEASE_S + (40 * 86400)]) {
      suntan.track.place(t)
      const relay = suntan.track.nodes.relay.position
      // The relay orbit's line: its origin the relay, a vertex at it.
      const line = lineOf('relay')
      expect(line.position.equals(relay)).toBe(true)
      const xyz = line.geometry.getAttribute('position').array
      const n = line.geometry.drawRange.count
      let atCraft = false
      for (let j = 0; j < n; j++) {
        atCraft ||= xyz[3 * j] === 0 && xyz[(3 * j) + 1] === 0 && xyz[(3 * j) + 2] === 0
      }
      expect(atCraft).toBe(true)
      // The same circle before release, drawn again, goes through it too.
      expect(lineOf('sync').position.equals(relay)).toBe(true)
      // A leg no craft is on is drawn plainly, about the Sun.
      expect(lineOf('psp1').position.length()).toBe(0)
    }
    // And the lander's, on its descent.
    suntan.track.place(RELEASE_S + 86400)
    expect(lineOf('descent').position.equals(suntan.track.nodes.lander.position)).toBe(true)
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

  it('puts the flight system\'s model on the craft, the lander flying off on its own after release', async () => {
    modelPromise = Promise.resolve(assembly())
    try {
      const {s} = sunOnly()
      const suntan = await s.getSuntan()
      // A mark alone is no sunlit surface for the meter.
      expect(s.sunlitCraft()).toEqual([])
      await modelPromise
      await Promise.resolve()
      const {relay, lander, released} = suntan.track.models
      expect(relay.parent).toBe(suntan.track.nodes.relay)
      expect(lander.parent).toBe(suntan.track.nodes.lander)
      // The zoom's size is the model's now.
      expect(suntan.track.nodes.relay.props.radius.scalar).toBeCloseTo(relay.radius, 9)
      // Before release one stack; after, the copy flies and the wheel's own is gone.
      suntan.track.place(Date.parse('2027-03-01T00:00:00Z') / 1000)
      expect([relay.visible, lander.visible, released.visible]).toEqual([true, false, true])
      // The meter's sunlit craft are those whose models show.
      const nodes = suntan.track.nodes
      expect(s.sunlitCraft()).toEqual([nodes.relay])
      suntan.track.place(RELEASE_S)
      expect([relay.visible, lander.visible, released.visible]).toEqual([true, true, false])
      expect(s.sunlitCraft()).toEqual([nodes.relay, nodes.lander])
      expect(nodes.lander.props.albedo).toBeGreaterThan(0)
      // Its shield faces the Sun.
      const up = new Vector3(0, 1, 0).applyQuaternion(relay.quaternion)
      const sunward = suntan.track.nodes.relay.position.clone().negate().normalize()
      expect(up.dot(sunward)).toBeCloseTo(1, 6)
    } finally {
      modelPromise = new Promise(() => {})
    }
  })
})
