/**
 * The layer a Cesium-capable body shows until the user picks another: its
 * Cesium layer, falling back to celestiary's own rendering if Cesium can't
 * load (CesiumLayers._fail records that choice).
 */
export const DEFAULT_BODY_LAYER = 'cesium'


/**
 * @param {object} bodyLayers The store's `bodyLayers`
 * @param {string} name Body name
 * @returns {string} The layer chosen for the body: 'cesium' or 'default'
 */
export function bodyLayer(bodyLayers, name) {
  return bodyLayers?.[name] ?? DEFAULT_BODY_LAYER
}


/**
 * Per-body render layers.  See CESIUM.md.
 *
 *   - `layerBody` — name of the Cesium-capable body the camera is in range
 *     of right now (e.g. `'earth'`), or null.  Published every frame by ThreeUi; the
 *     layers control shows only while it is set.
 *   - `bodyLayers` — the user's choice per body: `{earth: 'default'}`
 *     (`'default'` is celestiary's own rendering).  Absent means
 *     DEFAULT_BODY_LAYER; read it with bodyLayer().
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
