/**
 * Camera drag mode + landed state.
 *
 *   - `dragMode` — `'orbit'` (turn round the target) or `'pan'` (look
 *     around in place).  The user's: set by the toggle and the `'m'`
 *     shortcut, and by navigation, never by altitude: Scene.goTo sets
 *     `'orbit'` on arriving at a body, Scene.land `'pan'` on the surface.
 *     Default `'orbit'`.
 *
 *   - `landed` — true when the camera is pinned to a surface location via
 *     Scene.land (sidereal tracking).  Drives the permalink `L` flag and
 *     any future first-person controller.
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createDragModeSlice(set, get) {
  return {
    dragMode: 'orbit',
    landed: false,
    setDragMode: (mode) => set(() => ({dragMode: mode})),
    setLanded: (v) => set(() => ({landed: v})),
  }
}
