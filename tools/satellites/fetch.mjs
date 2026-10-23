#!/usr/bin/env node
// Refresh the satellites' snapshot, public/data/satellites.json, from
// CelesTrak's GP data (js/scene/satellites/Satellites.md, the data):
//
//   yarn satellites
//
// One request a group (CelesTrak asks for no more than one per group every
// two hours, and blocks clients that ask more).

import fs from 'node:fs'
import {GROUP_QUERIES, buildSnapshot, gpUrl} from './select.js'


const OUT = new URL('../../public/data/satellites.json', import.meta.url)


const fetched = []
for (const {group, query, keep} of GROUP_QUERIES) {
  const url = gpUrl(query)
  const rsp = await fetch(url, {headers: {'user-agent': 'celestiary (https://celestiary.org/; tools/satellites)'}})
  if (!rsp.ok) {
    throw new Error(`${url}: ${rsp.status}`)
  }
  const records = await rsp.json()
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
