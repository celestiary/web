const indexFile = './js/index.jsx'
// Layer mode's page (design/LayerMode.md): celestiary's orbits as a NetGL
// guest in another app's globe, its own entry so it loads none of the app.
const layerFile = './js/layer/layer.js'
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
export default {
  entryPoints: [indexFile, layerFile],
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
  },
}
