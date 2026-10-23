import {describe, expect, it} from 'bun:test'
import {REGIMES, elfoInclination, nodeForLocalTime, periodOf, semiMajorAxisOf, sunSyncInclination} from './regimes.js'


const EARTH_YEAR = 365.256363 * 86400
const MARS_YEAR = 686.98 * 86400
const SIDEREAL_DAY = 86164.1


describe('regimes', () => {
  const {earth, mars, moon} = REGIMES
  const orbit = (body, start) => body.orbits.find((o) => o.text.startsWith(start))

  it('gives the sun-synchronous inclinations of Earth and Mars', () => {
    // Earth at 700 km: 98.19° (Vallado, Fundamentals of Astrodynamics).
    expect(sunSyncInclination(earth, EARTH_YEAR, earth.equatorialRadius + 700e3)).toBeCloseTo(98.19, 1)
    // At 800 km, 98.6°.
    expect(sunSyncInclination(earth, EARTH_YEAR, earth.equatorialRadius + 800e3)).toBeCloseTo(98.6, 1)
    // Mars Reconnaissance Orbiter, ~255 x 320 km: 92.65°.
    expect(sunSyncInclination(mars, MARS_YEAR, mars.equatorialRadius + 290e3)).toBeCloseTo(92.65, 1)
    // Too high for J2 to turn the node fast enough: none.
    expect(sunSyncInclination(earth, EARTH_YEAR, 7 * earth.equatorialRadius)).toBeNull()
  })

  it('has the families\' periods: Molniya and GPS half a sidereal day, Tundra one', () => {
    for (const [start, periods] of [['Molniya', 0.5], ['GPS', 0.5], ['Tundra', 1]]) {
      const o = orbit(earth, start)
      expect(periodOf(earth.gm, semiMajorAxisOf(earth, o)) / SIDEREAL_DAY).toBeCloseTo(periods, 2)
    }
    // Molniya's apogee: 39,400 km up.
    const m = orbit(earth, 'Molniya')
    expect(((m.a * (1 + m.e)) - earth.equatorialRadius) / 1e6).toBeCloseTo(39.4, 0)
    // GEO's altitude over the equator is the shells' MEO edge.
    expect(earth.shells.find((s) => s.name === 'MEO').to).toBe(35786e3)
    expect(semiMajorAxisOf(earth, orbit(earth, 'sun-synchronous'))).toBe(earth.equatorialRadius + 700e3)
  })

  it('puts a node at its local time from the Sun', () => {
    // The Sun on +X: noon's node is there, 6 pm's 90° on (toward -Z).
    expect(nodeForLocalTime({x: 1, z: 0}, 12)).toBeCloseTo(0, 9)
    expect(nodeForLocalTime({x: 1, z: 0}, 18)).toBeCloseTo(90, 9)
    expect(nodeForLocalTime({x: 0, z: 1}, 12)).toBeCloseTo(270, 9)
    expect(nodeForLocalTime({x: 0, z: 1}, 6)).toBeCloseTo(180, 9)
  })

  it('has the Moon\'s frozen inclinations, LRO\'s orbits and the 30 h ELFO', () => {
    const frozen = moon.orbits.filter((o) => o.label.startsWith('frozen'))
    expect(frozen.map((o) => o.i)).toEqual([27, 50, 76, 86])
    // LRO's 50 km mapping orbit: about 113 minutes.
    expect(periodOf(moon.gm, semiMajorAxisOf(moon, orbit(moon, 'LRO\'s mapping'))) / 60).toBeCloseTo(113, 0)
    // In 2015: 20 km up over the south pole (ω 270°, polar), 165 km over the north.
    const lro = orbit(moon, 'LRO since')
    expect(((lro.a * (1 - lro.e)) - moon.equatorialRadius) / 1e3).toBeCloseTo(20, 6)
    expect(((lro.a * (1 + lro.e)) - moon.equatorialRadius) / 1e3).toBeCloseTo(165, 6)
    // The LCRNS reference ELFO: a 11,313 km, e 0.69168, 30 h.
    const elfo = orbit(moon, 'elliptical')
    expect(elfo.a / 1e6).toBeCloseTo(11.313, 2)
    expect(elfo.e).toBeCloseTo(0.69168, 4)
    expect(periodOf(moon.gm, elfo.a) / 3600).toBeCloseTo(30, 1)
  })

  it('gives the inclination at which the Earth freezes an elliptical lunar orbit', () => {
    // Kozai's critical inclination, as e goes to 0: acos(sqrt(3/5)).
    expect(elfoInclination(0)).toBeCloseTo(39.23, 2)
    // Ely's e = 0.6: 51.7°.
    expect(elfoInclination(0.6)).toBeCloseTo(51.7, 1)
    // e² + (5/3) cos² i = 1 holds.
    for (const e of [0.2, 0.5, 0.7]) {
      expect((e * e) + ((5 / 3) * (Math.cos(elfoInclination(e) * Math.PI / 180) ** 2))).toBeCloseTo(1, 12)
    }
    // The Moon's own field moves the 30 h ELFO's a few degrees above it.
    const elfo = orbit(moon, 'elliptical')
    expect(elfo.i - elfoInclination(elfo.e)).toBeGreaterThan(2)
    expect(elfo.i - elfoInclination(elfo.e)).toBeLessThan(5)
  })
})
