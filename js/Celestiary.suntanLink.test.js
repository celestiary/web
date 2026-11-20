import {describe, expect, it} from 'bun:test'
import {BufferGeometry, Float32BufferAttribute, Line, Object3D, PerspectiveCamera, Points, Quaternion,
  Scene as ThreeScene, Vector3} from 'three'
import {worldToLatLngAlt} from './coords.js'
import {decodePermalink, encodePermalink, pathFromFragment} from './permalink.js'
import * as Shared from './shared.js'
import {parseTargetPath} from './targetPath.js'
// A link written riding a Suntan craft, and followed (design/URLs.md
// `suntan:`): the view in the craft's own frame, so it comes back metres
// off the craft, not 190 km, as in the Sun's frame 2.5e10 m away.
global.window ??= {innerWidth: 1, innerHeight: 1, addEventListener: () => {}}
const {default: Celestiary} = await import('./Celestiary.js')
const {default: Scene} = await import('./scene/Scene.js')
const {installSuntan} = await import('./scene/suntan/install.js')


const RELEASE_S = Date.parse('2027-04-29T12:00:00Z') / 1000


/**
 * @param {Float32Array} positions
 * @returns {object} a Line in a wide line strip's place
 */
function stubLine(positions) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return new Line(geometry)
}


/** @returns {object} rings without a shader */
function stubRings() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(3), 3))
  return new Points(geometry)
}


/**
 * A page as far as the link needs: the Sun, the Suntan mission round it at
 * a time, the camera on its platform, and the Celestiary methods that write
 * and restore the view, called on it.
 *
 * @returns {Promise<object>}
 */
async function page() {
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
  Object.assign(Shared.targets, {cur: sun, landed: false, tween: null, follow: null, label: null, obj: sun})
  s._syncRegimes = () => {/* none */}
  s._syncLagrange = () => {/* none */}
  s.loadSuntan = () => Promise.resolve({
    installSuntan: (sc, deps) => installSuntan(sc, {
      ...deps,
      newRings: stubRings,
      newLabels: () => ({sheet: {positionAttribute: null}, sprites: new Object3D()}),
      newWideLineStrip: stubLine,
      loadModel: () => new Promise(() => {}),
    }),
  })
  const suntan = await s.getSuntan()
  suntan.track.place(RELEASE_S)
  scene.updateMatrixWorld()
  const app = Object.create(Celestiary.prototype)
  Object.assign(app, {ui: {camera, scene}, scene: s, loader: {pathByName: {sun: 'sun'}}})
  return {app, s, suntan, camera, scene}
}


describe('a link riding a Suntan craft', () => {
  it('names the craft and its own frame, and puts the camera back where it was on it', async () => {
    const before = await page()
    const {app, s, suntan, camera, scene} = before
    s.setTarget(suntan.craft.relay, {look: false})
    s.goTo()
    Shared.targets.tween = null
    // 40 m off, the platform turned on the node (as a ride can leave it)
    // and the camera turned on the platform.
    camera.platform.quaternion.setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.7)
    camera.position.set(25, -12, 29)
    camera.quaternion.setFromAxisAngle(new Vector3(-2, 1, 0.5).normalize(), 1.1)
    scene.updateMatrixWorld()
    const node = suntan.nodeOf('relay')
    const offset = (cam, n) => cam.getWorldPosition(new Vector3()).sub(n.getWorldPosition(new Vector3()))
    const want = offset(camera, node)
    const wantDir = new Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new Quaternion()))

    const frame = app._cameraFrame()
    expect(frame.path).toBe('suntan:relay')
    const {lat, lng, alt} = worldToLatLngAlt(camera.getWorldPosition(new Vector3()), frame.pos, frame.quat, frame.radius)
    const link = encodePermalink('suntan:relay', 0, lat, lng, alt, s.linkCameraQuaternion(), 45)
    expect(pathFromFragment(link)).toBe('suntan:relay')
    expect(parseTargetPath(pathFromFragment(link))).toEqual({kind: 'craft', id: 'relay'})

    // Followed in a fresh page at the same time, the camera far off.
    const after = await page()
    const pl = decodePermalink(link)
    after.app._restoreCraftView(pl, {kind: 'craft', id: 'relay'})
    after.scene.updateMatrixWorld()
    const node2 = after.suntan.nodeOf('relay')
    expect(after.camera.platform.parent).toBe(node2)
    const got = offset(after.camera, node2)
    // The link's metre and four decimals of a degree: well under a metre.
    expect(got.distanceTo(want)).toBeLessThan(0.6)
    const gotDir = new Vector3(0, 0, -1).applyQuaternion(after.camera.getWorldQuaternion(new Quaternion()))
    expect(gotDir.angleTo(wantDir)).toBeLessThan(1e-3)
  })

  it('goes to the Sun when the craft isn\'t in flight at the link\'s time', async () => {
    const {app, suntan, camera} = await page()
    suntan.track.place(suntan.mission.tStart - 1)
    app._restoreCraftView({lat: 0, lng: 0, alt: 34, quat: {x: 0, y: 0, z: 0, w: 1}}, {kind: 'craft', id: 'relay'})
    expect(camera.platform.parent).not.toBe(suntan.track.nodes.relay)
    expect(Shared.targets.obj.name).toBe('sun')
  })
})
