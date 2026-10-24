import {describe, expect, it} from 'bun:test'
import {canvasOver, classifyCityPixels, halfToFloat, summarizeFrames} from './newYorkDebug.js'


describe('summarizeFrames', () => {
  it('finds the frames that showed the city and drew none of it, and the frames between them', () => {
    const rows = []
    for (let f = 0; f < 120; f++) {
      const missing = f % 50 === 49
      rows.push({t: f * 40, cesiumRenders: 1, lightsFrames: 0, shown: true, cityDraws: missing ? 0 : 187,
        calls: [{staged: missing}]})
    }
    // Not shown: not counted as missing
    rows.push({t: 120 * 40, cesiumRenders: 1, lightsFrames: 1, shown: false, cityDraws: 0, calls: []})
    const s = summarizeFrames(rows)
    expect(s.frames).toBe(121)
    expect(s.fps).toBe(25)
    expect(s.framesShown).toBe(120)
    expect(s.framesWithoutCity).toBe(2)
    expect(s.withoutCityAt).toEqual([49, 99])
    expect(s.framesBetween).toEqual([50])
    expect(s.stagedCalls).toBe(2)
    expect(s.cityDrawsPerFrame).toEqual({min: 0, median: 187, max: 187})
    expect(s.cityCallsPerFrame).toEqual([0, 1])
    expect(s.lightsFrames).toBe(1)
  })

  it('reports nothing for no frames', () => {
    const s = summarizeFrames([])
    expect(s.frames).toBe(0)
    expect(s.fps).toBe(null)
    expect(s.cityDrawsPerFrame).toBe(null)
  })
})


describe('classifyCityPixels', () => {
  it('sorts the city\'s pixels by where their light comes from', () => {
    const width = 4
    const height = 1
    // Pixel 0: no city.  1: the city, black.  2: the city, its day frame lit
    // blue.  3: the city, black, with the night lights added over it.
    const dayWithout = new Uint8Array(16)
    const dayWith = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 3, 2, 0, 0, 0, 3])
    const sceneWithout = new Float32Array(16)
    sceneWithout[0] = 0.5
    const sceneWith = Float32Array.from([0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 2e4, 1, 0, 1e-3, 3e-3, 1])
    const lightsWith = Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1e-3, 3e-3, 0])
    const c = classifyCityPixels({width, height, dayWith, dayWithout, sceneWith, sceneWithout, lightsWith})
    expect(c.city).toBe(3)
    expect(c.dayLit).toBe(1)
    expect(c.dayCodes).toEqual({'0,0,3': 1})
    expect(c.lightsAdded).toBe(1)
    expect(c.lightsMax).toEqual([0, 1e-3, 3e-3].map((v) => Math.fround(v)))
    expect(c.sceneLit).toBe(2)
    expect(c.holes).toBe(0)
  })

  it('decodes half floats', () => {
    expect(halfToFloat(0x3c00)).toBe(1)
    expect(halfToFloat(0xc000)).toBe(-2)
    expect(halfToFloat(0x0001)).toBeCloseTo(5.96e-8, 10)
    expect(halfToFloat(0x7c00)).toBe(Infinity)
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true)
  })
})


describe('canvasOver', () => {
  it('counts the lit pixels and means over every masked one', () => {
    const canvas = Uint8Array.from([0, 0, 0, 255, 0, 0, 30, 255, 9, 9, 9, 255])
    expect(canvasOver(canvas, Uint8Array.from([1, 1, 0]))).toEqual({n: 2, lit: 1, mean: [0, 0, 15]})
  })
})
