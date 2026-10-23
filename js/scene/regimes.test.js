import {describe, expect, it} from 'bun:test'
import {REGIMES, nodeForLocalTime, periodOf, semiMajorAxisOf, sunSyncInclination} from './regimes.js'


const EARTH_YEAR = 365.256363 * 86400
const MARS_YEAR = 686.98 * 86400
const SIDEREAL_DAY = 86164.1


describe('regimes', () => {
  const {earth, mars} = REGIMES
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
})
