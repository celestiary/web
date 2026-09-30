import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import {
  J2000_JD,
  precessEcliptic,
  precessionQuaternion,
  utcToTtJulianDay,
} from './celestialFrame.js'
import {eclipticToScene} from './lunarTheory.js'
import StellarFrame, {STELLAR_FRAME_EPSILON_DAYS} from './StellarFrame.js'


const ARCSEC_PER_RAD = 206264.806247
const DAYS_PER_YEAR = 365.25


/**
 * Angle between two vectors in arcseconds, well-conditioned near 0.
 *
 * @param {Vector3} a
 * @param {Vector3} b
 * @returns {number}
 */
function sepArcsec(a, b) {
  return Math.atan2(new Vector3().crossVectors(a, b).length(), a.dot(b)) * ARCSEC_PER_RAD
}


describe('precessionQuaternion', () => {
  it('turns directions as precessEcliptic does, to 1e-6″', () => {
    // From the year 0 to 4000; poles, equinoxes and points in between.
    const dates = [1721057.5, 2415020.5, 2451545.0, 2461313.1, 2634233.5, 2816787.5]
    const points = [[0, 0], [90, 0], [180, 0], [270, 0], [149.48, 1.77], [31, 85], [200, -60], [300, -89.9]]
    for (const jde of dates) {
      const q = precessionQuaternion(J2000_JD, jde)
      for (const [l, b] of points) {
        const v = eclipticToScene(l, b, 1).applyQuaternion(q)
        const p = precessEcliptic(l, b, J2000_JD, jde)
        expect(sepArcsec(v, eclipticToScene(p.lambda, p.beta, 1))).toBeLessThan(1e-6)
      }
    }
  })


  it('reproduces Meeus example 21.c', () => {
    // J2000 (λ, β) = (149.48194°, 1.76549°) precessed to -214 June 30.0 TD
    // (JDE 1643074.5): λ = 118.704°, β = +1.615°.
    const v = eclipticToScene(149.48194, 1.76549, 1).applyQuaternion(precessionQuaternion(J2000_JD, 1643074.5))
    const lambda = ((Math.atan2(-v.z, v.x) * 180 / Math.PI) + 360) % 360
    const beta = Math.asin(v.y) * 180 / Math.PI
    expect(lambda).toBeCloseTo(118.704, 3)
    expect(beta).toBeCloseTo(1.615, 3)
  })


  it('is the identity at J2000 and inverts by swapping the dates', () => {
    const q = precessionQuaternion(J2000_JD, J2000_JD)
    expect(q.angleTo(new Quaternion)).toBeLessThan(1e-15)
    const there = precessionQuaternion(J2000_JD, 2634233.5)
    const back = precessionQuaternion(2634233.5, J2000_JD)
    expect(there.multiply(back).angleTo(new Quaternion)).toBeLessThan(1e-12)
  })


  it('moves the J2000 equinox ~50.29″ a year along the ecliptic, about the ecliptic pole', () => {
    const years = 26.75
    const q = precessionQuaternion(J2000_JD, J2000_JD + (years * DAYS_PER_YEAR))
    const x = new Vector3(1, 0, 0).applyQuaternion(q)
    // Longitude increases toward -Z in the scene.
    const dLambda = Math.atan2(-x.z, x.x) * ARCSEC_PER_RAD
    expect(dLambda / years).toBeCloseTo(50.29, 1)
    // The ecliptic pole moves only by η, ~47″ a century.
    const pole = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(sepArcsec(pole, new Vector3(0, 1, 0))).toBeLessThan(0.5 * years)
  })
})


describe('StellarFrame', () => {
  it('starts at the identity (J2000) and turns to the date', () => {
    const frame = new StellarFrame()
    expect(frame.quaternion.angleTo(new Quaternion)).toBe(0)
    const jd = 2461313.1
    expect(frame.update(jd)).toBe(true)
    const want = precessionQuaternion(J2000_JD, utcToTtJulianDay(jd))
    expect(frame.quaternion.angleTo(want)).toBeLessThan(1e-15)
  })


  it('recomputes only when the date moves by more than the threshold', () => {
    const frame = new StellarFrame()
    const calls = []
    frame.onChange((q) => calls.push(q))
    const q = frame.quaternion
    expect(frame.update(2461313.1)).toBe(true)
    expect(frame.update(2461313.1 + (0.9 * STELLAR_FRAME_EPSILON_DAYS))).toBe(false)
    expect(frame.update(2461313.1 - (0.9 * STELLAR_FRAME_EPSILON_DAYS))).toBe(false)
    expect(frame.update(2461313.1 + (1.1 * STELLAR_FRAME_EPSILON_DAYS))).toBe(true)
    expect(frame.update(NaN)).toBe(false)
    expect(calls.length).toBe(2)
    // In place: the same quaternion object throughout, and handed to the
    // callbacks.
    expect(frame.quaternion).toBe(q)
    expect(calls[0]).toBe(q)
  })


  it('lags the date by under 0.2″ between updates', () => {
    const frame = new StellarFrame()
    const jd = 2461313.1
    frame.update(jd)
    const later = precessionQuaternion(J2000_JD, utcToTtJulianDay(jd + STELLAR_FRAME_EPSILON_DAYS))
    expect(frame.quaternion.angleTo(later) * ARCSEC_PER_RAD).toBeLessThan(0.2)
  })


  it('follows Animation\'s preAnimCb with the animated Julian Day', () => {
    const frame = new StellarFrame()
    const time = {simTimeJulianDay: () => J2000_JD + 5000}
    frame.preAnimCb(time, 2634233.5)
    expect(frame.jde).toBeCloseTo(utcToTtJulianDay(2634233.5), 9)
    frame.preAnimCb(time, null)
    expect(frame.jde).toBeCloseTo(utcToTtJulianDay(J2000_JD + 5000), 9)
  })


  it('toParent turns a catalogue position about the Sun', () => {
    const frame = new StellarFrame()
    frame.update(2634233.5)
    const v = frame.toParent(new Vector3(3, 4, 12))
    expect(v.length()).toBeCloseTo(13, 12)
    expect(sepArcsec(v, new Vector3(3, 4, 12))).toBeGreaterThan(6 * 3600)
  })
})

