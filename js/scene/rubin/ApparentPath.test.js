import {describe, expect, it} from 'bun:test'
import {Object3D, Vector3} from 'three'
import ApparentPath, {FINE_PER_DAY} from './ApparentPath.js'
import {ASTRO_UNIT_METER, OVERLAY_LAYER} from '../../shared.js'
import {newRings} from '../LagrangeMarks.js'
import {J2000_JD, J2000_OBLIQUITY_DEG, precessionQuaternion, utcToTtJulianDay} from '../celestialFrame.js'
import {meanElements, orbitAt} from '../meanElements.js'
import {planetsApprox} from '../planetsApprox.js'
import {newWideLineStrip} from '../wideLines.js'
import horizons from '../ed138.horizons.json'
import ed138 from '../../../public/data/ed138/index.json'


const toDeg = 180 / Math.PI
const toRad = Math.PI / 180
const elements = meanElements(ed138.orbit)
const earthAt = (jd) => {
  const e = planetsApprox(jd).earth
  return new Vector3(e.x, e.z, -e.y).multiplyScalar(ASTRO_UNIT_METER)
}
const newLabels = (entries) => ({sheet: null, sprites: new Object3D, entries})
const deps = {orbitAt, precessionQuaternion, utcToTtJulianDay, J2000_JD, newRings, newLabels, newWideLineStrip, OVERLAY_LAYER}


/**
 * @param {number} x scene axes, J2000
 * @param {number} y
 * @param {number} z
 * @returns {{ra: number, dec: number}} degrees
 */
function raDec(x, y, z) {
  // Scene (x, z, -y) to the ecliptic's (x, y, z), then to the equator.
  const ecl = [x, -z, y]
  const eps = J2000_OBLIQUITY_DEG * toRad
  const yEq = (ecl[1] * Math.cos(eps)) - (ecl[2] * Math.sin(eps))
  const zEq = (ecl[1] * Math.sin(eps)) + (ecl[2] * Math.cos(eps))
  return {ra: ((Math.atan2(yEq, ecl[0]) * toDeg) + 360) % 360, dec: Math.atan2(zEq, Math.hypot(ecl[0], yEq)) * toDeg}
}


describe('ApparentPath', () => {
  const path = new ApparentPath({elements, earthAt, deps})

  it('lays the daily positions from Earth at the body\'s true distance, 45 to 47 au, March to August 2026', () => {
    expect(path.jds).toHaveLength(154)
    const AU = 1.495978707e11
    for (let i = 0; i < path.jds.length; i++) {
      const d = Math.hypot(path.points[3 * i], path.points[(3 * i) + 1], path.points[(3 * i) + 2]) / AU
      expect(d).toBeGreaterThan(45)
      expect(d).toBeLessThan(47.6)
    }
  })

  it('is where Horizons sees the body from Earth, within 0.01° (the stand-in Earth)', () => {
    for (const [i, o] of horizons.observer.entries()) {
      const k = Math.round(o.jd - path.jds[0])
      expect(path.jds[k]).toBeCloseTo(o.jd, 6)
      const {ra, dec} = raDec(path.points[3 * k], path.points[(3 * k) + 1], path.points[(3 * k) + 2])
      expect(Math.abs(ra - o.raDeg)).toBeLessThan(0.01)
      expect(Math.abs(dec - o.decDeg)).toBeLessThan(0.01)
      expect(i).toBeGreaterThanOrEqual(0)
    }
  })

  it('names the first of each month', () => {
    expect(path.months.map((m) => m.text)).toEqual(['1 Mar', '1 Apr', '1 May', '1 Jun', '1 Jul', '1 Aug'])
  })

  it('puts the ring where the body is at the clock\'s time, within the span only', () => {
    path.place(path.jds[0] - 1)
    expect(path.marker.visible).toBe(false)
    const mid = path.jds[50] + 0.5
    path.place(mid)
    expect(path.marker.visible).toBe(true)
    // The ring is at the anchor, its vertex at the origin: the cubic
    // between the days, off their chord's midpoint by the sag of a day of
    // Earth's orbit (5.5e6 m), less than 1e7 m.
    const at = path.marker.geometry.getAttribute('position').array
    expect([...at]).toEqual([0, 0, 0])
    expect(path.marker.position.equals(path.anchor)).toBe(true)
    for (const [k, c] of ['x', 'y', 'z'].entries()) {
      const mean = (path.points[(3 * 50) + k] + path.points[(3 * 51) + k]) / 2
      expect(Math.abs(path.anchor[c] - mean)).toBeLessThan(1e7)
    }
    path.place(path.jds[path.jds.length - 1] + 1)
    expect(path.marker.visible).toBe(false)
  })

  it('is on the curve between the days: the cubic within 2e3 m of the body\'s computed place', () => {
    for (const day of [10.25, 50.5, 100.75, 140.1]) {
      const jd = path.jds[0] + day
      path.place(jd)
      const exact = path.positionJ2000(jd)
      expect(path.anchor.distanceTo(exact)).toBeLessThan(2e3)
    }
  })

  it('draws the line as float32 offsets from the anchor: good to 6e-8 of the offset, not of 7e12 m', () => {
    path.place(path.jds[0] + 70.3)
    expect(path.line.position.equals(path.anchor)).toBe(true)
    const offsets = path.line.geometry.getAttribute('position').array
    const j = Math.round(70.3 * FINE_PER_DAY)
    for (const i of [j - 2, j, j + 2]) {
      for (const [k, c] of ['x', 'y', 'z'].entries()) {
        const exact = path.fine[(3 * i) + k] - path.anchor[c]
        // A vertex 1e8 m from the anchor is held to a few metres, 1e-12 rad
        // at 47 au; unanchored, 5e5 m.
        expect(Math.abs(offsets[(3 * i) + k] - exact)).toBeLessThanOrEqual((6e-8 * Math.abs(exact)) + 1e-6)
      }
    }
    expect(Math.abs(Math.fround(path.fine[3 * j]) - path.fine[3 * j])).toBeGreaterThan(1)
  })

  it('samples again when the ephemeris arrives, and the ring follows', () => {
    let ready = false
    let shift = 1.7e7
    const later = new ApparentPath({elements, deps, approximate: () => !ready,
      earthAt: (jd) => earthAt(jd).add(new Vector3(shift, 0, 0))})
    const jd = later.jds[60] + 0.3
    later.place(jd)
    const before = later.anchor.clone()
    shift = 0
    later.place(jd)
    expect(later.anchor.equals(before)).toBe(true)
    ready = true
    later.place(jd)
    // Earth 1.7e7 m along +X in the date's frame; the path, from Earth, the other way.
    expect(later.anchor.distanceTo(before)).toBeGreaterThan(1.6e7)
    expect(later.anchor.distanceTo(later.positionJ2000(jd))).toBeLessThan(2e3)
    const offsets = later.line.geometry.getAttribute('position').array
    const j = Math.round((60 + 0.3) * FINE_PER_DAY)
    expect(Math.abs(offsets[3 * j] - (later.fine[3 * j] - later.anchor.x))).toBeLessThan(10)
  })

  it('turns to the date: the precession from J2000, a fraction of a degree', () => {
    path.place(path.jds[0])
    const angle = 2 * Math.acos(Math.min(1, Math.abs(path.quaternion.w))) * toDeg
    expect(angle).toBeGreaterThan(0.3)
    expect(angle).toBeLessThan(0.4)
  })
})
