import {describe, expect, it} from 'bun:test'
import {Vector3} from 'three'
import {J2000_JD, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {Trajectory, hermite} from './trajectory.js'
import fixture from './trajectory.webb.horizons.json'
import table from '../../public/data/trajectories/webb.json'


describe('hermite', () => {
  it('is exact for a cubic', () => {
    // x(t) = t³ − 2t + 1 in km, t in s; ends at t = 0 and 2 (s per unit 1).
    const x = (t) => (t ** 3) - (2 * t) + 1
    const dx = (t) => (3 * t * t) - 2
    const a = {jd: 0, r: [x(0), 0, 0], v: [dx(0), 0, 0]}
    const b = {jd: 2, r: [x(2), 0, 0], v: [dx(2), 0, 0]}
    for (const t of [0, 0.3, 1, 1.7, 2]) {
      expect(hermite(a, b, t, [0, 0, 0], 1)[0]).toBeCloseTo(x(t), 12)
    }
  })
})


describe('Trajectory: Webb (JWST) against Horizons', () => {
  const traj = new Trajectory(table)

  it('spans the mission from just after launch', () => {
    // Launch 2021-12-25 12:20 UTC; Horizons from 13:02 TDB.
    expect(traj.start).toBeGreaterThan(2459574.0)
    expect(traj.start).toBeLessThan(2459574.05)
    // To 2031-10-04, where the 5-year schedule ends.
    expect(traj.end).toBeGreaterThan(2463143)
    expect(traj.parent).toBe('earth')
  })

  it('interpolates to within its tolerance at times off its grid', () => {
    expect(fixture.states.length).toBeGreaterThan(10)
    for (const s of fixture.states) {
      const p = traj.positionAt(s.jd)
      const d = Math.hypot(p[0] - s.r[0], p[1] - s.r[1], p[2] - s.r[2])
      // 5 km against the dense sample, which the fixture's times fall between.
      expect(d).toBeLessThan(6)
    }
  })

  it('is nowhere outside its span', () => {
    expect(traj.positionAt(traj.start - 1)).toBeNull()
    expect(traj.positionAt(traj.end + 1)).toBeNull()
    expect(traj.scenePositionAt(2451545)).toBeNull()
  })

  it('finds its segment out of order', () => {
    const late = fixture.states.at(-1)
    const early = fixture.states[0]
    const a = traj.positionAt(late.jd).slice()
    const b = traj.positionAt(early.jd).slice()
    expect(traj.positionAt(late.jd)).toEqual(a)
    expect(Math.hypot(b[0] - early.r[0], b[1] - early.r[1], b[2] - early.r[2])).toBeLessThan(6)
  })

  it('is near the Sun–Earth L2, away from the Sun, in the scene frame', () => {
    // 2026-10-23 12:00 TDB, a fixture time, asked for on the UTC clock.
    const s = fixture.states.find((st) => Math.abs(st.jd - 2461337.0) < 0.01)
    expect(s).toBeDefined()
    const jdUtc = s.jd - (utcToTtJulianDay(s.jd) - s.jd)
    const p = traj.scenePositionAt(jdUtc)
    // L2 is 1.5 million km beyond the Earth; the halo's amplitude is about
    // 800,000 km.
    const km = p.length() / 1000
    expect(km).toBeGreaterThan(1.0e6)
    expect(km).toBeLessThan(2.0e6)
    // Undo the precession and the axis remap and it is Horizons' vector.
    const q = precessionQuaternion(J2000_JD, utcToTtJulianDay(jdUtc)).invert()
    const back = p.clone().applyQuaternion(q).divideScalar(1000)
    const horizons = new Vector3(s.r[0], s.r[2], -s.r[1])
    expect(back.distanceTo(horizons)).toBeLessThan(6)
    // Precessed, it isn't: 26 years of it move 1.5 million km by ~9,500 km.
    expect(p.clone().divideScalar(1000).distanceTo(horizons)).toBeGreaterThan(5000)
    // Away from the Sun: on 23 October the Sun is at ecliptic longitude
    // ~210°, so L2 is at ~30°.
    const lon = Math.atan2(-back.z, back.x) * 180 / Math.PI
    expect(Math.abs(((lon - 30 + 540) % 360) - 180)).toBeLessThan(40)
  })


  it('refuses a table without states', () => {
    expect(() => new Trajectory({t: [1], r: [0, 0, 0], v: [0, 0, 0]})).toThrow()
  })
})
