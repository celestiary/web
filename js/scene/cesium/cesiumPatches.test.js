import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'


// The Cesium patches (patches/, CESIUM.md "Patching Cesium") are applied by
// patch-package on install.  A checkout installed without them still builds
// and runs, with Cesium's unpatched behaviour, so check them here.
const require = createRequire(import.meta.url)
const engine = path.dirname(require.resolve('@cesium/engine/package.json'))
const cesium = path.dirname(require.resolve('cesium/package.json'))
const read = (file) => readFileSync(path.join(engine, file), 'utf8')


describe('Cesium patches', () => {
  it('lights a globe without vertex normals by the globe\'s settings', () => {
    const fs = read('Source/Shaders/GlobeFS.js')
    expect(fs).toContain('u_dayNightLambertDiffuseMultiplier + u_vertexShadowDarkness')
    expect(fs).not.toContain('normalEC) * 5.0 + 0.3')
    expect(read('Source/Scene/Globe.js')).toContain('this.dayNightLambertDiffuseMultiplier = 5.0')
  })

  it('has the external render pass (celestiary/external-render-pass)', () => {
    const scene = read('Source/Scene/Scene.js')
    expect(scene).toContain('this._externalRenderers = new ExternalRendererCollection()')
    expect(scene).toContain('executeExternalRenderers(')
    expect(scene).toContain('extent.renderer.render(parameters)')
    expect(read('Source/Scene/View.js')).toContain('this.externalRendererExtents = []')
    expect(read('Source/Renderer/Context.js')).toContain('Context.prototype.resetState = function')
    expect(read('Source/Scene/ExternalRenderer.js')).toContain('function ExternalRenderer(options)')
    expect(read('Source/Scene/ExternalRendererCollection.js')).toContain('function ExternalRendererCollection()')
    // Exported, from the engine and from the cesium package celestiary imports.
    expect(read('index.js')).toContain(`export { default as ExternalRenderer } from './Source/Scene/ExternalRenderer.js'`)
    expect(readFileSync(path.join(cesium, 'Source/Cesium.js'), 'utf8')).toContain(`export { ExternalRenderer } from '@cesium/engine'`)
  })

  it('opts log depth into a NetGL host\'s reprojection, and exempts the viewport quad (celestiary/netgl-reproject)', () => {
    expect(read('Source/Renderer/AutomaticUniforms.js')).toContain('netgl_reproject: new AutomaticUniform({')
    const derived = read('Source/Scene/DerivedCommand.js')
    expect(derived).toContain('uniform mat4 netgl_reproject;')
    expect(derived.indexOf('gl_Position = netgl_reproject * gl_Position;')).toBeLessThan(derived.indexOf('    czm_vertexLogDepth();'))
    const quad = read('Source/Shaders/ViewportQuadVS.js')
    expect(quad).toContain('uniform mat4 netgl_reproject;')
    expect(quad).not.toContain('netgl_reproject *')
  })
})
