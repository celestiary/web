import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {
  CAPTION_MAX_CHARS, CHANGELOG_URL, HOLD_MAX_MS, HOLD_MIN_MS, LAST_SEEN_KEY, SHOW_ALL_KEY, checkNew, decodeNewsToken,
  encodeNewsToken, formatEntryDate, freshIds, holdMs, loadChangelog, localStorageOrNull, markSeen, parseChangelog,
  readLastSeen, readShowAll, stampEntries, tourCaption, tourStops, unseenCount, visibleEntries, writeLastSeen,
  writeShowAll,
} from './changelog.js'
import {decodePermalink} from './permalink.js'


const FILE = JSON.parse(readFileSync(new URL('../public/data/changelog.json', import.meta.url), 'utf8'))

const LINK = '#sun/earth@-38.1501,-99.3434,12.104919Mm;t=9781.4376jd;cq=0.1302,-0.0725,0.0095,0.9888;fov=45deg'

/**
 * @param {string} date
 * @param {string} headline
 * @param {object} [extra]
 * @returns {object} An entry as changelog.json has it
 */
function entry(date, headline, extra = {}) {
  return {id: `${date}-${headline.toLowerCase().replace(/\W+/g, '-')}`, date, headline, text: 'Text.', links: [],
    epic: null, permalink: null, image: null, ...extra}
}

/** @returns {object} A storage that works, like localStorage */
function memoryStorage(initial = {}) {
  const data = {...initial}
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    removeItem: (k) => {
      delete data[k]
    },
  }
}

/** @returns {object} A storage that throws on every access, as a private window's can */
function throwingStorage() {
  const boom = () => {
    throw new Error('SecurityError')
  }
  return {getItem: boom, setItem: boom, removeItem: boom}
}


describe('the changelog JSON in the app', () => {
  it('parses the real file: every entry, newest first, fragments without the #', () => {
    const entries = parseChangelog(FILE)
    expect(entries.length).toBe(FILE.entries.length)
    expect(entries.length).toBeGreaterThan(50)
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].date >= entries[i].date).toBe(true)
    }
    const flyable = entries.filter((e) => e.permalink)
    expect(flyable.length).toBe(FILE.entries.filter((e) => e.permalink).length)
    expect(flyable.length).toBeGreaterThan(20)
    for (const e of flyable) {
      expect(e.permalink.startsWith('#')).toBe(false)
      // Every view in it decodes, or is a path alone (the app opens either).
      if (e.permalink.includes('@')) {
        expect(decodePermalink(e.permalink)).not.toBe(null)
      }
    }
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length)
  })

  it('drops what it can\'t show: no headline, no date, a link that isn\'t http', () => {
    const entries = parseChangelog({entries: [
      {date: '2026-10-13', headline: 'Fine', text: 'T', links: [
        {kind: 'pr', number: 1, url: 'https://github.com/celestiary/web/pull/1'},
        {kind: 'pr', number: 2, url: 'javascript:alert(1)'},
        {kind: 'pr', url: 'https://x.test/'},
      ], epic: {number: 3, title: 'E', url: 'javascript:alert(2)'}, permalink: '#', image: {src: ''}},
      {date: '2026-10-13', text: 'No headline'},
      {date: 'last week', headline: 'No date'},
      null,
      'nonsense',
    ]})
    expect(entries.length).toBe(1)
    expect(entries[0].links).toEqual([{kind: 'pr', number: 1, url: 'https://github.com/celestiary/web/pull/1'}])
    expect(entries[0].epic).toBe(null)
    // A bare '#' is no view.
    expect(entries[0].permalink).toBe(null)
    expect(entries[0].image).toBe(null)
  })

  it('a file that isn\'t a changelog is no entries, not an error', () => {
    expect(parseChangelog(null)).toEqual([])
    expect(parseChangelog({})).toEqual([])
    expect(parseChangelog({entries: 'x'})).toEqual([])
  })

  it('sorts newest first and keeps a day\'s entries in the file\'s order', () => {
    const entries = parseChangelog({entries: [
      entry('2026-10-10', 'old'), entry('2026-10-12', 'b1'), entry('2026-10-12', 'b2'), entry('2026-10-11', 'mid'),
    ]})
    expect(entries.map((e) => e.headline)).toEqual(['b1', 'b2', 'mid', 'old'])
  })

  it('loads from data/changelog.json, a relative URL, and rejects a bad response', async () => {
    const seen = []
    const ok = (url) => {
      seen.push(url)
      return Promise.resolve({ok: true, json: () => Promise.resolve(FILE)})
    }
    expect((await loadChangelog(ok)).length).toBe(FILE.entries.length)
    expect(seen).toEqual([CHANGELOG_URL])
    expect(CHANGELOG_URL.startsWith('/')).toBe(false)
    expect(CHANGELOG_URL.startsWith('data/')).toBe(true)
    await expect(loadChangelog(() => Promise.resolve({ok: false, status: 404}))).rejects.toThrow('404')
    await expect(loadChangelog(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline')
    await expect(loadChangelog(() => Promise.resolve({ok: true, json: () => Promise.reject(new Error('bad json'))})))
        .rejects.toThrow('bad json')
  })
})


