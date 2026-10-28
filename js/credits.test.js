import {afterEach, beforeEach, describe, expect, it} from 'bun:test'
import {
  CREDIT_FADE_MS,
  CREDIT_SHOW_MS,
  DEFAULT_ORDER,
  addCredit,
  clearCredits,
  followCredit,
  getCredits,
  hasCredit,
  removeCredit,
  setCreditSource,
  setCreditsChrome,
  setCreditsClock,
  setCreditsMotion,
  subscribeCredits,
} from './credits.js'


describe('the credits registry', () => {
  afterEach(() => clearCredits())

  it('adds a credit, and removes it', () => {
    expect(getCredits()).toEqual([])
    addCredit('gaia', {text: 'ESA/Gaia/DPAC', href: 'https://www.cosmos.esa.int/gaia'})
    expect(hasCredit('gaia')).toBe(true)
    expect(getCredits()).toEqual([{
      id: 'gaia', items: [{text: 'ESA/Gaia/DPAC', href: 'https://www.cosmos.esa.int/gaia'}], element: null,
      order: DEFAULT_ORDER, seq: expect.any(Number), persistence: 'while-shown', phase: 'in',
    }])
    removeCredit('gaia')
    expect(hasCredit('gaia')).toBe(false)
    expect(getCredits()).toEqual([])
  })

  it('replaces a credit with the same id, keeping its place', () => {
    addCredit('a', {text: 'A'})
    addCredit('b', {text: 'B'})
    addCredit('a', [{text: 'A1'}, {text: 'A2'}])
    expect(getCredits().map((c) => c.id)).toEqual(['a', 'b'])
    expect(getCredits()[0].items.map((i) => i.text)).toEqual(['A1', 'A2'])
  })

  it('orders by order, then by when added', () => {
    addCredit('late', {text: 'Late'})
    addCredit('early', {text: 'Early'})
    addCredit('cesium', {element: {}}, {order: 0})
    expect(getCredits().map((c) => c.id)).toEqual(['cesium', 'late', 'early'])
  })

  it('keeps only text and http(s) links', () => {
    addCredit('x', [{text: 'ok', href: 'javascript:alert(1)'}, {text: '  '}, {text: 'site', href: 'https://example.org/'}])
    expect(getCredits()[0].items).toEqual([{text: 'ok'}, {text: 'site', href: 'https://example.org/'}])
    // Nothing left to show: no entry.
    addCredit('y', {href: 'https://example.org/'})
    expect(hasCredit('y')).toBe(false)
  })

  it('holds an element as it is, for a library that manages its own', () => {
    const element = {id: 'cesium-credits'}
    addCredit('cesium', {element})
    expect(getCredits()[0].element).toBe(element)
    expect(getCredits()[0].items).toEqual([])
  })

  it('tells its listeners of changes only, and keeps one array between them', () => {
    let calls = 0
    const off = subscribeCredits(() => calls++)
    addCredit('a', {text: 'A'})
    const snapshot = getCredits()
    addCredit('a', {text: 'A'})
    removeCredit('nothing')
    expect(calls).toBe(1)
    expect(getCredits()).toBe(snapshot)
    removeCredit('a')
    expect(calls).toBe(2)
    off()
    addCredit('b', {text: 'B'})
    expect(calls).toBe(2)
  })
})


/**
 * A clock run by hand: `advance(ms)` moves its time and runs the timers due.
 *
 * @returns {object}
 */
function handClock() {
  let t = 1000
  let next = 0
  const timers = new Map()
  const clock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      timers.set(++next, {fn, at: t + ms})
      return next
    },
    clearTimeout: (id) => timers.delete(id),
  }
  const advance = (ms) => {
    const end = t + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) {
        break
      }
      timers.delete(due[0])
      t = due[1].at
      due[1].fn()
    }
    t = end
  }
  return {clock, advance, timers}
}


