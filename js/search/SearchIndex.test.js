import {afterEach, describe, expect, it} from 'bun:test'
import SearchIndex, {inScope} from './SearchIndex.js'
import * as SearchRegistry from './SearchRegistry.js'


// Minimal stub providers so tests are fast and catalog-independent.

class StubSceneProvider {
  constructor(entries) {
    this.id = 'scene'
    this.lazy = false
    this._entries = entries
  }
  collectAll() {
    return this._entries
  }
}


class StubStarsProvider {
  constructor(entries, hipResolver) {
    this.id = 'stars'
    this.lazy = false
    this._entries = entries
    this._hipResolver = hipResolver
  }
  collectAll() {
    return this._entries
  }
  resolveHip(hipId) {
    return this._hipResolver(hipId)
  }
}


const EARTH = {
  id: 'earth', displayName: 'Earth', aliases: ['terra', 'gaia'],
  kind: 'planet', path: 'milkyway/sun/earth', parent: 'sun', payload: {name: 'earth'},
}
const MOON = {
  id: 'moon', displayName: 'Moon', aliases: ['luna'],
  kind: 'moon', path: 'milkyway/sun/earth/moon', parent: 'earth', payload: {name: 'moon'},
}
const MARS = {
  id: 'mars', displayName: 'Mars', aliases: [],
  kind: 'planet', path: 'milkyway/sun/mars', parent: 'sun', payload: {name: 'mars'},
}
const SUN = {
  id: 'sun', displayName: 'Sun', aliases: ['sol'],
  kind: 'star', path: 'milkyway/sun', parent: 'milkyway', payload: {name: 'sun'},
}
const RIGEL = {
  id: 'hip:24436', displayName: 'Rigel', aliases: ['BET Ori', 'HIP 24436', '24436'],
  kind: 'star', path: 'milkyway/hip:24436', parent: 'milkyway', payload: {hipId: 24436},
}
const SIRIUS = {
  id: 'hip:32349', displayName: 'Sirius', aliases: ['ALF CMa', 'HIP 32349', '32349'],
  kind: 'star', path: 'milkyway/hip:32349', parent: 'milkyway', payload: {hipId: 32349},
}


function buildIndex() {
  SearchRegistry._reset()
  const idx = new SearchIndex()
  const scene = new StubSceneProvider([SUN, EARTH, MOON, MARS])
  const stars = new StubStarsProvider([RIGEL, SIRIUS], (hipId) => {
    if (hipId === 24436) {
      return RIGEL
    }
    if (hipId === 32349) {
      return SIRIUS
    }
    if (hipId === 99999) {
      return {
        id: 'hip:99999', displayName: 'HIP 99999', aliases: ['HIP 99999', '99999'],
        kind: 'star', path: 'milkyway/hip:99999', parent: 'milkyway', payload: {hipId: 99999},
      }
    }
    return null
  })
  idx.register(scene)
  idx.register(stars)
  return idx
}


describe('inScope', () => {
  it('milkyway anchor matches everything', () => {
    expect(inScope('milkyway/sun/earth', 'milkyway')).toBe(true)
    expect(inScope('milkyway/hip:32349', 'milkyway')).toBe(true)
  })

  it('sun anchor matches solar system but not peer stars', () => {
    expect(inScope('milkyway/sun/earth', 'milkyway/sun')).toBe(true)
    expect(inScope('milkyway/sun', 'milkyway/sun')).toBe(true)
    expect(inScope('milkyway/hip:32349', 'milkyway/sun')).toBe(false)
  })

  it('earth anchor matches earth + moon but not mars', () => {
    expect(inScope('milkyway/sun/earth/moon', 'milkyway/sun/earth')).toBe(true)
    expect(inScope('milkyway/sun/mars', 'milkyway/sun/earth')).toBe(false)
  })

  it('substring prefix collision is rejected (sun vs sunflower)', () => {
    expect(inScope('milkyway/sunflower', 'milkyway/sun')).toBe(false)
  })
})


