import {afterEach, beforeEach, describe, expect, it} from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import {descriptorUrl, placesUrl} from '../bodyBundle.js'
import {_resetPlaces} from '../scene/Places.js'
import {_resetPlacesIndex} from './placesIndex.js'
import PlacesProvider from './providers/PlacesProvider.js'
import SceneProvider from './providers/SceneProvider.js'
import SearchIndex from './SearchIndex.js'
import * as SearchRegistry from './SearchRegistry.js'


// Places are searchable from every scope that contains their body (#177,
// where "austin" with Earth in the breadcrumb found nothing).  This runs the
// real providers over the real descriptors and the places' index in
// public/data (built from the catalogues: tools/places/index.mjs), with only
// the network cut out.
const DATA = path.join(import.meta.dir, '..', '..', 'public', 'data')
const BODIES = ['milkyway', 'sun', 'mercury', 'venus', 'earth', 'moon', 'mars']


const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'))


/** @returns {object} A Loader's `loaded`, as the app has it after expanding the tree */
function loadedTree() {
  const loaded = {}
  for (const name of BODIES) {
    loaded[name] = readJson(descriptorUrl(name).slice('data/'.length))
  }
  return loaded
}


const realFetch = global.fetch
let fetched


describe('place search by scope', () => {
  let index
  beforeEach(() => {
    SearchRegistry._reset()
    _resetPlacesIndex()
    _resetPlaces()
    fetched = []
    global.fetch = (url) => {
      fetched.push(url)
      const m = String(url).match(/^data\/([\w/-]+)\.json$/)
      if (!m) {
        return Promise.resolve({ok: false})
      }
      return Promise.resolve({ok: true, json: () => Promise.resolve(readJson(`${m[1]}.json`))})
    }
    const loader = {loaded: loadedTree(), loadObj: () => {}}
    index = new SearchIndex()
    index.register(new SceneProvider(loader))
    index.register(new PlacesProvider(loader))
  })

  afterEach(() => {
    global.fetch = realFetch
    SearchRegistry._reset()
    _resetPlacesIndex()
    _resetPlaces()
  })

  const find = async (text, anchor) => {
    await index.ensureScope(anchor)
    return index.query(text, anchor).map((r) => r.entry)
  }

  it('finds Austin under Earth', async () => {
    const results = await find('austin', 'milkyway/sun/earth')
    expect(results[0].displayName).toBe('Austin')
    expect(results[0].kind).toBe('place')
    expect(results[0].path).toBe('milkyway/sun/earth/austin')
    expect(results[0].payload).toEqual({body: 'earth', lat: 30.2672, lng: -97.7431, alt: undefined})
  })

  it('finds Tycho under the Moon', async () => {
    const results = await find('tycho', 'milkyway/sun/earth/moon')
    expect(results[0].displayName).toBe('Tycho')
    expect(results[0].payload.body).toBe('moon')
  })

  it('finds a place from the solar system scope, which the breadcrumb Sun > Earth searches (the icon before Earth)', async () => {
    const results = await find('austin', 'milkyway/sun')
    expect(results.map((r) => r.displayName)).toContain('Austin')
  })

  it('finds a place from the root, ranked below the bodies and stars that match as well', async () => {
    const results = await find('mars', 'milkyway')
    expect(results[0].id).toBe('mars')
    expect((await find('tycho', 'milkyway')).map((r) => r.displayName)).toContain('Tycho')
    expect((await find('apollo 11', 'milkyway')).map((r) => r.payload.body)).toContain('moon')
  })

  it('only offers the places inside the scope', async () => {
    // (Mars has a Tycho Brahe, so a name only the Moon has.)
    expect((await find('tranquillitatis', 'milkyway/sun/mars')).some((r) => r.kind === 'place')).toBe(false)
    // The Moon is inside Earth's scope, so its places are too.
    expect((await find('tranquillitatis', 'milkyway/sun/earth')).some((r) => r.kind === 'place')).toBe(true)
    expect((await find('austin', 'milkyway/sun/earth/moon')).some((r) => r.displayName === 'Austin')).toBe(false)
    expect((await find('austin', 'milkyway/sun/mars')).some((r) => r.displayName === 'Austin')).toBe(false)
  })

  it('fetches the places\' index once, for every scope, and no catalogue', async () => {
    await index.ensureScope('milkyway/sun/earth/moon')
    expect(fetched).toEqual(['data/places-index.json'])
    await index.ensureScope('milkyway/sun/earth/moon')
    expect(await index.ensureScope('milkyway/sun/earth')).toBe(1)
    expect(await index.ensureScope('milkyway')).toBe(3)
    expect(fetched).toEqual(['data/places-index.json'])
  })

  it('says how many catalogues were loaded, so the caller can query again', async () => {
    expect(await index.ensureScope('milkyway')).toBe(5)
    expect(await index.ensureScope('milkyway')).toBe(0)
  })

  // Every tier 0 place and one in 40 of the rest: a query takes tens of ms, and
  // the Gazetteer's catalogues are 8,000 places (all of them took two minutes).
  it('matches the places of every catalogue by their own names', async () => {
    await index.ensureScope('milkyway')
    for (const body of ['earth', 'moon', 'mars', 'mercury', 'venus']) {
      for (const [i, e] of readJson(placesUrl(body).slice('data/'.length)).places.entries()) {
        if ((e.t ?? 0) > 0 && i % 40 !== 0) {
          continue
        }
        const hits = index.query(e.n, `milkyway/sun/${body === 'moon' ? 'earth/moon' : body}`, 20)
        expect(hits.some((h) => h.entry.kind === 'place' && h.entry.displayName === e.n)).toBe(true)
      }
    }
  }, 30000) // 4-6 s alone: at bun's 5 s limit
})
