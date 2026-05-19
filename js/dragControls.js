import {Quaternion, Vector3} from 'three'
import {resolveDragMode} from './dragMode'


/**
 * Attach pointer-driven camera drag to a DOM element.  Single-pointer drag
 * rotates the camera; a second simultaneous pointer is ignored so it can
 * flow through to TrackballControls for pinch-zoom.
 *
 * Pointer events are used (not mouse events) so the same handler covers
 * mouse, pen, and touch — the original mousedown/mousemove implementation
 * silently dropped touch input on mobile.  setPointerCapture redirects
 * subsequent pointermove events to the element regardless of where the
 * pointer actually is, so dragging past the canvas edge keeps tracking.
 *
 * Drag behavior is mode-driven.  Mode is resolved at pointerdown and
 * latched for the gesture (no mid-drag flip).  Three modes:
 * - `'pan'`    → pitch/yaw camera around its local axes (free look,
 *                natural on a planet surface looking at the sky).
 * - `'orbit'`  → rotate camera.position around the platform origin and
 *                apply the same rotation to camera.quaternion (natural
 *                when viewing a planet from space).
 * - `'auto'`   → pick `'pan'` or `'orbit'` via `pickDragMode` using the
 *                current camera-to-target distance.  This follows the
 *                viewing context as the camera moves (zoom, navigation)
 *                without the user thinking about it.
 *
 * Alt held at pointerdown inverts the resolved mode for that gesture
 * (pan ↔ orbit), useful as a one-shot override on desktop.
 *
 * @param {HTMLElement} el The container to bind events on.
 * @param {object} camera A three.js Camera (uses .rotateX/.rotateY for
 *   pan; .position and .quaternion for orbit).
 * @param {object} [options]
 * @param {Function} [options.onChange] Called after each rotation update.
 * @param {Function} [options.getDragMode] Returns `'pan'`, `'orbit'`, or
 *   `'auto'`.  Treated as `'auto'` when omitted.
 * @param {Function} [options.getTarget] Returns the current target object
 *   (with `.props.radius.scalar` and optional `.props.atmosphere.height.scalar`).
 *   Required for `'auto'` to resolve to anything other than `'pan'`.
 * @param {Function} [options.onClick] Called with the pointerup event when
 *   the gesture moved less than CLICK_PX_THRESHOLD — distinguishes a true
 *   click (e.g., to pick a label) from a drag-rotate.
 * @param {Function} [options.onDblClick] Called with the pointerup event of
 *   the second of two clicks that fall within DBLCLICK_MS and DBLCLICK_PX.
 *   Browser-style semantics: `onClick` fires on every click, `onDblClick`
 *   additionally fires on the second click — handlers should treat the
 *   dblclick as an override (latest action wins).
 */
export function attachPointerDrag(el, camera, options = {}) {
  const {onChange, getDragMode, getTarget, onClick, onDblClick} = options
  let lastX = 0
  let lastY = 0
  let downX = 0
  let downY = 0
  let activePointerId = null
  let activeMode = 'pan'
  const orbitAxis = new Vector3()
  const orbitRot = new Quaternion()
  // Total pixel travel above which we treat the gesture as a drag, not a click.
  // Below this, pointerup fires onClick (after which dragControls also runs its
  // pointerend cleanup).  Tuned for finger-tap jitter on touch devices.
  const CLICK_PX_THRESHOLD = 5
  // Two clicks within DBLCLICK_MS *and* DBLCLICK_PX of each other promote to a
  // dblclick.  350 ms matches the default browser dblclick window; 8 px is a
  // touch above CLICK_PX_THRESHOLD so finger-tap jitter on the second tap
  // doesn't disqualify it.
  const DBLCLICK_MS = 350
  const DBLCLICK_PX = 8
  let lastClickTime = 0
  let lastClickX = 0
  let lastClickY = 0

  // Suppress browser touch gestures (pan / pinch-to-zoom-page / double-tap-zoom)
  // on the canvas so single-finger drags reach our handler instead of being
  // consumed by the page itself.
  el.style.touchAction = 'none'

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || activePointerId !== null) {
      return
    }
    activePointerId = e.pointerId
    activeMode = resolveMode(getDragMode?.(), camera, getTarget?.())
    if (e.altKey) {
      activeMode = activeMode === 'orbit' ? 'pan' : 'orbit'
      e.preventDefault() // suppress browser Alt menu on the canvas
    }
    lastX = e.clientX
    lastY = e.clientY
    downX = e.clientX
    downY = e.clientY
    el.setPointerCapture?.(e.pointerId)
  })

  const onPointerEnd = (e) => {
    if (e.pointerId === activePointerId) {
      const dx = e.clientX - downX
      const dy = e.clientY - downY
      if ((dx * dx) + (dy * dy) < CLICK_PX_THRESHOLD * CLICK_PX_THRESHOLD) {
        if (onClick) {
          onClick(e)
        }
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
        const ddx = e.clientX - lastClickX
        const ddy = e.clientY - lastClickY
        if (onDblClick &&
            (now - lastClickTime) < DBLCLICK_MS &&
            ((ddx * ddx) + (ddy * ddy)) < DBLCLICK_PX * DBLCLICK_PX) {
          onDblClick(e)
          // Push lastClickTime far in the past so a third quick tap doesn't
          // immediately register as another dblclick — the user has to
          // do two more taps for the next one.  Setting to 0 isn't enough
          // because performance.now() can be small early in a session
          // (e.g. unit-test environments) and `now - 0 < DBLCLICK_MS` would
          // still hold.
          lastClickTime = Number.NEGATIVE_INFINITY
        } else {
          lastClickTime = now
          lastClickX = e.clientX
          lastClickY = e.clientY
        }
      }
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

    if (activeMode === 'orbit') {
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
      // Pan / free look: pitch/yaw camera around its own local axes.
      camera.rotateY(-dx * speed)
      camera.rotateX(-dy * speed)
    }
    onChange?.()
  })
}


/**
 * Wrap `resolveDragMode` for the dragControls context.  `camera.position.length()`
 * is the camera-to-target distance because the platform is parented to
 * the target's local frame (target center = local origin).
 *
 * @param {string} stored
 * @param {object} camera
 * @param {object} target
 * @returns {'pan'|'orbit'}
 */
function resolveMode(stored, camera, target) {
  return resolveDragMode(stored, camera.position.length(), target)
}
