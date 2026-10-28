import {beforeAll, describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {ASTRO_UNIT_METER} from '../shared.js'
import {J2000_JD, J2000_OBLIQUITY_DEG, precessionQuaternion} from './celestialFrame.js'
import {meanElements, orbitAt} from './meanElements.js'
import horizons from './ed138.horizons.json'
import ed138 from '../../public/data/ed138/index.json'


// 2026 ED138, Rubin's first dwarf planet candidate (rubin/Rubin.md), on
// JPL's osculating elements at one epoch (2026-06-09), against JPL Horizons
// (ed138.horizons.json, recorded with the query that produced it).  Two-body
// motion from one epoch drifts from the integrated orbit as the planets'
// perturbations accrue, 5 million km by 2016 and 4 million by 2036 (0.03
// au at 47 au: 0.04° seen from the Sun); in the discovery months the
// direction from Earth is Horizons' to a ten-thousandth of a degree.

const toDeg = 180 / Math.PI
const toRad = Math.PI / 180
const KM = 1e3
const q = new Quaternion
const p = new Vector3


/**
 * @param {number} jde
 * @returns {Vector3} heliocentric, ecliptic and equinox of J2000, km
 */
function heliocentricKm(jde) {
  orbitAt(meanElements(ed138.orbit), jde, q, p)
  // Scene axes (x, z, -y) back to the ecliptic's (x, y, z).
  return new Vector3(p.x, -p.z, p.y).multiplyScalar(1 / KM)
}


/**
 * @param {Vector3} v ecliptic J2000
 * @returns {{ra: number, dec: number}} ICRF, degrees
 */
function raDec(v) {
  const eps = J2000_OBLIQUITY_DEG * toRad
  const yEq = (v.y * Math.cos(eps)) - (v.z * Math.sin(eps))
  const zEq = (v.y * Math.sin(eps)) + (v.z * Math.cos(eps))
  return {ra: ((Math.atan2(yEq, v.x) * toDeg) + 360) % 360, dec: Math.atan2(zEq, Math.hypot(v.x, yEq)) * toDeg}
}


describe('2026 ED138 on its JPL elements', () => {
  let vsop87c
  beforeAll(async () => {
    vsop87c = await vsop87cLoader
  })

  it('is in the Sun\'s system, as a planet with its own label and kind', () => {
    expect(ed138.type).toBe('planet')
    expect(ed138.label).toBe('2026 ED138')
    expect(ed138.kind).toBe('Dwarf planet candidate')
    expect(ed138.orbit.referencePlane).toBe('ecliptic')
    expect(ed138.orbit.siderealOrbitPeriod).toBeCloseTo(ed138.orbit.period * 86400, 0)
  })

  it('matches Horizons\' heliocentric vectors: within 50,000 km in 2026, 5.5 million km over 2016 to 2036', () => {
    for (const h of horizons.heliocentric) {
      const miss = heliocentricKm(h.jd).distanceTo(new Vector3(...h.km))
      expect(miss).toBeLessThan(h.date.startsWith('2026') ? 5e4 : 5.5e6)
      expect(heliocentricKm(h.jd).length() / (ASTRO_UNIT_METER / KM)).toBeGreaterThan(46)
    }
  })

  it('is seen from Earth where Horizons puts it through the discovery months, within 0.002°', () => {
    for (const [i, g] of horizons.geocentric.entries()) {
      const e = vsop87c(g.jd).earth
      // VSOP87C's Earth, ecliptic of date, to J2000 (scene axes in between).
      const earth = new Vector3(e.x, e.z, -e.y).multiplyScalar(ASTRO_UNIT_METER)
          .applyQuaternion(precessionQuaternion(g.jd, J2000_JD))
      const earthKm = new Vector3(earth.x, -earth.z, earth.y).multiplyScalar(1 / KM)
      const geo = heliocentricKm(g.jd).sub(earthKm)
      expect(geo.angleTo(new Vector3(...g.km)) * toDeg).toBeLessThan(0.002)
      const {ra, dec} = raDec(geo)
      const o = horizons.observer[i]
      expect(o.jd).toBe(g.jd)
      expect(Math.abs(ra - o.raDeg)).toBeLessThan(0.002)
      expect(Math.abs(dec - o.decDeg)).toBeLessThan(0.002)
      // Corona Australis' corner of the sky, as Rubin's picture has it.
      expect(ra).toBeGreaterThan(272)
      expect(ra).toBeLessThan(276)
      expect(dec).toBeGreaterThan(-43)
      expect(dec).toBeLessThan(-42)
    }
  })

  it('turns round at the start of April (Earth\'s parallax), 2° of retrograde to August, while it moves 0.5° on its orbit', () => {
    const ras = horizons.observer.map((o) => o.raDeg)
    const turn = ras.indexOf(Math.max(...ras))
    expect(horizons.observer[turn].jd).toBe(2461130.5) // 2026-03-31
    expect(ras[0] - ras[ras.length - 1]).toBeGreaterThan(1.8)
    expect(ras[0] - ras[ras.length - 1]).toBeLessThan(2.2)
    const first = horizons.heliocentric.find((h) => h.date.startsWith('2026'))
    const sunward = heliocentricKm(first.jd).angleTo(heliocentricKm(first.jd + 153)) * toDeg
    expect(sunward).toBeGreaterThan(0.4)
    expect(sunward).toBeLessThan(0.6)
  })
})
