import {describe, expect, it} from 'bun:test'
import {Scene as ThreeScene} from 'three'
import Scene from './Scene.js'


function makeScene() {
  const ui = {
    scene: new ThreeScene(),
    addClickCb: () => {},
  }
  return new Scene(ui)
}


describe('Scene._pathFor', () => {
  it('returns just [name] for milkyway root', () => {
    const s = makeScene()
    expect(s._pathFor('milkyway')).toEqual(['milkyway'])
  })

  it('builds a single-element path for sun', () => {
    const s = makeScene()
    s.objects['sun'] = {props: {parent: 'milkyway'}}
    expect(s._pathFor('sun')).toEqual(['sun'])
  })

  it('walks parent chain for a planet', () => {
    const s = makeScene()
    s.objects['sun'] = {props: {parent: 'milkyway'}}
    s.objects['earth'] = {props: {parent: 'sun'}}
    expect(s._pathFor('earth')).toEqual(['sun', 'earth'])
  })

  it('walks parent chain for a moon', () => {
    const s = makeScene()
    s.objects['sun'] = {props: {parent: 'milkyway'}}
    s.objects['earth'] = {props: {parent: 'sun'}}
    s.objects['moon'] = {props: {parent: 'earth'}}
    expect(s._pathFor('moon')).toEqual(['sun', 'earth', 'moon'])
  })

  it('stops walking if parent is not in objects (e.g., milkyway → universe)', () => {
    const s = makeScene()
    // milkyway.parent='universe' which isn't loaded — loop terminates there
    s.objects['sun'] = {props: {parent: 'milkyway'}}
    expect(s._pathFor('sun')).toEqual(['sun'])
  })

  it('returns empty for unknown target (no crash)', () => {
    const s = makeScene()
    expect(s._pathFor('unknown')).toEqual([])
  })

  it('handles a parent-chain cycle without looping forever', () => {
    // Defensive: two entries pointing at each other shouldn't spin.
    const s = makeScene()
    s.objects['a'] = {props: {parent: 'b'}}
    s.objects['b'] = {props: {parent: 'a'}}
    const path = s._pathFor('a')
    expect(path.length).toBeLessThanOrEqual(2)
  })
})
