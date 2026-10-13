import {describe, expect, it} from 'bun:test'
import {PerspectiveCamera, Vector3} from 'three'
import {HOME_TOUR_EARTH_MS, homeTour} from './homeTour.js'
import {
  AIM_MAX_DEG, DARK_FULL_DEG, EARTH_RADIUS_METER, ECLIPSE_DIST, FALLBACK_HOURS, MIN_SHARE, PREFERRED_HOURS,
  SUN_MARGIN_DEG, angleVector, arcDeg, chooseNightSide, darkness, eclipseReachDeg, hoursFromMidnight, nightDepthDeg,
  planEarthPass, subsolarPoint, sunAltitudeAt, tourAngles, wrap180,
} from './nightSide.js'
import {fromSpherical} from './tour.js'
import {lowPrecisionSun, sunAltitude} from './tonight.js'
import {ASTRO_UNIT_METER} from './shared.js'


const HOUR = 3600000

/**
 * Fixed times through the seasons: each solstice's and equinox's day, every
 * three hours, so night is over each longitude in turn, the Pacific among
 * them.
 */
const TIMES = []
for (const day of ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21']) {
  for (let h = 0; h < 24; h += 3) {
    TIMES.push(Date.parse(`${day}T00:00:00Z`) + (h * HOUR) + (37 * 60000))
  }
}


describe('the Sun and the ground', () => {
  it('the subsolar point is where the Sun is overhead', () => {
    for (const ms of TIMES) {
      const s = subsolarPoint(ms)
      expect(sunAltitude(s.lat, s.lng, ms)).toBeGreaterThan(89.9)
    }
  })

  it('the Sun\'s altitude agrees with tonight.js\'s', () => {
    for (const ms of TIMES) {
      const s = subsolarPoint(ms)
      for (const [lat, lng] of [[51.5, 0], [-33.9, 151.2], [35.7, 139.7], [64.1, -21.9]]) {
        expect(Math.abs(sunAltitudeAt(lat, lng, s) - sunAltitude(lat, lng, ms))).toBeLessThan(0.05)
      }
    }
  })

  it('local midnight is opposite the Sun, and the hours run east', () => {
    const ms = Date.parse('2026-03-20T12:00:00Z')
    const s = subsolarPoint(ms)
    expect(hoursFromMidnight(wrap180(s.lng + 180), s)).toBeCloseTo(0, 6)
    expect(hoursFromMidnight(wrap180(s.lng + 150), s)).toBeCloseTo(-2, 6)
    expect(hoursFromMidnight(wrap180(s.lng - 150), s)).toBeCloseTo(2, 6)
  })

  it('darkness is none in twilight and whole from nautical dusk', () => {
    expect(darkness(0)).toBe(0)
    expect(darkness(-6)).toBe(0)
    expect(darkness(-9)).toBeCloseTo(0.5, 6)
    expect(darkness(DARK_FULL_DEG)).toBe(1)
    expect(darkness(-40)).toBe(1)
  })
})


describe('the tour\'s frame', () => {
  it('the subsolar point is at azimuth 0, midnight at 180, the dusk terminator at 90', () => {
    for (const ms of TIMES) {
      const s = subsolarPoint(ms)
      const noon = tourAngles(s.lat, s.lng, ms)
      expect(Math.abs(noon.az)).toBeLessThan(0.05)
      expect(Math.abs(noon.el)).toBeLessThan(0.05)
      const midnight = tourAngles(-s.lat, wrap180(s.lng + 180), ms)
      expect(Math.abs(Math.abs(midnight.az) - 180)).toBeLessThan(0.05)
      // The equator at local 18:00 is on the dusk terminator, about.
      const dusk = tourAngles(0, wrap180(s.lng + 90), ms)
      expect(Math.abs(dusk.az - 90)).toBeLessThan(25)
      expect(Math.abs(nightDepthDeg(angleVector(dusk.az, dusk.el)))).toBeLessThan(1)
    }
  })

  it('the north pole is the ecliptic\'s tilt from its north', () => {
    const {el} = tourAngles(90, 0, Date.parse('2026-06-21T00:00:00Z'))
    expect(el).toBeCloseTo(90 - 23.436, 2)
  })

  it('a point\'s arc from the terminator is its Sun\'s depth', () => {
    for (const ms of TIMES) {
      const s = subsolarPoint(ms)
      for (const [lat, lng] of [[48.9, 2.4], [28.6, 77.2], [40.7, -74]]) {
        const a = tourAngles(lat, lng, ms)
        expect(nightDepthDeg(angleVector(a.az, a.el))).toBeCloseTo(-sunAltitudeAt(lat, lng, s), 1)
      }
    }
  })
})


