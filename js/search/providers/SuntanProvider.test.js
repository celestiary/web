import {describe, expect, it} from 'bun:test'
import SuntanProvider from './SuntanProvider.js'
import {SUNTAN_CRAFT} from '../../scene/suntan/SuntanTrack.js'


describe('SuntanProvider', () => {
  it('lists nothing while the Suntan app isn\'t running', () => {
    expect(new SuntanProvider({suntan: null}).collectAll()).toEqual([])
  })

  it('lists the relay and the lander as craft targets while it runs', () => {
    const entries = new SuntanProvider({suntan: {craft: SUNTAN_CRAFT}}).collectAll()
    expect(entries.map((e) => e.displayName)).toEqual(['Suntan relay', 'Suntan lander'])
    for (const e of entries) {
      expect(e.kind).toBe('craft')
      expect(e.path).toBe('milkyway/sun')
      expect(e.payload.target.kind).toBe('craft')
      expect(e.payload.target.body).toBe('sun')
    }
  })
})
