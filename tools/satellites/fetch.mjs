#!/usr/bin/env node
// Refresh Earth's satellites from CelesTrak's GP data
// (js/scene/satellites/Satellites.md, the data): the snapshot,
// public/data/earth/satellites/index.json, and the constellations the space
// networks draw, each whole in a file of its own under networks/ there
// (select.js `file`: Starlink's and Iridium's), which the population reads
// too:
//
//   yarn satellites [--cache DIR] [--offline] [--skip group,...]
//
// One request a group (CelesTrak asks for no more than one per group every
// two hours, and blocks clients that ask more), through celestrak.mjs: each
// answer is kept in tools/satellites/.cache (or --cache DIR) and used again
// for two hours, so a run that failed part way can be run again without
// asking for the groups it had.  With --offline, the cache is used whatever
// its age and nothing is asked (to rebuild the files from the last fetch).
// Node's fetch reads HTTPS_PROXY only with NODE_USE_ENV_PROXY=1, which `yarn
// satellites` sets.
//
// CelesTrak's usage policy (https://celestrak.org/usage-policy.php): stop at
// the first answer that isn't a 200 and report it to a person, so the script
// throws there and asks for nothing more.  A group refused because its data
// hasn't changed since this address last had it (a 403) can be left out with
// --skip, without asking; the snapshot's header names it, for a later run,
// and a skipped group's own file is left as it was.

import fs from 'node:fs'
import path from 'node:path'
import {DEFAULT_CACHE, fetchGroup} from './celestrak.mjs'
import {GROUP_QUERIES, SATELLITES_DIR, buildSnapshot, columnsJson, gpUrl, rowsJson} from './select.js'


const PUBLIC = new URL('../../public/', import.meta.url).pathname
const OUT = path.join(PUBLIC, SATELLITES_DIR, 'index.json')
const cacheArg = process.argv.indexOf('--cache')
const CACHE = cacheArg > 0 ? process.argv[cacheArg + 1] : DEFAULT_CACHE
const skipArg = process.argv.indexOf('--skip')
const SKIP = new Set(skipArg > 0 ? process.argv[skipArg + 1].split(',') : [])
const OFFLINE = process.argv.includes('--offline')


// When the oldest group was fetched, ms: the snapshot's `fetched` (a group
// from the cache counts from when it was fetched, not when it's read).
let oldest = Date.now()


const fetched = []
for (const q of GROUP_QUERIES) {
  const url = gpUrl(q.query)
  if (SKIP.has(q.group)) {
    console.warn(`${q.group}: skipped`)
    fetched.push({...q, records: [], url, error: 'skipped'})
    continue
  }
  const {records, fetchedMs} = await fetchGroup(url, {cacheDir: CACHE, offline: OFFLINE})
  oldest = Math.min(oldest, fetchedMs)
  console.log(`${q.group}: ${records.length} from ${url}`)
  fetched.push({...q, records, url})
}
const {files, ...snapshot} = buildSnapshot(fetched, new Date(oldest).toISOString())


fs.mkdirSync(path.dirname(OUT), {recursive: true})
fs.writeFileSync(OUT, rowsJson(snapshot))
console.log(`Wrote ${snapshot.rows.length} satellites to ${OUT}`)
for (const [file, part] of Object.entries(files)) {
  const out = path.join(PUBLIC, file)
  fs.mkdirSync(path.dirname(out), {recursive: true})
  fs.writeFileSync(out, columnsJson(part))
  console.log(`Wrote ${part.count} ${part.group} to ${out}`)
}