describe('choosing the night side', () => {
  it('is dark, near local midnight, and over city light, at any hour and season', () => {
    for (const ms of TIMES) {
      const aim = chooseNightSide(ms)
      const when = new Date(ms).toISOString()
      // Dark: the Sun more than 12° down there.
      expect(sunAltitude(aim.lat, aim.lng, ms), when).toBeLessThan(DARK_FULL_DEG)
      expect(aim.hours, when).toBeGreaterThanOrEqual(FALLBACK_HOURS[0])
      expect(aim.hours, when).toBeLessThanOrEqual(FALLBACK_HOURS[1])
      // Somewhere people live, lit.
      expect(aim.lat, when).toBeGreaterThanOrEqual(-45)
      expect(aim.lat, when).toBeLessThanOrEqual(60)
      expect(aim.share, when).toBeGreaterThan(0.1)
      if (!aim.fallback) {
        // 21:00 to 01:30, and bright.
        expect(aim.hours, when).toBeGreaterThanOrEqual(PREFERRED_HOURS[0])
        expect(aim.hours, when).toBeLessThanOrEqual(PREFERRED_HOURS[1])
        expect(aim.share, when).toBeGreaterThanOrEqual(MIN_SHARE)
      }
    }
  })

  it('finds Europe, India, East Asia and the Americas each at its hour', () => {
    const cases = [
      ['2026-03-20T23:00:00Z', [35, 60], [-10, 30]],
      ['2026-12-21T16:30:00Z', [5, 35], [65, 95]],
      ['2026-09-22T13:00:00Z', [20, 45], [100, 145]],
      ['2026-06-21T04:00:00Z', [25, 50], [-100, -65]],
    ]
    for (const [iso, lat, lng] of cases) {
      const aim = chooseNightSide(Date.parse(iso))
      expect(aim.fallback, iso).toBe(false)
      expect(aim.lat, iso).toBeGreaterThanOrEqual(lat[0])
      expect(aim.lat, iso).toBeLessThanOrEqual(lat[1])
      expect(aim.lng, iso).toBeGreaterThanOrEqual(lng[0])
      expect(aim.lng, iso).toBeLessThanOrEqual(lng[1])
    }
  })

  it('with midnight over the Pacific, falls back to the nearest lit coast', () => {
    const ms = Date.parse('2026-03-20T09:30:00Z')
    const s = subsolarPoint(ms)
    // Midnight is over the Pacific, east of Hawaii.
    expect(wrap180(s.lng + 180)).toBeLessThan(-125)
    expect(wrap180(s.lng + 180)).toBeGreaterThan(-180)
    const aim = chooseNightSide(ms)
    expect(aim.fallback).toBe(true)
    expect(aim.share).toBeGreaterThanOrEqual(MIN_SHARE)
    // The American west, after midnight.
    expect(aim.lng).toBeGreaterThan(-125)
    expect(aim.lng).toBeLessThan(-95)
    expect(aim.hours).toBeGreaterThan(0)
  })

  it('asks the ephemeris for the Sun once or twice a plan, not once an aim', () => {
    // VSOP87C takes about 2 ms a call: once an aim, a plan took 4 s.
    let calls = 0
    const sunAt = (jd) => {
      calls++
      return lowPrecisionSun(jd)
    }
    const ms = Date.parse('2026-03-20T21:00:00Z')
    expect(planEarthPass(ms, {sunAt})).toEqual(planEarthPass(ms))
    expect(calls).toBeLessThanOrEqual(2)
  })

  it('in a northern summer passes over the short nights the far north doesn\'t have', () => {
    // 21:00 UTC at midsummer: Scandinavia in twilight, so not there.
    const aim = chooseNightSide(Date.parse('2026-06-21T21:00:00Z'))
    expect(sunAltitude(aim.lat, aim.lng, Date.parse('2026-06-21T21:00:00Z'))).toBeLessThan(DARK_FULL_DEG)
    expect(aim.lat).toBeLessThan(50)
  })
})


