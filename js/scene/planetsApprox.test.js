import {describe, expect, it} from 'bun:test'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {PLANET_NAMES, planetsApprox} from './planetsApprox.js'
import {lowPrecisionSun} from '../tonight.js'
import {ASTRO_UNIT_METER} from '../shared.js'


// From the package, not ./vsop.js, which Celestiary.test.js mocks for the
// whole process.
const vsop87c = await vsop87cLoader

const AU_KM = ASTRO_UNIT_METER / 1000
const DEG = 180 / Math.PI

// J2000 plus years, in Julian Days.
const jdAt = (year) => 2451545 + ((year - 2000) * 365.25)

// Standish's table 1 is for 1800-2050.  Each year over that (the errors vary
// over decades, a planet's year at the fastest), and 2020 to 2035, around
// the present.
const TABLE = []
for (let year = 1800; year <= 2050; year += 1) {
  TABLE.push(jdAt(year))
}
const NOW = TABLE.filter((jd) => jd >= jdAt(2020) && jd <= jdAt(2035))

// VSOP87C takes about 2 ms a call: once a date.
const cache = new Map
const vsop = (jd) => {
  if (!cache.has(jd)) {
    cache.set(jd, vsop87c(jd))
  }
  return cache.get(jd)
}


/**
 * @param {{x: number, y: number, z: number}} a
 * @param {{x: number, y: number, z: number}} b
 * @returns {number} the angle between the directions, degrees
 */
function angle(a, b) {
  const dot = (a.x * b.x) + (a.y * b.y) + (a.z * b.z)
  return Math.acos(Math.min(1, dot / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)))) * DEG
}


/**
 * @param {object} planets {name: {x, y, z}}
 * @param {string} name
 * @param {{x: number, y: number, z: number}} from
 * @returns {{x: number, y: number, z: number}} the body as seen from there
 */
function seenFrom(planets, name, from) {
  const p = planets[name]
  return {x: p.x - from.x, y: p.y - from.y, z: p.z - from.z}
}


describe('the planets before VSOP87C has loaded', () => {
  it('names the eight planets, as VSOP87C does', () => {
    const jd = jdAt(2026)
    expect(Object.keys(planetsApprox(jd)).sort()).toEqual(Object.keys(vsop87c(jd)).sort())
    expect(PLANET_NAMES).toHaveLength(8)
  })

  it('reuses the object it is given, so a frame allocates nothing', () => {
    const target = {}
    expect(planetsApprox(jdAt(2026), target)).toBe(target)
    const mercury = target.mercury
    planetsApprox(jdAt(2027), target)
    expect(target.mercury).toBe(mercury)
  })

  it('puts every planet within a quarter of a degree (seen from the Sun) of VSOP87C, 1800 to 2050', () => {
    // Measured at quarter-years: Saturn's 0.205° is the largest.
    for (const jd of TABLE) {
      const a = planetsApprox(jd)
      const b = vsop(jd)
      for (const name of PLANET_NAMES) {
        expect(angle(a[name], b[name])).toBeLessThan(0.25)
      }
    }
  })

  it('puts Earth and the inner planets within 20,000 km of VSOP87C, 1800 to 2050', () => {
    // Measured: 20,000 km at most (Earth's), Venus 15,000, Mercury 7,000.
    for (const jd of TABLE) {
      const a = planetsApprox(jd)
      const b = vsop(jd)
      for (const name of ['mercury', 'venus', 'earth']) {
        const km = Math.hypot(a[name].x - b[name].x, a[name].y - b[name].y, a[name].z - b[name].z) * AU_KM
        expect(km).toBeLessThan(21000)
      }
    }
  })

  it('shows every planet from Earth within a quarter of a degree of VSOP87C, 1800 to 2050', () => {
    // What the sky shows: the Moon is 0.5° across.  Saturn and Jupiter are
    // the worst, 0.22° and 0.17° at the table's ends.
    for (const jd of TABLE) {
      const a = planetsApprox(jd)
      const b = vsop(jd)
      for (const name of PLANET_NAMES.filter((n) => n !== 'earth')) {
        expect(angle(seenFrom(a, name, a.earth), seenFrom(b, name, b.earth))).toBeLessThan(0.25)
      }
    }
  })

  it('shows every planet from Earth within a tenth of a degree of VSOP87C, 2020 to 2035', () => {
    for (const jd of NOW) {
      const a = planetsApprox(jd)
      const b = vsop(jd)
      for (const name of PLANET_NAMES.filter((n) => n !== 'earth')) {
        expect(angle(seenFrom(a, name, a.earth), seenFrom(b, name, b.earth))).toBeLessThan(0.1)
      }
    }
  })

  it('has the Sun where Meeus\'s low-precision Sun puts it, to a hundredth of a degree', () => {
    for (const jd of NOW) {
      const e = planetsApprox(jd).earth
      expect(angle({x: -e.x, y: -e.y, z: -e.z}, lowPrecisionSun(jd))).toBeLessThan(0.02)
    }
  })

  it('is finite and bounded across the supported dates, if less accurate', () => {
    for (const year of [-4000, -2000, 0, 1000, 3000, 5000, 7000]) {
      const a = planetsApprox(jdAt(year))
      for (const name of PLANET_NAMES) {
        const {x, y, z} = a[name]
        expect(Number.isFinite(x + y + z)).toBe(true)
        // Within a degree or two of its semi-major axis' scale, not at some 10^9 AU.
        expect(Math.hypot(x, y, z)).toBeLessThan(40)
      }
    }
  })
})
