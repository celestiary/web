import {describe, expect, it} from 'bun:test'
import {
  CADENCE_MIN_ALT_DEG, FIELD_DIAMETER_DEG, KINEMATICS, axisSlewSeconds, buildNight, gmstDeg, jdOf, nextTargetVisit,
  nightBounds, nightOf, pointingAt, raDecToAltAz, separationDeg, slewSeconds, sunAltitude, tileSky, visitAt,
} from './cadence.js'
import fixture from '../ed138.horizons.json'


const SITE = {lat: -30.2446, lng: -70.7494}
const NIGHT = Date.UTC(2026, 4, 15)


/**
 * The object's astrometric place from the Horizons fixture, linear between
 * its 10-day rows.
 *
 * @param {number} ms
 * @returns {{raDeg: number, decDeg: number}}
 */
function ed138At(ms) {
  const jd = jdOf(ms)
  const rows = fixture.observer
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]
    const b = rows[i + 1]
    if (jd >= a.jd && jd <= b.jd) {
      const f = (jd - a.jd) / (b.jd - a.jd)
      return {raDeg: a.raDeg + ((b.raDeg - a.raDeg) * f), decDeg: a.decDeg + ((b.decDeg - a.decDeg) * f)}
    }
  }
  throw new Error('outside the fixture')
}

const bounds = nightBounds(NIGHT, SITE)
const target = ed138At((bounds.startMs + bounds.endMs) / 2)
const night = buildNight({nightMs: NIGHT, site: SITE, target})
const {visits} = night


