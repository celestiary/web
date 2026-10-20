import {describe, expect, it} from 'bun:test'
import {budgetProblems, contributors, firstLoadFiles, kb, measureFirstLoad} from './staticBudget.js'


const KB = 1024


/**
 * A metafile of the shape esbuild writes, as in firstLoad.test.js.
 *
 * @param {object} outputs name: {entryPoint, cssBundle, inputs: {path: bytes}, imports: [name]}
 * @returns {object}
 */
function metafile(outputs) {
  const out = {}
  for (const [name, o] of Object.entries(outputs)) {
    out[name] = {
      bytes: 0,
      entryPoint: o.entryPoint,
      cssBundle: o.cssBundle,
      inputs: Object.fromEntries(Object.entries(o.inputs ?? {}).map(([i, b]) => [i, {bytesInOutput: b}])),
      imports: (o.imports ?? []).map((path) => ({kind: 'import-statement', path})),
    }
  }
  return {outputs: out}
}


const META = metafile({
  'docs/index.js': {entryPoint: 'js/index.tsx', cssBundle: 'docs/index.css', imports: ['docs/chunk-a.js'],
    inputs: {'js/index.tsx': 1 * KB}},
  'docs/index.css': {inputs: {'js/style.css': 10 * KB}},
  'docs/App.js': {entryPoint: 'js/App.jsx', imports: ['docs/chunk-a.js'],
    inputs: {'js/App.jsx': 20 * KB, 'js/Celestiary.js': 80 * KB}},
  'docs/chunk-a.js': {inputs: {
    'node_modules/three/build/three.module.js': 600 * KB,
    'node_modules/@mui/material/Box/Box.js': 40 * KB,
    'node_modules/@mui/material/Button/Button.js': 60 * KB,
    'js/shared.js': 5 * KB,
  }},
  'docs/Cesium.js': {entryPoint: 'js/Cesium.js', inputs: {'node_modules/cesium/Source/Cesium.js': 5000 * KB}},
})
// Contents are whatever the metafile's inputs sum to; "gzip" is a quarter.
const SIZES = {'docs/index.js': 1, 'docs/index.css': 10, 'docs/App.js': 100, 'docs/chunk-a.js': 705, 'docs/Cesium.js': 5000}
const contentOf = (path) => new Uint8Array(SIZES[path] * KB)
const quarter = (content) => content.length / 4
const measure = () => measureFirstLoad(META, contentOf, quarter)


describe('the first load\'s files', () => {
  it('are the scripts it fetches and the CSS they carry, not what loads later', () => {
    expect(firstLoadFiles(META).sort()).toEqual(
        ['docs/App.js', 'docs/chunk-a.js', 'docs/index.css', 'docs/index.js'])
  })
})


describe('contributors', () => {
  it('groups a package\'s files, scoped packages whole, and sorts biggest first', () => {
    expect(contributors(META.outputs['docs/chunk-a.js'])).toEqual([
      {name: 'node_modules/three', bytes: 600 * KB, files: 1},
      {name: 'node_modules/@mui/material', bytes: 100 * KB, files: 2},
      {name: 'js/shared.js', bytes: 5 * KB, files: 1},
    ])
  })
})


describe('measuring the first load', () => {
  it('totals the minified and gzipped bytes and finds the largest file', () => {
    const m = measure()
    expect(m.minified).toBe(816 * KB)
    expect(m.gzip).toBe(204 * KB)
    expect(m.largest.path).toBe('docs/chunk-a.js')
    expect(m.files).toHaveLength(4)
  })
})


describe('the budget', () => {
  const within = {totalMinifiedKB: 900, totalGzipKB: 250, largestChunkMinifiedKB: 800}

  it('passes with nothing over', () => {
    expect(budgetProblems(measure(), within)).toEqual([])
  })

  it('passes exactly at a limit', () => {
    expect(budgetProblems(measure(), {...within, totalMinifiedKB: 816})).toEqual([])
  })

  it('fails the total, by how much, and names the biggest files and their contributors', () => {
    const problems = budgetProblems(measure(), {...within, totalMinifiedKB: 700})
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('first load, minified: 816 KB, over the 700 KB budget by 116 KB')
    expect(problems[0]).toContain('docs/chunk-a.js')
    expect(problems[0]).toContain('node_modules/three')
    expect(problems[0]).toContain('600 KB')
  })

  it('fails the gzipped total on its own', () => {
    const problems = budgetProblems(measure(), {...within, totalGzipKB: 200})
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('gzipped: 204 KB, over the 200 KB budget by 4 KB')
  })

  it('fails the largest chunk, naming it and listing its contributors', () => {
    const problems = budgetProblems(measure(), {...within, largestChunkMinifiedKB: 500})
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('docs/chunk-a.js, minified: 705 KB, over the 500 KB budget by 205 KB')
    expect(problems[0]).toContain('node_modules/three')
    expect(problems[0]).toContain('node_modules/@mui/material  (2 files)')
  })

  it('reports each limit exceeded', () => {
    const problems = budgetProblems(measure(), {totalMinifiedKB: 1, totalGzipKB: 1, largestChunkMinifiedKB: 1})
    expect(problems).toHaveLength(3)
    // The same file's contributors, listed once.
    expect(problems.join('\n').match(/node_modules\/three/g)).toHaveLength(1)
    expect(problems[2]).toContain('listed above')
  })
})


describe('kb', () => {
  it('rounds to whole KB with thousands separators', () => {
    expect(kb(1536 * KB)).toBe('1,536 KB')
    expect(kb(100)).toBe('0 KB')
  })
})
