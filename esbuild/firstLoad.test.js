import {describe, expect, it} from 'bun:test'
import {firstLoadOutputs, firstLoadProblems, totalBytes} from './firstLoad.js'


/**
 * A metafile of the shape esbuild writes: outputs by name, each with its
 * entry point (if any), its inputs and its imports.
 *
 * @param {object} outputs name: {entryPoint, inputs: [paths], imports: [[kind, name]]}
 * @returns {object}
 */
function metafile(outputs) {
  const out = {}
  for (const [name, o] of Object.entries(outputs)) {
    out[name] = {
      bytes: o.bytes ?? 100,
      entryPoint: o.entryPoint,
      inputs: Object.fromEntries((o.inputs ?? []).map((i) => [i, {bytesInOutput: 1}])),
      imports: (o.imports ?? []).map(([kind, path]) => ({kind, path})),
    }
  }
  return {outputs: out}
}


const GOOD = {
  'docs/index.js': {entryPoint: 'js/index.tsx', imports: [['import-statement', 'docs/chunk-a.js']]},
  'docs/chunk-a.js': {inputs: ['node_modules/three/build/three.module.js']},
  'docs/App.js': {entryPoint: 'js/App.jsx', imports: [['import-statement', 'docs/chunk-a.js'],
    ['dynamic-import', 'docs/vsop.js'], ['dynamic-import', 'docs/Cesium.js']]},
  'docs/vsop.js': {entryPoint: 'js/vsop.js', inputs: ['js/vsop.js', 'node_modules/vsop87/dist/vsop87c-wasm.js']},
  'docs/Cesium.js': {entryPoint: 'js/Cesium.js', inputs: ['node_modules/cesium/Source/Cesium.js']},
}


describe('the first load', () => {
  it('is the entry, the App route and what they import statically', () => {
    expect(firstLoadOutputs(metafile(GOOD)).sort()).toEqual(['docs/App.js', 'docs/chunk-a.js', 'docs/index.js'])
  })

  it('leaves out what is imported dynamically', () => {
    expect(firstLoadOutputs(metafile(GOOD))).not.toContain('docs/vsop.js')
  })

  it('follows static imports through other chunks', () => {
    const m = metafile({
      ...GOOD,
      'docs/chunk-a.js': {imports: [['import-statement', 'docs/chunk-b.js']]},
      'docs/chunk-b.js': {inputs: ['js/x.js']},
    })
    expect(firstLoadOutputs(m)).toContain('docs/chunk-b.js')
  })

  it('ignores imports of files that aren\'t outputs (externals)', () => {
    const m = metafile({...GOOD, 'docs/index.js': {entryPoint: 'js/index.tsx',
      imports: [['import-statement', 'https://example.com/x.js'], ['import-statement', 'docs/chunk-a.js']]}})
    expect(firstLoadOutputs(m)).toContain('docs/chunk-a.js')
  })

  it('fails loudly if its entries have gone from the build', () => {
    expect(() => firstLoadOutputs(metafile({'docs/other.js': {entryPoint: 'js/other.js'}}))).toThrow()
  })

  it('totals the bytes of the files it names', () => {
    const m = metafile({'a': {bytes: 5}, 'b': {bytes: 7}})
    expect(totalBytes(m, ['a', 'b'])).toBe(12)
  })
})


describe('the VSOP87 check', () => {
  it('passes when the coefficients are a chunk of their own, loaded dynamically', () => {
    expect(firstLoadProblems(metafile(GOOD))).toEqual([])
  })

  it('fails when a static import puts them in the first load', () => {
    const m = metafile({
      ...GOOD,
      'docs/chunk-a.js': {inputs: ['node_modules/three/build/three.module.js',
        'node_modules/vsop87/dist/vsop87c-wasm.js']},
    })
    const problems = firstLoadProblems(m)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('docs/chunk-a.js')
    expect(problems[0]).toContain('vsop87c-wasm')
  })

  it('fails when the app\'s own wrapper is the one in the first load', () => {
    const m = metafile({...GOOD, 'docs/App.js': {entryPoint: 'js/App.jsx',
      inputs: ['js/vsop.js'], imports: [['import-statement', 'docs/chunk-a.js']]}})
    expect(firstLoadProblems(m)[0]).toContain('docs/App.js')
  })

  it('fails when the coefficients are in no output, so the check can\'t be passing for nothing', () => {
    const m = metafile({...GOOD, 'docs/vsop.js': {entryPoint: 'js/vsop.js', inputs: []}})
    expect(firstLoadProblems(m)[0]).toContain('no vsop87')
  })
})
