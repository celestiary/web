#!/usr/bin/env node
// Fetches the offline fixture js/scene/iauRotation.horizons.json: JPL
// Horizons' sub-observer points (quantity 14) on each body celestiary
// rotates, seen from Earth's centre and, for the moons, from their planet's
// centre, with the astrometric direction (quantity 1) and light time
// (quantity 21) that let a test rebuild the same point from a rotation
// model.  Tests never fetch; run this by hand to refresh the fixture.
//
//   node tools/iau/fetchHorizons.mjs > js/scene/iauRotation.horizons.json
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
// UT Julian Days: 1950-01-01 0h, J2000 (2000-01-01 12h UT), 2026-10-01 0h,
// 2050-01-01 0h.
const DATES = ['2433282.5', '2451545.0', '2461314.5', '2469807.5']
const COMMON = {
  format: 'text',
  OBJ_DATA: 'NO',
  MAKE_EPHEM: 'YES',
  EPHEM_TYPE: 'OBSERVER',
  QUANTITIES: '1,14,21',
  ANG_FORMAT: 'DEG',
  CSV_FORMAT: 'YES',
  EXTRA_PREC: 'YES',
  TIME_TYPE: 'UT',
  TLIST_TYPE: 'JD',
}
const GEOCENTRE = '500@399'
// [celestiary name, Horizons COMMAND, CENTER, observer name]
const ENTRIES = [
  ['mercury', '199', GEOCENTRE, 'earth'],
  ['venus', '299', GEOCENTRE, 'earth'],
  ['earth', '399', '500@301', 'moon'],
  ['moon', '301', GEOCENTRE, 'earth'],
  ['mars', '499', GEOCENTRE, 'earth'],
  ['phobos', '401', '500@499', 'mars'],
  ['deimos', '402', '500@499', 'mars'],
  ['jupiter', '599', GEOCENTRE, 'earth'],
  ['io', '501', GEOCENTRE, 'earth'],
  ['io', '501', '500@599', 'jupiter'],
  ['europa', '502', GEOCENTRE, 'earth'],
  ['europa', '502', '500@599', 'jupiter'],
  ['ganymede', '503', '500@599', 'jupiter'],
  ['callisto', '504', '500@599', 'jupiter'],
  ['saturn', '699', GEOCENTRE, 'earth'],
  ['tethys', '603', '500@699', 'saturn'],
  ['dione', '604', '500@699', 'saturn'],
  ['rhea', '605', '500@699', 'saturn'],
  ['titan', '606', GEOCENTRE, 'earth'],
  ['titan', '606', '500@699', 'saturn'],
  ['iapetus', '608', '500@699', 'saturn'],
  ['uranus', '799', GEOCENTRE, 'earth'],
  ['titania', '703', '500@799', 'uranus'],
  ['oberon', '704', '500@799', 'uranus'],
  ['neptune', '899', GEOCENTRE, 'earth'],
  ['triton', '801', '500@899', 'neptune'],
  ['pluto', '999', GEOCENTRE, 'earth'],
  ['charon', '901', '500@999', 'pluto'],
]


/**
 * @param {string} command
 * @param {string} center
 * @returns {Promise<object>}
 */
async function fetchEntry(command, center) {
  const params = {...COMMON, COMMAND: `'${command}'`, CENTER: `'${center}'`, TLIST: DATES.map((d) => `'${d}'`).join(' ')}
  const url = `${API}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
  const text = await (await fetch(url)).text()
  const frame = /Target pole\/equ : (.+?)\s+\{(East|West)-longitude positive\}/.exec(text)
  const radii = /Target radii\s+: ([\d.]+), ([\d.]+), ([\d.]+) km/.exec(text)
  const source = /Target body name: .*\{source: (\S+)\}/.exec(text)
  const soe = text.indexOf('$$SOE')
  const eoe = text.indexOf('$$EOE')
  if (!frame || !radii || soe < 0 || eoe < 0) {
    throw new Error(`unexpected Horizons reply for ${command} from ${center}`)
  }
  const rows = text.slice(soe + '$$SOE'.length, eoe).trim().split('\n').map((line, i) => {
    const cols = line.split(',').map((s) => s.trim())
    // Date, two flag columns, RA, Dec, sub-lon, sub-lat, light time.
    const [ra, dec, lon, lat, lt] = cols.slice(3, 8).map(Number)
    return [Number(DATES[i]), ra, dec, lon, lat, lt]
  })
  return {
    frame: frame[1],
    longitudePositive: frame[2].toLowerCase(),
    radiiKm: radii.slice(1, 4).map(Number),
    ephemeris: source ? source[1] : null,
    rows,
  }
}


const entries = []
for (const [body, command, center, observer] of ENTRIES) {
  entries.push({body, command, center, observer, ...await fetchEntry(command, center)})
}
const today = new Date().toISOString().slice(0, 10)
const out = {
  source: `JPL Horizons API (${API}), retrieved ${today}, by tools/iau/fetchHorizons.mjs`,
  query: `${Object.entries(COMMON).filter(([k]) => k !== 'format').map(([k, v]) => `${k}=${v}`).join('&')}` +
    `&TLIST=${DATES.join(' ')}, with COMMAND and CENTER per entry`,
  columns: ['jdUtc', 'raDeg', 'decDeg', 'subLonDeg', 'subLatDeg', 'lightTimeMin'],
  notes: 'raDeg, decDeg: astrometric ICRF direction from the observer to the body (light-time corrected). ' +
    'subLonDeg, subLatDeg: the apparent sub-observer point, planetodetic on the frame\'s spheroid (radiiKm), ' +
    'longitude positive as longitudePositive says.  lightTimeMin: one-way, body to observer.  Dates are UT ' +
    '(UT1 before 1962).',
  entries,
}
const json = JSON.stringify(out, null, 1)
    .replace(/\[\s+([^[\]{}]*?)\s+\]/g, (s, inner) => `[${inner.replace(/\s+/g, ' ')}]`)
process.stdout.write(`${json}\n`)
