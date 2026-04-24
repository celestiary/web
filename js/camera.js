import {
  Quaternion,
  Vector3,
} from 'three'
import {Easing, Tween} from '@tweenjs/tween.js'


/**
 * @param {Camera} camera
 * @param {Matrix4|Vector3} targetMatrixOrPos World-space target — either a Matrix4
 *   (position extracted via setFromMatrixPosition) or a Vector3 used directly.
 * @returns {Tween}
 */
export function newCameraLookTween(camera, targetMatrixOrPos) {
  const tPos = targetMatrixOrPos.isMatrix4 ?
    new Vector3().setFromMatrixPosition(targetMatrixOrPos) :
    targetMatrixOrPos.clone()
  const startQuat = new Quaternion().copy(camera.quaternion)
  // Preserve the camera's current roll by using its world-up as the up hint,
  // so only pitch and yaw change — same convention as newCameraGoToTween.
  const worldUp = new Vector3(0, 1, 0).applyQuaternion(startQuat)
  camera.up.copy(worldUp)
  camera.lookAt(tPos)
  const endQuat = new Quaternion().copy(camera.quaternion)
  camera.up.set(0, 1, 0)
  camera.quaternion.copy(startQuat)
  return new Tween({t: 0})
      .to({t: 1}, 600)
      .easing(Easing.Quadratic.InOut)
      .onUpdate((obj) => camera.quaternion.slerpQuaternions(startQuat, endQuat, obj.t))
      .start()
}


/**
 * Animate camera position and rotation when jumping to a new target.
 *
 * Split timing: rotation runs 0–60% of the tween, position 40–100%, with a
 * 40–60% overlap so the camera never stops between "turning" and "traveling".
 * Each channel is eased independently (quadratic in-out) so the rotation
 * settles as movement ramps up.
 *
 * Rotation: quaternion slerp from startQuat → endQuat.  endQuat is the lookAt
 * orientation from the arrival position, with the camera's current world-up
 * as the up-hint so pitch/yaw change but roll (horizon) is preserved.
 *
 * @param {object} camera
 * @param {Vector3} targetWorldPos World-space position to look at
 * @param {Vector3} endLocalPos Destination camera position in platform-local space
 * @returns {Tween}
 */
export function newCameraGoToTween(camera, targetWorldPos, endLocalPos) {
  const startPos = camera.position.clone()
  const startQuat = camera.quaternion.clone()

  const worldUp = new Vector3(0, 1, 0).applyQuaternion(startQuat)
  camera.up.copy(worldUp)
  camera.position.copy(endLocalPos)
  camera.lookAt(targetWorldPos)
  const endQuat = camera.quaternion.clone()
  camera.up.set(0, 1, 0)
  camera.position.copy(startPos)
  camera.quaternion.copy(startQuat)

  const totalMs = 1800
  const rotEnd = 0.6 // rotation finishes at 60% of total
  const posStart = 0.4 // position begins at 40% of total (overlap: 40–60%)

  return new Tween({t: 0})
      .to({t: 1}, totalMs)
      .easing(Easing.Linear.None) // easing applied per-channel below
      .onUpdate(({t}) => {
        const rotT = t < rotEnd ? (t / rotEnd) : 1
        camera.quaternion.slerpQuaternions(startQuat, endQuat, easeInOutQuad(rotT))
        if (t > posStart) {
          const posT = (t - posStart) / (1 - posStart)
          camera.position.lerpVectors(startPos, endLocalPos, easeInOutQuad(posT))
        }
      })
      .start()
}


/**
 * Quadratic ease-in-out.
 *
 * @param {number} t
 * @returns {number}
 */
function easeInOutQuad(t) {
  if (t < 0.5) {
    return 2 * t * t
  }
  const u = 2 - (2 * t)
  return 1 - ((u * u) / 2)
}
