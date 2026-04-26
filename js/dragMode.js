/**
 * Distance-based suggestion for which drag mode best fits a viewing
 * context: orbit when the camera is "in space" looking at a body,
 * free-look ("pan") when it's near or on the surface.
 *
 * @param {number} cameraDist Distance from camera to target center, metres.
 * @param {object} target A target object with `.props.radius.scalar` and
 *   optionally `.props.atmosphere.height.scalar`.  May be null.
 * @returns {'pan'|'orbit'}
 */
export function pickDragMode(cameraDist, target) {
  const r = target?.props?.radius?.scalar
  if (!r) {
    return 'pan'
  }
  // If the body has an atmosphere, "in space" starts a bit past the top
  // of the atmosphere; otherwise key off raw surface radius.  These
  // multipliers put the orbit/pan boundary around low-orbit altitude
  // (~2 surface radii up), where intuition flips between "looking at
  // the planet" and "looking from the planet."
  const atmH = target?.props?.atmosphere?.height?.scalar ?? 0
  const threshold = atmH > 0 ? (r + atmH) * 2 : r * 3
  return cameraDist > threshold ? 'orbit' : 'pan'
}


/**
 * Resolve a `dragMode` store intent (`'pan'` | `'orbit'` | `'auto'`)
 * to a concrete `'pan'` or `'orbit'` against the current camera
 * position and target.  Explicit modes pass through; anything else
 * (`'auto'`, undefined, etc.) consults `pickDragMode`.
 *
 * Used by dragControls at pointerdown (to decide what the gesture
 * does) AND by ThreeUI per frame (to publish into
 * `state.effectiveDragMode` so the UI toggle can highlight whichever
 * mode is actually active right now).
 *
 * @param {string} intent
 * @param {number} cameraDist
 * @param {object} target
 * @returns {'pan'|'orbit'}
 */
export function resolveDragMode(intent, cameraDist, target) {
  if (intent === 'pan' || intent === 'orbit') {
    return intent
  }
  return pickDragMode(cameraDist, target)
}
