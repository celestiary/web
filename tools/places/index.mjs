#!/usr/bin/env node
// Writes public/data/places-index.json: every body's places for the search,
// without what only the labels need (the tier), so a search loads one file
// rather than every body's catalogue (#258; js/search/DESIGN.md, "Places in
// the index").  Built from each body's places.json, in its directory
// (public/data/earth/places.json, public/data/earth/moons/moon/places.json:
// js/bodyDirs.json), which stay what to edit or rebuild (build.mjs runs this
// after writing them); committed, and a test fails when it has drifted from
// them (places.test.js).
//
//   yarn places-index           writes the index
//   yarn places-index --check   exits 1 if the index isn't what the catalogues say
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {readBodyDirs} from '../bodies/build.mjs'


const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
export const DATA = join(root, 'public/data')
export const OUTPUT = join(DATA, 'places-index.json')


/**
 * @param {string} body
 * @param {string} [data] public/data
 * @returns {string} where its place catalogue is, in its directory
 */
export function catalogueFile(body, data = DATA) {
  const dir = readBodyDirs()[body]
  if (!dir) {
    throw new Error(`${body} has no directory (js/bodyDirs.json): run yarn bodies`)
  }
  return join(data, dir, 'places.json')
}


/**
 * @param {string} [data] public/data
 * @returns {Array<[string, string]>} each body with places and its
 *   catalogue's file, by name
 */
export function catalogueFiles(data = DATA) {
  return Object.keys(readBodyDirs()).sort().map((body) => [body, catalogueFile(body, data)])
      .filter(([, file]) => existsSync(file))
}


/**
 * The index of some catalogues.  A place is a row, `[name, lat, lng, kind]`
 * and its altitude after if it has one, the kind an index into `kinds`
 * (0: none): the kinds are 60 words over 8,400 places.
 *
 * @param {object} catalogues A body's name to its catalogue (`{places: [...]}`)
 * @returns {{kinds: Array<string>, bodies: object}}
 */
export function placesIndex(catalogues) {
  const kinds = ['']
  const kindOf = new Map([['', 0]])
  const bodies = {}
  for (const body of Object.keys(catalogues).sort()) {
    bodies[body] = catalogues[body].places.map((p) => {
      const k = p.k ?? ''
      if (!kindOf.has(k)) {
        kindOf.set(k, kinds.length)
        kinds.push(k)
      }
      const row = [p.n, p.lat, p.lng, kindOf.get(k)]
      if (p.a !== undefined) {
        row.push(p.a)
      }
      return row
    })
  }
  return {kinds, bodies}
}


/**
 * @param {{kinds: Array<string>, bodies: object}} index
 * @returns {string} The file's text: a body to a line
 */
export function renderIndex(index) {
  const lines = Object.entries(index.bodies).map(([body, rows]) => `${JSON.stringify(body)}: ${JSON.stringify(rows)}`)
  return [
    '{',
    '"_generator": "tools/places/index.mjs",',
    '"_about": "The places of each body\'s places.json for the search: [name, lat, lng, kind, altitude?]. ' +
      'Edit or rebuild those, then run yarn places-index",',
    `"kinds": ${JSON.stringify(index.kinds)},`,
    '"bodies": {',
    lines.join(',\n'),
    '}',
    '}',
    '',
  ].join('\n')
}


/**
 * @param {string} [data] public/data
 * @returns {string} The index the catalogues there make
 */
export function buildIndex(data = DATA) {
  const catalogues = {}
  for (const [body, file] of catalogueFiles(data)) {
    catalogues[body] = JSON.parse(readFileSync(file, 'utf8'))
  }
  return renderIndex(placesIndex(catalogues))
}


/**
 * Write the index from the catalogues.
 *
 * @returns {string} What was written
 */
export function writeIndex() {
  const text = buildIndex()
  writeFileSync(OUTPUT, text)
  console.log(`Wrote ${relative(root, OUTPUT)} (${text.length} bytes).`)
  return text
}


/** Write the index, or with --check say whether it's current. */
function main() {
  if (process.argv.includes('--check')) {
    const text = buildIndex()
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : ''
    if (current !== text) {
      console.error('public/data/places-index.json is out of date with the catalogues: run `yarn places-index`.')
      process.exit(1)
    }
    console.log('places-index.json is current.')
    return
  }
  writeIndex()
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
