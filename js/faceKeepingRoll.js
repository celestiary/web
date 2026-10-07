import {Matrix4, Object3D, Quaternion, Vector3} from 'three'


const _pos = new Vector3
const _scale = new Vector3
const _forward = new Vector3
const _dir = new Vector3
const _worldQuat = new Quaternion
const _swing = new Quaternion
const _parentQuat = new Quaternion
const _parentMatrix = new Matrix4


/**
 * Turn a camera to face a world-space point by the shortest turn, leaving
 * its roll about the view axis as it is.  Object3D.lookAt resets the roll
 * to the camera's up vector every call; this carries the camera's own
 * orientation along instead, so whatever roll the user gave it (the arrow
 * keys, the trackball) holds while the target stays centred, as when
 * tracking (`t`) runs time over a moving target.
 *
 * @param {Object3D} camera Any Object3D, as lookAt takes
 * @param {Vector3} point World space
 */
export function faceKeepingRoll(camera, point) {
  camera.updateWorldMatrix(true, false)
  camera.matrixWorld.decompose(_pos, _worldQuat, _scale)
  _dir.copy(point).sub(_pos)
  if (_dir.lengthSq() === 0) {
    return
  }
  _dir.normalize()
  _forward.set(0, 0, -1).applyQuaternion(_worldQuat)
  _swing.setFromUnitVectors(_forward, _dir)
  _worldQuat.premultiply(_swing)
  if (camera.parent) {
    _parentMatrix.extractRotation(camera.parent.matrixWorld)
    _parentQuat.setFromRotationMatrix(_parentMatrix)
    _worldQuat.premultiply(_parentQuat.invert())
  }
  camera.quaternion.copy(_worldQuat).normalize()
}
