import {describe, expect, it} from 'bun:test'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {SYNODIC_DAYS, aldrinCycler, flybyDv, idealOnCircles} from './cycler.js'
import {appBodies} from './bodies.js'
import {heliocentricTracks} from './ephemeris.js'
import {aldrinFlight} from './flights.js'
import {GM} from './integrator.js'
import designs from '../../../public/data/aldrin.json'


const vsop87c = await vsop87cLoader
const AU = 149597870700
const EARTH = {gm: GM.earth, radius: 6378e3, height: 300e3}
// Mars's sphere of influence, a (m/M)^(2/5).
const MARS_SOI = 577e6


describe('a cycler', () => {
  it('costs a flyby nothing where the planet can turn it, and the rest in Δv', () => {
    // v∞ 6 km/s turned 30°: free past the Earth.
    const v = 6e3
    const turned = (deg) => [v * Math.cos(deg * Math.PI / 180), v * Math.sin(deg * Math.PI / 180), 0]
    expect(flybyDv(turned(0), turned(30), EARTH).dv).toBeLessThan(1e-6)
    // Past the most the Earth can turn it (above 300 km), the rest rotated.
    const most = flybyDv(turned(0), turned(30), EARTH).maxTurn * 180 / Math.PI
    expect(most).toBeGreaterThan(60)
    expect(most).toBeLessThan(90)
    const over = flybyDv(turned(0), turned(most + 10), EARTH)
    expect(over.dv).toBeCloseTo(2 * v * Math.sin(5 * Math.PI / 180), -1)
    // Speeds unmatched: a burn at periapsis, less than the difference far out.
    const faster = flybyDv([6e3, 0, 0], [7e3, 0, 0], EARTH)
    expect(faster.dv).toBeGreaterThan(300)
    expect(faster.dv).toBeLessThan(1000)
  })

  it('finds Aldrin\'s cycler on circles as the papers have it', () => {
    // Byrnes, Longuski and Aldrin (1993); Russell and Ocampo (2004): 146 days
    // from the Earth to Mars, v∞ 6.54 km/s at the Earth and 9.75 at Mars,
    // aphelion 2.23 AU, an orbit of 2.02 years met by the Earth every 2.135.
    const c = idealOnCircles()
    expect(c.mars.jde - c.t).toBeCloseTo(146, -1)
    expect(Math.abs(c.mars.jde - c.t - 146)).toBeLessThan(3)
    expect(Math.abs(c.vInfEarth - 6540)).toBeLessThan(300)
    expect(Math.abs(c.mars.vInf - 9750)).toBeLessThan(200)
    expect(c.a * (1 + c.e) / AU).toBeCloseTo(2.23, 1)
    expect(c.period / 365.25).toBeCloseTo(2.02, 1)
    // It passes Mars: well within its sphere of influence.
    expect(c.mars.miss).toBeLessThan(0.05 * MARS_SOI)
    // The Earth's flyby: the turn it asks is 80°, past the 73° a 300 km pass
    // gives at 6.4 km/s; the rest is paid in Δv (Craft.md).
    expect(c.earth.turn).toBeGreaterThan(c.earth.maxTurn)
  })

  it('designs one on the planets as they are, its Mars passes nearly free', () => {
    const tracks = heliocentricTracks(appBodies(vsop87c), ['earth', 'mars'])
    const c = aldrinCycler(tracks, 2462116.5, 3)
    expect(c.flybys.map((f) => f.body)).toEqual(['earth', 'mars', 'earth', 'mars', 'earth', 'mars', 'earth'])
    for (const f of c.flybys) {
      if (f.body === 'mars') {
        expect(f.dv).toBeLessThan(100)
        expect(f.vInfIn / 1e3).toBeGreaterThan(7)
        expect(f.vInfIn / 1e3).toBeLessThan(14)
      } else if (f.vInfOut) {
        expect(f.vInfOut / 1e3).toBeGreaterThan(4)
        expect(f.vInfOut / 1e3).toBeLessThan(9)
      }
    }
    // Each cycle about a synodic period, the Earth met each time.
    const earth = c.flybys.filter((f) => f.body === 'earth').map((f) => f.jde)
    for (let k = 1; k < earth.length; k++) {
      expect(Math.abs(earth[k] - earth[k - 1] - SYNODIC_DAYS)).toBeLessThan(30)
    }
    expect(c.cost).toBeLessThan(3000)
  })

  it('flies the cyclers the app offers', () => {
    expect(designs.cyclers.length).toBeGreaterThan(4)
    const first = Math.min(...designs.cyclers.map((d) => d.x[0]))
    const path = aldrinFlight(first - 10, appBodies(vsop87c), designs)
    expect(path.facts.departure).toBe(first)
    expect(path.facts.cycles).toBe(3)
    // Out past Mars, under 2.6 AU; over six years.
    const r = []
    for (let i = 0; i < path.xyz.length; i += 3) {
      r.push(Math.hypot(path.xyz[i], path.xyz[i + 1], path.xyz[i + 2]) / AU)
    }
    expect(Math.max(...r)).toBeGreaterThan(1.8)
    expect(Math.max(...r)).toBeLessThan(2.6)
    expect(Math.min(...r)).toBeGreaterThan(0.5)
    expect(path.t.at(-1) - path.t[0]).toBeGreaterThan(6 * 365)
    expect(aldrinFlight(Math.max(...designs.cyclers.map((d) => d.x[0])) + 1, appBodies(vsop87c), designs)).toBeNull()
  })
})
