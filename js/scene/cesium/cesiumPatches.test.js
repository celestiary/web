import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'


// The Cesium patches (patches/, CESIUM.md "Patching Cesium") are applied by
// patch-package on install.  A checkout installed without them still builds
// and runs, with Cesium's unpatched behaviour, so check them here.
const require = createRequire(import.meta.url)
const engine = path.dirname(require.resolve('@cesium/engine/package.json'))
const read = (file) => readFileSync(path.join(engine, file), 'utf8')


describe('Cesium patches', () => {
  it('lights a globe without vertex normals by the globe\'s settings', () => {
    const fs = read('Source/Shaders/GlobeFS.js')
    expect(fs).toContain('u_dayNightLambertDiffuseMultiplier + u_vertexShadowDarkness')
    expect(fs).not.toContain('normalEC) * 5.0 + 0.3')
    expect(read('Source/Scene/Globe.js')).toContain('this.dayNightLambertDiffuseMultiplier = 5.0')
  })
})
