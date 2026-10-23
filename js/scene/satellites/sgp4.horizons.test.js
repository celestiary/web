import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import {sgp4, twoline2satrec} from 'satellite.js'
import {precessionQuaternion, utcToTtJulianDay} from '../celestialFrame.js'
import {newSatRecord, temePosition, temeToEquator} from './sgp4.js'
import fixture from './sgp4.horizons.json'
import earth from '../../../public/data/earth.json'


// Satellites against JPL Horizons (offline fixture sgp4.horizons.json, its
// queries in it; tools/satellites/fetchHorizons.mjs): SGP4's TEME taken to
// Earth's equator under planetTilt, then to the scene's axes, against
// Horizons' J2000 ecliptic vectors precessed to the date
// (Satellites.md, checked).


const X_AXIS = new Vector3(1, 0, 0)
const J2000_OBLIQUITY = 23.4392911


/**
 * @param {number} deg
 * @returns {Quaternion} planetTilt's rotateX(-ε)
 */
const tilt = (deg) => new Quaternion().setFromAxisAngle(X_AXIS, -deg * Math.PI / 180)


/**
 * @param {object} row Horizons' {jd, x, y, z}, km
 * @returns {Vector3} in the scene's axes, the ecliptic of date
 */
function horizonsInScene(row) {
  return new Vector3(row.x, row.z, -row.y).applyQuaternion(precessionQuaternion(2451545.0, utcToTtJulianDay(row.jd)))
}


/**
 * @param {{x: number, y: number, z: number}} teme km
 * @param {number} obliquity degrees
 * @returns {Vector3} km, in the scene's axes
 */
const temeInScene = (teme, obliquity) => temeToEquator(teme, new Vector3).multiplyScalar(1e-3).applyQuaternion(tilt(obliquity))


describe('satellites against Horizons', () => {
  const vanguard = fixture.satellites.find((s) => s.name === 'Vanguard 1')

  it('has the fixture\'s queries, so it can be fetched again', () => {
    expect(vanguard.query.COMMAND).toBe('\'TLE\'')
    expect(vanguard.query.CENTER).toBe('500@399')
    expect(vanguard.rows).toHaveLength(3)
  })

  it('takes TEME to the scene\'s frame: Horizons\' SGP4 from the same TLE, within 0.4 km', () => {
    // The J2000 obliquity: nutation, which TEME has and the scene doesn't,
    // is the rest (0.2 to 0.33 km at 7,000 to 9,000 km out).
    const satrec = twoline2satrec(...vanguard.tle)
    const epoch = satrec.jdsatepoch + (satrec.jdsatepochF ?? 0)
    for (const row of vanguard.rows) {
      const p = sgp4(satrec, (row.jd - epoch) * 1440).position
      expect(temeInScene(p, J2000_OBLIQUITY).distanceTo(horizonsInScene(row))).toBeLessThan(0.4)
    }
  })

  it('is within 2 km in Earth\'s equator as drawn (its 23.45° tilt)', () => {
    // earth.json's axialInclination is 0.0107° over the J2000 obliquity;
    // the satellites hang in the drawn equator, so they keep their places
    // over the drawn ground and carry that 38″ in space (1.6 km here).
    expect(earth.axialInclination).toBe(23.45)
    const satrec = twoline2satrec(...vanguard.tle)
    const epoch = satrec.jdsatepoch + (satrec.jdsatepochF ?? 0)
    for (const row of vanguard.rows) {
      const p = sgp4(satrec, (row.jd - epoch) * 1440).position
      expect(temeInScene(p, earth.axialInclination).distanceTo(horizonsInScene(row))).toBeLessThan(2)
    }
  })

  const iss = fixture.satellites.find((s) => s.name === 'ISS')
  it.skipIf(!iss)('puts the ISS where Horizons\' trajectory has it, from the snapshot\'s elements', () => {
    const rec = newSatRecord(iss.omm, 'stations')
    for (const row of iss.rows) {
      const p = temePosition(rec, row.jd)
      const err = temeInScene(p, J2000_OBLIQUITY).distanceTo(horizonsInScene(row))
      // Horizons' ISS is fitted from the same elements (0.00 km at the
      // epoch); 0.6 km 6 h off, 1.5 km a day off, when fetched.
      expect(err).toBeLessThan(Math.abs(row.jd - rec.epochJd) < 0.3 ? 1 : 3)
    }
  })
})
