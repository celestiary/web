// What Earth's satellites are called and how they're named as targets and
// in links (Satellites.md): no dependencies, so the scene, the search and
// the link can import it without the SGP4 chunk.


/** A satellite's path in the location hash: `sat:25544` (targetPath.js). */
export const SAT_PREFIX = 'sat:'


// The names people know them by, for the scene and the search, where
// CelesTrak's OBJECT_NAME is a module's or a catalogue's.
const KNOWN = {
  25544: {name: 'ISS', aliases: ['International Space Station', 'ISS (Zarya)', 'Zarya']},
  48274: {name: 'Tiangong', aliases: ['Chinese Space Station', 'CSS', 'Tianhe', 'CSS (Tianhe)']},
  20580: {name: 'Hubble Space Telescope', aliases: ['Hubble', 'HST']},
}


/**
 * @param {object} rec
 * @returns {string} what to call it
 */
export function displayName(rec) {
  return KNOWN[rec.id]?.name ?? rec.name
}


/**
 * @param {object} rec
 * @returns {Array<string>} other names it's found by: CelesTrak's, the
 *   known ones, its NORAD number and international designator
 */
export function aliasesOf(rec) {
  const out = [...(KNOWN[rec.id]?.aliases ?? [])]
  if (KNOWN[rec.id]) {
    out.push(rec.name)
  }
  out.push(`NORAD ${rec.id}`, String(rec.id))
  if (rec.intlId) {
    out.push(rec.intlId)
  }
  return out
}


/**
 * @param {object} rec
 * @returns {{kind: 'satellite', id: number, name: string, body: string}} the
 *   satellite as a target (Scene.setTarget): Earth is its body, as a
 *   place's is
 */
export function satelliteTarget(rec) {
  return {kind: 'satellite', id: rec.id, name: displayName(rec), body: 'earth'}
}


/**
 * The satellites load when the camera comes this near Earth's centre, m,
 * with the orbits (`o`) shown (Scene._watchForSatellites); they're drawn
 * within it (Satellites.js).  The Moon is 3.8e8 m out.
 */
export const SATELLITES_LOAD_DIST = 1.5e9


const GM_EARTH_KM3_S2 = 398600.4418
const EARTH_EQUATORIAL_KM = 6378.137
const GROUP_TEXT = {
  stations: 'space station', science: 'science', gnss: 'navigation', starlink: 'Starlink', geo: 'geostationary',
  molniya: 'Molniya orbit', weather: 'weather',
}


/**
 * What the info panel says about a satellite (ControlPanel.showSatellite):
 * its catalogue numbers, its orbit from its mean elements, and the elements'
 * age at the date, with whether it's drawn there.
 *
 * @param {object} rec sgp4.js SatRecord
 * @param {number} jd the date, Julian Day (UTC)
 * @param {?string} fetched when the snapshot was fetched, ISO
 * @returns {{name: string, kind: string, fact: string, rows: Array<Array<string>>, notes: Array<string>}}
 *   the panel's head, its rows as [label, value, unit], and notes in words
 */
export function satelliteFacts(rec, jd, fetched = null) {
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
    kind: GROUP_TEXT[rec.group] ? `Satellite, ${GROUP_TEXT[rec.group]}` : 'Satellite',
    fact: `${perigee} km up`,
    rows,
    notes,
  }
}
