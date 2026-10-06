import {describe, expect, it} from 'bun:test'
import {RollingStat, StatFamily, percentile} from './stats.js'


describe('percentile', () => {
  it('is the nearest rank', () => {
    const v = Array.from({length: 100}, (_, i) => i + 1)
    expect(percentile(v, 0.95)).toBe(95)
    expect(percentile(v, 0.5)).toBe(50)
    expect(percentile(v, 1)).toBe(100)
  })

  it('does not depend on the order, and leaves its input alone', () => {
    const v = [5, 1, 4, 2, 3]
    expect(percentile(v, 0.95)).toBe(5)
    expect(v).toEqual([5, 1, 4, 2, 3])
  })

  it('is 0 for no values and the value for one', () => {
    expect(percentile([], 0.95)).toBe(0)
    expect(percentile([7], 0.95)).toBe(7)
  })
})


describe('RollingStat', () => {
  it('gives mean, p95 and max over what it holds', () => {
    const s = new RollingStat(100)
    for (let i = 1; i <= 100; i++) {
      s.add(i)
    }
    expect(s.mean()).toBeCloseTo(50.5, 9)
    expect(s.p95()).toBe(95)
    expect(s.max()).toBe(100)
    expect(s.n).toBe(100)
  })

  it('keeps the last `capacity` samples, oldest first', () => {
    const s = new RollingStat(4)
    for (let i = 1; i <= 6; i++) {
      s.add(i)
    }
    expect(s.samples()).toEqual([3, 4, 5, 6])
    expect(s.mean()).toBe(4.5)
  })

  it('ignores non-finite samples', () => {
    const s = new RollingStat(4)
    s.add(1)
    s.add(NaN)
    s.add(Infinity)
    s.add(3)
    expect(s.samples()).toEqual([1, 3])
  })

  it('is all zeros while empty', () => {
    const s = new RollingStat()
    expect(s.mean()).toBe(0)
    expect(s.p95()).toBe(0)
    expect(s.max()).toBe(0)
    expect(s.activeShare()).toBe(0)
  })

  it('counts the share of samples above zero', () => {
    const s = new RollingStat(10)
    for (const v of [0, 0, 0, 5, 0, 0, 0, 0, 5, 0]) {
      s.add(v)
    }
    expect(s.activeShare()).toBe(0.2)
    expect(s.mean()).toBe(1)
  })

  it('summarises rounded, and clears', () => {
    const s = new RollingStat(10)
    s.add(1 / 3)
    s.add(2 / 3)
    expect(s.summary(2)).toEqual({mean: 0.5, p95: 0.67, max: 0.67, runShare: 1, n: 2})
    s.clear()
    expect(s.n).toBe(0)
    expect(s.mean()).toBe(0)
  })

  it('a p95 of a spiky series is the spike, the mean is not', () => {
    const s = new RollingStat(100)
    for (let i = 0; i < 100; i++) {
      s.add(i < 90 ? 2 : 20)
    }
    expect(s.p95()).toBe(20)
    expect(s.mean()).toBeCloseTo(3.8, 9)
  })
})


describe('StatFamily', () => {
  it('counts a name missing from a frame as zero in it', () => {
    const f = new StatFamily(10)
    f.add({a: 2, b: 4})
    f.add({a: 2})
    expect(f.get('a').mean()).toBe(2)
    expect(f.get('b').mean()).toBe(2)
    expect(f.get('b').n).toBe(2)
  })

  it('counts a name new to it as zero in the frames before', () => {
    const f = new StatFamily(10)
    f.add({a: 1})
    f.add({a: 1})
    f.add({a: 1, late: 6})
    expect(f.get('late').samples()).toEqual([0, 0, 6])
    expect(f.get('late').mean()).toBe(2)
  })

  it('backfills no more than its window', () => {
    const f = new StatFamily(3)
    for (let i = 0; i < 10; i++) {
      f.add({a: 1})
    }
    f.add({a: 1, late: 3})
    expect(f.get('late').samples()).toEqual([0, 0, 3])
  })

  it('lists its names, and forgets them on clear', () => {
    const f = new StatFamily()
    f.add({x: 1, y: 2})
    expect(f.names()).toEqual(['x', 'y'])
    f.clear()
    expect(f.names()).toEqual([])
    expect(f.frames).toBe(0)
  })
})
