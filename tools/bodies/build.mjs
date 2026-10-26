#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'


/**
 * Writes public/data/bodies.json: every body descriptor under the Milky Way
 * (following each one's `system`), in one file, so the app's first load
 * fetches the scene's bodies in one request rather than thirty (#258;
 * DESIGN.md "Data loading").  The descriptors stay where they are, one file
 * each in the body's own directory, and are what to edit; the bundle is
 * committed, like the repo's other built data, and a test fails when it has
 * drifted from them (tools/bodies/bodies.test.js).
 *
 * A body's directory (DESIGN.md "Data policy", by body) is
 * public/data/<name>/ for the Milky Way, the Sun and the Sun's children (the
 * planets), and under its parent's by its type for the rest
 * (public/data/earth/moons/moon/, public/data/earth/spacecraft/webb/), its
 * descriptor `index.json` there, its places `places.json`.  The names'
 * directories are written to js/bodyDirs.json too, for the app (the loader's
 * fallback, the places), which can't work them out before it has the
 * descriptors.
 *
 *   yarn bodies           writes the bundle and the directories
 *   yarn bodies --check   exits 1 if either isn't what the descriptors say
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
export const DATA = path.join(ROOT, 'public', 'data')
export const OUTPUT = path.join(DATA, 'bodies.json')
export const DIRS_OUTPUT = path.join(ROOT, 'js', 'bodyDirs.json')
/** The scene's root, as Celestiary loads it. */
export const ROOT_BODY = 'milkyway'
/** The bodies whose children are at the top of public/data/, beside them. */
export const TOP_BODIES = new Set(['milkyway', 'sun'])
/** Where under its parent's directory a body is, by its type. */
export const KIND_DIRS = {moon: 'moons', spacecraft: 'spacecraft'}


/**
 * The descriptors under a root, depth first through each one's `system`,
 * each once, each found in its directory.
 *
 * @param {function(string): ?object} read A directory (under public/data/)
 *   to the descriptor in it, or null if there's none
 * @param {string} [root]
 * @returns {Array<[string, object, string]>} Name, descriptor and directory,
 *   the root first
 */
export function collectBodies(read, root = ROOT_BODY) {
  const out = []
  const seen = new Set()
  const visit = (name, parent, parentDir) => {
    if (seen.has(name)) {
      return
    }
    seen.add(name)
    const top = parent === null || TOP_BODIES.has(parent)
    const candidates = top ? [name] : Object.values(KIND_DIRS).map((k) => `${parentDir}/${k}/${name}`)
    const dir = candidates.find((d) => read(d))
    if (!dir) {
      throw new Error(`no descriptor for ${name} (${candidates.map((d) => `${d}/index.json`).join(', ')})`)
    }
    const obj = read(dir)
    if (!top && dir !== `${parentDir}/${KIND_DIRS[obj.type]}/${name}`) {
      throw new Error(`${name} is a ${obj.type}, not in ${dir}`)
    }
    out.push([name, obj, dir])
    for (const child of obj.system ?? []) {
      visit(child, name, dir)
    }
  }
  visit(root, null, null)
  return out
}


/**
 * @param {Array<[string, object]>} bodies As collectBodies gives
 * @returns {string} The bundle's text: a body to a line, so a change to one
 *   descriptor is a one-line diff
 */
export function renderBundle(bodies) {
  const lines = bodies.map(([name, obj]) => `${JSON.stringify(name)}: ${JSON.stringify(obj)}`)
  return [
    '{',
    '"_generator": "tools/bodies/build.mjs",',
    `"_about": "Every body under ${ROOT_BODY}, from its public/data/<dir>/index.json: edit those, then run yarn bodies",`,
    '"bodies": {',
    lines.join(',\n'),
    '}',
    '}',
    '',
  ].join('\n')
}


/**
 * @param {Array<[string, object, string]>} bodies As collectBodies gives
 * @returns {string} js/bodyDirs.json's text: each body's directory under
 *   public/data/, by name, a body to a line
 */
export function renderDirs(bodies) {
  return `{\n${bodies.map(([name, , dir]) => `  ${JSON.stringify(name)}: ${JSON.stringify(dir)}`).join(',\n')}\n}\n`
}


/**
 * @param {string} [dir] Where the descriptors are
 * @returns {Array<[string, object, string]>} the bodies there
 */
export function readBodies(dir = DATA) {
  return collectBodies((d) => {
    const file = path.join(dir, d, 'index.json')
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  })
}


/**
 * @param {string} [dir] Where the descriptors are
 * @returns {string} The bundle the descriptors there make
 */
export function buildBundle(dir = DATA) {
  return renderBundle(readBodies(dir))
}


/**
 * @param {string} [dir] Where the descriptors are
 * @returns {string} The directories the descriptors there are in
 */
export function buildDirs(dir = DATA) {
  return renderDirs(readBodies(dir))
}


/**
 * @returns {object} js/bodyDirs.json, as written: a body's name to its
 *   directory under public/data/
 */
export function readBodyDirs() {
  return JSON.parse(fs.readFileSync(DIRS_OUTPUT, 'utf8'))
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputs = [[OUTPUT, buildBundle()], [DIRS_OUTPUT, buildDirs()]]
  if (process.argv.includes('--check')) {
    for (const [file, text] of outputs) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      if (current !== text) {
        console.error(`${path.relative(ROOT, file)} is out of date with the descriptors: run \`yarn bodies\`.`)
        process.exit(1)
      }
    }
    console.log('bodies.json and bodyDirs.json are current.')
  } else {
    for (const [file, text] of outputs) {
      fs.writeFileSync(file, text)
      console.log(`Wrote ${path.relative(ROOT, file)} (${text.length} bytes).`)
    }
  }
}