describe('cadence: the sky and the clock', () => {
  it('has the sidereal time at J2000', () => {
    expect(gmstDeg(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(280.46061837, 6)
  })

  it('puts the night between the twilights, the Sun under -12°', () => {
    expect(sunAltitude(bounds.startMs - 60e3, SITE)).toBeGreaterThan(-12)
    expect(sunAltitude(bounds.startMs + 60e3, SITE)).toBeLessThan(-12)
    expect(sunAltitude(bounds.endMs + 60e3, SITE)).toBeGreaterThan(-12)
    expect(sunAltitude((bounds.startMs + bounds.endMs) / 2, SITE)).toBeLessThan(-40)
    // A May night at 30° S: about eleven and a half hours of dark.
    const hours = (bounds.endMs - bounds.startMs) / 3600e3
    expect(hours).toBeGreaterThan(10.5)
    expect(hours).toBeLessThan(12.5)
    expect(nightOf(bounds.startMs)).toBe(NIGHT)
    expect(nightOf(bounds.endMs)).toBe(NIGHT)
  })

  it('tiles the footprint with fields that cover it', () => {
    const tiles = tileSky()
    expect(tiles.length).toBeGreaterThan(2000)
    // Any point in the footprint is within a field of some tile.
    for (const [ra, dec] of [[0, 0], [123.4, -41.2], [274.5, -42.5], [359, -70]]) {
      const d = Math.min(...tiles.map((t) => separationDeg(t.raDeg, t.decDeg, ra, dec)))
      expect(d).toBeLessThan(FIELD_DIAMETER_DEG / 2)
    }
  })

  it('times a slew by the slowest axis, and the settle', () => {
    expect(axisSlewSeconds(0, KINEMATICS.telAz)).toBe(0)
    // 1.5°/s at 0.75°/s²: 2 s up to speed over 1.5°, and as long down.
    expect(axisSlewSeconds(3, KINEMATICS.domeAz)).toBeCloseTo(4, 6)
    expect(axisSlewSeconds(6, KINEMATICS.domeAz)).toBeCloseTo(6, 6)
    expect(slewSeconds({el: 60, az: 10}, {el: 60, az: 13.5})).toBeCloseTo(axisSlewSeconds(3.5, KINEMATICS.domeAz) + 3, 6)
    expect(slewSeconds({el: 60, az: 359}, {el: 60, az: 2})).toBeCloseTo(slewSeconds({el: 60, az: 0}, {el: 60, az: 3}), 6)
  })
})


describe('cadence: a night of visits', () => {
  it('fills the night with 30 s visits, some 800 to 1100', () => {
    expect(visits.length).toBeGreaterThan(800)
    expect(visits.length).toBeLessThan(1100)
    for (const v of visits) {
      expect(v.expS).toBe(30)
      expect(v.tMs).toBeGreaterThanOrEqual(night.startMs)
      expect(v.endMs).toBeLessThanOrEqual(night.endMs)
    }
  })

  it('is deterministic', () => {
    const again = buildNight({nightMs: NIGHT, site: SITE, target})
    expect(again.visits.length).toBe(visits.length)
    expect(again.visits[500]).toEqual(visits[500])
  })

  it('never overlaps visits, and leaves each slew its time at the mount\'s rates', () => {
    for (let i = 1; i < visits.length; i++) {
      const a = visits[i - 1]
      const b = visits[i]
      expect(b.tMs).toBeGreaterThanOrEqual(a.endMs)
      const from = raDecToAltAz(a.raDeg, a.decDeg, a.endMs, SITE)
      const to = raDecToAltAz(b.raDeg, b.decDeg, b.tMs, SITE)
      // The slew starts no earlier than the last visit's end and lasts as
      // the kinematics ask (to within the sky's turn while it waits).
      expect((b.tMs - a.endMs) / 1e3).toBeGreaterThanOrEqual(slewSeconds(from, to) - 0.5)
    }
    // Neighbouring fields: most slews are a few seconds.
    const slews = visits.slice(1).map((v) => v.slewS).sort((a, b) => a - b)
    expect(slews[slews.length >> 1]).toBeLessThan(10)
  })

  it('takes every visit above the altitude limit, from start to end', () => {
    for (const v of visits) {
      expect(raDecToAltAz(v.raDeg, v.decDeg, v.tMs, SITE).el).toBeGreaterThanOrEqual(CADENCE_MIN_ALT_DEG)
      expect(raDecToAltAz(v.raDeg, v.decDeg, v.endMs, SITE).el).toBeGreaterThanOrEqual(CADENCE_MIN_ALT_DEG)
    }
  })

  it('visits fields in pairs, the second some tens of minutes after the first', () => {
    const byField = new Map
    for (const v of visits) {
      byField.set(v.field, [...(byField.get(v.field) ?? []), v])
    }
    let paired = 0
    for (const list of byField.values()) {
      expect(list.length).toBeLessThanOrEqual(2)
      if (list.length === 2) {
        paired++
        const gapMin = (list[1].tMs - list[0].tMs) / 60e3
        expect(gapMin).toBeGreaterThan(10)
        expect(gapMin).toBeLessThan(60)
      }
    }
    expect(paired / byField.size).toBeGreaterThan(0.95)
  })

  it('changes filter a few times a night', () => {
    let changes = 0
    for (let i = 1; i < visits.length; i++) {
      changes += visits[i].filter === visits[i - 1].filter ? 0 : 1
    }
    expect(changes).toBeGreaterThan(0)
    expect(changes).toBeLessThan(12)
  })

  it('visits the object\'s field as a pair, holding it at each visit', () => {
    const own = visits.filter((v) => v.isTarget)
    expect(own.length).toBe(2)
    for (const v of own) {
      const at = ed138At(v.tMs)
      expect(separationDeg(v.raDeg, v.decDeg, at.raDeg, at.decDeg)).toBeLessThan(FIELD_DIAMETER_DEG / 2)
    }
    expect(nextTargetVisit(visits, night.startMs)).toBe(own[0])
    expect(nextTargetVisit(visits, own[1].tMs)).toBe(null)
  })
})


describe('cadence: the run\'s nights', () => {
  it('visits the object\'s field as a pair on nights of March to July', () => {
    for (const nightMs of [Date.UTC(2026, 2, 4), Date.UTC(2026, 3, 1), Date.UTC(2026, 5, 20), Date.UTC(2026, 6, 11)]) {
      const b = nightBounds(nightMs, SITE)
      const own = buildNight({nightMs, site: SITE, target: ed138At((b.startMs + b.endMs) / 2)}).visits.filter((v) => v.isTarget)
      expect(own.length).toBe(2)
      expect((own[1].tMs - own[0].tMs) / 60e3).toBeGreaterThan(20)
      for (const v of own) {
        const at = ed138At(v.tMs)
        expect(separationDeg(v.raDeg, v.decDeg, at.raDeg, at.decDeg)).toBeLessThan(FIELD_DIAMETER_DEG / 2)
      }
    }
  })
})


describe('cadence: the mount on the schedule', () => {
  it('points at the visit\'s field while it is under way, and moves between', () => {
    const v = visits[100]
    const mid = (v.tMs + v.endMs) / 2
    expect(visitAt(visits, mid)).toEqual({index: 100, slewing: false})
    const p = pointingAt(visits, mid, SITE)
    const field = raDecToAltAz(v.raDeg, v.decDeg, mid, SITE)
    expect(p.el).toBeCloseTo(field.el, 9)
    expect(p.az).toBeCloseTo(field.az, 9)
    const next = visits[101]
    if (next.slewS > 0) {
      const during = next.tMs - (next.slewS * 1e3 / 2)
      const s = pointingAt(visits, during, SITE)
      expect(s.slewing).toBe(true)
      expect(s.index).toBe(101)
    }
    expect(pointingAt(visits, night.startMs - 1e3, SITE)).toBe(null)
    expect(pointingAt(visits, night.endMs + 1e3, SITE)).toBe(null)
  })
})
