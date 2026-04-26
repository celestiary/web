import {Quaternion, Vector3} from 'three'


/**
 * Attach pointer-driven camera drag to a DOM element.  Single-pointer drag
 * rotates the camera (free look or alt-orbit); a second simultaneous
 * pointer is ignored so it can flow through to TrackballControls for
 * pinch-zoom.
 *
 * Pointer events are used (not mouse events) so the same handler covers
 * mouse, pen, and touch — the original mousedown/mousemove implementation
 * silently dropped touch input on mobile.  setPointerCapture redirects
 * subsequent pointermove events to the element regardless of where the
 * pointer actually is, so dragging past the canvas edge keeps tracking.
 *
 * Plain drag    → pitch/yaw camera around its local axes.
 * Option+drag   → orbit: rotate camera.position around the platform origin
 *                 and apply the same rotation to camera.quaternion so view
 *                 direction stays consistent with the new orbital position.
 *
 * @param {HTMLElement} el The container to bind events on.
 * @param {object} camera A three.js Camera (uses .rotateX/.rotateY for
 *   free look; .position and .quaternion for alt-orbit).
 * @param {Function} [onChange] Called after each rotation update.
 */
export function attachPointerDrag(el, camera, onChange) {
  let lastX = 0
  let lastY = 0
  let activePointerId = null
  const orbitAxis = new Vector3()
  const orbitRot = new Quaternion()

  // Suppress browser touch gestures (pan / pinch-to-zoom-page / double-tap-zoom)
  // on the canvas so single-finger drags reach our handler instead of being
  // consumed by the page itself.
  el.style.touchAction = 'none'

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || activePointerId !== null) {
      return
    }
    activePointerId = e.pointerId
    lastX = e.clientX
    lastY = e.clientY
    el.setPointerCapture?.(e.pointerId)
    if (e.altKey) {
      e.preventDefault()
    } // suppress browser Alt menu
  })

  const onPointerEnd = (e) => {
    if (e.pointerId === activePointerId) {
      activePointerId = null
    }
  }
  el.addEventListener('pointerup', onPointerEnd)
  el.addEventListener('pointercancel', onPointerEnd)

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointerId) {
      return
    }
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    const speed = 0.005 // radians per pixel

    if (e.altKey) {
      // Horizontal → around platform-local Y
      orbitAxis.set(0, 1, 0)
      orbitRot.setFromAxisAngle(orbitAxis, -dx * speed)
      camera.position.applyQuaternion(orbitRot)
      camera.quaternion.premultiply(orbitRot)
      // Vertical → around camera's current right axis
      orbitAxis.set(1, 0, 0).applyQuaternion(camera.quaternion)
      orbitRot.setFromAxisAngle(orbitAxis, -dy * speed)
      camera.position.applyQuaternion(orbitRot)
      camera.quaternion.premultiply(orbitRot)
    } else {
      // Free look: pitch/yaw camera around its own local axes.
      camera.rotateY(-dx * speed)
      camera.rotateX(-dy * speed)
    }
    onChange?.()
  })
}
