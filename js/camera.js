import {
  Camera,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import {Easing, Tween} from '@tweenjs/tween.js'


/**
 * @param {Camera} camera
 * @param {Matrix4} targetMatrixWorld
 * @returns {Tween}
 */
export function newCameraLookTween(camera, targetMatrixWorld) {
  const tPos = new Vector3().setFromMatrixPosition(targetMatrixWorld)
  const startQuat = new Quaternion().copy(camera.quaternion)
  camera.lookAt(tPos)
  const endQuat = new Quaternion().copy(camera.quaternion)
  camera.quaternion.copy(startQuat)
  return new Tween({t: 0})
      .to({t: 1}, 600)
      .easing(Easing.Quadratic.InOut)
      .onUpdate((obj) => camera.quaternion.slerpQuaternions(startQuat, endQuat, obj.t))
      .start()
}


/**
 * Animate camera position and rotation together when jumping to a new target.
 * Call this after re-parenting the camera platform but before setting the
 * final camera position, so camera.position still holds the departure offset.
 *
 * @param {Camera} camera
 * @param {Vector3} targetWorldPos World-space position to look at
 * @param {Vector3} endLocalPos Destination camera position in platform-local space
 * @returns {Tween}
 */
export function newCameraGoToTween(camera, targetWorldPos, endLocalPos) {
  const startPos = camera.position.clone()
  const startQuat = new Quaternion().copy(camera.quaternion)

  // Compute endQuat from the arrival position so rotation and position
  // both reach their final values at the same moment with no snap.
  // Three.js lookAt uses the object's current local position via updateWorldMatrix,
  // so we temporarily move to endLocalPos, sample the quaternion, then restore.
  camera.position.copy(endLocalPos)
  camera.lookAt(targetWorldPos)
  const endQuat = new Quaternion().copy(camera.quaternion)
  camera.position.copy(startPos)
  camera.quaternion.copy(startQuat)

  return new Tween({t: 0})
      .to({t: 1}, 1500)
      .easing(Easing.Quadratic.InOut)
      .onUpdate(({t}) => {
        camera.position.lerpVectors(startPos, endLocalPos, t)
        camera.quaternion.slerpQuaternions(startQuat, endQuat, t)
      })
      .start()
}
