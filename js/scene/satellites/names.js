// What Earth's satellites (and any population's objects) are called, how
// they're named in links, and the satellites' panel lines (Satellites.md):
// no dependencies, so the scene, the search and the link can import it
// without the SGP4 chunk.


/**
 * An object's path in the location hash (targetPath.js): `sat:25544` round
 * Earth, `sat:<body>:<id>` round another body.
 */
export const SAT_PREFIX = 'sat:'


/**
 * @param {object} rec a population's record
 * @returns {boolean} whether it's one of the best known (the snapshot's
 *   `known`), named first
 */
export function isKnown(rec) {
  return Boolean(rec.known)
}


/**
 * @param {object} rec
 * @returns {string} what to call it: its known name, else the catalogue's
 */
export function displayName(rec) {
  return rec.label ?? rec.name
}


/**
 * @param {object} rec
 * @returns {Array<string>} other names it's found by: its known aliases,
 *   the catalogue's name, its number and its international designator
 */
export function aliasesOf(rec) {
  const out = [...(rec.aliases ?? [])]
  if (rec.label && rec.label !== rec.name) {
    out.push(rec.name)
  }
  out.push(`NORAD ${rec.id}`, String(rec.id))
  if (rec.intlId) {
    out.push(rec.intlId)
  }
  return out
}


/**
 * The satellites load when the camera comes this near Earth's centre, m,
 * with the orbits (`o`) shown (Scene._watchForSatellites); they're drawn
 * within it (Satellites.js).  The Moon is 3.8e8 m out.
 */
export const SATELLITES_LOAD_DIST = 1.5e9


const GM_EARTH_KM3_S2 = 398600.4418
const EARTH_EQUATORIAL_KM = 6378.137


/**
 * What the info panel says about a satellite (ControlPanel.showSatellite):
 * its catalogue numbers, its orbit from its mean elements, and the elements'
 * age at the date, with whether it's drawn there.
 *
 * @param {object} rec sgp4.js SatRecord
 * @param {number} jd the date, Julian Day (UTC)
 * @param {?string} fetched when the snapshot was fetched, ISO
 * @param {?string} [kind] what one of its group is (the snapshot's groups'
 *   `kind`), e.g. 'space station'
 * @returns {{name: string, kind: string, fact: string, rows: Array<Array<string>>, notes: Array<string>}}
 *   the panel's head, its rows as [label, value, unit], and notes in words
 */
export function satelliteFacts(rec, jd, fetched = null, kind = null) {
  const n = rec.meanMotion * 2 * Math.PI / 86400
  const a = Math.cbrt(GM_EARTH_KM3_S2 / (n * n))
  const km = (x) => Math.round(x).toLocaleString('en-US')
  const perigee = km((a * (1 - rec.eccentricity)) - EARTH_EQUATORIAL_KM)
  const apogee = km((a * (1 + rec.eccentricity)) - EARTH_EQUATORIAL_KM)
  const age = jd - rec.epochJd
  const ageText = Math.abs(age) < 1 ? `${(Math.abs(age) * 24).toFixed(1)} h` : `${Math.abs(age).toFixed(1)} days`
  const epoch = new Date((rec.epochJd - 2440587.5) * 86400e3).toISOString().slice(0, 16).replace('T', ' ')
  const rows = [
    ['Height', perigee === apogee ? perigee : `${perigee} – ${apogee}`, 'km'],
    ['Inclination', `${rec.inclination.toFixed(1)}°`, ''],
    ['Period', (1440 / rec.meanMotion).toFixed(1), 'min'],
    ['Eccentricity', rec.eccentricity.toFixed(4), ''],
    ['Elements', `${epoch} UTC`, `${ageText} ${age < 0 ? 'after' : 'before'} this date`],
    ['NORAD', String(rec.id), ''],
  ]
  if (rec.intlId) {
    rows.push(['Designator', rec.intlId, ''])
  }
  const notes = []
  if (Math.abs(age) > rec.windowDays) {
    notes.push(`Not drawn: more than ${rec.windowDays} days from its elements, SGP4 can't say where it is.`)
  }
  if (fetched) {
    notes.push(`Elements from CelesTrak, ${fetched.slice(0, 10)}.`)
  }
  return {
    name: displayName(rec),
    kind: kind ? `Satellite, ${kind}` : 'Satellite',
    fact: `${perigee} km up`,
    rows,
    notes,
  }
}
