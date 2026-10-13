import {beforeAll, describe, expect, it} from 'bun:test'
import {
  ASTRONOMICAL_TWILIGHT_DEG, DEFAULT_LOCATION, browserLocation, formatTonight, lowPrecisionSun, resolveLocation,
  sunAltitude, timeZoneLocation, tonightTime,
} from './tonight.js'
import {loadVsop87c} from './vsop.js'


// The app's own ephemeris: VSOP87C's Earth, turned round to the Sun.
let vsopSun = null
beforeAll(async () => {
  const vsop87c = await new Promise((resolve) => loadVsop87c(resolve))
  vsopSun = (jd) => {
    const e = vsop87c(jd).earth
    return {x: -e.x, y: -e.y, z: -e.z}
  }
})

const MIN = 60000


describe('the Sun\'s altitude', () => {
  it('the stand-in agrees with the app\'s ephemeris to a hundredth of a degree', () => {
    for (const jd of [2451545, 2455000, 2461326.5, 2465000]) {
      const a = lowPrecisionSun(jd)
      const b = vsopSun(jd)
      const n = Math.hypot(b.x, b.y, b.z)
      const deg = Math.acos(((a.x * b.x) + (a.y * b.y) + (a.z * b.z)) / n) * 180 / Math.PI
      expect(deg).toBeLessThan(0.02)
    }
  })

  it('is overhead at noon on the equator at an equinox, and under the horizon at midnight', () => {
    // 2026-03-20, the equinox (14:46 UTC); noon at 140° W is about then.
    const noon = Date.parse('2026-03-20T21:20:00Z')
    expect(sunAltitude(0, -140, noon, vsopSun)).toBeGreaterThan(88)
    expect(sunAltitude(0, 40, noon, vsopSun)).toBeLessThan(-88)
  })

  it('at a solstice, the Sun\'s noon height is 90° less the latitude plus the tilt', () => {
    // 2026-06-21, ~12:05 UTC at Greenwich (the equation of time is ~-2 min).
    const max = Math.max(...[0, 2, 4, 6, 8, 10].map((m) =>
      sunAltitude(51.4779, 0, Date.parse('2026-06-21T12:00:00Z') + (m * MIN), vsopSun)))
    expect(max).toBeCloseTo(90 - 51.4779 + 23.436, 1)
  })
})


describe('tonight\'s time', () => {
  it('is now at night', () => {
    const now = Date.parse('2026-01-15T23:00:00Z')
    expect(tonightTime(51.48, 0, now, vsopSun)).toEqual({ms: now, kind: 'now'})
  })

  it('in the day, this evening\'s astronomical dusk: the Sun 18° under the horizon, going down', () => {
    // Greenwich in mid-January: sunset ~16:22, astronomical dusk ~18:10 UTC.
    const noon = Date.parse('2026-01-15T12:00:00Z')
    const t = tonightTime(51.4779, 0, noon, vsopSun)
    expect(t.kind).toBe('dusk')
    expect(Math.abs(t.ms - Date.parse('2026-01-15T18:10:00Z'))).toBeLessThan(15 * MIN)
    expect(sunAltitude(51.4779, 0, t.ms, vsopSun)).toBeCloseTo(ASTRONOMICAL_TWILIGHT_DEG, 2)
    expect(sunAltitude(51.4779, 0, t.ms + (10 * MIN), vsopSun)).toBeLessThan(ASTRONOMICAL_TWILIGHT_DEG)
  })

  it('in the evening twilight, its end that evening', () => {
    // Austin, 2026-10-13: sunset ~00:00 UTC (19:00 CDT); at 00:30 UTC the
    // Sun is a few degrees down, and astronomical dusk comes within the hour.
    const now = Date.parse('2026-10-14T00:30:00Z')
    expect(sunAltitude(30.27, -97.74, now, vsopSun)).toBeGreaterThan(ASTRONOMICAL_TWILIGHT_DEG)
    const t = tonightTime(30.27, -97.74, now, vsopSun)
    expect(t.kind).toBe('dusk')
    expect(t.ms - now).toBeGreaterThan(0)
    expect(t.ms - now).toBeLessThan(90 * MIN)
  })

  it('in the morning twilight, the next evening\'s dusk', () => {
    // Sydney, 2026-06-21 at 06:30 local (20:30 UTC the day before).
    const now = Date.parse('2026-06-20T20:30:00Z')
    const t = tonightTime(-33.87, 151.21, now, vsopSun)
    expect(t.kind).toBe('dusk')
    // That evening, ~18:20 local: about 12 hours on.
    expect((t.ms - now) / 3600000).toBeGreaterThan(10)
    expect((t.ms - now) / 3600000).toBeLessThan(14)
  })

  it('with no astronomical night (Reykjavík at midsummer), the darkest moment', () => {
    const noon = Date.parse('2026-06-21T13:00:00Z')
    const t = tonightTime(64.15, -21.94, noon, vsopSun)
    expect(t.kind).toBe('darkest')
    // Solar midnight there is ~01:30 UTC.
    const hours = new Date(t.ms).getUTCHours() + (new Date(t.ms).getUTCMinutes() / 60)
    expect(Math.abs(hours - 1.5)).toBeLessThan(0.75)
  })

  it('works on the stand-in before the ephemeris loads', () => {
    const noon = Date.parse('2026-01-15T12:00:00Z')
    const a = tonightTime(51.4779, 0, noon)
    const b = tonightTime(51.4779, 0, noon, vsopSun)
    expect(Math.abs(a.ms - b.ms)).toBeLessThan(MIN)
  })
})


