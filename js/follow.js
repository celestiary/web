import {Quaternion, Vector3} from 'three'


const _pos = new Vector3
const _quat = new Quaternion
const _platformQuat = new Quaternion


/**
 * Hang the camera's platform on a new node and put the camera back where it
 * was and facing as it was, in the world: the same world position and the
 * same world orientation, so the frame changes and the picture doesn't.
 * Following (`f`) is this, onto the followed body's `orbitPosition`: from
 * then on the camera is carried by the body's orbit as the scene graph
 * moves it, with no per-frame work and no accumulating error (DESIGN.md,
 * "Follow").
 *
 * The camera's local position then is its offset from the new anchor,
 * which is small whatever the anchor's distance from the Sun, so the
 * precision is that of a camera at the body (the frame-local way `goTo`
 * works).  The platform is left at the anchor's origin with no rotation,
 * which the controls rely on (`controls.target` is the platform's
 * position).
 *
 * The world matrices are read fresh from the nodes' local transforms, so
 * call it after the frame's animation, when the bodies are where they will
 * be drawn: the camera's offset from the anchor is then that of the frame
 * about to render.
 *
 * @param {object} platform The camera's platform (`camera.platform`)
 * @param {object} camera The camera, platform's child
 * @param {object} anchor The node to hang the platform on, in the scene
 */
export function rehangPlatform(platform, camera, anchor) {
  camera.updateWorldMatrix(true, false)
  camera.getWorldPosition(_pos)
  camera.getWorldQuaternion(_quat)
  anchor.add(platform)
  platform.position.set(0, 0, 0)
  platform.quaternion.identity()
  platform.updateWorldMatrix(true, false)
  camera.position.copy(platform.worldToLocal(_pos))
  platform.getWorldQuaternion(_platformQuat)
  camera.quaternion.copy(_platformQuat.invert().multiply(_quat))
}
