import {describe, expect, it} from 'bun:test'
import {Quaternion, Vector3} from 'three'
import vsop87a from 'vsop87/dist/vsop87a'
import vsop87c from 'vsop87/dist/vsop87c'
import {toJulianDay} from '../Time.js'
import {precessEcliptic, utcToTtJulianDay} from './celestialFrame.js'
import {
  LUNAR_EQUATOR_INCLINATION_DEG,
  eclipticToScene,
  moonArguments,
  moonEcliptic,
  moonOrbitOrientation,
  moonOrientation,
  moonScenePosition,
} from './lunarTheory.js'
import horizons from './lunarTheory.horizons.json'


const toDeg = 180 / Math.PI
const toRad = Math.PI / 180
const AU_METER = 149597870700


/**
 * Julian Day (UTC) of a UTC calendar date, via Date.UTC.
 *
 * @param {string} iso e.g. '2026-09-29T14:25:00Z'
 * @returns {number}
 */
function jdUtcOf(iso) {
  const UNIX_EPOCH_JD = 2440587.5
  return (Date.parse(iso) / 86400000) + UNIX_EPOCH_JD
}


/**
 * Moon–Sun elongation as seen from Earth's centre, in degrees, computed
 * the way the scene is built: Earth from VSOP87C at the (UTC) simulation
 * Julian Day, remapped into the scene frame; the Moon from lunarTheory at
 * TT, added to Earth's position; the Sun at the origin.
 *
 * @param {number} jdUtc
 * @returns {number}
 */
function sceneElongationDeg(jdUtc) {
  const e = vsop87c(jdUtc).earth
  const earth = new Vector3(e.x, e.z, -e.y).multiplyScalar(AU_METER)
  const moonOffset = moonScenePosition(utcToTtJulianDay(jdUtc))
  const toSun = earth.clone().negate()
  return toSun.angleTo(moonOffset) * toDeg
}


describe('moonArguments', () => {
  it('matches Meeus example 47.a (1992 April 12, 0h TD)', () => {
    const a = moonArguments(2448724.5)
    expect(a.t).toBeCloseTo(-0.077221081451, 11)
    expect(a.lp).toBeCloseTo(134.290182, 5)
    expect(a.d).toBeCloseTo(113.842304, 5)
    expect(a.m).toBeCloseTo(97.643514, 5)
    expect(a.mp).toBeCloseTo(5.150833, 5)
    expect(a.f).toBeCloseTo(219.889721, 5)
  })


  it('mean node regresses once in 18.6 years', () => {
    const a = moonArguments(2451545.0)
    const b = moonArguments(2451545.0 + (18.6 * 365.25))
    const moved = ((((b.node - a.node) + 540) % 360) - 180)
    expect(Math.abs(moved)).toBeLessThan(1)
  })
})


describe('moonEcliptic', () => {
  // Meeus, Astronomical Algorithms, example 47.a.
  const ex = moonEcliptic(2448724.5)


  it('reproduces the example\'s sums of periodic terms to the unit', () => {
    // Σl, Σb in 1e-6°, Σr in 1e-3 km: an exact check of both tables and
    // the additive terms at this date.
    expect(Math.abs(ex.sumL - -1127527)).toBeLessThan(1.5)
    expect(Math.abs(ex.sumB - -3229126)).toBeLessThan(1.5)
    expect(Math.abs(ex.sumR - -16590875)).toBeLessThan(1.5)
  })


  it('gives λ = 133.162655°, β = −3.229126°, Δ = 368409.7 km', () => {
    expect(ex.lambda).toBeCloseTo(133.162655, 6)
    expect(ex.beta).toBeCloseTo(-3.229126, 6)
    expect(ex.distanceKm).toBeCloseTo(368409.7, 1)
  })


  it('stays within the Moon\'s range of distance and latitude', () => {
    for (let jd = 2451545; jd < 2451545 + 3653; jd += 7.3) {
      const {beta, distanceKm} = moonEcliptic(jd)
      expect(Math.abs(beta)).toBeLessThan(5.35)
      expect(distanceKm).toBeGreaterThan(356000)
      expect(distanceKm).toBeLessThan(407000)
    }
  })
})


