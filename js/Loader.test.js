import {afterEach, beforeEach, describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {BODIES_URL, _resetBodyBundle, bodyDir, descriptorUrl, loadBodyBundle, placesUrl} from './bodyBundle.js'


// The real Loader, by a name the process-global mock of './Loader' in
// Celestiary.test.js doesn't take (AGENTS.md).
const realSpecifier = './Loader.js?real'
const Loader = (await import(realSpecifier)).default

const BUNDLE = JSON.parse(readFileSync('./public/data/bodies.json', 'utf8'))
const realFetch = global.fetch


/**
 * @param {object} json
 * @returns {object} A fetch response
 */
function ok(json) {
  return {ok: true, status: 200, json: () => Promise.resolve(json), text: () => Promise.resolve(JSON.stringify(json))}
}


/**
 * Serve the bundle and the bodies' own files from public/data, counting the asks.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.bundle] Serve the bundle (else a 404)
 * @returns {Array<string>} The URLs asked for
 */
function serve({bundle = true} = {}) {
  const asked = []
  global.fetch = (input) => {
    const url = String(input?.url ?? input)
    asked.push(url)
    if (url.endsWith(BODIES_URL)) {
      return Promise.resolve(bundle ? ok(BUNDLE) : {ok: false, status: 404})
    }
    const m = url.match(/(data\/[\w/-]+\.json)$/)
    if (!m) {
      return Promise.resolve({ok: false, status: 404})
    }
    try {
      const body = readFileSync(`./public/${m[1]}`, 'utf8')
      return Promise.resolve(ok(JSON.parse(body)))
    } catch {
      return Promise.resolve({ok: false, status: 404})
    }
  }
  return asked
}


/**
 * @param {Loader} loader
 * @param {string} path
 * @returns {Promise<Array<string>>} The names loaded, in order, once the path's target is in
 */
function loadAll(loader, path) {
  const names = []
  return new Promise((resolve, reject) => {
    loader.loadPath(path, (name) => names.push(name), () => setTimeout(() => resolve(names), 20), reject)
  })
}


describe('Loader and the bodies\' bundle', () => {
  const warn = console.warn
  beforeEach(() => {
    _resetBodyBundle()
    console.warn = () => {}
  })
  afterEach(() => {
    global.fetch = realFetch
    console.warn = warn
    _resetBodyBundle()
  })

  it('loads the whole scene from one request', async () => {
    const asked = serve()
    const loader = new Loader()
    const names = await loadAll(loader, 'milkyway')
    expect(asked).toEqual([BODIES_URL])
    expect(names.length).toBe(Object.keys(BUNDLE.bodies).length)
    expect(new Set(names)).toEqual(new Set(Object.keys(BUNDLE.bodies)))
    expect(loader.pathByName.moon).toBe('milkyway/sun/earth/moon')
    expect(loader.loaded.earth).toEqual(JSON.parse(readFileSync('./public/data/earth/index.json', 'utf8')))
  })

  it('gives each Loader its own copy, and still one request', async () => {
    const asked = serve()
    const a = new Loader()
    const b = new Loader()
    await Promise.all([loadAll(a, 'sun/earth'), loadAll(b, 'sun/earth')])
    expect(asked).toEqual([BODIES_URL])
    expect(a.loaded.earth).toEqual(b.loaded.earth)
    expect(a.loaded.earth).not.toBe(b.loaded.earth)
  })

  it('fetches a body the bundle doesn\'t have from its own file', async () => {
    const asked = serve()
    const loader = new Loader()
    const names = await loadAll(loader, 'earth-as-moon')
    expect(names).toEqual(['earth-as-moon'])
    expect(asked[0]).toBe(BODIES_URL)
    expect(asked.slice(1).every((u) => u.endsWith('data/demos/earth-as-moon.json'))).toBe(true)
  })

  it('fetches each body\'s file when the bundle fails, and says why once', async () => {
    const warned = []
    console.warn = (...args) => warned.push(args.join(' '))
    const asked = serve({bundle: false})
    const loader = new Loader()
    const names = await loadAll(loader, 'sun/earth')
    expect(names).toContain('earth')
    expect(loader.loaded.earth.name).toBe('earth')
    expect(asked.filter((u) => u.endsWith(BODIES_URL))).toHaveLength(1)
    expect(asked.some((u) => u.endsWith('data/earth/index.json'))).toBe(true)
    expect(warned.filter((w) => w.includes('bundle'))).toHaveLength(1)
  })

  it('reports a body that is nowhere', async () => {
    serve()
    const loader = new Loader()
    const err = await new Promise((resolve) => loader.loadPath('nosuchbody', () => {}, () => {}, resolve))
    expect(err).toBeTruthy()
  })
})


describe('a body\'s files', () => {
  it('are in its directory, a moon\'s under its planet\'s', () => {
    expect(bodyDir('earth')).toBe('earth')
    expect(descriptorUrl('moon')).toBe('data/earth/moons/moon/index.json')
    expect(placesUrl('moon')).toBe('data/earth/moons/moon/places.json')
    expect(descriptorUrl('webb')).toBe('data/earth/spacecraft/webb/index.json')
    // The guide's demo descriptors have none.
    expect(bodyDir('earth-as-moon')).toBeNull()
    expect(bodyDir('constructor')).toBeNull()
    expect(descriptorUrl('earth-as-moon')).toBe('data/demos/earth-as-moon.json')
    for (const url of [descriptorUrl('titan'), placesUrl('titan'), descriptorUrl('saturn-with-earth-moon')]) {
      expect(readFileSync(`./public/${url}`, 'utf8').length, url).toBeGreaterThan(0)
    }
  })
})


describe('loadBodyBundle', () => {
  afterEach(() => _resetBodyBundle())

  it('shares one request between concurrent asks', async () => {
    let calls = 0
    const fetchFn = () => {
      calls++
      return Promise.resolve(ok(BUNDLE))
    }
    const [a, b] = await Promise.all([loadBodyBundle(fetchFn), loadBodyBundle(fetchFn)])
    expect(calls).toBe(1)
    expect(a).toBe(b)
    expect(a.sun.name).toBe('sun')
  })

  it('resolves to null for a failure, a bad file or a throw', async () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      for (const fetchFn of [() => Promise.resolve({ok: false, status: 500}), () => Promise.resolve(ok({})),
        () => Promise.reject(new Error('offline'))]) {
        _resetBodyBundle()
        expect(await loadBodyBundle(fetchFn)).toBe(null)
      }
    } finally {
      console.warn = warn
    }
  })
})
