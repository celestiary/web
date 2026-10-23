#!/usr/bin/env node
// Fetches the offline fixture js/scene/craft/tess.horizons.json: JPL
// Horizons' geocentric state vectors of TESS (Horizons -95), every six hours
// over two three-day arcs between its momentum dumps, so a test can start
// the integrator from the first state of an arc and compare where it puts
// the craft with where Horizons has it (Craft.md, checked against a real
// craft).  TESS is in a 13.7-day orbit in 2:1 resonance with the Moon,
// 108,000 to 375,000 km out, where the Moon and the Sun pull hardest.
// Tests never fetch; run this by hand to refresh the fixture.
//
//   node tools/craft/fetchHorizons.mjs > js/scene/craft/tess.horizons.json
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
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
  CENTER: '\'500@399\'',
  COMMAND: '\'-95\'',
  STEP_SIZE: '\'6 h\'',
}
// The arcs, TDB: 2023-03-03 to 03-06 and 2023-03-17 to 03-20, each between
// two of its momentum dumps (found by flying a day from each day's state:
// a dump shows as kilometres of miss where a day without one is 0.5 km).
const ARCS = [['2023-03-03', '2023-03-06'], ['2023-03-17', '2023-03-20']]


/**
 * @param {string} start
 * @param {string} stop
 * @returns {Promise<Array<{jd: number, r: Array<number>, v: Array<number>}>>} km and km/s,
 *     ecliptic and equinox of J2000
 */
async function vectors(start, stop) {
  const params = new URLSearchParams({...COMMON, START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`})
  const res = await fetch(`${API}?${params}`)
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


const out = {
  source: 'JPL Horizons (ssd.jpl.nasa.gov/api/horizons.api), VECTORS, TESS (-95) from the Earth\'s centre, ' +
    'ecliptic and equinox of J2000, km and km/s, TDB',
  fetched: new Date().toISOString().slice(0, 10),
  query: {...COMMON, ARCS},
  arcs: [],
}
for (const [start, stop] of ARCS) {
  out.arcs.push(await vectors(start, stop))
}
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`)
