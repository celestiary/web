// The static load budget: the first load's size against the limits in
// esbuild/budget.js, from esbuild's metafile and the built files' bytes
// (#262; `yarn bundle-check`, esbuild/check.js).  Pure functions, so the
// comparison and the message are tested on synthetic metafiles
// (staticBudget.test.js).

import zlib from 'node:zlib'
import {firstLoadOutputs} from './firstLoad.js'


const KB = 1024
// How many contributors a failure lists.
const TOP_CONTRIBUTORS = 8
// How many of the first load's files a failure lists.
const TOP_FILES = 5


/**
 * @param {object} metafile esbuild's, from a build with `metafile: true`
 * @param {string[]} [entries] first-load entry points (as firstLoad.js)
 * @returns {string[]} the first load's files: its JS outputs and the CSS
 *   bundles they carry
 */
export function firstLoadFiles(metafile, entries) {
  const files = firstLoadOutputs(metafile, entries)
  const css = files.map((f) => metafile.outputs[f].cssBundle).filter(Boolean)
  return [...new Set([...files, ...css])]
}


/**
 * @param {object} info One metafile output
 * @returns {Array<{name: string, bytes: number, files: number}>} what the
 *   output is made of, biggest first: each npm package as one entry, each of
 *   the app's own files as its own
 */
export function contributors(info) {
  const byName = new Map()
  for (const [input, {bytesInOutput}] of Object.entries(info.inputs ?? {})) {
    const name = inputGroup(input)
    const entry = byName.get(name) ?? {name, bytes: 0, files: 0}
    entry.bytes += bytesInOutput
    entry.files++
    byName.set(name, entry)
  }
  return [...byName.values()].sort((a, b) => b.bytes - a.bytes)
}


/**
 * @param {string} input An input path from the metafile
 * @returns {string} `node_modules/<package>` (scoped packages whole) for
 *   a dependency, else the path itself
 */
function inputGroup(input) {
  const match = input.match(/^(?:.*\/)?node_modules\/((?:@[^/]+\/)?[^/]+)\//)
  return match ? `node_modules/${match[1]}` : input
}


/**
 * @param {object} metafile
 * @param {function(string): Uint8Array} contentOf The built bytes of an
 *   output file, as esbuild wrote (or would write) it
 * @param {function(Uint8Array): number} [gzipSize] Bytes after gzip
 * @param {string[]} [entries] the entry points to measure from (default
 *   the app's first load, firstLoad.js FIRST_LOAD_ENTRIES)
 * @returns {{files: Array<object>, minified: number, gzip: number,
 *   largest: object}} each first-load file's path, minified bytes, gzipped
 *   bytes and contributors; their totals; and the largest by minified bytes
 */
export function measureFirstLoad(metafile, contentOf, gzipSize = gzipBytes, entries = undefined) {
  const files = firstLoadFiles(metafile, entries).map((path) => {
    const content = contentOf(path)
    return {
      path,
      minified: content.length,
      gzip: gzipSize(content),
      contributors: contributors(metafile.outputs[path]),
    }
  })
  const sum = (key) => files.reduce((total, f) => total + f[key], 0)
  const largest = files.reduce((a, b) => (b.minified > a.minified ? b : a), files[0])
  return {files, minified: sum('minified'), gzip: sum('gzip'), largest}
}


/**
 * @param {Uint8Array} content
 * @returns {number} gzipped length
 */
export function gzipBytes(content) {
  return zlib.gzipSync(content).length
}


/**
 * @param {number} bytes
 * @returns {string} e.g. "1,234 KB"
 */
export function kb(bytes) {
  return `${Math.round(bytes / KB).toLocaleString('en-US')} KB`
}


/**
 * @param {object} measure From measureFirstLoad
 * @param {object} limits STATIC_BUDGET (esbuild/budget.js)
 * @returns {string[]} one message per limit exceeded, each naming the
 *   number, the limit and how far over it is, and the biggest contributors to
 *   what grew; empty if the first load is within its budget
 */
export function budgetProblems(measure, limits) {
  const problems = []
  // Files whose contributors a message has listed already: say it once.
  const listed = new Set()
  const over = (what, bytes, limitKB, where) => {
    if (bytes > limitKB * KB) {
      problems.push(`${what}: ${kb(bytes)}, over the ${limitKB.toLocaleString('en-US')} KB budget by ` +
        `${kb(bytes - (limitKB * KB))}.\n${where()}`)
    }
  }
  over('first load, minified', measure.minified, limits.totalMinifiedKB,
      () => biggestFiles(measure, 'minified', listed))
  over('first load, gzipped', measure.gzip, limits.totalGzipKB, () => biggestFiles(measure, 'gzip', listed))
  over(`largest first-load chunk ${measure.largest.path}, minified`, measure.largest.minified,
      limits.largestChunkMinifiedKB, () => contributorsOf(measure.largest, listed))
  return problems
}


/**
 * @param {object} measure
 * @param {string} key 'minified' or 'gzip'
 * @param {Set<string>} listed Files whose contributors are already in the
 *   report; the biggest here is added
 * @returns {string} the first load's biggest files, and the biggest one's
 *   contributors
 */
function biggestFiles(measure, key, listed) {
  const sorted = [...measure.files].sort((a, b) => b[key] - a[key])
  const lines = sorted.slice(0, TOP_FILES).map((f) => `    ${kb(f[key]).padStart(9)}  ${f.path}`)
  return `    the first load's biggest files (${key}):\n${lines.join('\n')}\n${contributorsOf(sorted[0], listed)}`
}


/**
 * @param {object} file From measureFirstLoad
 * @param {Set<string>} listed
 * @returns {string} the file's contributors, or a pointer to where they were
 *   listed
 */
function contributorsOf(file, listed) {
  if (listed.has(file.path)) {
    return `    (${file.path}'s contributors are listed above)`
  }
  listed.add(file.path)
  return `    the biggest contributors to ${file.path} (minified bytes in the output):\n${
    listContributors(file.contributors)}`
}


/**
 * @param {Array<{name: string, bytes: number, files: number}>} list
 * @returns {string} the top few, one per line
 */
function listContributors(list) {
  return list.slice(0, TOP_CONTRIBUTORS).map((c) => {
    const many = c.files > 1 ? `  (${c.files} files)` : ''
    return `    ${kb(c.bytes).padStart(9)}  ${c.name}${many}`
  }).join('\n')
}
