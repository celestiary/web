/**
 * Camera drag mode.
 *
 * Two related store fields:
 *
 *   - `dragMode` — user intent: `'pan'`, `'orbit'`, or `'auto'` (let
 *     dragControls pick based on camera-to-target distance).  Default
 *     is `'auto'`.  Set by the UI toggle, the `'m'` shortcut, and
 *     reset to `'auto'` by Scene.goTo.
 *
 *   - `effectiveDragMode` — the resolved `'pan'` or `'orbit'` for the
 *     current frame.  Updated each frame by ThreeUI's render loop so the
 *     UI toggle can highlight whichever mode is *actually* active right
 *     now — including when `dragMode === 'auto'` and the resolution
 *     follows the camera context.
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createDragModeSlice(set, get) {
  return {
    dragMode: 'auto',
    effectiveDragMode: 'pan',
    setDragMode: (mode) => set(() => ({dragMode: mode})),
    setEffectiveDragMode: (mode) => set(() => ({effectiveDragMode: mode})),
  }
}
