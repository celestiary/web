import {afterEach, describe, expect, it, setSystemTime} from 'bun:test'
import {readFileSync} from 'node:fs'
import {staleRoute} from './staleBuild.js'


// The stale-build script in public/index.html: it has to listen before the
// entry loads, so it is inline there; this runs that source.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const source = html.match(/<script type="text\/javascript" id="stale-build">([\s\S]*?)<\/script>/)[1]

const KEY = 'celestiary-stale-reload'
const BASE = 'https://celestiary.org/web/pr-preview/pr-9/'
const T0 = new Date('2026-10-23T12:00:00Z')
const GUARD_MS = 30000

const CHROMIUM = new TypeError(`Failed to fetch dynamically imported module: ${BASE}App-NXGNVLSM.js`)
const SAFARI = new TypeError('Importing a module script failed.')
const FIREFOX = new TypeError(`error loading dynamically imported module: ${BASE}App-NXGNVLSM.js`)


/**
 * Run the script in a stub page.
 *
 * @param {object} [opts]
 * @param {object} [opts.stored] sessionStorage's contents
 * @param {boolean} [opts.storageThrows] sessionStorage throws (blocked)
 * @param {boolean} [opts.fetchFails] fetch rejects (offline)
 * @param {boolean} [opts.loadingDone] the loading text has gone
 * @param {boolean} [opts.isQuiet] the page loads quiet
 * @returns {object} The page: `fire(type, event)`, and what the script did
 */
function load({stored = {}, storageThrows = false, fetchFails = false, loadingDone = false, isQuiet = false} = {}) {
  const page = {fetches: [], reloads: 0, stored: {...stored}, listeners: {}, prevented: 0}
  const classes = new Set(isQuiet ? ['quiet-load'] : [])
  const moon = {className: 'loading-text'}
  const inner = {
    children: [moon],
    removeChild: (c) => inner.children.splice(inner.children.indexOf(c), 1),
    appendChild: (c) => inner.children.push(c),
  }
  const loading = {
    classList: {contains: (c) => loadingDone && c === 'done'},
    querySelector: (sel) => (sel === '.loading-in' ? inner : inner.children.find((c) => sel === `.${c.className}`)),
  }
  const storage = {
    getItem: (k) => {
      if (storageThrows) {
        throw new Error('SecurityError')
      }
      return k in page.stored ? page.stored[k] : null
    },
    setItem: (k, v) => {
      if (storageThrows) {
        throw new Error('SecurityError')
      }
      page.stored[k] = v
    },
  }
  const window = {
    sessionStorage: storage,
    location: {href: `${BASE}#sun/earth`, reload: () => page.reloads++},
    fetch: (url, init) => {
      page.fetches.push({url, cache: init.cache})
      return fetchFails ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ok: true})
    },
    addEventListener: (type, fn, capture) => {
      page.listeners[type] = {fn, capture: !!capture}
    },
  }
  const document = {
    baseURI: BASE,
    documentElement: {classList: {remove: (c) => classes.delete(c)}},
    getElementById: (id) => (id === 'loading' ? loading : null),
    createElement: () => ({}),
  }
  new Function('window', 'document', source)(window, document)
  page.window = window
  page.quiet = () => classes.has('quiet-load')
  page.message = () => inner.children.find((c) => c.className === 'loading-failed')?.textContent ?? null
  page.moonShown = () => inner.children.includes(moon)
  page.fire = (type, event) => page.listeners[type].fn({preventDefault: () => page.prevented++, ...event})
  page.entryFailed = () => page.fire('error', {target: {tagName: 'SCRIPT', type: 'module'}})
  page.settle = () => new Promise((r) => setTimeout(r, 0))
  return page
}


