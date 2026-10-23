import {describe, expect, it} from 'bun:test'
import {nearestDetent, tapDetent} from './infoSheet.js'


describe('infoSheet', () => {
  it('snaps a drag to the nearest height', () => {
    const heights = [88, 400, 700]
    expect(nearestDetent(60, heights)).toBe('peek')
    expect(nearestDetent(250, heights)).toBe('half')
    expect(nearestDetent(560, heights)).toBe('full')
    expect(nearestDetent(2000, heights)).toBe('full')
  })

  it('steps on a tap: up from the peek, back down from half, to half from full', () => {
    expect(tapDetent('peek')).toBe('half')
    expect(tapDetent('half')).toBe('peek')
    expect(tapDetent('full')).toBe('half')
  })
})