// The marker from the stamp the app carries (#258): the same answers as
// from the changelog, without fetching it.
describe('the changelog\'s stamp', () => {
  const parsed = parseChangelog(FILE)

  it('has the changelog\'s dates, as many of each as it has entries', () => {
    expect(stampEntries().map((e) => e.date)).toEqual(parsed.map((e) => e.date))
  })

  it('gives the marker the changelog would, on a first visit and after', () => {
    for (const since of [null, '2026-10-01', '2026-10-13', '2030-01-01']) {
      const a = memoryStorage(since ? {[LAST_SEEN_KEY]: since} : {})
      const b = memoryStorage(since ? {[LAST_SEEN_KEY]: since} : {})
      const fromStamp = checkNew(stampEntries(), a)
      const fromFile = checkNew(parsed, b)
      expect(fromStamp.since).toBe(fromFile.since)
      expect(fromStamp.fresh.length).toBe(fromFile.fresh.length)
      expect(a.data).toEqual(b.data)
      expect(freshIds(parsed, fromStamp.since)).toEqual(new Set(fromFile.fresh.map((e) => e.id)))
      expect(markSeen(stampEntries(), a)).toBe(markSeen(parsed, b))
      expect(a.data).toEqual(b.data)
    }
  })

  it('reads a bad stamp as none, and storage that throws as nothing new', () => {
    expect(stampEntries({})).toEqual([])
    expect(stampEntries({dates: [['soon', 2], ['2026-10-01', 'x'], ['2026-10-02', 2]]})).toEqual(
        [{date: '2026-10-02'}, {date: '2026-10-02'}])
    expect(checkNew(stampEntries(), throwingStorage())).toEqual({since: null, fresh: []})
    expect(freshIds(parsed, null)).toEqual(new Set())
  })
})


