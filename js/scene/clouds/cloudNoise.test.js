import {
  DETAIL_SIZE,
  SHAPE_SIZE,
  detailNoise,
  detailTexel,
  equalize,
  perlin,
  remap,
  shapeNoise,
  shapeTexel,
  sliceSteps,
  worley,
} from './cloudNoise.js'


describe('perlin', () => {
  it('is periodic in every axis', () => {
    const period = 4
    for (const [x, y, z] of [[0.3, 1.7, 2.2], [3.9, 0.1, 1.5], [1.25, 2.5, 3.75]]) {
      const v = perlin(x, y, z, period)
      expect(perlin(x + period, y, z, period)).toBeCloseTo(v, 12)
      expect(perlin(x, y + period, z, period)).toBeCloseTo(v, 12)
      expect(perlin(x, y, z - period, period)).toBeCloseTo(v, 12)
    }
  })

  it('is zero on the lattice and within −1..1 between', () => {
    expect(perlin(2, 1, 3, 4)).toBe(0)
    let lo = 0
    let hi = 0
    for (let i = 0; i < 2000; i++) {
      const v = perlin(Math.random() * 4, Math.random() * 4, Math.random() * 4, 4)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    expect(lo).toBeGreaterThan(-1)
    expect(hi).toBeLessThan(1)
    expect(hi - lo).toBeGreaterThan(0.5)
  })
})


describe('worley', () => {
  it('is periodic, in 0..1, and 1 at a feature point', () => {
    const period = 8
    for (const [x, y, z] of [[0.3, 1.7, 2.2], [7.9, 0.1, 1.5]]) {
      const v = worley(x, y, z, period)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      expect(worley(x + period, y, z, period)).toBeCloseTo(v, 12)
      expect(worley(x, y - period, z, period)).toBeCloseTo(v, 12)
      expect(worley(x, y, z + period, period)).toBeCloseTo(v, 12)
    }
    // Find a feature point by taking the nearest cell's hashes as the
    // function does: the brightest value near it is 1.
    let best = 0
    for (let i = 0; i < 4000; i++) {
      best = Math.max(best, worley(Math.random() * 8, Math.random() * 8, Math.random() * 8, 8))
    }
    expect(best).toBeGreaterThan(0.9)
  })
})


describe('remap', () => {
  it('maps and clamps', () => {
    expect(remap(0.5, 0, 1, 10, 20)).toBe(15)
    expect(remap(-1, 0, 1, 10, 20)).toBe(10)
    expect(remap(2, 0, 1, 10, 20)).toBe(20)
    expect(remap(0.75, 0.5, 1, 0, 1)).toBe(0.5)
  })
})


describe('the textures', () => {
  it('give four channels in 0..1, and tile across their edges', () => {
    for (const texel of [shapeTexel, detailTexel]) {
      const a = texel(0.001, 0.4, 0.6)
      const b = texel(0.999, 0.4, 0.6)
      expect(a).toHaveLength(4)
      for (let i = 0; i < 4; i++) {
        expect(a[i]).toBeGreaterThanOrEqual(0)
        expect(a[i]).toBeLessThanOrEqual(1)
        // Within a texel of the edge: continuous across it (the period).
        if (i < 3 || texel === shapeTexel) {
          expect(Math.abs(a[i] - b[i])).toBeLessThan(0.1)
        }
      }
    }
  })

  it('fill a small texture slice by slice', () => {
    const size = 4
    const out = new Uint8Array(size * size * size * 4)
    const slices = []
    for (const z of sliceSteps(size, shapeTexel, out)) {
      slices.push(z)
    }
    expect(slices).toEqual([0, 1, 2, 3])
    expect(Math.max(...out)).toBeGreaterThan(0)
  })

  it('are sized as the renderer expects', () => {
    expect(shapeNoise(8).data.length).toBe(8 * 8 * 8 * 4)
    expect(detailNoise(4).data.length).toBe(4 * 4 * 4 * 4)
    expect(SHAPE_SIZE).toBe(128)
    expect(DETAIL_SIZE).toBe(32)
  })

  it('equalises the shape\'s red, so a coverage c thresholds c of the volume', () => {
    const {data, steps} = shapeNoise(16)
    while (!steps.next().done) {
      // Fill it.
    }
    const count = data.length / 4
    for (const coverage of [0.2, 0.5, 0.8]) {
      let above = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] / 255 > 1 - coverage) {
          above++
        }
      }
      expect(Math.abs((above / count) - coverage)).toBeLessThan(0.03)
    }
    // The other channels are left as they are: Worley, mostly mid-range.
    let sum = 0
    for (let i = 1; i < data.length; i += 4) {
      sum += data[i]
    }
    expect(sum / count / 255).toBeGreaterThan(0.2)
    expect(sum / count / 255).toBeLessThan(0.8)
  })

  it('equalize maps a two-valued channel to its ranks', () => {
    const data = new Uint8Array([10, 0, 0, 0, 10, 0, 0, 0, 200, 0, 0, 0, 200, 0, 0, 0])
    equalize(data, 0)
    expect(Array.from(data).filter((_, i) => i % 4 === 0)).toEqual([64, 64, 191, 191])
  })
})
