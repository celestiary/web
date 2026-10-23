#!/usr/bin/env node
// Refresh the space networks' snapshots (js/scene/networks/Networks.md):
//
//   yarn networks [--cache DIR] [--only starlink,iridium,dsn]
//
// - public/data/networks/starlink.json: CelesTrak's GROUP=starlink, every
//   satellite, in the compact columns of js/scene/networks/compactElements.js
//   (about 0.7 MB, 0.3 MB gzipped, for ~11,000).
// - public/data/networks/iridium.json: GROUP=iridium-NEXT, the same way,
//   with their names.
// - public/data/networks/dsn.json: DSN Now's config.xml, the complexes and
//   the spacecraft's names.  The live feed isn't bundled: the app polls it.
//
// CelesTrak is asked as tools/satellites/celestrak.mjs asks: once a group,
// kept in --cache DIR for two hours, and stopping at the first refusal.
// NODE_USE_ENV_PROXY=1 (set by `yarn networks`) lets Node's fetch use the
// proxy.

import fs from 'node:fs'
import {dsnConfig} from './dsnConfig.js'
import {encodeElements} from '../../js/scene/networks/compactElements.js'
import {cacheFile, fetchGroup} from '../satellites/celestrak.mjs'
import {gpUrl} from '../satellites/select.js'


const OUT = new URL('../../public/data/networks/', import.meta.url)
const DSN_CONFIG = 'https://eyes.nasa.gov/dsn/config.xml'
const SOURCE = 'CelesTrak GP data (https://celestrak.org/NORAD/elements/), OMM, ' +
  'from the US Space Force\'s public catalogue; tools/networks/fetch.mjs'
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : null
}
const CACHE = arg('--cache')
const ONLY = new Set((arg('--only') ?? 'starlink,iridium,dsn').split(','))


/**
 * @param {string} file
 * @param {object} data
 */
function write(file, data) {
  fs.mkdirSync(OUT, {recursive: true})
  const out = new URL(file, OUT)
  // A column to a line: a diff reads by field.
  const body = Object.entries(data).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')
  fs.writeFileSync(out, `{\n${body}\n}\n`)
  console.log(`Wrote ${out.pathname}: ${fs.statSync(out).size} bytes`)
}


const fetched = new Date().toISOString()
for (const [name, group, names] of [['starlink', 'starlink', false], ['iridium', 'iridium-NEXT', true]]) {
  if (!ONLY.has(name)) {
    continue
  }
  const url = gpUrl({GROUP: group})
  const records = (await fetchGroup(url, CACHE)).filter((r) => r.MEAN_MOTION > 0)
  console.log(`${name}: ${records.length} from ${url}`)
  // When CelesTrak answered: the cached answer's time, if it came from there.
  const at = CACHE && fs.existsSync(cacheFile(url, CACHE)) ? fs.statSync(cacheFile(url, CACHE)).mtime.toISOString() : fetched
  write(`${name}.json`, {source: SOURCE, fetched: at, url, ...encodeElements(records, {names})})
}
if (ONLY.has('dsn')) {
  const rsp = await fetch(DSN_CONFIG)
  if (!rsp.ok) {
    throw new Error(`${DSN_CONFIG}: ${rsp.status}`)
  }
  write('dsn.json', dsnConfig(await rsp.text(), {
    source: 'NASA DSN Now configuration (https://eyes.nasa.gov/dsn/config.xml); tools/networks/fetch.mjs',
    fetched,
    url: DSN_CONFIG,
  }))
}