describe('moonEcliptic against JPL Horizons', () => {
  // Geocentric geometric Moon vectors, ecliptic J2000, from
  // lunarTheory.horizons.json (the query is recorded there; offline).  Meeus
  // 47 is of date, so precess to J2000 first: without that, 2026 is ~1350″
  // off.  Measured 2026-09-30: separation 0.3-4.3″ (longitude ≤ 3.9″,
  // latitude ≤ 1.8″), distance ≤ 4.2 km, 1950 to 2050.  Tolerances are
  // Meeus's stated accuracy (~10″ longitude, ~4″ latitude), which 1950 and
  // 2050 also meet here, though the truncated series degrades away from
  // J2000.
  const J2000 = 2451545.0
  for (const [jde, date, x, y, z] of horizons.rows) {
    it(`agrees at ${date}`, () => {
      const m = moonEcliptic(jde)
      const p = precessEcliptic(m.lambda, m.beta, jde, J2000)
      const r = Math.hypot(x, y, z)
      const lonH = ((Math.atan2(y, x) * toDeg) + 360) % 360
      const latH = Math.asin(z / r) * toDeg
      const dLonArcsec = ((((p.lambda - lonH) + 540) % 360) - 180) * 3600
      const dLatArcsec = (p.beta - latH) * 3600
      expect(Math.abs(dLonArcsec)).toBeLessThan(10)
      expect(Math.abs(dLatArcsec)).toBeLessThan(4)
      expect(Math.abs(m.distanceKm - r)).toBeLessThan(10)
    })
  }
})


describe('the simulation clock against the Horizons epochs', () => {
  // The same instants as UTC wall-clock times (TT − UTC from the leap
  // seconds then), through Time.toJulianDay and utcToTtJulianDay as
  // Animation does.  Time.toJulianDay used to run 14.6 s ahead, ~8″ of
  // lunar motion.
  const cases = [
    [Date.UTC(1992, 3, 11, 23, 59, 1, 816), 2448724.5], // TT − UTC 58.184 s
    [Date.UTC(2000, 0, 1, 11, 58, 55, 816), 2451545.0], // 64.184 s
    [Date.UTC(2026, 8, 26, 16, 48, 38, 816), 2461310.20125], // 69.184 s
    [Date.UTC(2026, 8, 29, 14, 23, 50, 432), 2461313.10069],
    [Date.UTC(2049, 11, 31, 23, 58, 50, 816), 2469807.5],
  ]
  for (const [ms, jdTT] of cases) {
    it(`maps ${new Date(ms).toISOString()} UTC to JDE ${jdTT}`, () => {
      const jde = utcToTtJulianDay(toJulianDay(ms))
      // Float64 JDs resolve ~40 µs.
      expect(Math.abs(jde - jdTT) * 86400).toBeLessThan(0.01)
      const row = horizons.rows.find((r) => r[0] === jdTT)
      const [, , x, y] = row
      const m = moonEcliptic(jde)
      const p = precessEcliptic(m.lambda, m.beta, jde, 2451545.0)
      const lonH = ((Math.atan2(y, x) * toDeg) + 360) % 360
      const dLonArcsec = ((((p.lambda - lonH) + 540) % 360) - 180) * 3600
      expect(Math.abs(dLonArcsec)).toBeLessThan(10)
    })
  }
})


describe('moonScenePosition', () => {
  it('uses the same axis remap as the planets: (x, z, -y)', () => {
    const jde = 2448724.5
    const {lambda, beta, distanceKm} = moonEcliptic(jde)
    const p = moonScenePosition(jde)
    const l = lambda * toRad
    const b = beta * toRad
    const r = distanceKm * 1000
    expect(p.x).toBeCloseTo(r * Math.cos(b) * Math.cos(l), 3)
    expect(p.y).toBeCloseTo(r * Math.sin(b), 3)
    expect(p.z).toBeCloseTo(-r * Math.cos(b) * Math.sin(l), 3)
  })
})


describe('scene frame', () => {
  it('VSOP87C is ecliptic of date, the frame of Meeus 47 (Meeus example 25.b)', () => {
    // The Sun's geometric longitude at 1992 Oct 13.0 TD from full VSOP87,
    // of date, is 199.907372° (before the FK5 correction).  VSOP87A
    // (J2000) would give ~200.008°: the 0.1° of precession since 2000.
    const e = vsop87c(2448908.5).earth
    const sunLon = ((Math.atan2(-e.y, -e.x) * toDeg) + 360) % 360
    expect(Math.abs(sunLon - 199.907372) * 3600).toBeLessThan(1)
  })
})