describe('the pass over Earth', () => {
  /**
   * Earth at the origin, the Sun along +X, as the tour's driver gives them.
   *
   * @param {string} name
   * @returns {{pos: Vector3, ref: Vector3}}
   */
  function bodyAt(name) {
    return name === 'sun' ?
      {pos: new Vector3(ASTRO_UNIT_METER, 0, 0), ref: new Vector3(-1, 0, 0)} :
      {pos: new Vector3(), ref: new Vector3(1, 0, 0)}
  }

  /**
   * @param {object} pose CameraPath.pose's
   * @param {number} aspect
   * @returns {function(Vector3): boolean} Whether a point on the globe is
   *   in the frame and faces the camera
   */
  function inFrame(pose, aspect) {
    const camera = new PerspectiveCamera(pose.fov, aspect, 1, 1e12)
    camera.position.copy(pose.position)
    camera.quaternion.copy(pose.quaternion)
    camera.updateMatrixWorld()
    return (p) => {
      if (p.dot(new Vector3().subVectors(pose.position, p)) <= 0) {
        return false
      }
      const ndc = p.clone().project(camera)
      return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1
    }
  }

  // Points on the globe: the terminator (x = 0), the sunlit side and the night side.
  const R = EARTH_RADIUS_METER
  const STEPS = 72
  const terminator = []
  const lit = []
  const night = []
  for (let i = 0; i < STEPS; i++) {
    const b = 2 * Math.PI * i / STEPS
    terminator.push(new Vector3(0, R * Math.sin(b), R * Math.cos(b)))
    for (const [x, list] of [[0.3, lit], [-0.5, night]]) {
      const r = R * Math.sqrt(1 - (x * x))
      list.push(new Vector3(R * x, r * Math.sin(b), r * Math.cos(b)))
    }
  }

  /**
   * @param {Vector3} eye
   * @returns {number} How far, degrees, the Sun is behind Earth's limb seen
   *   from there: negative if it shows
   */
  function sunBehindDeg(eye) {
    const toEarth = eye.clone().negate()
    const earthRadius = Math.asin(R / toEarth.length()) * 180 / Math.PI
    const sunOff = toEarth.angleTo(new Vector3(1, 0, 0)) * 180 / Math.PI
    return earthRadius - sunOff
  }

  it('arrives over the crescent, the terminator and the night side in frame', () => {
    for (const ms of TIMES) {
      const tour = homeTour(ms)
      const when = new Date(ms).toISOString()
      for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
        const seen = inFrame(tour.pose(HOME_TOUR_EARTH_MS.arrive, bodyAt), aspect)
        expect(terminator.some(seen), when).toBe(true)
        expect(lit.some(seen), when).toBe(true)
        expect(night.some(seen), when).toBe(true)
      }
    }
  })

  it('holds in Earth\'s shadow, the Sun well behind the limb, the aim\'s lights in frame', () => {
    for (const ms of TIMES) {
      const tour = homeTour(ms)
      const {plan} = tour
      const when = new Date(ms).toISOString()
      expect(plan.aimDeg, when).toBeLessThanOrEqual(AIM_MAX_DEG + 1e-6)
      const aimAngles = tourAngles(plan.lat, plan.lng, ms)
      const aim = fromSpherical(aimAngles.az, aimAngles.el, R, new Vector3(1, 0, 0))
      for (let t = HOME_TOUR_EARTH_MS.shadow; t <= HOME_TOUR_EARTH_MS.hold; t += 1000) {
        const pose = tour.pose(t, bodyAt)
        expect(sunBehindDeg(pose.position), `${when} ${t}`).toBeGreaterThanOrEqual(SUN_MARGIN_DEG - 1e-6)
        // Nothing sunlit faces the camera there: only the night side.
        for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
          const seen = inFrame(pose, aspect)
          expect(seen(aim), `${when} ${t} aim`).toBe(true)
          expect(night.some(seen), `${when} ${t}`).toBe(true)
          expect(lit.some(seen), `${when} ${t}`).toBe(false)
        }
      }
    }
  })

  it('comes in from the evening side, and the shadow\'s point is as near the aim as the eclipse allows', () => {
    for (const ms of TIMES) {
      const plan = planEarthPass(ms)
      // Over the crescent: just past the dusk terminator.
      expect(nightDepthDeg(angleVector(plan.arrive.az, plan.arrive.el))).toBeGreaterThan(0)
      expect(nightDepthDeg(angleVector(plan.arrive.az, plan.arrive.el))).toBeLessThan(15)
      // Into the shadow, toward midnight from the evening's side.
      expect(plan.pass.az).toBeGreaterThan(plan.arrive.az)
      const c = angleVector(plan.pass.az, plan.pass.el)
      expect(arcDeg(c, [-1, 0, 0])).toBeCloseTo(plan.sunOffDeg, 6)
      expect(plan.sunOffDeg).toBeLessThanOrEqual(eclipseReachDeg(plan.pass.dist) + 1e-9)
      expect(arcDeg(c, angleVector(plan.target.az, plan.target.el))).toBeCloseTo(plan.aimDeg, 6)
      // The globe fits the field, with its ring round it.
      expect(plan.pass.dist / R).toBeCloseTo(ECLIPSE_DIST, 6)
      expect(Math.asin(R / plan.pass.dist) * 180 / Math.PI).toBeLessThan(21)
    }
  })

  it('is the same picture whatever the hour: the same keyframes against the Sun for a like aim', () => {
    // Europe at 21:00 UTC a week apart: the same place, nearly the same angles.
    const a = planEarthPass(Date.parse('2026-03-13T21:00:00Z'))
    const b = planEarthPass(Date.parse('2026-03-20T21:00:00Z'))
    expect(Math.abs(a.pass.az - b.pass.az)).toBeLessThan(5)
    expect(Math.abs(a.pass.el - b.pass.el)).toBeLessThan(5)
  })
})
