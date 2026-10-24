import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {
  DARK_SUN_DEG, OBSERVING_KEY, observingAtLoad, setObservingTheme, shouldOfferObserving, storeObserving,
} from './observing.js'
import {decodeSettings, encodeSettings} from './permalink.js'


// The observing script in public/index.html runs before the first paint, so
// it is inline there; this runs that source, as quietLoad.test.js does.
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const source = html.match(/<script type="text\/javascript" id="observing">([\s\S]*?)<\/script>/)[1]


/**
 * @param {string} hash The page's fragment, with its '#'
 * @param {?object} storage localStorage, or one that throws
 * @returns {?string} <html>'s data-theme after the script
 */
function themeAtLoad(hash, storage) {
  const attrs = {}
  const window = {location: {hash}, localStorage: storage}
  const document = {documentElement: {setAttribute: (k, v) => {
    attrs[k] = v
  }}}
  new Function('window', 'document', source)(window, document)
  return attrs['data-theme'] ?? null
}


/** @returns {object} A localStorage of a Map */
function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  }
}


const VIEW = '#sun/earth@43.3389,-9.9593,30373373.021376Tm;t=9779.5692jd;cq=-0.436,0.7975,0.0666,0.4116;fov=45deg'
const THROWS = {getItem: () => {
  throw new Error('blocked')
}}


describe('the observing script', () => {
  it('turns the theme on for a device that chose it, before the first paint', () => {
    expect(themeAtLoad('', memoryStorage({[OBSERVING_KEY]: '1'}))).toBe('observing')
    expect(themeAtLoad(`${VIEW};s=a`, memoryStorage({[OBSERVING_KEY]: '1'}))).toBe('observing')
  })

  it('turns it on for a view link with R in s=, as permalink.js reads it', () => {
    expect(themeAtLoad(`${VIEW};s=R`, memoryStorage())).toBe('observing')
    expect(themeAtLoad(`${VIEW};s=alR`, memoryStorage())).toBe('observing')
    expect(decodeSettings('alR').R).toBe(true)
    expect(encodeSettings({...decodeSettings(''), R: true})).toBe('R')
  })

  it('leaves it off otherwise, and when storage throws', () => {
    expect(themeAtLoad('', memoryStorage())).toBe(null)
    expect(themeAtLoad(VIEW, memoryStorage())).toBe(null)
    // Without a camera (cq=), a link's s= is ignored, as permalink.js ignores it.
    expect(themeAtLoad('#sun/earth@1,2,3m;t=1jd;fov=45deg;s=R', memoryStorage())).toBe(null)
    expect(themeAtLoad('', THROWS)).toBe(null)
    expect(themeAtLoad(`${VIEW};s=R`, THROWS)).toBe('observing')
  })

  it('reads the key the app writes', () => {
    expect(source).toContain(`'${OBSERVING_KEY}'`)
  })
})


describe('observing', () => {
  it('sets and reads the theme on <html>', () => {
    const root = {dataset: {}}
    expect(observingAtLoad(root)).toBe(false)
    setObservingTheme(root, true)
    expect(root.dataset.theme).toBe('observing')
    expect(observingAtLoad(root)).toBe(true)
    setObservingTheme(root, false)
    expect(root.dataset.theme).toBeUndefined()
    expect(observingAtLoad(null)).toBe(false)
    setObservingTheme(null, true)
  })

  it('keeps the device\'s choice, and survives storage that throws', () => {
    const storage = memoryStorage()
    storeObserving(storage, true)
    expect(storage.getItem(OBSERVING_KEY)).toBe('1')
    storeObserving(storage, false)
    expect(storage.getItem(OBSERVING_KEY)).toBe(null)
    storeObserving({setItem: THROWS.getItem, removeItem: THROWS.getItem}, true)
    storeObserving(null, true)
  })

  it('is offered on Earth after dark, once, when it is off', () => {
    const dark = {observing: false, offered: false, body: 'earth', sunAltitudeDeg: -12}
    expect(shouldOfferObserving(dark)).toBe(true)
    expect(shouldOfferObserving({...dark, sunAltitudeDeg: DARK_SUN_DEG + 1})).toBe(false) // dusk
    expect(shouldOfferObserving({...dark, sunAltitudeDeg: 30})).toBe(false)
    expect(shouldOfferObserving({...dark, observing: true})).toBe(false)
    expect(shouldOfferObserving({...dark, offered: true})).toBe(false)
    expect(shouldOfferObserving({...dark, body: 'mars'})).toBe(false)
  })
})