describe('"new since your last visit"', () => {
  const entries = [entry('2026-10-13', 'c'), entry('2026-10-12', 'b'), entry('2026-10-11', 'a')]

  it('the first visit is a baseline: nothing is new, and the newest date is stored', () => {
    const storage = memoryStorage()
    expect(checkNew(entries, storage)).toEqual({since: null, fresh: []})
    expect(storage.data[LAST_SEEN_KEY]).toBe('2026-10-13')
  })

  it('later, the entries after the date last seen are new', () => {
    const storage = memoryStorage({[LAST_SEEN_KEY]: '2026-10-11'})
    const {since, fresh} = checkNew(entries, storage)
    expect(since).toBe('2026-10-11')
    expect(fresh.map((e) => e.headline)).toEqual(['c', 'b'])
    // Checking doesn't clear it: seeing the entries does.
    expect(storage.data[LAST_SEEN_KEY]).toBe('2026-10-11')
    expect(checkNew(entries, storage).fresh.length).toBe(2)
    expect(markSeen(entries, storage)).toBe(true)
    expect(storage.data[LAST_SEEN_KEY]).toBe('2026-10-13')
    expect(checkNew(entries, storage).fresh).toEqual([])
  })

  it('a day\'s date is the grain: an entry on the day last seen is not new', () => {
    const storage = memoryStorage({[LAST_SEEN_KEY]: '2026-10-13'})
    expect(checkNew(entries, storage).fresh).toEqual([])
  })

  it('a bad stored value is a first visit', () => {
    const storage = memoryStorage({[LAST_SEEN_KEY]: 'yesterday'})
    expect(readLastSeen(storage)).toBe(null)
    expect(checkNew(entries, storage)).toEqual({since: null, fresh: []})
    expect(storage.data[LAST_SEEN_KEY]).toBe('2026-10-13')
  })

  it('a stored date ahead of every entry is nothing new', () => {
    const storage = memoryStorage({[LAST_SEEN_KEY]: '2030-01-01'})
    expect(checkNew(entries, storage).fresh).toEqual([])
  })

  it('with storage that throws on every access, nothing is new and nothing breaks', () => {
    const storage = throwingStorage()
    expect(readLastSeen(storage)).toBe(null)
    expect(writeLastSeen('2026-10-13', storage)).toBe(false)
    expect(checkNew(entries, storage)).toEqual({since: null, fresh: []})
    expect(markSeen(entries, storage)).toBe(false)
  })

  it('with no storage at all, or an accessor that throws, the same', () => {
    expect(checkNew(entries, null)).toEqual({since: null, fresh: []})
    expect(markSeen(entries, null)).toBe(false)
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get: () => {
      throw new Error('SecurityError')
    }})
    try {
      expect(localStorageOrNull()).toBe(null)
      // The default storage is that one.
      expect(checkNew(entries)).toEqual({since: null, fresh: []})
      expect(readLastSeen()).toBe(null)
      expect(writeLastSeen('2026-10-13')).toBe(false)
    } finally {
      if (saved) {
        Object.defineProperty(globalThis, 'localStorage', saved)
      } else {
        delete globalThis.localStorage
      }
    }
  })

  it('no entries, nothing to mark', () => {
    const storage = memoryStorage()
    expect(checkNew([], storage)).toEqual({since: null, fresh: []})
    expect(markSeen([], storage)).toBe(false)
    expect(storage.data).toEqual({})
  })
})


