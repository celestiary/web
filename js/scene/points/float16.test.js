import {describe, expect, it} from 'bun:test'
import {fromHalf, toHalf} from './float16.js'


describe('float16', () => {
  it('encodes the textbook values', () => {
    expect(toHalf(0)).toBe(0)
    expect(toHalf(-0)).toBe(0x8000)
    expect(toHalf(1)).toBe(0x3c00)
    expect(toHalf(-2)).toBe(0xc000)
    expect(toHalf(65504)).toBe(0x7bff)
    expect(toHalf(1e6)).toBe(0x7c00)
    expect(toHalf(2 ** -14)).toBe(0x0400)
    expect(toHalf(2 ** -24)).toBe(0x0001)
    expect(toHalf(0.1)).toBe(0x2e66)
    expect(toHalf(NaN) & 0x7c00).toBe(0x7c00)
  })

  it('decodes them back', () => {
    expect(fromHalf(0x3c00)).toBe(1)
    expect(fromHalf(0xc000)).toBe(-2)
    expect(fromHalf(0x7bff)).toBe(65504)
    expect(fromHalf(0x0001)).toBe(2 ** -24)
    expect(fromHalf(0x7c00)).toBe(Infinity)
  })

  it('keeps a velocity to 0.05% from 0.01 to 1,000 km/s', () => {
    for (let v = 0.01; v < 1000; v *= 1.37) {
      for (const s of [1, -1]) {
        const back = fromHalf(toHalf(s * v))
        expect(Math.abs(back - (s * v)) / v).toBeLessThanOrEqual(2 ** -11)
      }
    }
  })
})
