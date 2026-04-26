import {
  // Camera and Matrix4 are imported only for JSDoc type references below;
  // the project's eslint no-unused-vars config accepts type-only imports.
  Camera,
  CatmullRomCurve3,
  Matrix4,
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
 * Animate a spacecraft-style landing on a body surface.
 *
 * Geometry: a Catmull-Rom curve through 4 knots in body-local coordinates,
 * placed so the final segment is tangent to the surface (the camera comes
 * in horizontally, like a landing aircraft on final approach):
 *
 *   K0 = camera start                                   (where the user is)
 *   K1 = above & behind the landing site, ~r/2 high     (mid-altitude pivot)
 *   K2 = ~0.1% radius above surface, ~1% radius behind  (final approach gate)
 *   K3 = arrival position at lat/lng/alt                (touchdown)
 *
 * "Behind" means offset by −approachDir, where approachDir is the direction
 * from start toward arrival projected onto the tangent plane at arrival.
 * That construction guarantees the tangent (K3 − K2) points along approachDir
 * — i.e., parallel to the surface — so the last few seconds of descent feel
 * like a runway approach rather than a vertical drop.
 *
 * Per-frame orientation: camera looks along the local spline tangent with
 * up = radial (outward).  This keeps a meaningful horizon throughout the
 * descent and arrives looking horizontally along the approach direction —
 * "looking at the horizon, downrange of the approach," as requested.
 *
 * The first ~30% of the tween slerps from the user's prior orientation
 * into the spline-derived orientation so the camera doesn't snap-pivot at
 * t=0 if the prior view was off-axis from the spline tangent.
 *
 * @param {object} camera Three.js camera
 * @param {Vector3} arrivalLocal Touchdown position in platform-local space
 * @param {number} planetRadius Body radius (meters), used to size knot offsets
 * @returns {Tween}
 */
export function newCameraLandTween(camera, arrivalLocal, planetRadius) {
  const startPos = camera.position.clone()
  const startQuat = camera.quaternion.clone()
  const r = planetRadius

  // Surface normal at touchdown — "up" in local body frame.
  const normalEnd = arrivalLocal.clone().normalize()

  // approachDir = horizontal projection of (arrival − start) at the
  // touchdown point.  This is the runway direction at the landing.
  // Falls back to an arbitrary tangent if start is directly above arrival
  // (gross direction is purely radial, projection collapses to zero).
  const gross = arrivalLocal.clone().sub(startPos)
  let approachDir = gross.clone().sub(normalEnd.clone().multiplyScalar(gross.dot(normalEnd)))
  if (approachDir.lengthSq() < 1e-6) {
    const fallback = Math.abs(normalEnd.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
    approachDir = fallback.sub(normalEnd.clone().multiplyScalar(fallback.dot(normalEnd)))
  }
  approachDir.normalize()

  // Spline knots — K2 sits low + behind landing so the curve's last segment
  // is tangent to the surface (approach comes in along approachDir).  K1 is
  // a high mid-altitude pivot offset back so the descent arcs in like a
  // landing aircraft rather than dropping straight down.
  const k1 = arrivalLocal.clone()
      .add(normalEnd.clone().multiplyScalar(r * 0.5))
      .add(approachDir.clone().multiplyScalar(-r * 0.3))
  const k2 = arrivalLocal.clone()
      .add(normalEnd.clone().multiplyScalar(r * 0.001))
      .add(approachDir.clone().multiplyScalar(-r * 0.01))
  const curve = new CatmullRomCurve3([startPos.clone(), k1, k2, arrivalLocal.clone()],
      false, 'catmullrom', 0.5)

  // Build endQuat in BODY-LOCAL frame.  Matrix4.lookAt is frame-agnostic
  // (just builds a rotation matrix from three vectors); pass body-local
  // eye/target/up and the resulting quaternion is body-local — directly
  // assignable to camera.quaternion since the camera is parented under
  // the rotating planet.  Camera.lookAt(world_target) cannot be used
  // here: it reads matrixWorld and assumes world coords for the target,
  // which would mismatch our body-local arrivalLocal.
  const horizonPoint = arrivalLocal.clone().add(approachDir.clone().multiplyScalar(r))
  const endMatrix = new Matrix4().lookAt(arrivalLocal, horizonPoint, normalEnd)
  const endQuat = new Quaternion().setFromRotationMatrix(endMatrix)

  const totalMs = 2500
  const _pos = new Vector3()

  return new Tween({t: 0})
      .to({t: 1}, totalMs)
      .easing(Easing.Quadratic.InOut)
      .onUpdate(({t}) => {
        // Position: arc-length-parameterized sample for uniform-speed travel.
        curve.getPointAt(t, _pos)
        camera.position.copy(_pos)
        // Direct slerp startQuat → endQuat in body-local frame.  Smooth,
        // monotonic head-turn from the user's prior view to the horizon
        // view at touchdown — synchronized with the eased spline travel.
        camera.quaternion.slerpQuaternions(startQuat, endQuat, easeInOutQuad(t))
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
