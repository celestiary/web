import {describe, expect, it} from 'bun:test'
import CreditsReveal, {CREDITS_FULL_MS} from './creditsReveal.js'


/** @returns {object} an element's classList and click, and a clock run by hand */
function fixture() {
  const classes = new Set
  let onClick = null
  const elt = {
    classList: {add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c)},
    addEventListener: (type, fn) => {
      onClick = fn
    },
  }
  let next = 0
  const timers = new Map
  const clock = {
    setTimeout: (fn) => {
      timers.set(++next, fn)
      return next
    },
    clearTimeout: (id) => timers.delete(id),
  }
  const elapse = () => {
    const fns = [...timers.values()]
    timers.clear()
    fns.forEach((fn) => fn())
  }
  return {elt, classes, clock, elapse, timers, click: (ev) => onClick(ev)}
}


describe('CreditsReveal', () => {
  it('shows the credits in full as a body comes into view, then compact', () => {
    const f = fixture()
    const reveal = new CreditsReveal(f.elt, f.clock)
    reveal.show('earth')
    expect(f.classes.has('compact')).toBe(false)
    expect(f.timers.size).toBe(1)
    f.elapse()
    expect(f.classes.has('compact')).toBe(true)
    // The same body, frame after frame, changes nothing.
    reveal.show('earth')
    expect(f.classes.has('compact')).toBe(true)
    // Another body comes into view: in full again.
    reveal.show('moon')
    expect(f.classes.has('compact')).toBe(false)
    f.elapse()
    // None, then the first again: in full again.
    reveal.show(null)
    expect(f.timers.size).toBe(0)
    reveal.show('earth')
    expect(f.classes.has('compact')).toBe(false)
    expect(CREDITS_FULL_MS).toBeGreaterThan(0)
  })

  it('brings the compact credits back on a tap, instead of following the logo\'s link', () => {
    const f = fixture()
    const reveal = new CreditsReveal(f.elt, f.clock)
    reveal.show('earth')
    let prevented = false
    const ev = {preventDefault: () => {
      prevented = true
    }}
    f.click(ev)
    expect(prevented).toBe(false)
    f.elapse()
    f.click(ev)
    expect(prevented).toBe(true)
    expect(f.classes.has('compact')).toBe(false)
    f.elapse()
    expect(f.classes.has('compact')).toBe(true)
  })
})
