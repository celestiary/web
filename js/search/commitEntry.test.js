import {beforeEach, describe, expect, it} from 'bun:test'
import {goToEntry, lookAtEntry} from './commitEntry.js'


const STAR = {x: 1, y: 2, z: 3}

const entries = {
  jupiter: {id: 'jupiter', displayName: 'Jupiter', kind: 'planet', path: 'milkyway/sun/jupiter', payload: {name: 'jupiter'}},
  star: {id: 'hip:32349', displayName: 'Sirius', kind: 'star', path: 'milkyway/hip:32349', payload: {hipId: 32349, star: STAR}},
  place: {id: 'loc:earth:paris', displayName: 'Paris', kind: 'place', path: 'milkyway/sun/earth/paris',
    payload: {body: 'earth', lat: 48.8, lng: 2.3, alt: 35}},
}


/** A celestiary whose scene and store record calls. */
function makeCelestiary() {
  const calls = []
  const rec = (name) => (...args) => calls.push([name, ...args])
  return {
    calls,
    scene: {
      objects: {jupiter: {}},
      goTo: rec('goTo'),
      land: rec('land'),
      setTarget: rec('setTarget'),
      lookAtStar: rec('lookAtStar'),
      lookAtPlace: rec('lookAtPlace'),
    },
    useStore: {getState: () => ({setCommittedStar: rec('setCommittedStar')})},
    loader: {pathByName: {jupiter: 'sun/jupiter'}},
  }
}


describe('lookAtEntry (target)', () => {
  let c
  beforeEach(() => {
    c = makeCelestiary()
  })

  it('targets a body with setTarget and never travels', () => {
    lookAtEntry(entries.jupiter, c)
    expect(c.calls).toEqual([['setTarget', 'jupiter']])
  })

  it('looks at a star in place and commits it, without goTo', () => {
    lookAtEntry(entries.star, c)
    expect(c.calls.map((x) => x[0])).toEqual(['lookAtStar', 'setCommittedStar'])
    expect(c.calls[0][1]).toBe(STAR)
    expect(c.calls[1][1]).toEqual({hipId: 32349, displayName: 'Sirius', star: STAR})
  })

  it('looks at a place in place, without land', () => {
    lookAtEntry(entries.place, c)
    expect(c.calls).toEqual([['lookAtPlace', 'earth', 48.8, 2.3, 35]])
  })

  it('ignores a body with no scene object, and a missing entry', () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      lookAtEntry({...entries.jupiter, payload: {name: 'nope'}}, c)
      lookAtEntry(null, c)
    } finally {
      console.warn = warn
    }
    expect(c.calls).toEqual([])
  })
})


describe('goToEntry (go)', () => {
  let c
  beforeEach(() => {
    c = makeCelestiary()
    global.window = global.window ?? {}
    global.window.location = global.window.location ?? {hash: ''}
    global.window.location.hash = ''
  })

  it('routes a body through the location hash, with no look', () => {
    goToEntry(entries.jupiter, c)
    expect(global.window.location.hash).toBe('sun/jupiter')
    expect(c.calls).toEqual([])
  })

  it('travels to a star and commits it', () => {
    goToEntry(entries.star, c)
    expect(c.calls.map((x) => x[0])).toEqual(['goTo', 'setCommittedStar'])
  })

  it('lands on a place', () => {
    goToEntry(entries.place, c)
    expect(c.calls).toEqual([['land', 'earth', 48.8, 2.3, 35]])
  })
})
