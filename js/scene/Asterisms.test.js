import {describe, expect, it} from 'bun:test'

// Asterisms reaches SpriteSheet, which touches document.* at import.
global.document = global.document ?? {
  createElement: () => ({setAttribute: () => {}, getContext: () => ({}), width: 0, height: 0}),
  body: {appendChild: () => {}},
}

const {centroid} = await import('./Asterisms.js')


describe('centroid (where an asterism\'s name goes)', () => {
  it('is the mean direction at the mean distance, not the mean position', () => {
    // Two stars, one at 1 along +x, one at 9 along +y: the mean position
    // (0.5, 4.5) is dragged to the farther one's side; the direction is 45 degrees.
    const c = centroid([{x: 1, y: 0, z: 0}, {x: 0, y: 9, z: 0}])
    expect(Math.atan2(c.y, c.x)).toBeCloseTo(Math.PI / 4)
    expect(Math.hypot(c.x, c.y, c.z)).toBeCloseTo(5)
  })

  it('is the star itself for one', () => {
    const c = centroid([{x: 3, y: 4, z: 12}])
    expect(c.x).toBeCloseTo(3)
    expect(c.y).toBeCloseTo(4)
    expect(c.z).toBeCloseTo(12)
  })

  it('falls back to the mean position when the directions cancel, and to null for none', () => {
    expect(centroid([{x: 1, y: 0, z: 0}, {x: -1, y: 0, z: 0}])).toEqual({x: 0, y: 0, z: 0})
    expect(centroid([])).toBe(null)
    expect(centroid([{x: 0, y: 0, z: 0}])).toBe(null)
  })
})