describe('Moon–Sun elongation from Earth\'s centre', () => {
  it('is ~144° at JD 2461313.14 (issue #87; was 85° on the old ellipse)', () => {
    // The issue's example: 2026-09-29 14:25 UTC, three days after the
    // full moon, waning gibbous.  (Its JD 2461313.14 is 15:21 UTC; the
    // elongation changes ~12° a day, so check both.)
    const atUtcTime = sceneElongationDeg(jdUtcOf('2026-09-29T14:25:00Z'))
    const atJd = sceneElongationDeg(2461313.14)
    expect(atUtcTime).toBeGreaterThan(141)
    expect(atUtcTime).toBeLessThan(147)
    expect(atJd).toBeGreaterThan(141)
    expect(atJd).toBeLessThan(147)
    expect(atJd).toBeLessThan(atUtcTime) // waning
  })


  it('peaks near 180° at the 2026-09-26 16:49 UTC full moon', () => {
    // Full moon (opposition in ecliptic longitude) 2026-09-26 16:49 UTC:
    // the published time, and JPL Horizons' geocentric Sun and Moon
    // vectors put it at 16:49.6.  Elongation stays short of 180° by the
    // Moon's ecliptic latitude.
    const jdFull = jdUtcOf('2026-09-26T16:49:36Z')
    const {lambda, beta} = moonEcliptic(utcToTtJulianDay(jdFull))
    const e = vsop87c(jdFull).earth
    const sunLon = ((Math.atan2(-e.y, -e.x) * toDeg) + 360) % 360
    const dLon = ((lambda - sunLon) + 360) % 360
    // Moon moves ~0.5°/h against the Sun; within 0.05° is within ~6 min.
    expect(Math.abs(dLon - 180)).toBeLessThan(0.05)
    const elong = sceneElongationDeg(jdFull)
    expect(elong).toBeCloseTo(180 - Math.abs(beta), 1)
    expect(elong).toBeGreaterThan(176.5)
    // A day either side, it's ~12° less.
    expect(sceneElongationDeg(jdFull - 1)).toBeLessThan(170)
    expect(sceneElongationDeg(jdFull + 1)).toBeLessThan(170)
  })


  it('is small at the 2026-09-11 03:27 UTC new moon', () => {
    const jdNew = jdUtcOf('2026-09-11T03:27:00Z')
    const {beta} = moonEcliptic(utcToTtJulianDay(jdNew))
    const elong = sceneElongationDeg(jdNew)
    expect(elong).toBeLessThan(Math.abs(beta) + 0.1)
    expect(elong).toBeLessThan(5.3)
  })


  it('is under a degree at the 2026-08-12 total solar eclipse (17:46 UTC)', () => {
    // Greatest eclipse 17:46 UTC, gamma 0.898: the geocentric centres are
    // ~0.9 × the Moon's horizontal parallax (0.95°) apart.
    expect(sceneElongationDeg(jdUtcOf('2026-08-12T17:46:00Z'))).toBeLessThan(1)
  })


  it('is within a degree of 180° at the 2026-08-28 partial lunar eclipse (04:13 UTC)', () => {
    expect(sceneElongationDeg(jdUtcOf('2026-08-28T04:13:00Z'))).toBeGreaterThan(179)
  })
})


describe('precessEcliptic', () => {
  it('takes VSOP87C (of date) onto VSOP87A (J2000) to under 0.1″', () => {
    // Two series of the same theory in the two frames: an independent check
    // of the precession, from 1900 to 2100.
    for (const jd of [2415020.5, 2448724.5, 2461313.1, 2469807.5, 2488070.5]) {
      const c = vsop87c(jd).earth
      const a = vsop87a(jd).earth
      const lonC = Math.atan2(c.y, c.x) * toDeg
      const latC = Math.atan2(c.z, Math.hypot(c.x, c.y)) * toDeg
      const p = precessEcliptic(lonC, latC, jd, 2451545.0)
      const lonA = ((Math.atan2(a.y, a.x) * toDeg) + 360) % 360
      const latA = Math.atan2(a.z, Math.hypot(a.x, a.y)) * toDeg
      expect(Math.abs((((p.lambda - lonA) + 540) % 360) - 180) * 3600).toBeLessThan(0.1)
      expect(Math.abs(p.beta - latA) * 3600).toBeLessThan(0.1)
    }
  })


  it('round-trips', () => {
    const a = precessEcliptic(200, 3, 2461313.1, 2451545.0)
    const b = precessEcliptic(a.lambda, a.beta, 2451545.0, 2461313.1)
    expect(b.lambda).toBeCloseTo(200, 8)
    expect(b.beta).toBeCloseTo(3, 8)
  })


  it('moves longitude by ~50.3″ a year near the ecliptic', () => {
    const p = precessEcliptic(0, 0, 2451545.0 + (26.75 * 365.25), 2451545.0)
    expect((p.lambda - 360) * 3600).toBeCloseTo(-26.75 * 50.29, -1)
  })
})


