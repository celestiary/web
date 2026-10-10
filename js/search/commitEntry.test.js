import {beforeEach, describe, expect, it} from 'bun:test'
import {goToEntry, lookAtEntry, targetEntry} from './commitEntry.js'


const STAR = {x: 1, y: 2, z: 3}
const GALAXY = {isGalaxy: true, id: 'ngc2403', name: 'NGC 2403'}
const PARIS = {kind: 'place', body: 'earth', name: 'Paris', lat: 48.8, lng: 2.3, alt: 35}

const entries = {
  jupiter: {id: 'jupiter', displayName: 'Jupiter', kind: 'planet', path: 'milkyway/sun/jupiter', payload: {name: 'jupiter'}},
  star: {id: 'hip:32349', displayName: 'Sirius', kind: 'star', path: 'milkyway/hip:32349', payload: {hipId: 32349, star: STAR}},
  galaxy: {id: 'galaxy:ngc2403', displayName: 'NGC 2403', kind: 'galaxy', path: 'milkyway/galaxy:ngc2403',
    payload: {galaxy: GALAXY}},
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

  it('targets a star with setTarget, turning to it, without goTo', () => {
    lookAtEntry(entries.star, c)
    expect(c.calls).toEqual([['setTarget', {kind: 'star', star: STAR, name: 'Sirius'}]])
  })

  it('targets a SPARC galaxy with setTarget, turning to it, without goTo', () => {
    lookAtEntry(entries.galaxy, c)
    expect(c.calls).toEqual([['setTarget', {kind: 'galaxy', galaxy: GALAXY, name: 'NGC 2403'}]])
    c.calls.length = 0
    goToEntry(entries.galaxy, c)
    expect(c.calls).toEqual([['goTo', GALAXY, 'NGC 2403']])
  })

  it('targets a place with setTarget, turning to it, without land', () => {
    lookAtEntry(entries.place, c)
    expect(c.calls).toEqual([['setTarget', PARIS]])
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

  it('travels to a star, which targets it', () => {
    goToEntry(entries.star, c)
    expect(c.calls).toEqual([['goTo', STAR, 'Sirius']])
  })

  it('lands on a place, which stays the target', () => {
    goToEntry(entries.place, c)
    expect(c.calls).toEqual([['land', 'earth', 48.8, 2.3, 35, {target: PARIS}]])
  })
})


describe('targetEntry (pick in the dropdown)', () => {
  it('targets each kind as a click on its label does, without turning', () => {
    const c = makeCelestiary()
    targetEntry(entries.place, c)
    targetEntry(entries.jupiter, c)
    targetEntry(entries.star, c)
    expect(c.calls).toEqual([
      ['setTarget', PARIS, {look: false}],
      ['setTarget', 'jupiter', {look: false}],
      ['setTarget', {kind: 'star', star: STAR, name: 'Sirius'}, {look: false}],
    ])
  })

  it('ignores no entry, and a body not in the scene', () => {
    const c = makeCelestiary()
    const warn = console.warn
    console.warn = () => {}
    try {
      targetEntry(null, c)
      targetEntry({...entries.jupiter, payload: {name: 'nope'}}, c)
    } finally {
      console.warn = warn
    }
    expect(c.calls).toEqual([])
  })
})