describe('stale-build', () => {
  afterEach(() => setSystemTime())

  it('knows a module that didn\'t load in Chromium, Safari and Firefox', () => {
    for (const err of [CHROMIUM, SAFARI, FIREFOX]) {
      expect(load().window.reloadStaleBuild(err)).toBe(true)
    }
  })

  it('leaves every other error alone, a data fetch\'s included', () => {
    const page = load()
    for (const err of [new TypeError('Failed to fetch'), new TypeError('NetworkError when attempting to fetch resource.'),
      new TypeError('Cannot read properties of undefined (reading \'x\')'), undefined, null, 'oops']) {
      expect(page.window.reloadStaleBuild(err)).toBe(false)
    }
    expect(page.fetches).toEqual([])
  })

  it('on the entry\'s error, fetches the page and index.js afresh, then reloads once', async () => {
    setSystemTime(T0)
    const page = load()
    page.entryFailed()
    expect(page.fetches).toEqual([
      {url: BASE, cache: 'reload'},
      {url: `${BASE}index.js`, cache: 'reload'},
    ])
    expect(page.reloads).toBe(0)
    await page.settle()
    expect(page.reloads).toBe(1)
    expect(page.stored[KEY]).toBe(String(T0.getTime()))
    expect(page.message()).toBe(null)
    page.entryFailed()
    page.fire('unhandledrejection', {reason: CHROMIUM})
    await page.settle()
    expect(page.fetches.length).toBe(2)
    expect(page.reloads).toBe(1)
  })

  it('listens for the entry\'s error in the capture phase (a script\'s error doesn\'t bubble)', () => {
    expect(load().listeners.error.capture).toBe(true)
  })

  it('ignores other scripts\' errors, such as a blocked analytics tag', async () => {
    const page = load()
    page.fire('error', {target: {tagName: 'SCRIPT', type: 'text/javascript'}})
    page.fire('error', {target: {tagName: 'IMG'}})
    await page.settle()
    expect(page.fetches).toEqual([])
  })

  it('takes a dynamic import\'s unhandled rejection, and only that', async () => {
    const page = load()
    page.fire('unhandledrejection', {reason: new Error('something else')})
    expect(page.prevented).toBe(0)
    expect(page.fetches).toEqual([])
    page.fire('unhandledrejection', {reason: SAFARI})
    expect(page.prevented).toBe(1)
    await page.settle()
    expect(page.reloads).toBe(1)
  })

  it('takes an import\'s failure rethrown to the window (React\'s, without Routed\'s catch)', async () => {
    const page = load()
    page.fire('error', {target: page.window, error: CHROMIUM, message: `Uncaught TypeError: ${CHROMIUM.message}`})
    await page.settle()
    expect(page.reloads).toBe(1)
  })

  it('says it can\'t load, rather than reloading again, within 30 s of the last reload', async () => {
    setSystemTime(new Date(T0.getTime() + GUARD_MS - 1))
    const page = load({stored: {[KEY]: String(T0.getTime())}, isQuiet: true})
    page.entryFailed()
    await page.settle()
    expect(page.fetches).toEqual([])
    expect(page.reloads).toBe(0)
    expect(page.message()).toMatch(/Reload the page/)
    expect(page.moonShown()).toBe(false)
    expect(page.quiet()).toBe(false)
  })

  it('reloads again once 30 s have passed', async () => {
    setSystemTime(new Date(T0.getTime() + GUARD_MS))
    const page = load({stored: {[KEY]: String(T0.getTime())}})
    page.entryFailed()
    await page.settle()
    expect(page.reloads).toBe(1)
  })

  it('never reloads without somewhere to record it', async () => {
    const page = load({storageThrows: true})
    page.entryFailed()
    await page.settle()
    expect(page.reloads).toBe(0)
    expect(page.message()).not.toBe(null)
  })

  it('says it can\'t load when the fresh fetch fails (offline)', async () => {
    const page = load({fetchFails: true})
    page.entryFailed()
    await page.settle()
    expect(page.reloads).toBe(0)
    expect(page.message()).not.toBe(null)
  })

  it('does nothing once the loading text is gone: the running app degrades on its own', async () => {
    const page = load({loadingDone: true})
    expect(page.window.reloadStaleBuild(CHROMIUM)).toBe(false)
    page.entryFailed()
    await page.settle()
    expect(page.fetches).toEqual([])
    expect(page.message()).toBe(null)
  })
})


describe('staleRoute', () => {
  it('holds the route suspended while the page recovers', async () => {
    const win = {reloadStaleBuild: () => true}
    let settled = false
    staleRoute(CHROMIUM, win).then(() => {
      settled = true
    }, () => {
      settled = true
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)
  })

  it('throws what the page doesn\'t take, or without the page\'s script', () => {
    const err = new Error('a bug in App')
    expect(() => staleRoute(err, {reloadStaleBuild: () => false})).toThrow(err)
    expect(() => staleRoute(err, {})).toThrow(err)
    expect(() => staleRoute(err, undefined)).toThrow(err)
  })
})