describe('featured entries and the posts about them', () => {
  const X = 'https://x.com/celestiary_org/status/1'
  const FB = 'https://www.facebook.com/celestiary/posts/1'

  it('are read from the JSON: featured only when it says true; post URLs kept only on X and Facebook, https', () => {
    const [a, b, c, d] = parseChangelog({entries: [
      entry('2026-10-04', 'a', {featured: true, social: {x: X, facebook: FB}}),
      entry('2026-10-03', 'b', {featured: 'yes', social: {x: 'http://x.com/a/status/1', facebook: 'https://evil.example/p'}}),
      entry('2026-10-02', 'c', {featured: true, social: {x: 'javascript:alert(1)'}}),
      entry('2026-10-01', 'd'),
    ]})
    expect(a.featured).toBe(true)
    expect(a.social).toEqual({x: X, facebook: FB})
    expect(b.featured).toBe(false)
    expect(b.social).toBeNull()
    expect(c.social).toBeNull()
    expect(d.featured).toBe(false)
    expect(d.social).toBeNull()
  })

  it('are in the real file, and no URL there is one the app would drop', () => {
    const entries = parseChangelog(FILE)
    expect(entries.filter((e) => e.featured).length).toBeGreaterThan(5)
    for (const e of FILE.entries.filter((x) => x.social)) {
      expect(entries.find((x) => x.id === e.id).social).toEqual(e.social)
    }
  })

  it('are what What\'s new lists by default, and all of them when asked', () => {
    const entries = parseChangelog({entries: [
      entry('2026-10-04', 'a', {featured: true}), entry('2026-10-03', 'b'), entry('2026-10-02', 'c', {featured: true}),
    ]})
    expect(visibleEntries(entries, false).map((e) => e.headline)).toEqual(['a', 'c'])
    expect(visibleEntries(entries, true).map((e) => e.headline)).toEqual(['a', 'b', 'c'])
  })

  it('leave a changelog with none featured showing everything, not nothing', () => {
    const entries = parseChangelog({entries: [entry('2026-10-04', 'a'), entry('2026-10-03', 'b')]})
    expect(visibleEntries(entries, false)).toHaveLength(2)
  })

  it('are the choice remembered: off by default, stored as 1, cleared when turned off', () => {
    const storage = memoryStorage()
    expect(readShowAll(storage)).toBe(false)
    expect(writeShowAll(true, storage)).toBe(true)
    expect(storage.data[SHOW_ALL_KEY]).toBe('1')
    expect(readShowAll(storage)).toBe(true)
    expect(writeShowAll(false, storage)).toBe(true)
    expect(SHOW_ALL_KEY in storage.data).toBe(false)
    expect(readShowAll(storage)).toBe(false)
    expect(readShowAll(memoryStorage({[SHOW_ALL_KEY]: 'yes'}))).toBe(false)
  })

  it('are the default when storage throws, is missing, or the accessor throws', () => {
    expect(readShowAll(throwingStorage())).toBe(false)
    expect(writeShowAll(true, throwingStorage())).toBe(false)
    expect(readShowAll(null)).toBe(false)
    expect(writeShowAll(true, null)).toBe(false)
  })

  it('are all the "new" marker counts: the featured entries after the date last seen', () => {
    const featured = [{date: '2026-10-13'}, {date: '2026-10-13'}, {date: '2026-10-09'}]
    expect(unseenCount(featured, '2026-10-10')).toBe(2)
    expect(unseenCount(featured, '2026-10-13')).toBe(0)
    expect(unseenCount(featured, null)).toBe(0)
  })

  it('have a stamp of their own for the marker, which an old stamp lacks', () => {
    const stamp = {dates: [['2026-10-13', 3], ['2026-10-09', 1]], featured: [['2026-10-13', 1]]}
    expect(stampEntries(stamp, 'featured')).toEqual([{date: '2026-10-13'}])
    expect(stampEntries(stamp)).toHaveLength(4)
    expect(stampEntries({dates: stamp.dates}, 'featured')).toEqual([])
    const real = stampEntries(undefined, 'featured')
    expect(real.length).toBe(FILE.entries.filter((e) => e.featured).length)
  })
})


