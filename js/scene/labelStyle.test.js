import {describe, expect, it} from 'bun:test'
import {SATELLITE_LABELS, labelFont, labelLook, prominence, viewRange} from './labelStyle.js'


describe('label styles', () => {
  it('maps a measure to prominence, by its logarithm between near and far', () => {
    const style = {near: 1e6, far: 1e8, size: [10, 20], brightness: [0.5, 1]}
    expect(prominence(1e6, style)).toBe(1)
    expect(prominence(1e5, style)).toBe(1)
    expect(prominence(1e8, style)).toBe(0)
    expect(prominence(1e9, style)).toBe(0)
    // Halfway in decades.
    expect(prominence(1e7, style)).toBeCloseTo(0.5, 10)
    expect(prominence(5.05e7, {...style, interpolation: 'linear'})).toBeCloseTo(0.5, 10)
    expect(prominence(0, style)).toBe(1)
  })

  it('runs size and brightness from the group\'s least to its most, the dimmest 0.7 of the brightest', () => {
    expect(labelLook(0, SATELLITE_LABELS)).toEqual({size: 11, scale: 11 / 14, brightness: 0.7})
    expect(labelLook(1, SATELLITE_LABELS)).toEqual({size: 14, scale: 1, brightness: 1})
    expect(labelLook(0.5, SATELLITE_LABELS).size).toBe(12.5)
    expect(labelFont(SATELLITE_LABELS)).toBe('14px arial')
  })

  it('takes a view range from the nearest and farthest in view, the style\'s own while none is', () => {
    expect(viewRange([3e6, 9e6, 5e6], SATELLITE_LABELS)).toEqual({near: 3e6, far: 9e6})
    expect(viewRange([], SATELLITE_LABELS)).toEqual({near: 1e6, far: 5e7})
    // A lone name, or a tight cluster: at least a tenth between the ends.
    expect(viewRange([4e6], SATELLITE_LABELS)).toEqual({near: 4e6, far: 4.4e6})
    expect(viewRange([3e6, 9e6], {...SATELLITE_LABELS, range: 'fixed'})).toEqual({near: 1e6, far: 5e7})
  })
})
