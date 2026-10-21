import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {J2000_JD} from './celestialFrame.js'
import {moonArguments} from './lunarTheory.js'
import OrbitDiagram, {partState} from './orbitDiagram.js'
import {ORBIT_ELEMENTS, elementRows, elementsFromState, elementsOfDate, formatDistance, norm360} from
  './orbitElements.js'


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


describe('elementsFromState', () => {
  /**
   * A place and velocity on a Kepler orbit, laid as meanElements.orbitAt
   * lays it: Ry(Ω) Rx(i) Ry(ω), pericentre +X, prograde toward -Z.
   *
   * @param {object} el {a, e, i, node, w, E}: metres, degrees, E radians
   * @param {number} mu
   * @returns {{r: Vector3, v: Vector3}}
   */
  function state(el, mu) {
    const q = new Quaternion
    const t = new Quaternion
    const Y = new Vector3(0, 1, 0)
    const X = new Vector3(1, 0, 0)
    q.multiply(t.setFromAxisAngle(Y, el.node * Math.PI / 180))
    q.multiply(t.setFromAxisAngle(X, el.i * Math.PI / 180))
    q.multiply(t.setFromAxisAngle(Y, el.w * Math.PI / 180))
    const b = el.a * Math.sqrt(1 - (el.e * el.e))
    const n = Math.sqrt(mu / (el.a ** 3))
    const Edot = n / (1 - (el.e * Math.cos(el.E)))
    const r = new Vector3(el.a * (Math.cos(el.E) - el.e), 0, -b * Math.sin(el.E)).applyQuaternion(q)
    const v = new Vector3(-el.a * Math.sin(el.E) * Edot, 0, -b * Math.cos(el.E) * Edot).applyQuaternion(q)
    return {r, v}
  }

  it('gives back the elements a place and velocity were made from', () => {
    const mu = 2.9591220828559e-4 * (ASTRO_UNIT_METER ** 3)
    const el = {a: 1.5 * ASTRO_UNIT_METER, e: 0.2, i: 12, node: 80, w: 250, E: 1.1}
    const {r, v} = state(el, mu)
    const got = elementsFromState('mars', {}, r, v, mu)
    expect(got.a / el.a).toBeCloseTo(1, 9)
    expect(got.e).toBeCloseTo(0.2, 9)
    expect(got.i).toBeCloseTo(12, 6)
    expect(got.node).toBeCloseTo(80, 6)
    expect(got.w).toBeCloseTo(250, 6)
    expect(got.m).toBeCloseTo(norm360((el.E - (0.2 * Math.sin(el.E))) * 180 / Math.PI), 6)
    expect(got.kind).toBe('osculating')
    expect(got.ofDate).toBe(true)
  })

  it('takes the node as the reference direction in the reference plane', () => {
    const mu = 4.0350323e14 * (86400 ** 2)
    const {r, v} = state({a: 384400e3, e: 0.05, i: 0, node: 0, w: 30, E: 0.4}, mu)
    const got = elementsFromState('moon', {}, r, v, mu)
    // acos near 1 holds a degree to ~1e-6.
    expect(got.i).toBeLessThan(1e-5)
    expect(got.peri).toBeCloseTo(30, 6)
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

  /**
   * @param {object} diagram
   * @param {string} part
   * @param {Vector3} p
   * @returns {number} p's distance to the part's polyline
   */
  function distanceToPolyline(diagram, part, p) {
    const a = diagram.parts[part].geometry.attributes.position.array
    let best = Infinity
    const s0 = new Vector3
    const s1 = new Vector3
    const ab = new Vector3
    for (let j = 0; j + 5 < a.length; j += 3) {
      s0.set(a[j], a[j + 1], a[j + 2])
      s1.set(a[j + 3], a[j + 4], a[j + 5])
      ab.subVectors(s1, s0)
      const t = Math.max(0, Math.min(1, p.clone().sub(s0).dot(ab) / Math.max(ab.lengthSq(), 1e-30)))
      best = Math.min(best, s0.clone().addScaledVector(ab, t).distanceTo(p))
    }
    return best
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

  it('puts pericentre a(1 - e) from the focus, on the orbit', () => {
    const peri = point(d, 'periLine', -1)
    expect(peri.length()).toBeCloseTo(0.7, 5)
    expect(point(d, 'majorAxis', 0).length()).toBeCloseTo(1.3, 5)
    // On the polyline, to its spacing there (opposite the body: coarse).
    expect(distanceToPolyline(d, 'orbit', peri)).toBeLessThan(2e-3)
  })

  it('draws the orbit through the body, to a hair, however close the view', () => {
    // A 193-vertex ellipse missed it by up to a(1 - cos(π/192)), 1.3e-4 a:
    // 20,000 km of Earth's.
    const body = point(d, 'radius', -1)
    expect(distanceToPolyline(d, 'orbit', body)).toBeLessThan(1e-9)
    // And near it: a point 1° of eccentric anomaly on is within 1e-8 a.
    const e = 0.3
    const b = Math.sqrt(1 - (e * e))
    const eBody = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(el.nu * Math.PI / 360),
        Math.sqrt(1 + e) * Math.cos(el.nu * Math.PI / 360))
    const near = new Vector3(Math.cos(eBody + 0.0175) - e, 0, -b * Math.sin(eBody + 0.0175))
        .applyQuaternion(d._q.peri)
    expect(distanceToPolyline(d, 'orbit', near)).toBeLessThan(1e-7)
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

  it('meets the orbit with the mean anomaly\'s line, and arcs from it to the true place', () => {
    const p = 1 - (0.3 * 0.3)
    const m = 40 * Math.PI / 180
    // The orbit at angle M from pericentre, from the focus.
    expect(point(d, 'meanLine', -1).length()).toBeCloseTo(p / (1 + (0.3 * Math.cos(m))), 6)
    // The equation of centre: from the mean direction toward the body's.
    const n = d.parts.centreArc.geometry.attributes.position.count
    const start = point(d, 'centreArc', 0).normalize()
    const end = point(d, 'centreArc', n - 4).normalize()
    expect(start.dot(point(d, 'meanLine', -1).normalize())).toBeCloseTo(1, 6)
    expect(end.dot(point(d, 'radius', -1).normalize())).toBeCloseTo(1, 6)
  })

  it('marks the body away from its elements\' place only when told', () => {
    d.highlight('meanLongitude')
    expect(d.parts.bodyOffset.visible).toBe(false)
    const body = d.anchors.body.clone().add(new Vector3(0.01, 0, 0))
    d.setBodyOffset(body)
    expect(d.parts.bodyOffset.visible).toBe(true)
    expect(point(d, 'bodyOffset', -1).distanceTo(body)).toBeLessThan(1e-6)
    d.setBodyOffset(null)
    expect(d.parts.bodyOffset.visible).toBe(false)
  })

  it('puts the barycentre on the line to the body, and the primary\'s orbit about it through its centre', () => {
    const k = 1 / 82.3
    d.setMassRatio(k)
    d.setElements(el)
    d.highlight('meanLongitude')
    expect(d.parts.barycentre.visible && d.parts.primaryOrbit.visible).toBe(true)
    expect(d.anchors.barycentre.distanceTo(d.anchors.body.clone().multiplyScalar(k))).toBeLessThan(1e-9)
    const orbit = d.parts.primaryOrbit.geometry.attributes.position.array
    let nearest = Infinity
    for (let j = 0; j < orbit.length; j += 3) {
      nearest = Math.min(nearest, Math.hypot(orbit[j], orbit[j + 1], orbit[j + 2]))
    }
    // Through the primary's centre, the focus, to the sampling's step.
    expect(nearest).toBeLessThan(k * 2 * Math.PI / 192)
    // Not drawn for a pair whose barycentre is in the noise (the Sun and Earth).
    d.setMassRatio(3e-6)
    d.highlight('meanLongitude')
    expect(d.parts.barycentre.visible).toBe(false)
    d.setMassRatio(0)
    d.setElements(el)
  })

  it('ends each arc in an arrowhead pointing the way its angle runs', () => {
    for (const arc of ['nodeArc', 'periArc', 'anomalyArc', 'inclinationArc', 'centreArc']) {
      const n = d.parts[arc].geometry.attributes.position.count
      // The arc's last point, then one wing, the tip, the other wing.
      const end = point(d, arc, n - 4)
      const before = point(d, arc, n - 5)
      const tip = point(d, arc, n - 2)
      const wings = [point(d, arc, n - 3), point(d, arc, n - 1)]
      expect(tip.distanceTo(end)).toBeLessThan(1e-6)
      const tangent = end.clone().sub(before).normalize()
      for (const w of wings) {
        // Behind the tip, along the arc, and to either side of it.
        expect(w.clone().sub(tip).dot(tangent)).toBeLessThan(0)
      }
      expect(wings[0].distanceTo(wings[1])).toBeGreaterThan(0)
    }
  })

  it('lights an element\'s parts, keeps the base as context and hides the rest', () => {
    const lit = new Set(['inclination'])
    expect(partState('inclinationArc', lit)).toBe('lit')
    expect(partState('orbit', lit)).toBe('context')
    expect(partState('anomalyArc', lit)).toBe('hidden')
    expect(partState('anomalyArc', null)).toBe('all')
    expect(partState('anomalyArc', new Set(['inclination', 'meanAnomaly']))).toBe('lit')
    // Every element lights something.
    for (const key of Object.keys(ORBIT_ELEMENTS)) {
      d.highlight(key)
      expect(Object.values(d.parts).some((s) => s.visible && s.material.uniforms.uOpacity.value === 1)).toBe(true)
    }
    d.highlight('meanLongitude')
    expect(d.parts.nodeArc.visible && d.parts.periArc.visible && d.parts.anomalyArc.visible).toBe(true)
    expect(d.parts.inclinationArc.visible).toBe(false)
    // Several at once.
    d.highlight(['inclination', 'meanLongitude'])
    expect(d.parts.inclinationArc.visible && d.parts.anomalyArc.visible).toBe(true)
    expect(d.parts.focalLine.visible).toBe(false)
  })
})
