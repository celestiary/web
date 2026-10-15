#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'


/**
 * Writes public/data/bodies.json: every body descriptor under the Milky Way
 * (public/data/<name>.json, following each one's `system`), in one file, so
 * the app's first load fetches the scene's bodies in one request rather than
 * thirty (#258; DESIGN.md "Data loading").  The descriptors stay where they
 * are, one file each, and are what to edit; the bundle is committed, like
 * the repo's other built data, and a test fails when it has drifted from
 * them (tools/bodies/bodies.test.js).
 *
 *   yarn bodies           writes the bundle
 *   yarn bodies --check   exits 1 if the bundle isn't what the descriptors say
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
export const DATA = path.join(ROOT, 'public', 'data')
export const OUTPUT = path.join(DATA, 'bodies.json')
/** The scene's root, as Celestiary loads it. */
export const ROOT_BODY = 'milkyway'


/**
 * The descriptors under a root, depth first through each one's `system`,
 * each once.
 *
 * @param {function(string): object} read A body's name to its descriptor
 * @param {string} [root]
 * @returns {Array<[string, object]>} Name and descriptor, the root first
 */
export function collectBodies(read, root = ROOT_BODY) {
  const out = []
  const seen = new Set()
  const visit = (name) => {
    if (seen.has(name)) {
      return
    }
    seen.add(name)
    const obj = read(name)
    out.push([name, obj])
    for (const child of obj.system ?? []) {
      visit(child)
    }
  }
  visit(root)
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
    `"_about": "Every body under ${ROOT_BODY}, from public/data/<name>.json: edit those, then run yarn bodies",`,
    '"bodies": {',
    lines.join(',\n'),
    '}',
    '}',
    '',
  ].join('\n')
}


/**
 * @param {string} [dir] Where the descriptors are
 * @returns {string} The bundle the descriptors there make
 */
export function buildBundle(dir = DATA) {
  return renderBundle(collectBodies((name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'))))
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = buildBundle()
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
    if (current !== text) {
      console.error('public/data/bodies.json is out of date with the descriptors: run `yarn bodies`.')
      process.exit(1)
    }
    console.log('bodies.json is current.')
  } else {
    fs.writeFileSync(OUTPUT, text)
    const count = Object.keys(JSON.parse(text).bodies).length
    console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${count} bodies, ${text.length} bytes).`)
  }
}