describe('the changelog tour\'s stops', () => {
  const entries = parseChangelog({entries: [
    entry('2026-10-13', 'five', {permalink: LINK}),
    entry('2026-10-12', 'four'),
    entry('2026-10-11', 'three', {permalink: '#galaxy:ngc2403'}),
    entry('2026-10-11', 'two'),
    entry('2026-10-09', 'one', {permalink: LINK}),
  ]})

  it('are the entries with a permalink, newest first; those without are skipped', () => {
    expect(tourStops(entries).map((e) => e.headline)).toEqual(['five', 'three', 'one'])
  })

  it('begin at a chosen entry (by id) and go on toward the older ones', () => {
    expect(tourStops(entries, {from: entries[2].id}).map((e) => e.headline)).toEqual(['three', 'one'])
    // An entry without a view starts at the next with one.
    expect(tourStops(entries, {from: entries[1].id}).map((e) => e.headline)).toEqual(['three', 'one'])
  })

  it('begin at a date: the newest entry on or before it', () => {
    expect(tourStops(entries, {from: '2026-10-12'}).map((e) => e.headline)).toEqual(['three', 'one'])
    expect(tourStops(entries, {from: '2026-10-10'}).map((e) => e.headline)).toEqual(['one'])
    expect(tourStops(entries, {from: '2020-01-01'})).toEqual([])
  })

  it('an id that is gone falls back on the date it begins with; anything else, the newest', () => {
    expect(tourStops(entries, {from: '2026-10-11-reworded-headline'}).map((e) => e.headline)).toEqual(['three', 'one'])
    expect(tourStops(entries, {from: 'nonsense'}).length).toBe(3)
  })

  it('stop after a count', () => {
    expect(tourStops(entries, {count: 2}).map((e) => e.headline)).toEqual(['five', 'three'])
    expect(tourStops(entries, {from: '2026-10-11', count: 1}).map((e) => e.headline)).toEqual(['three'])
    expect(tourStops(entries, {count: 0})).toEqual([])
  })

  it('follow the filter: only the featured entries unless all are asked for', () => {
    const list = parseChangelog({entries: [
      entry('2026-10-13', 'five', {permalink: LINK, featured: true}),
      entry('2026-10-12', 'four', {permalink: LINK}),
      entry('2026-10-11', 'three', {permalink: '#galaxy:ngc2403', featured: true}),
      entry('2026-10-09', 'one', {permalink: LINK}),
    ]})
    expect(tourStops(list, {showAll: false}).map((e) => e.headline)).toEqual(['five', 'three'])
    expect(tourStops(list, {showAll: true}).map((e) => e.headline)).toEqual(['five', 'four', 'three', 'one'])
    expect(tourStops(list).length).toBe(4)
    // From an entry the filter hides: the next one it shows, by its date.
    expect(tourStops(list, {from: list[1].id, showAll: false}).map((e) => e.headline)).toEqual(['three'])
  })

  it('the real file has stops', () => {
    expect(tourStops(parseChangelog(FILE)).length).toBe(FILE.entries.filter((e) => e.permalink).length)
  })
})


describe('a stop\'s caption', () => {
  it('is the headline and the first sentence', () => {
    const c = tourCaption({
      headline: 'Clouds you can fly into',
      text: 'Fly down into Earth\'s clouds and look around, lit by the Sun. A second sentence follows here, and more.',
    })
    expect(c).toEqual({headline: 'Clouds you can fly into',
      sentence: 'Fly down into Earth\'s clouds and look around, lit by the Sun. A second sentence follows here, and more.'})
  })

  it('takes a second sentence when the first is short, only the first when it isn\'t', () => {
    expect(tourCaption({headline: 'H', text: 'Short one. Then the next.'}).sentence).toBe('Short one. Then the next.')
    const long = 'A first sentence that runs on for a good while, long enough that it stands by itself here.'
    expect(tourCaption({headline: 'H', text: `${long} And a second.`}).sentence).toBe(long)
  })

  it('doesn\'t split at a decimal point, and drops the backticks', () => {
    const c = tourCaption({headline: '`f` follows', text: 'Press `f` and the field is 0.91 degrees. Next.'})
    expect(c.headline).toBe('f follows')
    // 0.91 is no sentence end: the short first sentence is joined by the second.
    expect(c.sentence).toBe('Press f and the field is 0.91 degrees. Next.')
  })

  it('uses only the first paragraph, and cuts a long sentence at a word', () => {
    const c = tourCaption({headline: 'H', text: `${'word '.repeat(80)}end.\n\nSecond paragraph.`})
    expect(c.sentence.length).toBeLessThanOrEqual(CAPTION_MAX_CHARS)
    expect(c.sentence.endsWith('…')).toBe(true)
    expect(c.sentence.includes('Second')).toBe(false)
    expect(c.sentence.slice(0, -1).endsWith('word')).toBe(true)
  })

  it('of every real entry fits', () => {
    for (const e of parseChangelog(FILE)) {
      const c = tourCaption(e)
      expect(c.headline.length).toBeGreaterThan(0)
      expect(c.sentence.length).toBeGreaterThan(0)
      expect(c.sentence.length).toBeLessThanOrEqual(CAPTION_MAX_CHARS)
      expect(c.sentence.includes('`')).toBe(false)
    }
  })

  it('is held long enough to read, within bounds', () => {
    expect(holdMs({headline: 'H', sentence: 'S'})).toBe(HOLD_MIN_MS)
    expect(holdMs({headline: 'H'.repeat(500), sentence: 'S'.repeat(500)})).toBe(HOLD_MAX_MS)
    const mid = holdMs({headline: 'H'.repeat(60), sentence: 'S'.repeat(120)})
    expect(mid).toBeGreaterThan(HOLD_MIN_MS)
    expect(mid).toBeLessThan(HOLD_MAX_MS)
    // Longer text, longer hold.
    expect(holdMs({headline: 'H', sentence: 'S'.repeat(200)})).toBeGreaterThan(holdMs({headline: 'H', sentence: 'S'.repeat(100)}))
  })
})


