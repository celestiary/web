import {afterEach, describe, expect, it} from 'bun:test'
import {DEFAULT_ORDER, addCredit, clearCredits, getCredits, hasCredit, removeCredit, subscribeCredits} from './credits.js'


describe('the credits registry', () => {
  afterEach(() => clearCredits())

  it('adds a credit, and removes it', () => {
    expect(getCredits()).toEqual([])
    addCredit('gaia', {text: 'ESA/Gaia/DPAC', href: 'https://www.cosmos.esa.int/gaia'})
    expect(hasCredit('gaia')).toBe(true)
    expect(getCredits()).toEqual([{
      id: 'gaia', items: [{text: 'ESA/Gaia/DPAC', href: 'https://www.cosmos.esa.int/gaia'}], element: null,
      order: DEFAULT_ORDER, seq: expect.any(Number),
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
