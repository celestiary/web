import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Quaternion, Vector3} from 'three'
import {faceKeepingRoll} from './faceKeepingRoll.js'


const ROLL = 0.61 // radians, about 35 degrees


/**
 * @param {Object3D} camera
 * @returns {Vector3} The camera's up axis, in world space
 */
function worldUp(camera) {
  return new Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new Quaternion()))
}


/**
 * @param {Object3D} camera
 * @param {Vector3} point
 * @returns {number} Degrees between the view direction and the point
 */
function offCentre(camera, point) {
  const view = new Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new Quaternion()))
  return view.angleTo(point.clone().sub(camera.getWorldPosition(new Vector3()))) * 180 / Math.PI
}


/**
 * A camera on a platform, looking down the world's -Z and rolled about its
 * view axis; the platform is turned about if `turned`, as the camera's is
 * in the scene.
 *
 * @param {boolean} turned
 * @returns {PerspectiveCamera}
 */
function newRolledCamera(turned) {
  const platform = new Object3D
  platform.position.set(10, -20, 5)
  if (turned) {
    platform.quaternion.setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.7)
  }
  const camera = new PerspectiveCamera
  platform.add(camera)
  platform.updateMatrixWorld(true)
  // Aim along world -Z, then roll.
  camera.quaternion.copy(platform.quaternion).invert()
  camera.rotateZ(ROLL)
  camera.updateMatrixWorld(true)
  return camera
}


describe('faceKeepingRoll', () => {
  it('centres the point, under a turned platform too', () => {
    for (const turned of [false, true]) {
      const camera = newRolledCamera(turned)
      const point = new Vector3(-300, 40, 200)
      faceKeepingRoll(camera, point)
      expect(offCentre(camera, point)).toBeLessThan(1e-6)
    }
  })

  it('keeps the roll while a point swings round the world\'s Y axis', () => {
    for (const turned of [false, true]) {
      const camera = newRolledCamera(turned)
      const here = camera.getWorldPosition(new Vector3())
      // A turn about Y keeps the Y component of every vector, so the rolled
      // camera's up axis keeps its Y; lookAt's reset to the world's up would
      // make it 1.
      const upY = worldUp(camera).y
      expect(upY).toBeCloseTo(Math.cos(ROLL), 6)
      for (let deg = 0; deg <= 60; deg += 10) {
        const a = deg * Math.PI / 180
        const point = here.clone().add(new Vector3(-Math.sin(a), 0, -Math.cos(a)).multiplyScalar(1000))
        faceKeepingRoll(camera, point)
        camera.updateMatrixWorld(true)
        expect(offCentre(camera, point)).toBeLessThan(1e-5)
        expect(worldUp(camera).y).toBeCloseTo(upY, 5)
      }
    }
  })

  it('turns by the shortest swing: about an axis square to both views', () => {
    const camera = newRolledCamera(true)
    const viewOf = () => new Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new Quaternion()))
    const before = viewOf()
    const q0 = camera.getWorldQuaternion(new Quaternion())
    faceKeepingRoll(camera, camera.getWorldPosition(new Vector3()).add(new Vector3(200, 450, -520)))
    camera.updateMatrixWorld(true)
    const turn = camera.getWorldQuaternion(new Quaternion()).multiply(q0.invert())
    const axis = new Vector3(turn.x, turn.y, turn.z).normalize()
    expect(Math.abs(axis.dot(before))).toBeLessThan(1e-5)
    expect(Math.abs(axis.dot(viewOf()))).toBeLessThan(1e-5)
  })

  it('is what lookAt is not: lookAt resets the roll', () => {
    const camera = newRolledCamera(false)
    camera.lookAt(camera.getWorldPosition(new Vector3()).add(new Vector3(-500, 0, -866)))
    expect(worldUp(camera).y).toBeCloseTo(1, 6)
  })

  it('does nothing at the camera\'s own position', () => {
    const camera = newRolledCamera(true)
    const q = camera.quaternion.clone()
    faceKeepingRoll(camera, camera.getWorldPosition(new Vector3()))
    expect(camera.quaternion.equals(q)).toBe(true)
  })
})
