import {describe, expect, it} from 'bun:test'
import Choreography, {READY_TIMEOUT_MS, REVEAL_AT} from './choreography.js'
import {FADE_MS} from './scene/fade.js'
import {hideLoading} from './loading.js'


describe('Choreography', () => {
  it('runs nothing before it starts, then each step at its time, in order, once', () => {
    const ran = []
    const c = new Choreography([
      {at: 500, run: () => ran.push('b')},
      {at: 0, run: () => ran.push('a')},
      {at: 900, run: () => ran.push('c')},
    ])
    expect(c.frame(10000)).toBe(0)
    expect(c.started).toBe(false)
    c.start(1000)
    c.start(2000) // the first start holds
    expect(c.frame(1000)).toBe(1)
    expect(ran).toEqual(['a'])
    c.frame(1499)
    expect(ran).toEqual(['a'])
    c.frame(1500)
    expect(ran).toEqual(['a', 'b'])
    // A long frame runs everything due.
    c.frame(5000)
    expect(ran).toEqual(['a', 'b', 'c'])
    expect(c.done).toBe(true)
    c.frame(9000)
    expect(ran).toEqual(['a', 'b', 'c'])
  })

  it('the load is short: physical scene first, the overlays a beat apart, the chrome last', () => {
    const at = REVEAL_AT
    expect(at.loading).toBe(0)
    expect(at.orbits).toBeGreaterThan(at.loading)
    expect(at.diagrams).toBeGreaterThan(at.orbits)
    expect(at.labels).toBeGreaterThan(at.diagrams)
    expect(at.chrome).toBeGreaterThan(at.labels)
    // Everything in within a second and a half of the scene.
    expect(at.chrome + FADE_MS).toBeLessThanOrEqual(1500)
    expect(READY_TIMEOUT_MS).toBeLessThanOrEqual(5000)
  })
})


describe('hideLoading', () => {
  it('fades the loading text out once, and removes it when the fade ends', () => {
    const classes = new Set()
    let removed = false
    let onEnd = null
    const el = {
      classList: {add: (c) => classes.add(c), contains: (c) => classes.has(c)},
      addEventListener: (type, fn) => {
        expect(type).toBe('transitionend')
        onEnd = fn
      },
      remove: () => {
        removed = true
      },
    }
    const doc = {getElementById: (id) => (id === 'loading' ? el : null)}
    expect(hideLoading(doc)).toBe(true)
    expect(classes.has('done')).toBe(true)
    expect(hideLoading(doc)).toBe(false)
    onEnd()
    expect(removed).toBe(true)
  })

  it('does nothing without a page or the element', () => {
    expect(hideLoading({getElementById: () => null})).toBe(false)
    expect(hideLoading({getElementById: () => ({style: {}})})).toBe(false)
    expect(hideLoading(undefined)).toBe(false)
  })
})