describe('SearchIndex basic query', () => {
  afterEach(() => SearchRegistry._reset())

  it('matches exact case ("earth") and mixed case ("Earth")', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    const r1 = idx.query('earth')
    const r2 = idx.query('Earth')
    expect(r1[0].entry.id).toBe('earth')
    expect(r2[0].entry.id).toBe('earth')
  })

  it('matches one-typo approximation ("earrth")', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    const r = idx.query('earrth')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].entry.id).toBe('earth')
  })

  it('matches alias "luna" → Moon', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    const r = idx.query('luna')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].entry.id).toBe('moon')
  })

  it('matches canonical name "moon" → Moon', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    const r = idx.query('moon')
    expect(r[0].entry.id).toBe('moon')
  })

  it('matches star by proper name ("rigel", "Sirius")', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.query('rigel')[0].entry.id).toBe('hip:24436')
    expect(idx.query('Sirius')[0].entry.id).toBe('hip:32349')
  })

  it('empty query returns no results', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.query('').length).toBe(0)
    expect(idx.query('   ').length).toBe(0)
  })
})


describe('SearchIndex HIP exact path', () => {
  afterEach(() => SearchRegistry._reset())

  it('"HIP 32349" resolves to Sirius', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    const r = idx.query('HIP 32349')
    expect(r.length).toBe(1)
    expect(r[0].entry.id).toBe('hip:32349')
    expect(r[0].score).toBe(0)
  })

  it('"hip32349" is tolerated (no space)', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    const r = idx.query('hip32349')
    expect(r[0].entry.id).toBe('hip:32349')
  })

  it('bare "32349" resolves to Sirius', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    const r = idx.query('32349')
    expect(r[0].entry.id).toBe('hip:32349')
  })

  it('resolves unnamed HIP stars via exact path even when not in Tier A', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    const r = idx.query('HIP 99999')
    expect(r[0].entry.id).toBe('hip:99999')
  })

  it('unknown HIP returns empty', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.query('HIP 7777777').length).toBe(0)
  })
})


describe('SearchIndex anchor scoping', () => {
  afterEach(() => SearchRegistry._reset())

  it('earth anchor narrows to earth subtree ("moon" matches, "mars" does not)', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.query('moon', 'milkyway/sun/earth')[0].entry.id).toBe('moon')
    expect(idx.query('mars', 'milkyway/sun/earth').length).toBe(0)
  })

  it('sun anchor excludes peer stars', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.query('rigel', 'milkyway/sun').length).toBe(0)
    expect(idx.query('Sirius', 'milkyway/sun').length).toBe(0)
  })

  it('milkyway anchor (default) sees everything', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.query('rigel')[0].entry.id).toBe('hip:24436')
    expect(idx.query('earth')[0].entry.id).toBe('earth')
  })

  it('HIP exact path respects anchor scope', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.query('HIP 32349', 'milkyway/sun').length).toBe(0)
  })
})


describe('SearchIndex resolveByName', () => {
  afterEach(() => SearchRegistry._reset())

  it('resolves displayName', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.resolveByName('Earth').id).toBe('earth')
  })

  it('resolves alias', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.resolveByName('luna').id).toBe('moon')
  })

  it('respects anchor scope', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.resolveByName('Rigel', 'milkyway/sun')).toBeNull()
  })

  it('returns null for unknown', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    expect(idx.resolveByName('zzzz')).toBeNull()
  })
})


describe('SearchIndex dedupe', () => {
  afterEach(() => SearchRegistry._reset())

  it('registering the same provider id twice does not double-index', async () => {
    const idx = new SearchIndex()
    idx.register(new StubSceneProvider([EARTH]))
    idx.register(new StubSceneProvider([EARTH])) // same id='scene' replaces
    await idx.ensureReady()
    const r = idx.query('earth')
    expect(r.length).toBe(1)
  })
})
