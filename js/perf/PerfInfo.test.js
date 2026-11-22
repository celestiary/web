import {describe, expect, it} from 'bun:test'
import {GRAPHS, Series, graphPoint, infoSections} from './PerfInfo.js'


describe('PerfInfo', () => {
  it('has the three graphs, side by side: FPS, frame time, memory', () => {
    expect(GRAPHS.map((g) => g.key)).toEqual(['fps', 'ms', 'mb'])
  })

  it('makes a redraw\'s point from the frames since the last', () => {
    expect(graphPoint({n: 30, sumMs: 500}, {usedJSHeapSize: 64 * 1024 * 1024})).toEqual({fps: 60, ms: 500 / 30, mb: 64})
    // No frames, and no performance.memory (not Chromium): nothing to say.
    expect(graphPoint({n: 0, sumMs: 0}, undefined)).toEqual({fps: null, ms: null, mb: null})
  })

  it('keeps a rolling series and its range over the points kept', () => {
    const s = new Series(3)
    expect(s.last()).toBeNull()
    for (const v of [5, 1, 9, 4]) {
      s.add(v)
    }
    expect(s.values).toEqual([1, 9, 4])
    expect(s.last()).toBe(4)
    expect(s.min).toBe(1)
    expect(s.max).toBe(9)
    // The range is the kept points', not every point's.
    s.add(2)
    s.add(3)
    expect(s.values).toEqual([4, 2, 3])
    expect(s.min).toBe(2)
    expect(s.max).toBe(4)
  })

  it('builds the render info from the overlay\'s summary and the renderer', () => {
    const summary = {
      frame: {fps: 59.94, intervalMs: {mean: 16.683}},
      total: {cpu: {mean: 3.21}},
      three: {calls: 41, triangles: 1e5, points: 7, lines: 8},
    }
    const renderer = {info: {memory: {geometries: 12, textures: 34}}}
    const sections = infoSections(summary, renderer, {usedJSHeapSize: 100 * 1024 * 1024, jsHeapSizeLimit: 4096 * 1024 * 1024})
    const value = (title, name) => sections.find((s) => s.title.startsWith(title)).rows.find((r) => r[0] === name)[1]
    expect(sections.map((s) => s.title.split(' ')[0])).toEqual(['Frame', 'Memory', 'Render'])
    expect(value('Frame', 'FPS')).toBe('59.9')
    expect(value('Frame', 'frame time')).toBe('16.68 ms')
    expect(value('Frame', 'CPU to issue')).toBe('3.21 ms')
    expect(value('Memory', 'textures')).toBe('34')
    expect(value('Memory', 'JS heap')).toBe('100 / 4096 MB')
    expect(value('Render', 'triangles')).toBe('100000')
    const bare = infoSections({...summary, three: undefined}, {}, undefined)
    expect(bare.find((s) => s.title === 'Memory').rows.find((r) => r[0] === 'JS heap')[1]).toBe('n/a')
    expect(bare.find((s) => s.title.startsWith('Render')).rows.find((r) => r[0] === 'calls')[1]).toBe('0')
  })
})
