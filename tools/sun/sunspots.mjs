#!/usr/bin/env node
// Builds js/scene/sun/sunspots.json, the Sun's activity by month for the
// solar cycle (js/scene/sun/solarCycle.js, js/scene/Sun.md), from NOAA SWPC's
// two solar-cycle products, both US Government work:
//
//   observed: https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json
//   predicted: https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json
//
// From the observed product it keeps SWPC's own sunspot number,
// `observed_swpc_ssn` (SWPC's count, from January 1997), and its 13-month
// smoothed value, `smoothed_swpc_ssn`.  Not its `ssn` column: that is the
// international sunspot number of WDC-SILSO (Royal Observatory of Belgium),
// which SWPC redistributes and whose licence (CC BY-NC 4.0) forbids
// commercial use, so it isn't bundled.  From the predicted product, the
// panel's `predicted_ssn` for the months after the observed record.
//
// Tests never fetch; run this by hand to refresh the file:
//
//   node tools/sun/sunspots.mjs > js/scene/sun/sunspots.json
//
// or, with the two files already downloaded,
//
//   node tools/sun/sunspots.mjs observed.json predicted.json > js/scene/sun/sunspots.json
import {readFileSync} from 'node:fs'


const OBSERVED_URL = 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json'
const PREDICTED_URL = 'https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json'
// SWPC writes -1 for a value it doesn't have.
const MISSING = -1


/**
 * @param {string} url
 * @param {string} [file] A local copy to read instead
 * @returns {Promise<Array<object>>}
 */
async function load(url, file) {
  if (file) {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`)
  }
  return res.json()
}


/**
 * The months from the first with `key` to the last, as one array of
 * values (null where SWPC has none) and the first month's tag.
 *
 * @param {Array<object>} rows
 * @param {string} key
 * @returns {{start: string, values: Array<number|null>}}
 */
function series(rows, key) {
  const has = (r) => typeof r[key] === 'number' && r[key] !== MISSING
  const first = rows.findIndex(has)
  let last = rows.length - 1
  while (last > first && !has(rows[last])) {
    last--
  }
  const values = rows.slice(first, last + 1).map((r) => (has(r) ? r[key] : null))
  return {start: rows[first]['time-tag'], values}
}


const [observedFile, predictedFile] = process.argv.slice(2)
const observed = await load(OBSERVED_URL, observedFile)
const predicted = await load(PREDICTED_URL, predictedFile)
const ssn = series(observed, 'observed_swpc_ssn')
const smoothed = series(observed, 'smoothed_swpc_ssn')
const lastObserved = observed[observed.findLastIndex((r) => r.observed_swpc_ssn !== MISSING)]['time-tag']
// The forecast from the month after the observed record.
const ahead = predicted.filter((r) => r['time-tag'] > lastObserved)
const out = {
  source: 'NOAA Space Weather Prediction Center (SWPC), solar-cycle products; US Government work, not subject to copyright in the US (17 U.S.C. 105)',
  observedUrl: OBSERVED_URL,
  predictedUrl: PREDICTED_URL,
  fetched: new Date().toISOString().slice(0, 10),
  generatedBy: 'tools/sun/sunspots.mjs',
  note: 'observed: SWPC\'s own monthly sunspot number (observed_swpc_ssn) and its 13-month smoothed value (smoothed_swpc_ssn); predicted: the SWPC forecast (predicted_ssn) for the months after the observed record.  Not SILSO\'s international sunspot number (the observed product\'s ssn column, CC BY-NC 4.0).',
  observed: {start: ssn.start, ssn: ssn.values},
  smoothed: {start: smoothed.start, ssn: smoothed.values},
  predicted: {start: ahead[0]['time-tag'], ssn: ahead.map((r) => r.predicted_ssn)},
}
// One month a line, so a refresh diffs by month.
const lines = JSON.stringify(out, null, 1)
    .replace(/\[\n\s+([\s\S]*?)\n\s+\]/g, (m, body) => `[${body.replace(/\s*\n\s*/g, ' ')}]`)
process.stdout.write(`${lines}\n`)
