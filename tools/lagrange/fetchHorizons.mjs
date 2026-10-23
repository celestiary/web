#!/usr/bin/env node
// Fetches the offline fixture js/scene/lagrange.horizons.json: JPL
// Horizons' state vectors of bodies that sit at a pair's Lagrange points,
// and of the pair's secondary, relative to the primary, so a test can put
// the points where lagrange.js says and check the bodies are there:
// Telesto and Calypso at Tethys's L4 and L5, Helene and Polydeuces at
// Dione's, Jupiter's Trojans at the Sun-Jupiter L4 and L5, and Earth's
// trojan 2010 TK7 at the Sun-Earth L4.  Tests never fetch; run this by hand
// to refresh the fixture.
//
//   node tools/lagrange/fetchHorizons.mjs > js/scene/lagrange.horizons.json
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
// TDB Julian Days: 1950-01-01 0h, J2000, 2026-10-01 0h, 2050-01-01 0h.
const DATES = ['2433282.5', '2451545.0', '2461314.5', '2469807.5']
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
  TLIST_TYPE: 'JD',
}
// The pairs: [name, primary's CENTER, secondary's COMMAND, the bodies at
// its points: [name, COMMAND, the point]].  The Sun-Earth pair's secondary
// is the Earth-Moon barycentre.
const PAIRS = [
  ['tethys', '500@699', '603', [['telesto', '613', 'L4'], ['calypso', '614', 'L5']]],
  ['dione', '500@699', '604', [['helene', '612', 'L4'], ['polydeuces', '634', 'L5']]],
  ['jupiter', '500@10', '599', [
    ['achilles', '588;', 'L4'], ['hektor', '624;', 'L4'], ['patroclus', '617;', 'L5'], ['aeneas', '1172;', 'L5'],
  ]],
  ['earth', '500@10', '3', [['2010 TK7', 'DES=2010 TK7;', 'L4']]],
]


/**
 * @param {string} command
 * @param {string} center
 * @returns {Promise<Array<{jd: number, r: Array<number>, v: Array<number>}>>} km and km/s,
 *     ecliptic and equinox of J2000
 */
async function vectors(command, center) {
  const params = new URLSearchParams({...COMMON, COMMAND: `'${command}'`, CENTER: `'${center}'`,
    TLIST: DATES.map((d) => `'${d}'`).join(' ')})
  const res = await fetch(`${API}?${params}`)
  if (!res.ok) {
    throw new Error(`Horizons answered ${res.status} for ${command}`)
  }
  const text = (await res.json()).result
  const table = text.slice(text.indexOf('$$SOE') + 5, text.indexOf('$$EOE')).trim()
  if (!table) {
    throw new Error(`no vectors for ${command}: ${text.slice(0, 400)}`)
  }
  return table.split('\n').map((line) => {
    const f = line.split(',').map((s) => s.trim())
    return {jd: Number(f[0]), r: f.slice(2, 5).map(Number), v: f.slice(5, 8).map(Number)}
  })
}


const out = {
  source: 'JPL Horizons (ssd.jpl.nasa.gov/api/horizons.api), VECTORS, ecliptic and equinox of J2000, km and km/s',
  fetched: new Date().toISOString().slice(0, 10),
  query: {...COMMON, TLIST: DATES},
  pairs: {},
}
for (const [name, center, command, bodies] of PAIRS) {
  const pair = {center, command, states: await vectors(command, center), bodies: {}}
  for (const [body, bodyCommand, point] of bodies) {
    pair.bodies[body] = {command: bodyCommand, point, states: await vectors(bodyCommand, center)}
  }
  out.pairs[name] = pair
}
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`)
