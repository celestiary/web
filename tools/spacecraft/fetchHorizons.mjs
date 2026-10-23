#!/usr/bin/env node
// Builds a spacecraft's trajectory table, public/data/trajectories/<name>.json,
// from JPL Horizons' state vectors, and the offline fixture its test checks
// the interpolation against, js/scene/trajectory.<name>.horizons.json.  Tests never
// fetch; run this by hand to refresh both (js/scene/models.md, "Positions").
//
//   node tools/spacecraft/fetchHorizons.mjs
//
// The table: the craft's states relative to its parent body, ecliptic and
// equinox of J2000, at the times of a dense sample (minutes just after
// launch, hours over the first weeks, a day after), thinned to the fewest
// whose cubic Hermite interpolation (trajectory.js) reproduces every
// dropped state within TOLERANCE_KM.  The fixture: states at times off the
// dense sample's grid, fetched separately, so the test measures the
// interpolation against Horizons and not against the table's own points.
import fs from 'node:fs'
import path from 'node:path'
import {hermite} from '../../js/scene/trajectory.js'


const API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '../..')
// A thinned table reproduces the dense one to this, km.
const TOLERANCE_KM = 5
const COMMON = {
  format: 'json',
  OBJ_DATA: 'NO',
  MAKE_EPHEM: 'YES',
  EPHEM_TYPE: 'VECTORS',
  VEC_TABLE: '2',
  VEC_LABELS: 'NO',
  REF_PLANE: 'ECLIPTIC',
  REF_SYSTEM: 'ICRF',
  CSV_FORMAT: 'YES',
  OUT_UNITS: 'KM-S',
  TIME_TYPE: 'TDB',
}
// The craft: name, Horizons COMMAND, parent body and its CENTER, and the
// dense sample's spans [start, stop, step] (TDB).  Horizons' JWST starts
// 41 minutes after launch, past the Ariane's separation, and ends where
// the 5-year schedule does.
const CRAFT = [
  {
    name: 'webb', command: '-170', parent: 'earth', center: '500@399',
    spans: [
      ['2021-12-25 13:02', '2021-12-28 00:00', '10m'],
      ['2021-12-28 00:00', '2022-02-15 00:00', '1h'],
      ['2022-02-15 00:00', '2031-10-04 00:00', '1d'],
    ],
    // Off the grid, for the fixture.
    checks: [
      '2021-12-25 17:17', '2021-12-26 13:41', '2021-12-29 07:23', '2022-01-08 03:30', '2022-01-24 19:30',
      '2022-07-12 14:15', '2023-03-03 09:09', '2024-06-21 21:00', '2025-12-25 06:45', '2026-10-23 12:00',
      '2028-02-29 18:30', '2031-10-03 05:00',
    ],
  },
]


/**
 * @param {object} params Horizons query parameters past COMMON
 * @returns {Promise<Array<{jd: number, r: Array<number>, v: Array<number>}>>}
 */
async function vectors(params) {
  const query = new URLSearchParams({...COMMON, ...params})
  const res = await fetch(`${API}?${query}`)
  if (!res.ok) {
    throw new Error(`Horizons answered ${res.status}`)
  }
  const text = (await res.json()).result
  const table = text.slice(text.indexOf('$$SOE') + 5, text.indexOf('$$EOE')).trim()
  if (!table) {
    throw new Error(`no vectors: ${text.slice(0, 400)}`)
  }
  return table.split('\n').map((line) => {
    const f = line.split(',').map((s) => s.trim())
    return {jd: Number(f[0]), r: f.slice(2, 5).map(Number), v: f.slice(5, 8).map(Number)}
  })
}


/**
 * The fewest states, from the first and last, whose Hermite interpolation
 * reproduces every state of the dense sample within tolerance: greedy, each
 * kept state reaching as far as it can.
 *
 * @param {Array<{jd: number, r: Array<number>, v: Array<number>}>} dense
 * @param {number} toleranceKm
 * @returns {Array<{jd: number, r: Array<number>, v: Array<number>}>}
 */
function thin(dense, toleranceKm) {
  const kept = [dense[0]]
  let from = 0
  while (from < dense.length - 1) {
    let to = from + 1
    while (to + 1 < dense.length && reproduces(dense, from, to + 1, toleranceKm)) {
      to++
    }
    kept.push(dense[to])
    from = to
  }
  return kept
}


/**
 * @param {Array<{jd: number, r: Array<number>, v: Array<number>}>} dense
 * @param {number} a
 * @param {number} b
 * @param {number} toleranceKm
 * @returns {boolean} Whether a and b's Hermite reproduces every state between
 */
function reproduces(dense, a, b, toleranceKm) {
  const out = [0, 0, 0]
  for (let i = a + 1; i < b; i++) {
    hermite(dense[a], dense[b], dense[i].jd, out, DAY_S)
    const d = Math.hypot(out[0] - dense[i].r[0], out[1] - dense[i].r[1], out[2] - dense[i].r[2])
    if (d > toleranceKm) {
      return false
    }
  }
  return true
}


const DAY_S = 86400


for (const craft of CRAFT) {
  const dense = []
  const queries = []
  for (const [start, stop, step] of craft.spans) {
    const q = {COMMAND: `'${craft.command}'`, CENTER: `'${craft.center}'`,
      START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: `'${step}'`}
    queries.push(q)
    const states = await vectors(q)
    // The spans meet: drop the repeated state.
    dense.push(...(dense.length && states[0].jd <= dense.at(-1).jd ? states.slice(1) : states))
  }
  const kept = thin(dense, TOLERANCE_KM)
  const table = {
    name: craft.name,
    source: 'JPL Horizons (ssd.jpl.nasa.gov/api/horizons.api), VECTORS',
    fetched: new Date().toISOString().slice(0, 10),
    query: {...COMMON, spans: queries},
    parent: craft.parent,
    frame: 'ecliptic and equinox of J2000, relative to the parent\'s centre',
    units: {t: 'Julian Day, TDB', r: 'km', v: 'km/s'},
    tolerance: `cubic Hermite between neighbours reproduces the ${dense.length} states of the dense sample ` +
      `within ${TOLERANCE_KM} km`,
    // Flat: t[i], r[3i..3i+2], v[3i..3i+2].
    t: kept.map((s) => Number(s.jd.toFixed(9))),
    r: kept.flatMap((s) => s.r.map((x) => Number(x.toFixed(3)))),
    v: kept.flatMap((s) => s.v.map((x) => Number(x.toFixed(9)))),
  }
  const out = path.join(ROOT, 'public/data/trajectories', `${craft.name}.json`)
  fs.mkdirSync(path.dirname(out), {recursive: true})
  fs.writeFileSync(out, `${JSON.stringify(table)}\n`)
  process.stderr.write(`${craft.name}: ${dense.length} states thinned to ${kept.length}, ${out}\n`)

  const checkQuery = {COMMAND: `'${craft.command}'`, CENTER: `'${craft.center}'`,
    TLIST_TYPE: 'CAL', TLIST: craft.checks.map((t) => `'${t}'`).join(' ')}
  const fixture = {
    source: 'JPL Horizons (ssd.jpl.nasa.gov/api/horizons.api), VECTORS, ecliptic and equinox of J2000, ' +
      'km and km/s, relative to the parent\'s centre',
    fetched: table.fetched,
    query: {...COMMON, ...checkQuery},
    states: await vectors(checkQuery),
  }
  const fixturePath = path.join(ROOT, 'js/scene', `trajectory.${craft.name}.horizons.json`)
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 1)}\n`)
}
