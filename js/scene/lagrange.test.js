import {describe, expect, it} from 'bun:test'
import {Vector3} from 'three'
import fixture from './lagrange.horizons.json'
import {
  G, collinearDistances, hillRadius, lagrangePoints, massKg, placePoints, synchronousOrbit,
} from './lagrange.js'
import deimos from '../../public/data/mars/moons/deimos/index.json'
import dione from '../../public/data/saturn/moons/dione/index.json'
import earth from '../../public/data/earth/index.json'
import io from '../../public/data/jupiter/moons/io/index.json'
import jupiter from '../../public/data/jupiter/index.json'
import mars from '../../public/data/mars/index.json'
import mercury from '../../public/data/mercury/index.json'
import moon from '../../public/data/earth/moons/moon/index.json'
import phobos from '../../public/data/mars/moons/phobos/index.json'
import saturn from '../../public/data/saturn/index.json'
import sun from '../../public/data/sun/index.json'
import tethys from '../../public/data/saturn/moons/tethys/index.json'
import venus from '../../public/data/venus/index.json'


const EARTH_MOON_MU = 0.012150585
const DEG = 180 / Math.PI


/**
 * The force on a test particle at rest in the rotating frame, barycentric,
 * in units where G(M + m) = 1, the separation 1 and the frame turns at 1.
 *
 * @param {number} mu
 * @param {number} x barycentric, the primary at -mu
 * @param {number} y
 * @returns {Array<number>}
 */
function force(mu, x, y) {
  const r1 = Math.hypot(x + mu, y)
  const r2 = Math.hypot(x - 1 + mu, y)
  return [
    x - ((1 - mu) * (x + mu) / (r1 ** 3)) - (mu * (x - 1 + mu) / (r2 ** 3)),
    y - ((1 - mu) * y / (r1 ** 3)) - (mu * y / (r2 ** 3)),
  ]
}


/**
 * @param {object} body a descriptor
 * @returns {number} its GM, m³/s²
 */
function gm(body) {
  return G * massKg(body.mass)
}


/**
 * @param {string|number} v a descriptor's length ("6.37101e6 m") or metres
 * @returns {number}
 */
function metres(v) {
  return typeof v === 'string' ? Number(v.split(' ')[0]) : Number(v)
}


/**
 * @param {object} body
 * @param {object} primary
 * @param {number} [extra] mass added to the body's, kg
 * @returns {number} m / (M + m)
 */
function ratio(body, primary, extra = 0) {
  const m = massKg(body.mass) + extra
  return m / (m + massKg(primary.mass))
}


