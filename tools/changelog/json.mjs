#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {changelogJson} from './parse.mjs'


/**
 * Writes public/data/changelog.json from CHANGELOG.md, for the app
 * (tools/changelog/README.md).  The JSON is committed, like the repo's other
 * built data, and a test fails when it has drifted from the Markdown.
 *
 *   yarn changelog           writes the JSON
 *   yarn changelog --check   exits 1 if the JSON isn't what the Markdown says
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
export const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')
export const OUTPUT = path.join(ROOT, 'public', 'data', 'changelog.json')


/**
 * @param {string} markdown CHANGELOG.md's text
 * @returns {string} The JSON file's text
 */
export function renderJson(markdown) {
  return `${JSON.stringify(changelogJson(markdown), null, 2)}\n`
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const json = renderJson(fs.readFileSync(CHANGELOG, 'utf8'))
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
    if (current !== json) {
      console.error('public/data/changelog.json is out of date with CHANGELOG.md: run `yarn changelog`.')
      process.exit(1)
    }
    console.log('changelog.json is current.')
  } else {
    fs.writeFileSync(OUTPUT, json)
    console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${JSON.parse(json).entries.length} entries).`)
  }
}
