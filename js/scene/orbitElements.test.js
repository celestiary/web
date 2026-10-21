import {describe, expect, it} from 'bun:test'
import {Vector3} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {J2000_JD} from './celestialFrame.js'
import {moonArguments} from './lunarTheory.js'
import OrbitDiagram, {partState} from './orbitDiagram.js'
import {ORBIT_ELEMENTS, elementRows, elementsOfDate, formatDistance, norm360} from './orbitElements.js'


const EARTH_ORBIT = {
  eccentricity: 0.01671022, inclination: 5e-05, longitudeOfAscendingNode: -11.26064,
  longitudeOfPericenter: 102.94719, meanLongitude: 100.46435, semiMajorAxis: 149597900000.0,
  siderealOrbitPeriod: 31558150.1,
}
const IO_ORBIT = {
  referencePlane: 'Laplace', referencePole: {ra: 268.1, dec: 64.5}, epoch: 2451545.0,
  semiMajorAxis: 421800000.0, eccentricity: 0.004, inclination: 0.0, longitudeOfAscendingNode: 0.0,
  argumentOfPericenter: 49.1, meanAnomaly: 330.9, period: 1.762732, periodOf: 'meanAnomaly',
  apsidalPeriod: -1.333, nodalPeriod: 0, siderealOrbitPeriod: 152853.509808,
}


describe('elementsOfDate', () => {
  it('gives a planet Standish\'s elements, run on from J2000', () => {
    const el = elementsOfDate('earth', EARTH_ORBIT, J2000_JD)
    expect(el.a / ASTRO_UNIT_METER).toBeCloseTo(1.0, 4)
    expect(el.e).toBeCloseTo(0.0167, 3)
    expect(el.peri).toBeCloseTo(102.94, 1)
    expect(el.meanLongitude).toBeCloseTo(100.46, 1)
    expect(el.pericentreKey).toBe('longitudeOfPericenter')
    expect(el.placeKey).toBe('meanLongitude')
    // A year on, the mean longitude is back within a degree.
    const later = elementsOfDate('earth', EARTH_ORBIT, J2000_JD + 365.25)
    expect(Math.abs(later.meanLongitude - el.meanLongitude)).toBeLessThan(1)
  })

  it('keeps ϖ = Ω + ω and L = ϖ + M, and ν by the equation of centre', () => {
    const el = elementsOfDate('mars', {eccentricity: 0.0934}, J2000_JD + 1234)
    expect(norm360(el.node + el.w)).toBeCloseTo(el.peri, 9)
    expect(norm360(el.peri + el.m)).toBeCloseTo(el.meanLongitude, 9)
    // The equation of centre to second order: ν - M = 2e sin M + 5/4 e² sin 2M.
    const dnu = ((el.nu - el.m + 540) % 360) - 180
    const m = el.m * Math.PI / 180
    const centre = ((2 * el.e * Math.sin(m)) + (1.25 * el.e * el.e * Math.sin(2 * m))) * 180 / Math.PI
    expect(Math.abs(dnu - centre)).toBeLessThan(0.05)
  })

  it('gives the Moon its mean node and perigee of date', () => {
    const jde = J2000_JD + 9000
    const el = elementsOfDate('moon', {eccentricity: 0.0554, semiMajorAxis: 384467000}, jde)
    const args = moonArguments(jde)
    expect(el.node).toBeCloseTo(args.node, 9)
    expect(el.peri).toBeCloseTo(norm360(args.perigee), 9)
    expect(el.meanLongitude).toBeCloseTo(norm360(args.lp), 9)
    expect(el.i).toBeCloseTo(5.145, 3)
    expect(el.ofDate).toBe(true)
    expect(el.plane).toBe('eclipticOfDate')
  })

  it('gives a moon its mean elements in its Laplace plane, with ω and M', () => {
    const el = elementsOfDate('io', IO_ORBIT, J2000_JD)
    expect(el.plane).toBe('Laplace')
    expect(el.w).toBeCloseTo(49.1, 9)
    expect(el.m).toBeCloseTo(330.9, 9)
    expect(el.pericentreKey).toBe('argumentOfPericenter')
    expect(el.placeKey).toBe('meanAnomaly')
    expect(el.frame.equals(new (el.frame.constructor)())).toBe(false)
  })

  it('turns a negative inclination round, keeping ϖ', () => {
    // Standish's Earth: I = -0.00001531° at J2000, falling.
    const el = elementsOfDate('earth', EARTH_ORBIT, J2000_JD + 3650)
    expect(el.i).toBeGreaterThan(0)
    expect(el.node).toBeCloseTo(180, 6)
    expect(el.peri).toBeCloseTo(102.97, 1)
  })

  it('is null without an orbit', () => {
    expect(elementsOfDate('sun', undefined, J2000_JD)).toBeNull()
  })
})