describe('lagrange', () => {
  it('finds the collinear points of the Earth-Moon pair as published', () => {
    // Szebehely's Earth-Moon values, μ = 0.01215: L1 0.836915, L2 1.155682,
    // L3 -1.005063 from the barycentre.
    const {l1, l2, l3} = collinearDistances(EARTH_MOON_MU)
    expect(1 - EARTH_MOON_MU - l1).toBeCloseTo(0.836915, 6)
    expect(1 - EARTH_MOON_MU + l2).toBeCloseTo(1.155682, 6)
    expect(-EARTH_MOON_MU - l3).toBeCloseTo(-1.005063, 6)
  })

  it('puts all five where the forces balance, for tiny moons to equal masses', () => {
    for (const mu of [1e-12, 3.0404e-6, 9.5388e-4, EARTH_MOON_MU, 0.1, 0.5]) {
      for (const p of lagrangePoints(mu)) {
        // To barycentric: the primary at -mu.
        const [fx, fy] = force(mu, p.x - mu, p.y)
        // The force near the secondary is ~mu / γ²: compare with that.
        const scale = Math.max(1, mu / ((1 - p.x) ** 2))
        expect(Math.hypot(fx, fy) / scale).toBeLessThan(1e-9)
      }
    }
    // Equal masses: L1 midway, L2 and L3 mirror images.
    const {l1, l2, l3} = collinearDistances(0.5)
    expect(l1).toBeCloseTo(0.5, 12)
    expect(l2).toBeCloseTo(l3, 12)
  })

  it('places the points on the pair as it is: along it, scaled, L4 ahead', () => {
    const points = lagrangePoints(EARTH_MOON_MU)
    // The secondary 2 out along +X, moving toward -Z (the scene's prograde):
    // the pole is r × v = +Y.
    const r = new Vector3(2, 0, 0)
    const pole = new Vector3().crossVectors(r, new Vector3(0, 0, -1))
    const [L1, L2, L3, L4, L5] = placePoints(points, r, pole)
    expect(L1.x).toBeCloseTo(2 * points[0].x, 12)
    expect(L2.x).toBeGreaterThan(2)
    expect(L3.x).toBeLessThan(-1.9)
    expect(L4.z).toBeCloseTo(-Math.sqrt(3), 12)
    expect(L5.z).toBeCloseTo(Math.sqrt(3), 12)
    expect(L4.distanceTo(r)).toBeCloseTo(2, 12)
  })

  it('finds the real co-orbitals at the points (JPL Horizons)', () => {
    // Each body's longitude from its point in the pair's orbit plane, at
    // four dates 1950-2050, within its known libration.  Telesto and
    // Calypso barely move; Helene and Polydeuces, and Jupiter's Trojans,
    // swing tens of degrees about theirs.
    const mus = {
      tethys: ratio(tethys, saturn),
      dione: ratio(dione, saturn),
      jupiter: ratio(jupiter, sun),
    }
    const limits = {telesto: 5, calypso: 5, helene: 20, polydeuces: 35, achilles: 25, hektor: 25,
      patroclus: 25, aeneas: 25}
    const worst = {}
    for (const [pair, {states, bodies}] of Object.entries(fixture.pairs)) {
      if (!mus[pair]) {
        continue
      }
      const points = lagrangePoints(mus[pair])
      states.forEach((s, k) => {
        const r = new Vector3(...s.r)
        const pole = new Vector3().crossVectors(r, new Vector3(...s.v)).normalize()
        const placed = placePoints(points, r, pole)
        for (const [name, {point, states: at}] of Object.entries(bodies)) {
          const p = placed[point === 'L4' ? 3 : 4]
          const b = new Vector3(...at[k].r)
          const off = Math.atan2(pole.dot(new Vector3().crossVectors(p, b)), p.clone().cross(pole).cross(pole)
              .negate().dot(b)) * DEG
          worst[name] = Math.max(worst[name] ?? 0, Math.abs(off))
        }
      })
    }
    for (const [name, limit] of Object.entries(limits)) {
      expect(worst[name]).toBeLessThan(limit)
    }
  })

  it('finds Earth\'s trojan ahead of the Earth-Moon barycentre, on the L4 side', () => {
    // 2010 TK7's tadpole is wide (from near Earth to past L3), so only the
    // side is checked.
    const {states, bodies} = fixture.pairs.earth
    states.forEach((s, k) => {
      const r = new Vector3(...s.r)
      const pole = new Vector3().crossVectors(r, new Vector3(...s.v))
      const b = new Vector3(...bodies['2010 TK7'].states[k].r)
      const lead = Math.atan2(pole.normalize().dot(new Vector3().crossVectors(r, b)), r.dot(b)) * DEG
      expect(lead).toBeGreaterThan(0)
    })
  })

  it('gives the Hill radii', () => {
    const mu = ratio(earth, sun, massKg(moon.mass))
    // Earth's, at perihelion: ~1.47 million km.
    expect(hillRadius(1.496e11, 0.0167, mu) / 1e9).toBeCloseTo(1.47, 1)
    // The Moon's: ~58,000 km at perigee.
    expect(hillRadius(3.844e8, 0.0549, ratio(moon, earth)) / 1e6).toBeCloseTo(58.0, 0)
  })

  it('gives the synchronous orbits, and says which bodies can\'t hold one', () => {
    const sync = (body, primary, a, e) => synchronousOrbit({
      gm: gm(body), rotationSecs: body.siderealRotationPeriod, radius: metres(body.radius),
      hill: hillRadius(a, e, ratio(body, primary)),
    })
    // Geostationary: 42,164 km from the centre, 35,786 km up.  The
    // altitude here is over the mean radius, 7 km under the equator's.
    const geo = sync(earth, sun, 1.496e11, 0.0167)
    expect(geo.radius / 1e3).toBeCloseTo(42164, -1)
    expect(geo.altitude / 1e3).toBeCloseTo(35786, -2)
    expect(geo.why).toBeNull()
    // Areostationary, ~20,400 km: Phobos inside it, Deimos outside.
    const areo = sync(mars, sun, 2.279e11, 0.0934)
    expect(areo.radius / 1e3).toBeCloseTo(20428, -2)
    expect(metres(phobos.orbit.semiMajorAxis)).toBeLessThan(areo.radius)
    expect(metres(deimos.orbit.semiMajorAxis)).toBeGreaterThan(areo.radius)
    // Slow rotators and locked moons: past the Hill sphere.
    expect(sync(mercury, sun, 5.791e10, 0.2056).why).toBe('beyondHill')
    expect(sync(venus, sun, 1.082e11, 0.0068).why).toBe('beyondHill')
    const seleno = sync(moon, earth, 3.844e8, 0.0549)
    expect(seleno.why).toBe('beyondHill')
    expect(seleno.radius / 1e6).toBeCloseTo(88.4, 0)
    expect(sync(io, jupiter, 4.218e8, 0.004).why).toBe('beyondHill')
    // And one inside the body: a fast spinner.
    expect(synchronousOrbit({gm: 1e13, rotationSecs: 100, radius: 1e6}).why).toBe('inside')
    expect(synchronousOrbit({gm: 1e13, rotationSecs: 0, radius: 1e6})).toBeNull()
  })

  it('reads masses in any form', () => {
    expect(massKg('5.97219e27 g')).toBeCloseTo(5.97219e24, -20)
    expect(massKg({scalar: 5.97219e27})).toBeCloseTo(5.97219e24, -20)
    expect(massKg(7)).toBe(7)
    expect(massKg(undefined)).toBeNaN()
  })
})
