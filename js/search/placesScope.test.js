import {afterEach, beforeEach, describe, expect, it} from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import PlacesProvider from './providers/PlacesProvider.js'
import SceneProvider from './providers/SceneProvider.js'
import SearchIndex from './SearchIndex.js'
import * as SearchRegistry from './SearchRegistry.js'


// Places are searchable from every scope that contains their body (#177,
// where "austin" with Earth in the breadcrumb found nothing).  This runs the
// real providers over the real descriptors and place catalogs in
// public/data, with only the network cut out.
const DATA = path.join(import.meta.dir, '..', '..', 'public', 'data')
const BODIES = ['milkyway', 'sun', 'mercury', 'venus', 'earth', 'moon', 'mars']


const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'))


/** @returns {object} A Loader's `loaded`, as the app has it after expanding the tree */
function loadedTree() {
  const loaded = {}
  for (const name of BODIES) {
    loaded[name] = readJson(`${name}.json`)
  }
  return loaded
}


const realFetch = global.fetch
let fetched


describe('place search by scope', () => {
  let index
  beforeEach(() => {
    SearchRegistry._reset()
    fetched = []
    global.fetch = (url) => {
      fetched.push(url)
      const m = String(url).match(/^data\/places\/(\w+)\.json$/)
      if (!m) {
        return Promise.resolve({ok: false})
      }
      return Promise.resolve({ok: true, json: () => Promise.resolve(readJson(`places/${m[1]}.json`))})
    }
    const loader = {loaded: loadedTree(), loadObj: () => {}}
    index = new SearchIndex()
    index.register(new SceneProvider(loader))
    index.register(new PlacesProvider(loader))
  })

  afterEach(() => {
    global.fetch = realFetch
    SearchRegistry._reset()
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
    expect((await find('tycho', 'milkyway/sun/mars')).some((r) => r.kind === 'place')).toBe(false)
    // The Moon is inside Earth's scope, so its places are too.
    expect((await find('tycho', 'milkyway/sun/earth')).some((r) => r.kind === 'place')).toBe(true)
    expect((await find('austin', 'milkyway/sun/earth/moon')).some((r) => r.displayName === 'Austin')).toBe(false)
    expect((await find('austin', 'milkyway/sun/mars')).some((r) => r.displayName === 'Austin')).toBe(false)
  })

  it('fetches only the catalogues of the bodies in scope, once', async () => {
    await index.ensureScope('milkyway/sun/earth/moon')
    expect(fetched).toEqual(['data/places/moon.json'])
    await index.ensureScope('milkyway/sun/earth/moon')
    expect(fetched.length).toBe(1)
    expect(await index.ensureScope('milkyway/sun/earth')).toBe(1)
    expect(fetched).toEqual(['data/places/moon.json', 'data/places/earth.json'])
  })

  it('says how many catalogues were loaded, so the caller can query again', async () => {
    expect(await index.ensureScope('milkyway')).toBe(5)
    expect(await index.ensureScope('milkyway')).toBe(0)
  })

  it('matches every place in every catalogue by its own name', async () => {
    await index.ensureScope('milkyway')
    for (const body of ['earth', 'moon', 'mars', 'mercury', 'venus']) {
      for (const e of readJson(`places/${body}.json`).places) {
        const hits = index.query(e.n, `milkyway/sun/${body === 'moon' ? 'earth/moon' : body}`, 20)
        expect(hits.some((h) => h.entry.kind === 'place' && h.entry.displayName === e.n)).toBe(true)
      }
    }
  })
})
