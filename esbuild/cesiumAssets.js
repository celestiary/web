import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'


const require = createRequire(import.meta.url)


/**
 * Copy Cesium's static runtime assets (web workers, textures, wasm) into
 * `<outdir>/cesium/`.  The Cesium layer (CESIUM.md) sets
 * `window.CESIUM_BASE_URL` to that directory before importing Cesium, which
 * fetches these at runtime.  Cesium's JS itself is bundled by esbuild as a
 * lazily-loaded chunk.
 *
 * @param {string} outdir Build output directory
 */
export function copyCesiumAssets(outdir) {
  const src = path.join(path.dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium')
  const dest = path.join(outdir, 'cesium')
  for (const dir of ['Workers', 'Assets', 'ThirdParty']) {
    fs.cpSync(path.join(src, dir), path.join(dest, dir), {recursive: true})
  }
}
