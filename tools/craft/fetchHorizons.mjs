#!/usr/bin/env node
// Fetches the craft's offline fixtures from JPL Horizons (Craft.md), each
// recording its queries.  Tests never fetch; run this by hand to refresh
// one.
//
// - tess: TESS (Horizons -95), geocentric, every six hours over two
//   three-day arcs between its momentum dumps, so a test can start the
//   integrator from the first state of an arc and compare where it puts the
//   craft with where Horizons has it.  TESS is in a 13.7-day orbit in 2:1
//   resonance with the Moon, 108,000 to 375,000 km out, where the Moon and
//   the Sun pull hardest.
// - blt: the two ballistic lunar transfers flown, GRAIL-A (-177, 2011) and
//   CAPSTONE (-1176, 2022): geocentric every two days over the transfer
//   (its apogee, its energy leaving), Moon-centred hourly over the day
//   before arrival (its energy arriving), and CAPSTONE every six hours over
//   ten days of coast between its manoeuvres, 1 to 1.2 million km out,
//   where the Sun pulls as hard as the Earth.
//
//   node tools/craft/fetchHorizons.mjs tess > js/scene/craft/tess.horizons.json
//   node tools/craft/fetchHorizons.mjs blt > js/scene/craft/blt.horizons.json
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
}
// TESS's arcs, TDB: 2023-03-03 to 03-06 and 2023-03-17 to 03-20, each
// between two of its momentum dumps (found by flying a day from each day's
// state: a dump shows as kilometres of miss where a day without one is
// 0.5 km).
const TESS = [['2023-03-03', '2023-03-06'], ['2023-03-17', '2023-03-20']]
// The transfers: [name, COMMAND, the transfer's span, the day before
// arrival (Moon-centred), a quiet coast].  GRAIL-A launched 2011-09-10 and
// entered lunar orbit 2011-12-31; CAPSTONE left its Photon stage
// 2022-07-04 and entered its NRHO 2022-11-13.
const TRANSFERS = [
  ['grailA', '-177', ['2011-09-11', '2011-12-31'], ['2011-12-30', '2011-12-31T22:00'], null],
  ['capstone', '-1176', ['2022-07-05', '2022-11-13'], ['2022-11-12', '2022-11-13T12:00'],
    ['2022-07-14', '2022-07-24']],
]


/**
 * @param {object} query Horizons' parameters beyond COMMON
 * @returns {Promise<Array<{jd: number, r: Array<number>, v: Array<number>}>>} km and km/s,
 *     ecliptic and equinox of J2000
 */
async function vectors(query) {
  const params = new URLSearchParams({...COMMON, ...query})
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
    const f = line.split(',').map((x) => x.trim())
    return {jd: Number(f[0]), r: f.slice(2, 5).map(Number), v: f.slice(5, 8).map(Number)}
  })
}


/**
 * @param {string} command
 * @param {string} center
 * @param {Array<string>} span start and stop
 * @param {string} step
 * @returns {object} Horizons' query
 */
const query = (command, center, [start, stop], step) => ({COMMAND: `'${command}'`, CENTER: `'${center}'`,
  START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: `'${step}'`})


const which = process.argv[2]
const out = {
  source: 'JPL Horizons (ssd.jpl.nasa.gov/api/horizons.api), VECTORS, ecliptic and equinox of J2000, km and km/s, TDB',
  fetched: new Date().toISOString().slice(0, 10),
  common: COMMON,
}
if (which === 'tess') {
  out.arcs = []
  out.queries = []
  for (const span of TESS) {
    const q = query('-95', '500@399', span, '6 h')
    out.queries.push(q)
    out.arcs.push(await vectors(q))
  }
} else if (which === 'blt') {
  out.transfers = {}
  for (const [name, command, span, approach, coast] of TRANSFERS) {
    const queries = {transfer: query(command, '500@399', span, '2 d'),
      approach: query(command, '500@301', approach, '1 h')}
    if (coast) {
      queries.coast = query(command, '500@399', coast, '6 h')
    }
    const t = {command, queries}
    for (const [key, q] of Object.entries(queries)) {
      t[key] = await vectors(q)
    }
    out.transfers[name] = t
  }
} else {
  throw new Error('usage: fetchHorizons.mjs tess|blt')
}
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`)
