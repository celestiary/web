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
 * The sky surveys on, with one switched on or off: added at the end, or
 * taken out; the same list when nothing changes.
 *
 * @param {Array<string>} skyOn
 * @param {string} key
 * @param {boolean} on
 * @returns {Array<string>}
 */
export function withSurvey(skyOn, key, on) {
  const has = skyOn.includes(key)
  if (on === true) {
    return has ? skyOn : [...skyOn, key]
  }
  return has ? skyOn.filter((k) => k !== key) : skyOn
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
 *   - `newYorkOn` — the New York layer's switch (Slop New York, Manhattan's
 *     3D city on Earth's Cesium layer; CESIUM.md, "New York"): the user's
 *     toggle, the permalink's `layers:nyc` or `?nyc=1`.  Off by default.
 *     CesiumLayers follows it.
 *   - `newYorkNear` — whether the city can be drawn from here: Earth's
 *     Cesium layer in use (active or warming) and the camera in the city's range (newYork.js
 *     newYorkRange 'show').  Published by CesiumLayers; the layers control
 *     offers the toggle only while it is set.
 *   - `newYorkStatus` — the city's load state: null (not loaded),
 *     `'loading'` (the guest building, then its set-up staged into the
 *     frames), `'ready'` or `'error'`.  Published by CesiumLayers.
 *   - `skyOn` — the sky-imagery surveys switched on, by key, in the order
 *     they were (js/scene/sky/Sky.md, "The control"): the layers control's
 *     switches, the permalink's `sky:` token or `?sky=`.  None by default.
 *     Celestiary follows it (Scene.setSkySurveys).
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
    newYorkOn: false,
    newYorkNear: false,
    newYorkStatus: null,
    setNewYorkOn: (on) => set(() => ({newYorkOn: on === true})),
    setNewYorkState: ({near, status}) => set(() => ({newYorkNear: near === true, newYorkStatus: status ?? null})),
    skyOn: [],
    setSkyOn: (keys) => set(() => ({skyOn: [...new Set(keys ?? [])]})),
    setSkySurvey: (key, on) => set((state) => ({skyOn: withSurvey(state.skyOn, key, on)})),
  }
}
