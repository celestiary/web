import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import Animation from './Animation.js'
import {utcToTtJulianDay} from './celestialFrame.js'
import {moonScenePosition} from './lunarTheory.js'
import {eccentricAnomaly} from './meanElements.js'
import {ASTRO_UNIT_METER} from '../shared.js'


// The osculating elements (Animation.orbitElements): their ellipse meets
// the body where its ephemeris puts it, where the mean elements miss it by
// thousands of km.  The series from the package: Celestiary.test.js mocks
// ./vsop.js for the whole process.
const vsop87c = await vsop87cLoader

const JD = 2461326.441 // 2026 Oct 12, the maintainer's screenshots
const SECONDS_PER_DAY = 86400
const ORBITS = {
  moon: {eccentricity: 0.0554, semiMajorAxis: 384467000, siderealOrbitPeriod: 2360591.5},
  earth: {eccentricity: 0.0167, semiMajorAxis: 1.4959789e11, siderealOrbitPeriod: 31558149.8},
  jupiter: {eccentricity: 0.0484, semiMajorAxis: 7.785e11, siderealOrbitPeriod: 374335689},
}


/**
 * @param {number} jd
 * @returns {object} a clock at jd
 */
function newTime(jd) {
  return {jd, simTimeJulianDay: () => jd, simTimeSecs: () => (jd - 2440587.5) * SECONDS_PER_DAY}
}


/**
 * Where an element set puts its body, as the diagram draws it.
 *
 * @param {object} el
 * @returns {Vector3}
 */
function placeOf(el) {
  const q = new Quaternion().copy(el.frame)
  const t = new Quaternion
  q.multiply(t.setFromAxisAngle(new Vector3(0, 1, 0), el.node * Math.PI / 180))
  q.multiply(t.setFromAxisAngle(new Vector3(1, 0, 0), el.i * Math.PI / 180))
  q.multiply(t.setFromAxisAngle(new Vector3(0, 1, 0), el.w * Math.PI / 180))
  const E = eccentricAnomaly(el.m * Math.PI / 180, el.e)
  return new Vector3(el.a * (Math.cos(E) - el.e), 0, -el.a * Math.sqrt(1 - (el.e * el.e)) * Math.sin(E))
      .applyQuaternion(q)
}


describe('orbitElements', () => {
  const anim = new Animation(newTime(JD), vsop87c)
  anim.setDate(JD)

  it('puts the Moon on its ellipse, where the lunar theory has it', () => {
    const el = anim.orbitElements('moon', ORBITS.moon)
    expect(el.kind).toBe('osculating')
    const moon = moonScenePosition(utcToTtJulianDay(JD), new Vector3)
    // Within a km, against the mean elements' 5,000 km that day.
    expect(placeOf(el).distanceTo(moon)).toBeLessThan(1e3)
  })

  it('puts a planet on its ellipse, where VSOP87C has it; Earth\'s the barycentre\'s', () => {
    const v = vsop87c(JD).jupiter
    const jupiter = new Vector3(v.x, v.z, -v.y).multiplyScalar(ASTRO_UNIT_METER)
    expect(placeOf(anim.orbitElements('jupiter', ORBITS.jupiter)).distanceTo(jupiter)).toBeLessThan(1e3)
    const e = vsop87c(JD).earth
    const earth = new Vector3(e.x, e.z, -e.y).multiplyScalar(ASTRO_UNIT_METER)
    const off = placeOf(anim.orbitElements('earth', ORBITS.earth)).distanceTo(earth)
    // The barycentre, ~4,700 km from the Earth's centre: inside it.
    expect(off).toBeGreaterThan(4000e3)
    expect(off).toBeLessThan(5000e3)
  })

  it('makes a set from the stand-in again once VSOP87C is in', () => {
    const early = new Animation(newTime(JD), null)
    early.setDate(JD)
    const standIn = early.orbitElements('earth', ORBITS.earth)
    early.setEphemeris(vsop87c)
    const e = vsop87c(JD).earth
    const earth = new Vector3(e.x, e.z, -e.y).multiplyScalar(ASTRO_UNIT_METER)
    const moon = moonScenePosition(utcToTtJulianDay(JD), new Vector3)
    const barycentre = earth.clone().addScaledVector(moon, 1 / (1 + 81.30056))
    // The same date: only the ephemeris has changed.
    const now = early.orbitElements('earth', ORBITS.earth)
    expect(placeOf(standIn).distanceTo(barycentre)).toBeGreaterThan(1e6)
    expect(placeOf(now).distanceTo(barycentre)).toBeLessThan(1e3)
  })

  it('runs the body on along its ellipse between makings, and makes them again as the date moves', () => {
    const a = anim.orbitElements('moon', ORBITS.moon)
    anim.setDate(JD + 1)
    const b = anim.orbitElements('moon', ORBITS.moon)
    expect(b.m).not.toBe(a.m)
    const moon = moonScenePosition(utcToTtJulianDay(JD + 1), new Vector3)
    expect(placeOf(b).distanceTo(moon)).toBeLessThan(1e3)
  })
})
