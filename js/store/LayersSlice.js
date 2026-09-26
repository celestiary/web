/**
 * Per-body render layers.  See CESIUM.md.
 *
 *   - `layerBody` — name of the Cesium-capable body the camera is near right
 *     now (e.g. `'earth'`), or null.  Published every frame by ThreeUi; the
 *     layers control shows only while it is set.
 *   - `bodyLayers` — the user's choice per body: `{earth: 'cesium'}`.  Absent
 *     means `'default'` (celestiary's own rendering).
 *   - `layerStatus` — per body, the Cesium layer's load state: `'loading'`,
 *     `'ready'` or `'error'`.  Set by CesiumLayers.
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createLayersSlice(set, get) {
  return {
    layerBody: null,
    bodyLayers: {},
    layerStatus: {},
    setLayerBody: (name) => set(() => ({layerBody: name})),
    setBodyLayer: (body, layer) => set((state) => ({bodyLayers: {...state.bodyLayers, [body]: layer}})),
    setLayerStatus: (body, status) => set((state) => ({layerStatus: {...state.layerStatus, [body]: status}})),
  }
}
