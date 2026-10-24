// Pure helpers for run.mjs: finding the test files, estimating how long each
// takes, and splitting them into shards.  No process work here, so plan.test.js
// can drive it.
import fs from 'node:fs'
import path from 'node:path'

// What `bun test` takes for a test file: a name ending .test, _test, .spec or
// _spec, with a JS/TS extension.
const TEST_FILE = /(\.test|_test|\.spec|_spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/

// Directories bun's walk skips, plus `docs/` (build output, rebuilt wholesale
// and holding no tests) and `.claude/` (agent worktrees, whose tests belong to
// the other checkout).  Any dot-directory is skipped too.
const SKIP_DIRS = new Set(['node_modules', 'docs', 'coverage'])


/**
 * Every test file under `root`, as sorted paths relative to it, with `/`.
 *
 * @param {string} root
 * @return {Array<string>}
 */
export function findTestFiles(root) {
  const found = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
      const rel = dir ? `${dir}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        if (!ent.name.startsWith('.') && !SKIP_DIRS.has(ent.name)) {
          walk(rel)
        }
      } else if (TEST_FILE.test(ent.name)) {
        found.push(rel)
      }
    }
  }
  walk('')
  return found.sort()
}


/**
 * The files `filters` pick, the way `bun test <filter>...` does: those whose
 * path contains one of them.  A leading `./` is dropped, so a path pasted from
 * a shell completion works.  No filters picks all.
 *
 * @param {Array<string>} files
 * @param {Array<string>} filters
 * @return {Array<string>}
 */
export function selectFiles(files, filters) {
  if (filters.length === 0) {
    return files
  }
  const wants = filters.map((f) => f.replace(/^\.\//, ''))
  return files.filter((file) => wants.some((w) => file.includes(w)))
}


/** @return {number} the median of `values`, or 1 for none. */
export function median(values) {
  if (values.length === 0) {
    return 1
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}


/**
 * Seconds for each file: its measured time, or for one the timings file
 * doesn't know (a new file), the median of those it does.
 *
 * @param {Array<string>} files
 * @param {Object<string, number>} timings
 * @return {Map<string, number>}
 */
export function estimates(files, timings) {
  const fallback = median(files.filter((f) => f in timings).map((f) => timings[f]))
  return new Map(files.map((f) => [f, f in timings ? timings[f] : fallback]))
}


/**
 * Greedy longest-first split of `files` into `count` bins: each file, longest
 * first, goes to the bin with the least so far.  Within a bin, files stay
 * longest first.  Ties break by name, so every machine makes the same split
 * (CI's shards must agree on it).
 *
 * @param {Array<string>} files
 * @param {Map<string, number>} seconds
 * @param {number} count
 * @return {Array<Array<string>>}
 */
export function partition(files, seconds, count) {
  const bins = Array.from({length: count}, () => ({load: 0, files: []}))
  const order = [...files].sort((a, b) => (seconds.get(b) - seconds.get(a)) || (a < b ? -1 : 1))
  for (const file of order) {
    let least = bins[0]
    for (const bin of bins) {
      if (bin.load < least.load) {
        least = bin
      }
    }
    least.load += seconds.get(file)
    least.files.push(file)
  }
  return bins.map((b) => b.files)
}


/**
 * Parses `--shard`'s `i/n`, 1-based.
 *
 * @param {string} spec
 * @return {{index: number, count: number}}
 */
export function parseShard(spec) {
  const m = /^(\d+)\/(\d+)$/.exec(spec)
  const index = m && Number(m[1])
  const count = m && Number(m[2])
  if (!m || count < 1 || index < 1 || index > count) {
    throw new Error(`--shard wants i/n with 1 <= i <= n, got "${spec}"`)
  }
  return {index, count}
}


/**
 * Reads the counts off a `bun test` run's output: the lines " 12 pass",
 * " 0 fail", " 1 todo", " 2 skip", and "Ran 13 tests across 1 file".
 *
 * @param {string} output
 * @return {{pass: number, fail: number, todo: number, skip: number, tests: number}}
 */
export function parseCounts(output) {
  const counts = {pass: 0, fail: 0, todo: 0, skip: 0, tests: 0}
  for (const m of output.matchAll(/^\s*(\d+) (pass|fail|todo|skip)\s*$/gm)) {
    counts[m[2]] += Number(m[1])
  }
  const ran = /^Ran (\d+) tests? across/m.exec(output)
  counts.tests = ran ? Number(ran[1]) : 0
  return counts
}