/** @returns {object} each credit's phase by id */
function phases() {
  return Object.fromEntries(getCredits().map((c) => [c.id, c.phase]))
}


describe('credits on arrival, then fading', () => {
  let hand
  beforeEach(() => {
    hand = handClock()
    setCreditsClock(hand.clock)
    setCreditsChrome(true)
  })
  afterEach(() => {
    clearCredits()
    setCreditsClock(null)
  })

  it('shows a timed credit for its window, fades it, then takes it out of the line', () => {
    let calls = 0
    const off = subscribeCredits(() => calls++)
    addCredit('osm', {text: 'OSM'}, {persistence: 'timed'})
    expect(phases()).toEqual({osm: 'in'})
    hand.advance(CREDIT_SHOW_MS - 1)
    expect(phases()).toEqual({osm: 'in'})
    hand.advance(1)
    expect(phases()).toEqual({osm: 'fading'})
    hand.advance(CREDIT_FADE_MS)
    expect(phases()).toEqual({osm: 'out'})
    // Still applicable: in the registry, for the Credits button.
    expect(hasCredit('osm')).toBe(true)
    expect(getCredits()[0].persistence).toBe('timed')
    // Told of each phase, and nothing scheduled once it's out.
    expect(calls).toBe(3)
    expect(hand.timers.size).toBe(0)
    off()
  })

  it('times each credit on its own: Y\'s arrival doesn\'t touch X\'s window, and X goes first', () => {
    addCredit('x', {text: 'X'}, {persistence: 'timed'})
    hand.advance(3000)
    addCredit('y', {text: 'Y'}, {persistence: 'timed'})
    expect(phases()).toEqual({x: 'in', y: 'in'})
    hand.advance(CREDIT_SHOW_MS - 3000)
    expect(phases()).toEqual({x: 'fading', y: 'in'})
    hand.advance(CREDIT_FADE_MS)
    expect(phases()).toEqual({x: 'out', y: 'in'})
    hand.advance(3000 - CREDIT_FADE_MS)
    expect(phases()).toEqual({x: 'out', y: 'fading'})
    hand.advance(CREDIT_FADE_MS)
    expect(phases()).toEqual({x: 'out', y: 'out'})
  })

  it('starts a credit\'s window again when its data leaves and comes back, not when it\'s replaced', () => {
    addCredit('gibs', {text: 'GIBS'}, {persistence: 'timed'})
    hand.advance(CREDIT_SHOW_MS + CREDIT_FADE_MS)
    expect(phases()).toEqual({gibs: 'out'})
    // The same credit again while in: nothing changes.
    addCredit('gibs', {text: 'GIBS'}, {persistence: 'timed'})
    expect(phases()).toEqual({gibs: 'out'})
    removeCredit('gibs')
    addCredit('gibs', {text: 'GIBS'}, {persistence: 'timed'})
    expect(phases()).toEqual({gibs: 'in'})
    hand.advance(CREDIT_SHOW_MS)
    expect(phases()).toEqual({gibs: 'fading'})
  })

  it('never times out a while-shown credit (the default: ion\'s logo, Bing\'s)', () => {
    addCredit('cesium', {element: {}}, {order: 0, persistence: 'while-shown'})
    addCredit('unchecked', {text: 'Someone'})
    hand.advance(10 * CREDIT_SHOW_MS)
    expect(phases()).toEqual({cesium: 'in', unchecked: 'in'})
    expect(getCredits().map((c) => c.persistence)).toEqual(['while-shown', 'while-shown'])
    expect(hand.timers.size).toBe(0)
  })

  it('holds an as-prominent credit in while a while-shown one is, its window starting after', () => {
    addCredit('gaia', {text: 'ESA/Gaia/DPAC'}, {persistence: 'timed', asProminent: true})
    hand.advance(CREDIT_SHOW_MS + CREDIT_FADE_MS)
    expect(phases()).toEqual({gaia: 'out'})
    // Cesium's credits come in: Gaia's with them, for as long.
    addCredit('cesium', {element: {}}, {order: 0, persistence: 'while-shown'})
    expect(phases()).toEqual({cesium: 'in', gaia: 'in'})
    hand.advance(3 * CREDIT_SHOW_MS)
    expect(phases()).toEqual({cesium: 'in', gaia: 'in'})
    removeCredit('cesium')
    expect(phases()).toEqual({gaia: 'in'})
    hand.advance(CREDIT_SHOW_MS)
    expect(phases()).toEqual({gaia: 'fading'})
    // A plain timed credit isn't held.
    addCredit('osm', {text: 'OSM'}, {persistence: 'timed'})
    hand.advance(CREDIT_SHOW_MS + CREDIT_FADE_MS)
    addCredit('cesium', {element: {}}, {order: 0, persistence: 'while-shown'})
    expect(phases().osm).toBe('out')
  })

  it('runs no window while the chrome is hidden, and shows a credit once when it comes back', () => {
    setCreditsChrome(false)
    // Arrives on the homepage, with the chrome held.
    addCredit('gaia', {text: 'ESA/Gaia/DPAC'}, {persistence: 'timed'})
    hand.advance(3 * CREDIT_SHOW_MS)
    expect(phases()).toEqual({gaia: 'in'})
    expect(hand.timers.size).toBe(0)
    setCreditsChrome(true)
    hand.advance(CREDIT_SHOW_MS - 1)
    expect(phases()).toEqual({gaia: 'in'})
    // Hidden part way through its window ('v'): its whole window again after.
    setCreditsChrome(false)
    hand.advance(CREDIT_SHOW_MS)
    setCreditsChrome(true)
    hand.advance(CREDIT_SHOW_MS - 1)
    expect(phases()).toEqual({gaia: 'in'})
    hand.advance(1 + CREDIT_FADE_MS)
    expect(phases()).toEqual({gaia: 'out'})
    // Seen through, it stays out over a hide and a show.
    setCreditsChrome(false)
    setCreditsChrome(true)
    expect(phases()).toEqual({gaia: 'out'})
  })

  it('with reduced motion, goes straight from in to out: no fade', () => {
    setCreditsMotion({reduced: true})
    addCredit('nyc', {text: 'NYC Open Data'}, {persistence: 'timed'})
    hand.advance(CREDIT_SHOW_MS - 1)
    expect(phases()).toEqual({nyc: 'in'})
    hand.advance(1)
    expect(phases()).toEqual({nyc: 'out'})
  })

  it('keeps a credit from several sources in while any holds it, one window for all', () => {
    const credit = {text: 'GIBS'}
    setCreditSource('gibs', 'clouds', true, credit, {persistence: 'timed'})
    hand.advance(5000)
    setCreditSource('gibs', 'night-lights', true, credit, {persistence: 'timed'})
    setCreditSource('gibs', 'clouds', false, credit, {persistence: 'timed'})
    expect(hasCredit('gibs')).toBe(true)
    hand.advance(CREDIT_SHOW_MS - 5000)
    expect(phases()).toEqual({gibs: 'fading'})
    setCreditSource('gibs', 'night-lights', false, credit)
    expect(hasCredit('gibs')).toBe(false)
    // Back: a new window.
    setCreditSource('gibs', 'clouds', true, credit, {persistence: 'timed'})
    expect(phases()).toEqual({gibs: 'in'})
  })
})


describe('followCredit', () => {
  it('adds on the first frame drawn, and removes after its grace frames without', () => {
    const calls = []
    const follow = followCredit((on) => calls.push(on), 3)
    follow(false)
    expect(calls).toEqual([])
    follow(true)
    expect(calls).toEqual([true])
    follow(false)
    follow(false)
    follow(true)
    follow(false)
    follow(false)
    expect(calls).toEqual([true])
    follow(false)
    expect(calls).toEqual([true, false])
  })
})
