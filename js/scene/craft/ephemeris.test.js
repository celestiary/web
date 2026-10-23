import {describe, expect, it} from 'bun:test'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {appBodies, j2000ToDate, moonGeocentric, ttToUtc} from './bodies.js'
import {SampledTrack, earthPole, geocentricTracks} from './ephemeris.js'
import {J2000_OBLIQUITY_DEG} from '../celestialFrame.js'
import {ASTRO_UNIT_METER} from '../../shared.js'


// From the package, not ../vsop.js, which Celestiary.test.js mocks for the
// whole process.
const vsop87c = await vsop87cLoader
const JDE = 2461336.5


describe('a craft\'s ephemeris', () => {
  it('reads the Moon and the Sun between samples to under a metre', () => {
    const tracks = geocentricTracks(appBodies(vsop87c))
    for (let i = 0; i < 40; i++) {
      // Odd times, between the samples.
      const jde = JDE + (i * 0.3731)
      const m = moonGeocentric(jde)
      const a = tracks.moon.at(jde)
      expect(Math.hypot(a[0] - m[0], a[1] - m[1], a[2] - m[2])).toBeLessThan(1)
      if (i % 8 === 0) {
        const e = vsop87c(ttToUtc(jde)).earth
        const s = tracks.sun.at(jde)
        const d = Math.hypot(s[0] + (e.x * ASTRO_UNIT_METER), s[1] + (e.y * ASTRO_UNIT_METER),
            s[2] + (e.z * ASTRO_UNIT_METER))
        expect(d).toBeLessThan(1)
      }
    }
    // Each sample is taken once.
    const before = tracks.moon.samples.size
    tracks.moon.at(JDE + 1.1)
    expect(tracks.moon.samples.size).toBe(before)
  })

  it('interpolates a polynomial of degree 7 exactly', () => {
    const f = (t) => (t ** 7) - (3 * (t ** 4)) + 2
    const track = new SampledTrack((jde, out) => {
      out[0] = f(jde)
      out[1] = 0
      out[2] = 0
      return out
    }, 0.5)
    expect(track.at(1.37)[0]).toBeCloseTo(f(1.37), 8)
  })

  it('turns Horizons\' J2000 ecliptic to the ecliptic of date', () => {
    // Nothing at J2000; the equinox's 50.29″ a year in longitude after.
    const v = [1, 0, 0]
    expect(j2000ToDate(v, 2451545)[0]).toBeCloseTo(1, 12)
    const years = 26
    const turned = j2000ToDate(v, 2451545 + (years * 365.25))
    const lon = Math.atan2(turned[1], turned[0]) * 180 / Math.PI * 3600
    expect(lon / years).toBeCloseTo(50.29, 1)
    expect(Math.hypot(...turned)).toBeCloseTo(1, 12)
  })

  it('has the Earth\'s pole at the obliquity from the ecliptic\'s', () => {
    const p = earthPole()
    expect(Math.acos(p[2]) * 180 / Math.PI).toBeCloseTo(J2000_OBLIQUITY_DEG, 10)
    // Toward ecliptic longitude 270°: the equinox's +90° is where the equator
    // is highest.
    expect(p[1]).toBeLessThan(0)
  })
})
