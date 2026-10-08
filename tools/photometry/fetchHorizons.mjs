#!/usr/bin/env node
// Fetches the offline fixture js/scene/planetPhotometry.horizons.json: JPL
// Horizons' apparent V magnitude (APmag), surface brightness, illuminated
// fraction, angular diameter, distances and phase angle for the planets and
// the Moon, seen from Earth's centre at one date (#192's occultation,
// 2026-10-06 09:00 UT), and for Jupiter from Bay Village at the user's
// occultation view.  What the Sun's inverse-square light (shared.js) is
// checked against: the planets' brightness against one another and against
// the Moon (Planet.md, "Lighting and exposure").  Tests never fetch; run
// this by hand to refresh the fixture.
//
//   node tools/photometry/fetchHorizons.mjs > js/scene/planetPhotometry.horizons.json
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
const COMMON = {
  format: 'text',
  OBJ_DATA: 'NO',
  MAKE_EPHEM: 'YES',
  EPHEM_TYPE: 'OBSERVER',
  // 1 astrometric RA/Dec, 9 APmag and S-brt, 10 illuminated %, 13 angular
  // diameter, 14 the sub-observer point, 19 r, 20 delta, 24 S-T-O.
  QUANTITIES: '1,9,10,13,14,19,20,24',
  ANG_FORMAT: 'DEG',
  CSV_FORMAT: 'YES',
  EXTRA_PREC: 'YES',
  TIME_TYPE: 'UT',
  TLIST_TYPE: 'JD',
}
// 2026-10-06 09:00 UT, and the user's occultation view (t=9774.8911jd).
const DATE = '2461319.875'
const OCCULTATION = '2461319.8911'
const GEOCENTRE = {CENTER: '500@399'}
const BAY_VILLAGE = {CENTER: 'coord@399', COORD_TYPE: 'GEODETIC', SITE_COORD: '-82.3901,41.2054,0.169'}
// [celestiary name, Horizons COMMAND, observer, JD]
const ENTRIES = [
  ['mercury', '199', GEOCENTRE, DATE],
  ['venus', '299', GEOCENTRE, DATE],
  ['moon', '301', GEOCENTRE, DATE],
  ['mars', '499', GEOCENTRE, DATE],
  ['jupiter', '599', GEOCENTRE, DATE],
  ['saturn', '699', GEOCENTRE, DATE],
  ['uranus', '799', GEOCENTRE, DATE],
  ['neptune', '899', GEOCENTRE, DATE],
  ['jupiter', '599', BAY_VILLAGE, OCCULTATION],
]
const COLUMNS = ['raDeg', 'decDeg', 'apmag', 'sbrt', 'illuminatedPercent', 'angularDiameterArcsec',
  'subLonDeg', 'subLatDeg', 'rAu', 'rdotKmS', 'deltaAu', 'deldotKmS', 'phaseDeg']


/**
 * @param {object} params
 * @returns {string}
 */
function queryUrl(params) {
  // Horizons takes its values quoted, but `format` bare.
  const value = (k, v) => encodeURIComponent(k === 'format' ? v : `'${v}'`)
  return `${API}?${Object.entries(params).map(([k, v]) => `${k}=${value(k, v)}`).join('&')}`
}


/**
 * @param {string} command
 * @param {object} observer
 * @param {string} jd
 * @returns {Promise<object>}
 */
async function fetchEntry(command, observer, jd) {
  const params = {...COMMON, COMMAND: command, ...observer, TLIST: jd}
  const url = queryUrl(params)
  const text = await (await fetch(url)).text()
  const soe = text.indexOf('$$SOE')
  const eoe = text.indexOf('$$EOE')
  if (soe < 0 || eoe < 0) {
    throw new Error(`unexpected Horizons reply for ${command}`)
  }
  const cols = text.slice(soe + '$$SOE'.length, eoe).trim().split(',').map((s) => s.trim())
  // Date, two flag columns, then the quantities in order.
  const values = cols.slice(3, 3 + COLUMNS.length).map((s) => (s === 'n.a.' ? null : Number(s)))
  return {query: url.replace(/^.*\?/, `${API}?`), utc: cols[0], ...Object.fromEntries(COLUMNS.map((c, i) => [c, values[i]]))}
}


const entries = []
for (const [body, command, observer, jd] of ENTRIES) {
  const where = observer === GEOCENTRE ? 'geocentre' : 'Bay Village, Ohio, 169 m'
  entries.push({body, command, observer: where, jdUtc: Number(jd), ...await fetchEntry(command, observer, jd)})
}
const today = new Date().toISOString().slice(0, 10)
const out = {
  source: `JPL Horizons API (${API}), retrieved ${today}, by tools/photometry/fetchHorizons.mjs`,
  notes: 'apmag: Horizons\' approximate V (Mallama & Hilton 2018\'s phase laws; Saturn\'s includes its rings at ' +
    'their tilt).  sbrt: the illuminated disc\'s mean surface brightness, mag/arcsec2.  subLonDeg, subLatDeg: the ' +
    'apparent sub-observer point, planetodetic.  rAu: Sun to body, deltaAu: observer to body, phaseDeg: ' +
    'Sun-target-observer.  Dates are UT.',
  entries,
}
const json = JSON.stringify(out, null, 1)
process.stdout.write(`${json}\n`)
