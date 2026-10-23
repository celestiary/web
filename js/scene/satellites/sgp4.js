import {json2satrec, sgp4} from 'satellite.js'


// Earth satellites' positions from their mean elements (CelesTrak's GP data,
// OMM), by SGP4/SDP4 (satellite.js), in Earth's equator frame as the scene
// hangs it: under Earth's planetTilt, +Y the north pole, +X the equinox of
// date, metres (js/scene/satellites/Satellites.md).


const KM = 1e3
const MIN_PER_DAY = 1440
const UNIX_EPOCH_JD = 2440587.5
const MS_PER_DAY = 86400e3


/**
 * The snapshot's columns, after the NORAD number, the name and the group:
 * the OMM fields SGP4 is initialised from, as CelesTrak's JSON names them.
 */
export const OMM_FIELDS = [
  'OBJECT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
]


/**
 * How far from its elements' epoch a satellite is drawn, days, by how fast
 * its elements age.  SGP4's error grows from about a kilometre at the epoch
 * by a few kilometres a day in low orbit, where drag's changes aren't in
 * the elements; past a month the phase along the orbit is a guess.  Higher
 * up, with little drag, the plane and the phase hold for months.  Past the
 * window the satellite isn't drawn (`inWindow`), rather than drawn where it
 * wasn't.
 */
export const WINDOW_DAYS = {low: 30, high: 180}
// Mean motion over which an orbit counts as low (rev/day): a period under
// 225 minutes, SGP4's own split between near-Earth and deep space.
const LOW_MEAN_MOTION = MIN_PER_DAY / 225


/**
 * @typedef {object} SatRecord
 * @property {number} id NORAD catalogue number
 * @property {string} name CelesTrak's OBJECT_NAME
 * @property {string} group the snapshot's group ('stations', 'gnss', ...)
 * @property {string} intlId international designator, e.g. '1998-067A'
 * @property {number} epochJd the elements' epoch, Julian Day (UTC)
 * @property {number} meanMotion revolutions a day
 * @property {number} inclination degrees
 * @property {number} eccentricity e
 * @property {number} windowDays how far from the epoch it's drawn
 * @property {object} satrec satellite.js's SGP4 state
 */


/**
 * One row of the snapshot (tools/satellites/fetch.mjs) as an OMM object.
 *
 * @param {Array} row [id, name, group, ...OMM_FIELDS]
 * @returns {object}
 */
export function rowToOmm(row) {
  const omm = {NORAD_CAT_ID: row[0], OBJECT_NAME: row[1]}
  OMM_FIELDS.forEach((f, i) => {
    omm[f] = row[i + 3]
  })
  return omm
}


/**
 * @param {object} omm An OMM record, CelesTrak's JSON
 * @param {string} [group]
 * @returns {?SatRecord} null if SGP4 can't start from it
 */
export function newSatRecord(omm, group = '') {
  const satrec = json2satrec(omm)
  if (!satrec || satrec.error) {
    return null
  }
  const meanMotion = Number(omm.MEAN_MOTION)
  return {
    id: Number(omm.NORAD_CAT_ID),
    name: String(omm.OBJECT_NAME),
    group,
    intlId: String(omm.OBJECT_ID ?? ''),
    epochJd: satrec.jdsatepoch + (satrec.jdsatepochF ?? 0),
    meanMotion,
    inclination: Number(omm.INCLINATION),
    eccentricity: Number(omm.ECCENTRICITY),
    windowDays: meanMotion > LOW_MEAN_MOTION ? WINDOW_DAYS.low : WINDOW_DAYS.high,
    satrec,
  }
}


/**
 * The snapshot, parsed.
 *
 * @param {{rows: Array<Array>}} data public/data/satellites.json
 * @returns {Array<SatRecord>} in its order, those SGP4 can start from
 */
export function parseCatalog(data) {
  const out = []
  for (const row of data?.rows ?? []) {
    const rec = newSatRecord(rowToOmm(row), row[2])
    if (rec) {
      out.push(rec)
    }
  }
  return out
}


/**
 * @param {number} ms Unix time, ms
 * @returns {number} Julian Day (UTC), as Time.toJulianDay
 */
export function unixMsToJd(ms) {
  return UNIX_EPOCH_JD + (ms / MS_PER_DAY)
}


/**
 * @param {SatRecord} rec
 * @param {number} jd Julian Day (UTC)
 * @returns {boolean} whether jd is within the satellite's window round its
 *   elements' epoch
 */
export function inWindow(rec, jd) {
  return Math.abs(jd - rec.epochJd) <= rec.windowDays
}


/**
 * SGP4's position in TEME, km, or null: an error (decayed, a diverging
 * orbit) or outside the satellite's window.
 *
 * @param {SatRecord} rec
 * @param {number} jd Julian Day (UTC)
 * @param {boolean} [anyDate] propagate outside the window too
 * @returns {?{x: number, y: number, z: number}}
 */
export function temePosition(rec, jd, anyDate = false) {
  if (!anyDate && !inWindow(rec, jd)) {
    return null
  }
  const minutes = (jd - rec.epochJd) * MIN_PER_DAY
  const pv = sgp4(rec.satrec, minutes)
  const p = pv?.position
  if (!p || rec.satrec.error || !Number.isFinite(p.x)) {
    return null
  }
  return p
}


/**
 * TEME, km, to Earth's equator frame under planetTilt, m: +X the equinox
 * of date, +Y the north pole, +Z toward right ascension 270°, i.e. TEME
 * (x, y, z) → (x, z, −y), the same remap as the ecliptic's to the scene's
 * (DESIGN.md, frames and time).  TEME is the true equator and the mean
 * equinox; planetTilt is the mean equator by the J2000 obliquity about
 * the equinox of date: they differ by nutation and the obliquity's drift,
 * under 20″ (about 4 km at GEO, under 1 km in low orbit).
 *
 * @param {{x: number, y: number, z: number}} p
 * @param {{set: Function}} out a Vector3, or anything with set(x, y, z)
 * @returns {object} out
 */
export function temeToEquator(p, out) {
  return out.set(p.x * KM, p.z * KM, -p.y * KM)
}


/**
 * @param {SatRecord} rec
 * @returns {number} the orbit's period, minutes
 */
export function periodMinutes(rec) {
  return MIN_PER_DAY / rec.meanMotion
}
