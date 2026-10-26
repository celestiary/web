#!/usr/bin/env node
// Refresh the Deep Space Network's snapshot (js/scene/networks/Networks.md):
//
//   yarn networks
//
// public/data/earth/networks/dsn.json: DSN Now's config.xml, the complexes
// and the spacecraft's names; Earth's ground networks, beside its satellites'
// (satellites/networks/).  The live feed isn't bundled: the app polls it.
//
// The satellite networks' constellations (Starlink, Iridium) are CelesTrak's
// groups, refreshed with the rest of Earth's satellites by `yarn
// satellites` (tools/satellites/fetch.mjs), into
// public/data/earth/satellites/networks/: one copy each, which the overlays
// and the population both read.  NODE_USE_ENV_PROXY=1 (set by `yarn
// networks`) lets Node's fetch use the proxy.

import fs from 'node:fs'
import {dsnConfig} from './dsnConfig.js'
import {columnsJson} from '../satellites/select.js'


const OUT = new URL('../../public/data/earth/networks/dsn.json', import.meta.url)
const DSN_CONFIG = 'https://eyes.nasa.gov/dsn/config.xml'


const rsp = await fetch(DSN_CONFIG)
if (!rsp.ok) {
  throw new Error(`${DSN_CONFIG}: ${rsp.status}`)
}
fs.mkdirSync(new URL('.', OUT), {recursive: true})
fs.writeFileSync(OUT, columnsJson(dsnConfig(await rsp.text(), {
  source: 'NASA DSN Now configuration (https://eyes.nasa.gov/dsn/config.xml); tools/networks/fetch.mjs',
  fetched: new Date().toISOString(),
  url: DSN_CONFIG,
})))
console.log(`Wrote ${OUT.pathname}: ${fs.statSync(OUT).size} bytes`)
