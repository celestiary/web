import {describe, expect, it} from 'bun:test'
import {Quaternion} from 'three'
import SurveyCadence, {FIELD_SKY_M, duration, raDecToScene, sceneToRaDec} from './SurveyCadence.js'
import {FIELD_DIAMETER_DEG, jdOf, raDecToAltAz} from './cadence.js'
import {SITE} from './rubin.js'


const deps = {
  precessionQuaternion: (from, to, out = new Quaternion) => out.identity(),
  utcToTtJulianDay: (jd) => jd,
  J2000_JD: 2451545,
  sceneReferred: (m) => m,
  OVERLAY_LAYER: 3,
}
const TARGET = {raDeg: 274.6, decDeg: -42.6}
// 15 May 2026, 05:00 UTC: the middle of the night at the site.
const MID_MS = Date.UTC(2026, 4, 15, 5)


describe('SurveyCadence', () => {
  it('turns RA and Dec to the scene\'s ecliptic axes and back', () => {
    for (const [ra, dec] of [[0, 0], [90, 0], [274.6, -42.6], [10, 80]]) {
      const [x, y, z] = raDecToScene(ra, dec)
      const back = sceneToRaDec({x, y, z})
      expect(back.raDeg).toBeCloseTo(ra, 9)
      expect(back.decDeg).toBeCloseTo(dec, 9)
    }
    // The equinox is +X; the north celestial pole is 23.4° from the ecliptic's (+Y).
    expect(raDecToScene(0, 0)[0]).toBeCloseTo(1, 12)
    expect(Math.acos(raDecToScene(0, 90)[1]) * 180 / Math.PI).toBeCloseTo(23.4393, 4)
  })

  it('is off by default, and on, builds the clock\'s night once and points the mount on it', () => {
    let asked = 0
    const c = new SurveyCadence({deps, targetAt: () => {
      asked++
      return TARGET
    }})
    expect(c.pointing(MID_MS)).toBe(null)
    c.enabled = true
    const p = c.pointing(MID_MS)
    expect(asked).toBe(1)
    expect(c.night.visits.length).toBeGreaterThan(800)
    c.pointing(MID_MS + 3600e3)
    expect(asked).toBe(1)
    expect(p).not.toBe(null)
    if (!p.slewing) {
      const field = raDecToAltAz(p.visit.raDeg, p.visit.decDeg, MID_MS, SITE)
      expect(p.el).toBeCloseTo(field.el, 9)
      expect(p.az).toBeCloseTo(field.az, 9)
    }
    const r = c.readout(MID_MS)
    expect(r.count).toBe(c.night.visits.length)
    expect(r.lines[0]).toMatch(/^(Visit|Slewing to visit) \d+ of \d+, filter [grizy] \(modelled\)$/)
    expect(r.lines[1]).toMatch(/2026 ED138/)
    expect(duration(65 * 60e3)).toBe('1 h 05 min')
  })

  it('draws each field visited as a 3.5° circle on the sky, the current one brightest', () => {
    const c = new SurveyCadence({deps, targetAt: () => TARGET})
    c.enabled = true
    c.pointing(MID_MS)
    const v = c.night.visits[300]
    c.place(jdOf((v.tMs + v.endMs) / 2))
    expect(c.visible).toBe(true)
    expect(c.lines.layers.mask).toBe(1 << 3)
    const pos = c.lines.geometry.getAttribute('position')
    const order = [...new Set(c.night.visits.map((x) => x.field))]
    expect(pos.count).toBe(order.length * 48 * 2)
    // Every vertex is a field's radius from its centre, at the sky's distance.
    const first = c.night.visits[0]
    const [cx, cy, cz] = raDecToScene(first.raDeg, first.decDeg)
    for (let k = 0; k < 96; k++) {
      const x = pos.getX(k)
      const y = pos.getY(k)
      const z = pos.getZ(k)
      const r = Math.hypot(x, y, z)
      expect(r / FIELD_SKY_M).toBeCloseTo(1, 5)
      const angle = Math.acos(((x * cx) + (y * cy) + (z * cz)) / r) * 180 / Math.PI
      expect(angle).toBeCloseTo(FIELD_DIAMETER_DEG / 2, 4)
    }
    const colors = c.lines.geometry.getAttribute('color')
    const brightness = (i) => colors.getX(i * 96) + colors.getY(i * 96) + colors.getZ(i * 96)
    const current = order.indexOf(v.field)
    for (let i = 0; i < order.length; i++) {
      if (i !== current) {
        expect(brightness(i)).toBeLessThan(brightness(current))
      }
    }
    c.enabled = false
    c.place(jdOf(MID_MS))
    expect(c.visible).toBe(false)
  })
})
