import {describe, expect, it, beforeEach} from 'bun:test'
import PlacesProvider from './PlacesProvider.js'


// Stub global.fetch to feed PlacesProvider canned catalog data without hitting
// the network or the disk.  The provider calls fetchPlaces from Places.js,
// which goes through the real fetch().
function stubFetch(payload, ok = true) {
  global.fetch = () => Promise.resolve({
    ok,
    json: () => Promise.resolve(payload),
  })
}


describe('PlacesProvider.collectUnder', () => {
  beforeEach(() => {
    stubFetch({places: [
      {n: 'Tycho', t: 0, lat: -43.31, lng: -11.36, k: 'crater'},
      {n: 'Apollo 11', t: 0, lat: 0.674, lng: 23.473, k: 'landing'},
    ]})
  })

  it('returns SearchEntry shape with kind=place', async () => {
    const p = new PlacesProvider()
    const entries = await p.collectUnder('milkyway/sun/earth/moon')
    expect(entries.length).toBe(2)
    for (const e of entries) {
      expect(e.kind).toBe('place')
      expect(typeof e.id).toBe('string')
      expect(e.id.startsWith('loc:moon:')).toBe(true)
      expect(typeof e.displayName).toBe('string')
      expect(e.payload.body).toBe('moon')
      expect(typeof e.payload.lat).toBe('number')
      expect(typeof e.payload.lng).toBe('number')
    }
  })

  it('builds the path under the given anchor', async () => {
    const p = new PlacesProvider()
    const entries = await p.collectUnder('milkyway/sun/earth/moon')
    expect(entries.find((e) => e.displayName === 'Tycho').path)
        .toBe('milkyway/sun/earth/moon/tycho')
    expect(entries.find((e) => e.displayName === 'Apollo 11').path)
        .toBe('milkyway/sun/earth/moon/apollo-11')
  })

  it('returns [] for milkyway anchor (places are body-scoped)', async () => {
    const p = new PlacesProvider()
    expect(await p.collectUnder('milkyway')).toEqual([])
    expect(await p.collectUnder('')).toEqual([])
  })

  it('caches per body — second call does not refetch', async () => {
    const p = new PlacesProvider()
    let fetchCount = 0
    global.fetch = () => {
      fetchCount++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({places: [{n: 'A', lat: 0, lng: 0}]}),
      })
    }
    await p.collectUnder('milkyway/sun/earth/moon')
    await p.collectUnder('milkyway/sun/earth/moon')
    expect(fetchCount).toBe(1)
  })

  it('coalesces concurrent loads into a single fetch', async () => {
    const p = new PlacesProvider()
    let fetchCount = 0
    global.fetch = () => {
      fetchCount++
      return new Promise((resolve) => setTimeout(() => resolve({
        ok: true,
        json: () => Promise.resolve({places: [{n: 'A', lat: 0, lng: 0}]}),
      }), 10))
    }
    const [a, b] = await Promise.all([
      p.collectUnder('milkyway/sun/earth/moon'),
      p.collectUnder('milkyway/sun/earth/moon'),
    ])
    expect(fetchCount).toBe(1)
    expect(a.length).toBe(b.length)
  })

  it('degrades silently on 404', async () => {
    stubFetch({}, false)
    const p = new PlacesProvider()
    expect(await p.collectUnder('milkyway/sun/earth/missing')).toEqual([])
  })

  it('exposes the place kind as an alias when provided', async () => {
    const p = new PlacesProvider()
    const entries = await p.collectUnder('milkyway/sun/earth/moon')
    const tycho = entries.find((e) => e.displayName === 'Tycho')
    expect(tycho.aliases).toEqual(['crater'])
  })
})
