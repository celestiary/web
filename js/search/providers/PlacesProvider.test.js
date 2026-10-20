import {afterEach, beforeEach, describe, expect, it} from 'bun:test'
import {_resetPlaces} from '../../scene/Places.js'
import {_resetPlacesIndex, loadPlacesIndex, parsePlacesIndex} from '../placesIndex.js'
import PlacesProvider from './PlacesProvider.js'


const MOON = [
  {n: 'Tycho', lat: -43.31, lng: -11.36, k: 'crater'},
  {n: 'Apollo 11', lat: 0.674, lng: 23.473, k: 'landing'},
]
const INDEX = {kinds: ['', 'crater', 'landing'], bodies: {
  moon: [['Tycho', -43.31, -11.36, 1], ['Apollo 11', 0.674, 23.473, 2]],
  mars: [['Olympus Mons', 18.65, -133.8, 0]],
}}

const realFetch = global.fetch


/**
 * Serve the index and the catalogues from canned data, counting the asks.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.index] Serve the index (else a 500)
 * @param {number} [opts.delayMs]
 * @returns {Array<string>} The URLs asked for
 */
function serve({index = true, delayMs = 0} = {}) {
  const asked = []
  global.fetch = (url) => {
    asked.push(String(url))
    let rsp = {ok: false, status: 404}
    if (String(url).endsWith('places-index.json')) {
      rsp = index ? {ok: true, json: () => Promise.resolve(INDEX)} : {ok: false, status: 500}
    } else if (String(url).endsWith('places/moon.json')) {
      rsp = {ok: true, json: () => Promise.resolve({places: MOON.map((p) => ({...p, t: 0}))})}
    }
    return new Promise((resolve) => setTimeout(() => resolve(rsp), delayMs))
  }
  return asked
}


describe('PlacesProvider.collectUnder', () => {
  const warn = console.warn
  let asked
  beforeEach(() => {
    _resetPlacesIndex()
    _resetPlaces()
    console.warn = () => {}
    asked = serve()
  })
  afterEach(() => {
    global.fetch = realFetch
    console.warn = warn
    _resetPlacesIndex()
    _resetPlaces()
  })

  it('returns SearchEntry shape with kind=place, from the index', async () => {
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
    expect(asked).toEqual(['data/places-index.json'])
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
    expect(asked).toEqual([])
  })

  it('caches per body — second call does not refetch', async () => {
    const p = new PlacesProvider()
    await p.collectUnder('milkyway/sun/earth/moon')
    await p.collectUnder('milkyway/sun/earth/moon')
    expect(asked).toHaveLength(1)
  })

  it('coalesces concurrent loads, of one body or several, into a single fetch', async () => {
    asked = serve({delayMs: 10})
    const p = new PlacesProvider()
    const [a, b] = await Promise.all([
      p.collectUnder('milkyway/sun/earth/moon'),
      p.collectUnder('milkyway/sun/earth/moon'),
      p.collectUnder('milkyway/sun/mars'),
      new PlacesProvider().collectUnder('milkyway/sun/earth/moon'),
    ])
    expect(asked).toEqual(['data/places-index.json'])
    expect(a.length).toBe(b.length)
  })

  it('reads a body\'s own catalogue when the index fails, and asks for the index again next time', async () => {
    asked = serve({index: false})
    const p = new PlacesProvider()
    const entries = await p.collectUnder('milkyway/sun/earth/moon')
    expect(entries.map((e) => e.displayName)).toEqual(['Tycho', 'Apollo 11'])
    expect(asked).toEqual(['data/places-index.json', 'data/places/moon.json'])
    asked = serve()
    expect(await new PlacesProvider().collectUnder('milkyway/sun/mars')).toHaveLength(1)
    expect(asked[0]).toBe('data/places-index.json')
  })

  it('degrades silently when neither is there, and asks again next time', async () => {
    asked = serve({index: false})
    const p = new PlacesProvider()
    expect(await p.collectUnder('milkyway/sun/earth/missing')).toEqual([])
    expect(await p.collectUnder('milkyway/sun/earth/missing')).toEqual([])
    expect(asked.filter((u) => u.endsWith('missing.json'))).toHaveLength(2)
  })

  it('exposes the place kind as an alias when provided', async () => {
    const p = new PlacesProvider()
    const entries = await p.collectUnder('milkyway/sun/earth/moon')
    const tycho = entries.find((e) => e.displayName === 'Tycho')
    expect(tycho.aliases).toEqual(['crater'])
  })
})


describe('the places\' index', () => {
  afterEach(() => _resetPlacesIndex())

  it('reads rows back into the catalogues\' places, kind and altitude where they have one', () => {
    const index = parsePlacesIndex({kinds: ['', 'city'], bodies: {earth: [['Quito', -0.18, -78.47, 1, 2850], ['X', 1, 2, 0]]}})
    expect(index.get('earth')).toEqual([{n: 'Quito', lat: -0.18, lng: -78.47, a: 2850, k: 'city'}, {n: 'X', lat: 1, lng: 2}])
    expect(() => parsePlacesIndex({})).toThrow()
  })

  it('is fetched once for concurrent asks, and again after a failure', async () => {
    let calls = 0
    let fail = true
    const fetchFn = () => {
      calls++
      return Promise.resolve(fail ? {ok: false, status: 503} : {ok: true, json: () => Promise.resolve(INDEX)})
    }
    const results = await Promise.allSettled([loadPlacesIndex(fetchFn), loadPlacesIndex(fetchFn)])
    expect(calls).toBe(1)
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    fail = false
    const [a, b] = await Promise.all([loadPlacesIndex(fetchFn), loadPlacesIndex(fetchFn)])
    expect(calls).toBe(2)
    expect(a).toBe(b)
    expect(a.get('moon')[0].n).toBe('Tycho')
  })
})