describe('dates', () => {
  it('are written in words, not by locale', () => {
    expect(formatEntryDate('2026-10-13')).toBe('13 October 2026')
    expect(formatEntryDate('2026-01-05', true)).toBe('5 Jan 2026')
    expect(formatEntryDate('soon')).toBe('soon')
  })
})


describe('the tour\'s URL token', () => {
  it('is `news:tour` in a fragment with no path or view', () => {
    expect(decodeNewsToken('#;news:tour')).toEqual({from: null, count: Infinity})
    expect(decodeNewsToken(';news:tour')).toEqual({from: null, count: Infinity})
    expect(decodeNewsToken('#;news:tour,from=2026-10-10,n=3')).toEqual({from: '2026-10-10', count: 3})
    expect(decodeNewsToken(`#;news:tour,from=${entry('2026-10-10', 'x').id}`).from).toBe('2026-10-10-x')
  })

  it('round-trips', () => {
    for (const opts of [{}, {from: '2026-10-10'}, {count: 3}, {from: '2026-10-10-a-b', count: 12}]) {
      const fragment = encodeNewsToken(opts)
      expect(fragment.startsWith(';news:tour')).toBe(true)
      const back = decodeNewsToken(fragment)
      expect(back.from).toBe(opts.from ?? null)
      expect(back.count).toBe(opts.count ?? Infinity)
    }
  })

  it('ignores other tokens and unknown names, and takes a bad value as its default', () => {
    expect(decodeNewsToken('#;apps:open;news:tour,color=red')).toEqual({from: null, count: Infinity})
    expect(decodeNewsToken('#;news:tour,n=abc,from=a b')).toEqual({from: null, count: Infinity})
    expect(decodeNewsToken('#;news:tour,n=-2')).toEqual({from: null, count: Infinity})
  })

  it('is not asked for by anything else: a path, a view, no flag, another label', () => {
    expect(decodeNewsToken('')).toBe(null)
    expect(decodeNewsToken('#')).toBe(null)
    expect(decodeNewsToken('#sun/earth')).toBe(null)
    expect(decodeNewsToken('#news:tour')).toBe(null)
    expect(decodeNewsToken('#;news:')).toBe(null)
    expect(decodeNewsToken('#;news:from=2026-10-10')).toBe(null)
    expect(decodeNewsToken('#;time:pause')).toBe(null)
    expect(decodeNewsToken(`${LINK};news:tour`)).toBe(null)
  })

  it('is never a tour on a link with the HUD off (the quiet-load rule)', () => {
    expect(decodeNewsToken('#;news:tour;s=v')).toBe(null)
    expect(decodeNewsToken('#;s=alv;news:tour')).toBe(null)
    // Other settings are not the HUD.
    expect(decodeNewsToken('#;news:tour;s=alo')).not.toBe(null)
  })
})