describe('elementRows', () => {
  it('lists the six, in order, with units', () => {
    const rows = elementRows(elementsOfDate('earth', EARTH_ORBIT, J2000_JD))
    expect(rows.map((r) => r.symbol)).toEqual(['a', 'e', 'i', 'Ω', 'ϖ', 'L'])
    expect(rows[0].value).toMatch(/AU$/)
    expect(rows[2].value).toMatch(/°$/)
    const io = elementRows(elementsOfDate('io', IO_ORBIT, J2000_JD))
    expect(io.map((r) => r.symbol)).toEqual(['a', 'e', 'i', 'Ω', 'ω', 'M'])
    expect(io[0].value).toBe('421,800 km')
  })

  it('formats distances in AU from a tenth of one', () => {
    expect(formatDistance(ASTRO_UNIT_METER)).toBe('1.0000 AU')
    expect(formatDistance(384400e3)).toBe('384,400 km')
  })
})


describe('OrbitDiagram', () => {
  /**
   * @param {object} d
   * @param {string} part
   * @param {number} k point index
   * @returns {Vector3}
   */
  function point(d, part, k) {
    const a = d.parts[part].geometry.attributes.position.array
    const n = a.length / 3
    const j = k < 0 ? n + k : k
    return new Vector3(a[3 * j], a[(3 * j) + 1], a[(3 * j) + 2])
  }

  const el = {e: 0.3, i: 30, node: 300, w: 110, m: 40, nu: 0}
  // ν for M = 40°, e = 0.3, by Kepler's equation.
  let E = el.m * Math.PI / 180
  for (let k = 0; k < 30; k++) {
    E = (el.m * Math.PI / 180) + (el.e * Math.sin(E))
  }
  el.nu = 2 * Math.atan2(Math.sqrt(1.3) * Math.sin(E / 2), Math.sqrt(0.7) * Math.cos(E / 2)) * 180 / Math.PI
  const d = new OrbitDiagram({body: true})
  d.setElements(el)

  it('puts pericentre at the orbit\'s start, a(1 - e) from the focus', () => {
    const peri = point(d, 'orbit', 0)
    expect(peri.length()).toBeCloseTo(0.7, 5)
    expect(point(d, 'periLine', -1).distanceTo(peri)).toBeLessThan(1e-6)
    expect(point(d, 'majorAxis', 0).length()).toBeCloseTo(1.3, 5)
  })

  it('puts the ascending node on the orbit and in the reference plane, rising', () => {
    const node = point(d, 'nodeLine', -1).normalize()
    // Along Ω in the reference plane (prograde: +X toward -Z).
    expect(node.x).toBeCloseTo(Math.cos(300 * Math.PI / 180), 5)
    expect(node.z).toBeCloseTo(-Math.sin(300 * Math.PI / 180), 5)
    // The orbit crosses y = 0 going north there: the point after it is above.
    const orbit = d.parts.orbit.geometry.attributes.position.array
    let crossings = 0
    for (let k = 0; k + 1 < orbit.length / 3; k++) {
      const y0 = orbit[(3 * k) + 1]
      const y1 = orbit[(3 * (k + 1)) + 1]
      if (y0 < 0 && y1 >= 0) {
        crossings++
        const p = new Vector3(orbit[3 * k], 0, orbit[(3 * k) + 2]).normalize()
        expect(p.dot(node)).toBeGreaterThan(0.999)
      }
    }
    expect(crossings).toBe(1)
  })

  it('tilts the orbit\'s plane by i, and puts the body on the orbit', () => {
    const pole = new Vector3(0, 1, 0).applyQuaternion(d.orbitFrame.quaternion)
    expect(Math.acos(pole.y) * 180 / Math.PI).toBeCloseTo(30, 5)
    const body = point(d, 'radius', -1)
    const r = 0.91 / (1 + (0.3 * Math.cos(el.nu * Math.PI / 180)))
    expect(body.length()).toBeCloseTo(r, 5)
    expect(Math.abs(body.dot(pole))).toBeLessThan(1e-6)
  })

  it('lights an element\'s parts, keeps the base as context and hides the rest', () => {
    expect(partState('inclinationArc', 'inclination')).toBe('lit')
    expect(partState('orbit', 'inclination')).toBe('context')
    expect(partState('anomalyArc', 'inclination')).toBe('hidden')
    expect(partState('anomalyArc', null)).toBe('all')
    // Every element lights something.
    for (const key of Object.keys(ORBIT_ELEMENTS)) {
      d.highlight(key)
      expect(Object.values(d.parts).some((s) => s.visible && s.material.uniforms.uOpacity.value === 1)).toBe(true)
    }
    d.highlight('meanLongitude')
    expect(d.parts.nodeArc.visible && d.parts.periArc.visible && d.parts.anomalyArc.visible).toBe(true)
    expect(d.parts.inclinationArc.visible).toBe(false)
  })
})
