import {describe, expect, it} from 'bun:test'
import {Object3D, PerspectiveCamera, Quaternion, Scene, Vector3} from 'three'
import {rehangPlatform} from './follow.js'
import {formatNavMode} from './navMode.js'


const JUPITER_M = 7.78e11 // about 5.2 AU
const MM = 1e-3 // a millimetre, in metres


/**
 * A camera on a platform at the Sun's orbit node, with Jupiter's node
 * beside it in the same scene, as the app has them: both under a world
 * group, unrotated.
 *
 * @returns {object}
 */
function rig() {
  const scene = new Scene
  const world = new Object3D
  scene.add(world)
  const sun = new Object3D
  world.add(sun)
  const jupiter = new Object3D
  jupiter.position.set(JUPITER_M, 0, 0)
  world.add(jupiter)
  const platform = new Object3D
  sun.add(platform)
  const camera = new PerspectiveCamera
  platform.add(camera)
  // 3e8 m from Jupiter, off to one side, turned to look off at an angle.
  camera.position.set(JUPITER_M + 3e8, 1e8, -2e8)
  camera.quaternion.setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), 0.9)
  scene.updateMatrixWorld()
  return {scene, world, sun, jupiter, platform, camera}
}


/**
 * @param {object} camera
 * @returns {Quaternion}
 */
function worldQuat(camera) {
  return camera.getWorldQuaternion(new Quaternion)
}


describe('rehangPlatform', () => {
  it('keeps the camera where it is and as it faces', () => {
    const {scene, jupiter, platform, camera} = rig()
    const pos = camera.getWorldPosition(new Vector3)
    const quat = worldQuat(camera)
    rehangPlatform(platform, camera, jupiter)
    scene.updateMatrixWorld()
    expect(platform.parent).toBe(jupiter)
    expect(camera.getWorldPosition(new Vector3).distanceTo(pos)).toBeLessThan(MM)
    expect(worldQuat(camera).angleTo(quat)).toBeLessThan(1e-12)
  })

  it('leaves the platform at its anchor, unturned, for the controls', () => {
    const {jupiter, platform, camera} = rig()
    platform.position.set(1, 2, 3)
    rehangPlatform(platform, camera, jupiter)
    expect(platform.position.toArray()).toEqual([0, 0, 0])
    expect(platform.quaternion.angleTo(new Quaternion)).toBe(0)
  })

  it('makes the camera\'s position its small offset from the anchor', () => {
    // Not the 7.8e11 m from the Sun: the precision is that of a camera at Jupiter.
    const {jupiter, platform, camera} = rig()
    rehangPlatform(platform, camera, jupiter)
    expect(camera.position.distanceTo(new Vector3(3e8, 1e8, -2e8))).toBeLessThan(MM)
  })

  it('reads the nodes as they are now, not as the last render left them', () => {
    // The animation has moved Jupiter and the Sun's frame; no matrix update since.
    const {scene, sun, jupiter, platform, camera} = rig()
    jupiter.position.set(JUPITER_M, 5e10, 0)
    sun.position.set(0, 0, 1e9)
    rehangPlatform(platform, camera, jupiter)
    scene.updateMatrixWorld()
    // The camera rode the Sun's node to its new place, then was hung on Jupiter's there.
    expect(camera.getWorldPosition(new Vector3).distanceTo(
        new Vector3(JUPITER_M + 3e8, 1e8, -2e8 + 1e9))).toBeLessThan(MM)
    expect(camera.position.distanceTo(new Vector3(3e8, 1e8 - 5e10, -2e8 + 1e9))).toBeLessThan(MM)
  })

  it('carries the camera with the new anchor, its offset and its quaternion unchanged', () => {
    const {scene, jupiter, platform, camera} = rig()
    rehangPlatform(platform, camera, jupiter)
    const quat = camera.quaternion.clone()
    const offset = camera.getWorldPosition(new Vector3).sub(jupiter.getWorldPosition(new Vector3))
    // A twelfth of Jupiter's orbit, a frame at a time.
    for (let i = 1; i <= 360; i++) {
      const a = i * Math.PI / 180 / 12
      jupiter.position.set(JUPITER_M * Math.cos(a), 0, -JUPITER_M * Math.sin(a))
      scene.updateMatrixWorld()
      const now = camera.getWorldPosition(new Vector3).sub(jupiter.getWorldPosition(new Vector3))
      expect(now.distanceTo(offset)).toBeLessThan(MM)
    }
    expect(camera.quaternion.angleTo(quat)).toBe(0)
    expect(worldQuat(camera).angleTo(quat)).toBeLessThan(1e-12)
  })

  it('keeps the camera still in the world when the platform goes back to a fixed frame', () => {
    const {scene, sun, jupiter, platform, camera} = rig()
    rehangPlatform(platform, camera, jupiter)
    jupiter.position.set(0, 0, -JUPITER_M)
    scene.updateMatrixWorld()
    const pos = camera.getWorldPosition(new Vector3)
    rehangPlatform(platform, camera, sun)
    scene.updateMatrixWorld()
    expect(camera.getWorldPosition(new Vector3).distanceTo(pos)).toBeLessThan(MM)
    jupiter.position.set(JUPITER_M, 0, 0)
    scene.updateMatrixWorld()
    expect(camera.getWorldPosition(new Vector3).distanceTo(pos)).toBeLessThan(MM)
  })
})


describe('formatNavMode', () => {
  it('says which mode and whether it is on', () => {
    expect(formatNavMode('track', true)).toBe('Tracking on')
    expect(formatNavMode('track', false)).toBe('Tracking off')
    expect(formatNavMode('follow', true)).toBe('Following on')
    expect(formatNavMode('follow', false)).toBe('Following off')
  })
})
