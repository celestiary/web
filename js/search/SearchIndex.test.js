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


// The homepage's search is open from the page's start, before the loader has
// the bodies and before the stars' and galaxies' catalogues register: it was
// built then, nearly empty, and every register after left it unready for
// good, so every query answered nothing (#242).
describe('SearchIndex built before its data is in', () => {
  afterEach(() => SearchRegistry._reset())

  /**
   * @param {object} idx
   * @returns {Promise<number>} The version of the next build to land
   */
  function nextBuild(idx) {
    return new Promise((resolve) => {
      const stop = idx.onChange((version) => {
        stop()
        resolve(version)
      })
    })
  }

  it('a query while stale builds again, answers from the last build meanwhile, and says when it lands', async () => {
    SearchRegistry._reset()
    const idx = new SearchIndex()
    const bodies = [SUN]
    idx.register(new StubSceneProvider(bodies))
    // Opened at once: built from what the loader has, the Sun alone.
    await idx.ensureReady()
    expect(idx.query('earth')).toEqual([])
    // The bodies arrive (Celestiary.onLoad), then the stars register.
    bodies.push(EARTH, MOON)
    idx.markStale()
    idx.register(new StubStarsProvider([SIRIUS], () => null))
    expect(idx.ready).toBe(false)
    const landed = nextBuild(idx)
    // Asked while stale: the last build's answer, and a build started.
    expect(idx.query('sun').map((r) => r.entry.id)).toEqual(['sun'])
    const version = await landed
    expect(version).toBe(idx.version)
    expect(idx.ready).toBe(true)
    expect(idx.query('earth')[0].entry.id).toBe('earth')
    expect(idx.query('sirius')[0].entry.id).toBe('hip:32349')
  })

  it('invalidate keeps answering from the last build until the next lands', async () => {
    const idx = buildIndex()
    await idx.ensureReady()
    idx.invalidate()
    expect(idx.query('mars')[0].entry.id).toBe('mars')
    await idx.ensureReady()
    expect(idx.query('mars')[0].entry.id).toBe('mars')
  })

  it('a build that went stale while it ran is built again before ensureReady resolves', async () => {
    SearchRegistry._reset()
    const idx = new SearchIndex()
    const bodies = [SUN]
    let builds = 0
    const provider = new StubSceneProvider(bodies)
    provider.collectAll = () => {
      builds++
      if (builds === 1) {
        // A body loads while the first build runs.
        bodies.push(EARTH)
        idx.markStale()
      }
      return [...bodies]
    }
    idx.register(provider)
    await idx.ensureReady()
    expect(builds).toBe(2)
    expect(idx.ready).toBe(true)
    expect(idx.query('earth')[0].entry.id).toBe('earth')
  })
})


// #258: a catalogue whose provider registers when it arrives (the galaxies)
// is fetched for the first search, not with the page.
describe('SearchIndex.loadOnSearch', () => {
  afterEach(() => SearchRegistry._reset())

  /**
   * @param {SearchIndex} idx
   * @param {object} [opts]
   * @param {boolean} [opts.fail] The load rejects
   * @returns {{calls: number}} A source that registers a provider of NGC 2403 when it loads
   */
  function galaxiesSource(idx, {fail = false} = {}) {
    const state = {calls: 0, fail}
    idx.loadOnSearch(async () => {
      state.calls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (state.fail) {
        throw new Error('offline')
      }
      idx.register(new StubSceneProvider([{id: 'ngc2403', displayName: 'NGC 2403', aliases: [], kind: 'galaxy',
        path: 'milkyway/galaxy:ngc2403', parent: null, payload: {}}]))
    })
    return state
  }

  it('loads nothing until there\'s a query with text in it, then once', async () => {
    const idx = new SearchIndex()
    idx.register(new StubSceneProvider([SUN, EARTH]))
    const source = galaxiesSource(idx)
    await idx.ensureReady()
    idx.query('')
    idx.query('   ')
    expect(source.calls).toBe(0)
    const changed = new Promise((resolve) => idx.onChange(resolve))
    expect(idx.query('ngc 2403')).toEqual([])
    idx.query('ngc 240')
    await Promise.resolve()
    expect(source.calls).toBe(1)
    await changed
    await idx.ensureReady()
    expect(idx.query('ngc 2403')[0].entry.id).toBe('ngc2403')
    expect(source.calls).toBe(1)
  })

  it('ensureSearchable has it in before a query answered once (the homepage\'s Enter)', async () => {
    const idx = new SearchIndex()
    idx.register(new StubSceneProvider([SUN]))
    const source = galaxiesSource(idx)
    await idx.ensureSearchable('milkyway')
    expect(source.calls).toBe(1)
    expect(idx.query('ngc 2403', 'milkyway', 1)[0].entry.id).toBe('ngc2403')
  })

  it('starts a load that failed again at the next search', async () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      const idx = new SearchIndex()
      idx.register(new StubSceneProvider([SUN]))
      const source = galaxiesSource(idx, {fail: true})
      await idx.ensureSearchable()
      expect(source.calls).toBe(1)
      source.fail = false
      await idx.ensureSearchable()
      expect(source.calls).toBe(2)
      await idx.ensureSearchable()
      expect(source.calls).toBe(2)
      expect(idx.query('ngc 2403')[0].entry.id).toBe('ngc2403')
    } finally {
      console.warn = warn
    }
  })

  it('a source added after the first search starts at once', async () => {
    const idx = new SearchIndex()
    idx.query('x')
    const source = galaxiesSource(idx)
    await Promise.resolve()
    expect(source.calls).toBe(1)
  })
})


describe('SearchIndex, providers that search themselves (Tier P)', () => {
  afterEach(() => SearchRegistry._reset())

  /** A population round Earth: its own search, under Earth's path. */
  const population = {
    id: 'population:earth',
    lazy: false,
    scopePath: 'milkyway/sun/earth',
    collectAll: () => [],
    search: (text) => (text.toLowerCase().startsWith('star') ? [
      {entry: {id: 'sat:1', displayName: 'STARLINK-1008', aliases: [], kind: 'satellite',
        path: 'milkyway/sun/earth/sat:1'}, score: 0.05},
    ] : []),
  }

  it('merges its results by score from any scope that includes its body', async () => {
    const idx = buildIndex()
    idx.register(population)
    await idx.ensureReady()
    expect(idx.query('starl', 'milkyway/sun/earth').map((r) => r.entry.id)).toEqual(['sat:1'])
    // From the root, ranked as a place from a wider scope is.
    const wide = idx.query('starl', 'milkyway')
    expect(wide.find((r) => r.entry.id === 'sat:1').score).toBeCloseTo(0.15, 6)
    expect(idx.query('starl', 'milkyway/sun/mars')).toEqual([])
  })

  it('answers before Tier A is built, and with a number too', () => {
    const idx = buildIndex()
    idx.register({...population, search: () => [{entry: {id: 'sat:25544', path: 'milkyway/sun/earth/sat:25544'},
      score: 0}]})
    expect(idx.query('25544', 'milkyway/sun/earth').map((r) => r.entry.id)).toEqual(['sat:25544'])
  })
})
