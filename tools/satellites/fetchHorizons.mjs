#!/usr/bin/env node
// Fetches the offline fixture js/scene/satellites/sgp4.horizons.json: JPL
// Horizons' geocentric state vectors (ecliptic and equinox of J2000, km,
// UT) for satellites, beside the elements they're checked from
// (Satellites.md, checked).  Tests never fetch; run this by hand to refresh
// it.
//
//   node tools/satellites/fetchHorizons.mjs > js/scene/satellites/sgp4.horizons.json
//
// - Vanguard 1 from Vallado's verification TLE, propagated by Horizons'
//   own SGP4 (its TLE input): the same elements both sides, so it checks
//   the frame (TEME to the scene's) and the time, not the elements.
// - The ISS (Horizons -125544, its trajectory) a day either side of the
//   epoch of the snapshot's elements (public/data/satellites.json), if the
//   snapshot has it: the elements' error too.
import fs from 'node:fs'
import {rowToOmm} from '../../js/scene/satellites/sgp4.js'


const API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
const SNAPSHOT = new URL('../../public/data/satellites.json', import.meta.url)
const VECTORS = {
  format: 'text',
  MAKE_EPHEM: 'YES',
  EPHEM_TYPE: 'VECTORS',
  CENTER: '500@399',
  REF_PLANE: 'ECLIPTIC',
  REF_SYSTEM: 'ICRF',
  VEC_TABLE: '1',
  OUT_UNITS: 'KM-S',
  CSV_FORMAT: 'YES',
  VEC_LABELS: 'NO',
  TIME_TYPE: 'UT',
  TLIST_TYPE: 'JD',
}
const VANGUARD_TLE = [
  '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
  '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
]
// The TLE's epoch, 2000-06-27 18:50:19.73 UT, then 6 h and 1 d on.
const VANGUARD_JDS = [2451723.28495062, 2451723.53495062, 2451724.28495062]


/**
 * @param {object} params
 * @returns {Promise<{query: object, rows: Array<{jd: number, x: number, y: number, z: number}>}>}
 */
async function vectors(params) {
  const query = {...VECTORS, ...params}
  const url = `${API}?${Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
  const text = await (await fetch(url)).text()
  const soe = text.indexOf('$$SOE')
  const eoe = text.indexOf('$$EOE')
  if (soe < 0 || eoe < 0) {
    throw new Error(`unexpected Horizons reply: ${text.slice(0, 400)}`)
  }
  const rows = text.slice(soe + '$$SOE'.length, eoe).trim().split('\n').map((line) => {
    const cols = line.split(',').map((s) => s.trim())
    const [jd, , x, y, z] = cols
    return {jd: Number(jd), x: Number(x), y: Number(y), z: Number(z)}
  })
  const revised = /Revised: (.+?)\s{2,}/.exec(text)?.[1] ?? null
  return {query, revised, rows}
}


const jdList = (jds) => jds.map((d) => `'${d}'`).join(' ')
const out = {
  source: 'JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), geocentric vectors, ' +
    'ecliptic and equinox of J2000 (ICRF), km, UT; tools/satellites/fetchHorizons.mjs',
  fetched: new Date().toISOString(),
  satellites: [],
}

out.satellites.push({
  name: 'Vanguard 1', check: 'frame', tle: VANGUARD_TLE,
  ...await vectors({COMMAND: '\'TLE\'', TLE: VANGUARD_TLE.join('\n'), TLIST: jdList(VANGUARD_JDS)}),
})

const snapshot = fs.existsSync(SNAPSHOT) ? JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) : null
const issRow = snapshot?.rows?.find((r) => r[0] === 25544)
if (issRow) {
  const omm = rowToOmm(issRow)
  const epochJd = 2440587.5 + (Date.parse(`${omm.EPOCH}Z`) / 864e5)
  const jds = [-1, -0.25, 0, 0.25, 1].map((d) => (epochJd + d).toFixed(6))
  out.satellites.push({
    name: 'ISS', check: 'elements', omm, snapshotFetched: snapshot.fetched,
    ...await vectors({COMMAND: '\'-125544\'', TLIST: jdList(jds)}),
  })
} else {
  console.error('No ISS in the snapshot: the fixture has Vanguard 1 only')
}
console.log(JSON.stringify(out, null, 2))