describe('moonOrientation', () => {
  /**
   * Earth's selenographic (longitude, latitude) under moonOrientation.
   *
   * @param {number} jde
   * @returns {{l: number, b: number}}
   */
  function subEarth(jde) {
    const q = moonOrientation(moonArguments(jde))
    const toEarth = moonScenePosition(jde).negate().normalize()
    const body = toEarth.applyQuaternion(q.clone().invert())
    // coords.js: lng = atan2(-z, x), lat = asin(y).
    return {l: Math.atan2(-body.z, body.x) * toDeg, b: Math.asin(body.y) * toDeg}
  }


  it('gives Meeus example 53.a\'s optical libration: l′ = −1.206°, b′ = +4.194°', () => {
    const {l, b} = subEarth(2448724.5)
    expect(l).toBeCloseTo(-1.206, 2)
    expect(b).toBeCloseTo(4.194, 2)
  })


  it('agrees with Meeus 53.1 at other dates', () => {
    const inc = LUNAR_EQUATOR_INCLINATION_DEG * toRad
    for (let jde = 2461000; jde < 2461400; jde += 17.3) {
      const {lambda, beta, args} = moonEcliptic(jde)
      const w = (lambda - args.node) * toRad
      const bt = beta * toRad
      const a = Math.atan2(
          (Math.sin(w) * Math.cos(bt) * Math.cos(inc)) - (Math.sin(bt) * Math.sin(inc)),
          Math.cos(w) * Math.cos(bt))
      const lMeeus = ((((((a * toDeg) - args.f) % 360) + 540) % 360) - 180)
      const bMeeus = Math.asin((-Math.sin(w) * Math.cos(bt) * Math.sin(inc)) -
        (Math.sin(bt) * Math.cos(inc))) * toDeg
      const {l, b} = subEarth(jde)
      expect(l).toBeCloseTo(lMeeus, 6)
      expect(b).toBeCloseTo(bMeeus, 6)
    }
  })


  it('keeps the near side toward Earth: librations stay within ±8° and ±7°', () => {
    for (let jde = 2461000; jde < 2461400; jde += 1.1) {
      const {l, b} = subEarth(jde)
      expect(Math.abs(l)).toBeLessThan(8.2)
      expect(Math.abs(b)).toBeLessThan(7)
    }
  })


  it('puts the pole 1.54° from the north ecliptic pole', () => {
    const q = moonOrientation(moonArguments(2461313.1))
    const pole = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(pole.angleTo(new Vector3(0, 1, 0)) * toDeg).toBeCloseTo(LUNAR_EQUATOR_INCLINATION_DEG, 6)
  })
})


describe('moonOrbitOrientation', () => {
  it('tilts the orbit 5.145° with its ascending node at Ω', () => {
    const args = moonArguments(2461313.1)
    const q = moonOrbitOrientation(args)
    const normal = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(normal.angleTo(new Vector3(0, 1, 0)) * toDeg).toBeCloseTo(5.145396, 5)
    // The ascending node, where the orbit crosses the ecliptic going
    // north, is along ecliptic longitude Ω: perpendicular to the normal,
    // and 90° behind the direction the normal leans toward.
    const node = eclipticToScene(args.node, 0, 1)
    expect(Math.abs(normal.dot(node))).toBeLessThan(1e-12)
    const ahead = eclipticToScene(args.node + 90, 0, 1)
    // A prograde orbit's normal leans away from the node + 90° direction,
    // which is the orbit's northernmost point.
    expect(normal.dot(ahead)).toBeLessThan(0)
    expect(q).toBeInstanceOf(Quaternion)
  })


  it('passes near the Moon', () => {
    // The mean ellipse, focus at Earth, stays within ~2% of the Moon.
    const a = 384400e3
    const ecc = 0.0549
    for (let jde = 2461000; jde < 2461060; jde += 0.7) {
      const args = moonArguments(jde)
      const q = moonOrbitOrientation(args)
      const moon = moonScenePosition(jde)
      const inPlane = moon.clone().applyQuaternion(q.clone().invert())
      expect(Math.abs(inPlane.y) / moon.length()).toBeLessThan(0.01)
      const nu = Math.atan2(-inPlane.z, inPlane.x)
      const rEllipse = a * (1 - (ecc * ecc)) / (1 + (ecc * Math.cos(nu)))
      expect(Math.abs(moon.length() - rEllipse) / rEllipse).toBeLessThan(0.03)
    }
  })
})
