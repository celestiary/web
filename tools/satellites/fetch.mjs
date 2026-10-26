#!/usr/bin/env node
// Refresh the satellites' snapshot, public/data/satellites.json, from
// CelesTrak's GP data (js/scene/satellites/Satellites.md, the data):
//
//   yarn satellites [--cache DIR] [--offline] [--skip group,...]
//
// One request a group (CelesTrak asks for no more than one per group every
// two hours, and blocks clients that ask more), through celestrak.mjs: each
// answer is kept in tools/satellites/.cache (or --cache DIR) and used again
// for two hours, by this script and by `yarn networks`, which asks for two of
// the same groups; so a run that failed part way can be run again without
// asking for the groups it had.  With --offline, the cache is used whatever
// its age and nothing is asked (to rebuild the files from the last fetch).
// A group kept whole in a file of its own (select.js `file`: Starlink's) is
// written there.  Node's fetch reads HTTPS_PROXY only with
// NODE_USE_ENV_PROXY=1, which `yarn satellites` sets.
//
// CelesTrak's usage policy (https://celestrak.org/usage-policy.php): stop at
// the first answer that isn't a 200 and report it to a person, so the script
// throws there and asks for nothing more.  A group refused because its data
// hasn't changed since this address last had it (a 403) can be left out with
// --skip, without asking; the snapshot's header names it, for a later run.

import fs from 'node:fs'
import path from 'node:path'
import {DEFAULT_CACHE, fetchGroup} from './celestrak.mjs'
import {GROUP_QUERIES, buildSnapshot, gpUrl} from './select.js'


const OUT = new URL('../../public/data/satellites.json', import.meta.url)
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


/**
 * @param {object} obj with `rows`, written a row to a line: diffs between
 *   snapshots read by satellite
 * @returns {string}
 */
function rowsJson(obj) {
  const {rows, ...header} = obj
  return JSON.stringify(header, null, 2).replace(/\n}$/,
      `,\n  "rows": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]\n}\n`)
}


fs.writeFileSync(OUT, rowsJson(snapshot))
console.log(`Wrote ${snapshot.rows.length} satellites to ${OUT.pathname}`)
for (const [file, part] of Object.entries(files)) {
  // A group skipped this time keeps the file it had.
  if (part.rows.length === 0) {
    continue
  }
  const out = new URL(`../../public/${file}`, import.meta.url)
  fs.mkdirSync(path.dirname(out.pathname), {recursive: true})
  fs.writeFileSync(out, rowsJson(part))
  console.log(`Wrote ${part.rows.length} ${part.group} to ${out.pathname}`)
}
