const indexFile = './js/index.jsx'
// Layer mode's page (design/LayerMode.md): celestiary's orbits as a NetGL
// guest in another app's globe.  Built separately (layerConfig), not as a
// second entry here: esbuild's splitting would then cut the code the two
// share into chunks of their own, and the app's first load would fetch
// them as more requests (it did: two more, over the load budget).
const layerFile = './js/layer/layer.js'
// The Cesium guest page (design/CesiumGuest.md): one Cesium body as a NetGL
// guest that celestiary embeds from another origin.  Its own build too.
const cesiumGuestFile = './js/cesium-guest/guest.js'
const buildDir = 'docs'

// satellite.js (SGP4, js/scene/satellites/) also ships WASM propagators,
// loaded by `import('#wasm-...')` from its index, which bundle Node-only
// imports and top-level await.  Only its JavaScript SGP4 is used, so those
// two resolve to a module that throws if ever called.
const satelliteWasmStub = {
  name: 'satellite-wasm-stub',
  setup(build) {
    build.onResolve({filter: /^#wasm-(single|multi)-thread$/}, () => ({path: 'satellite-wasm-stub', namespace: 'satellite-wasm-stub'}))
    build.onLoad({filter: /.*/, namespace: 'satellite-wasm-stub'}, () => ({
      contents: 'export default () => { throw new Error("satellite.js WASM is not bundled") }',
    }))
  },
}

// The build config
const config = {
  entryPoints: [indexFile],
  outdir: buildDir,
  format: 'esm',
  platform: 'browser',
  target: ['es2021', 'chrome63', 'edge79', 'firefox67', 'safari11.1'],
  bundle: true,
  minify: (process.env.MINIFY || 'true') === 'true',
  keepNames: true, // TODOD(pablo): have had breakage without this
  splitting: true,
  metafile: true,
  sourcemap: true,
  logLevel: 'info',
  plugins: [satelliteWasmStub],
  define: {
    // Cesium ion access token for the Cesium layers (CESIUM.md).  Empty =
    // no ion data; Earth falls back to Cesium's bundled offline imagery.
    __CESIUM_ION_TOKEN__: JSON.stringify(process.env.CESIUM_ION_TOKEN ?? ''),
    // Where large data (textures, stars.dat, public/large/) is fetched from
    // (js/dataUrl.js).  Empty = the page's own origin and path.  PR previews
    // set the production site's URL rather than copy the data.
    __DATA_BASE_URL__: JSON.stringify(process.env.DATA_BASE_URL ?? ''),
    // Development mode: true in `yarn serve`, false in production builds.
    // Used to enable dev-only features like esbuild hot reload (js/index.tsx).
    __DEV__: JSON.stringify(false),
    // More origins that may host layer mode (js/layer/origins.js), comma-
    // separated, beyond its built-in allow-list.
    __LAYER_ORIGINS__: JSON.stringify(process.env.LAYER_ORIGINS ?? ''),
    // More hosts that may embed the Cesium guest, and origins celestiary may
    // load it from (js/cesium-guest/origins.js), comma-separated.
    __CESIUM_GUEST_HOSTS__: JSON.stringify(process.env.CESIUM_GUEST_HOSTS ?? ''),
    __CESIUM_GUEST_ORIGINS__: JSON.stringify(process.env.CESIUM_GUEST_ORIGINS ?? ''),
  },
}
export default config


/**
 * Layer mode's page, its own build into docs/layer/ (public/layer.html
 * loads layer/layer.js): it shares no chunk with the app, so neither build
 * changes the other's files.
 */
export const layerConfig = {
  ...config,
  entryPoints: [layerFile],
  outdir: `${buildDir}/layer`,
  define: {...config.define},
}


/**
 * The Cesium guest page's own build, into docs/cesium-guest/
 * (public/cesium-guest.html loads cesium-guest/guest.js).  Cesium's assets
 * are the app's, in docs/cesium/ (cesiumAssets.js), which the guest's
 * deploy copies beside it.
 */
export const cesiumGuestConfig = {
  ...config,
  entryPoints: [cesiumGuestFile],
  outdir: `${buildDir}/cesium-guest`,
  define: {...config.define},
}
