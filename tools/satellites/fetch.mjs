#!/usr/bin/env node
// Refresh the satellites' snapshot, public/data/satellites.json, from
// CelesTrak's GP data (js/scene/satellites/Satellites.md, the data):
//
//   yarn satellites [--cache DIR] [--skip group,...]
//
// One request a group (CelesTrak asks for no more than one per group every
// two hours, and blocks clients that ask more).  With --cache, a group's
// answer is kept in DIR and used again for two hours, so a run that failed
// part way can be run again without asking for the groups it had.  Node's
// fetch reads HTTPS_PROXY only with NODE_USE_ENV_PROXY=1, which `yarn
// satellites` sets.
//
// CelesTrak's usage policy (https://celestrak.org/usage-policy.php): stop at
// the first answer that isn't a 200 and report it to a person, so the script
// throws there and asks for nothing more.  A group refused because its data
// hasn't changed since this address last had it (a 403) can be left out with
// --skip, without asking; the snapshot's header names it, for a later run.

import fs from 'node:fs'
import {GROUP_QUERIES, buildSnapshot, gpUrl} from './select.js'
import {fetchGroup} from './celestrak.mjs'


const OUT = new URL('../../public/data/satellites.json', import.meta.url)
const cacheArg = process.argv.indexOf('--cache')
const CACHE = cacheArg > 0 ? process.argv[cacheArg + 1] : null
const skipArg = process.argv.indexOf('--skip')
const SKIP = new Set(skipArg > 0 ? process.argv[skipArg + 1].split(',') : [])


const fetched = []
for (const {group, query, keep} of GROUP_QUERIES) {
  const url = gpUrl(query)
  if (SKIP.has(group)) {
    console.warn(`${group}: skipped`)
    fetched.push({group, records: [], keep, url, error: 'skipped'})
    continue
  }
  const records = await fetchGroup(url, CACHE)
  console.log(`${group}: ${records.length} from ${url}`)
  fetched.push({group, records, keep, url})
}
const snapshot = buildSnapshot(fetched, new Date().toISOString())
// A row to a line: diffs between snapshots read by satellite.
const {rows, ...header} = snapshot
const json = JSON.stringify(header, null, 2).replace(/\n}$/,
    `,\n  "rows": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]\n}\n`)
fs.writeFileSync(OUT, json)
console.log(`Wrote ${rows.length} satellites to ${OUT.pathname}`)