describe('the visitor\'s location', () => {
  it('the browser\'s, when it gives it', async () => {
    const where = await resolveLocation({locate: () => Promise.resolve({lat: 30.27, lng: -97.74}), timeZone: 'Europe/Paris'})
    expect(where).toEqual({lat: 30.27, lng: -97.74, name: null, source: 'geolocation'})
  })

  it('else the time zone\'s city, with no network', async () => {
    const where = await resolveLocation({locate: () => Promise.reject(new Error('denied')), timeZone: 'Europe/Paris'})
    expect(where.source).toBe('timezone')
    expect(where.name).toBe('Paris')
    expect(where.lat).toBeCloseTo(48.86, 2)
  })

  it('else Greenwich', async () => {
    const where = await resolveLocation({locate: () => Promise.reject(new Error('denied')), timeZone: 'Mars/Olympus'})
    expect(where).toEqual({...DEFAULT_LOCATION, source: 'default'})
    const none = await resolveLocation({locate: () => Promise.resolve(null), timeZone: null})
    expect(none.source).toBe('default')
  })

  it('no geolocation in the browser is a refusal', async () => {
    let refused = false
    await browserLocation(undefined).catch(() => {
      refused = true
    })
    expect(refused).toBe(true)
  })

  it('the browser\'s location is asked for once, with a timeout', async () => {
    const asked = []
    const geolocation = {
      getCurrentPosition: (ok, _err, opts) => {
        asked.push(opts)
        ok({coords: {latitude: 1, longitude: 2}})
      },
    }
    expect(await browserLocation(geolocation)).toEqual({lat: 1, lng: 2})
    expect(asked.length).toBe(1)
    expect(asked[0].timeout).toBeGreaterThan(0)
  })

  it('every listed zone\'s city is on the globe', () => {
    for (const zone of ['America/New_York', 'Asia/Tokyo', 'Australia/Sydney']) {
      const at = timeZoneLocation(zone)
      expect(Math.abs(at.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(at.lng)).toBeLessThanOrEqual(180)
    }
    expect(timeZoneLocation(undefined)).toBe(null)
  })

  it('the readout says which was used', () => {
    const fmt = () => '18:10'
    expect(formatTonight({source: 'geolocation', name: null}, {kind: 'now', ms: 0}, fmt))
        .toBe('Tonight\'s sky from your location, now')
    expect(formatTonight({source: 'timezone', name: 'Paris'}, {kind: 'dusk', ms: 0}, fmt))
        .toBe('Tonight\'s sky from Paris (your time zone), at dusk, 18:10')
    expect(formatTonight({source: 'default', name: 'Greenwich'}, {kind: 'darkest', ms: 0}, fmt))
        .toBe('Tonight\'s sky from Greenwich (no location), at its darkest, 18:10')
  })
})
