import {
  BaseSampler, DetailComposer, LUMA_EPS, PromiseCache, RATIO_MAX, RATIO_MIN, ancestorTile, decodeByte, detailRatios, encodeByte,
  lowpassLevel, lumaOf, sampleBilinear, tileLonLats, transferTile,
} from './detailTransfer.js'
import {srgbDecode} from '../srgb.js'


const SIZE = 8


describe('the detail transfer (detailTransfer.js)', () => {
  it('low-passes Bing at the level whose texels are the Blue Marble\'s', () => {
    // Bing: 256 px tiles, two across at level 0; the Blue Marble 8192 texels round.
    expect(lowpassLevel(8192, 256, 2)).toBe(4)
    // A scheme of one tile at level 0 (a URL template's Web Mercator).
    expect(lowpassLevel(8192, 256, 1)).toBe(5)
  })

  it('encodes and decodes sRGB bytes', () => {
    for (const b of [0, 1, 5, 20, 128, 254, 255]) {
      expect(encodeByte(decodeByte(b))).toBe(b)
    }
    expect(decodeByte(128)).toBeCloseTo(srgbDecode(128 / 255), 6)
    expect(encodeByte(2)).toBe(255)
    expect(encodeByte(-1)).toBe(0)
  })

  it('takes luminance in linear light, and reads a flipped image bottom up', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    const y = lumaOf(rgba)
    expect(Array.from(y).map((v) => Number(v.toFixed(4)))).toEqual([0.2126, 0.7152, 0.0722, 1])
    const flipped = lumaOf(rgba, true, 2)
    expect(Array.from(flipped).map((v) => Number(v.toFixed(4)))).toEqual([0.0722, 1, 0.2126, 0.7152])
  })

  it('samples bilinearly, clamped at the edges', () => {
    const v = new Float32Array([0, 1, 2, 3])
    expect(sampleBilinear(v, 2, 0.5, 0)).toBeCloseTo(0.5, 6)
    expect(sampleBilinear(v, 2, 0.5, 0.5)).toBeCloseTo(1.5, 6)
    expect(sampleBilinear(v, 2, -3, 9)).toBe(2)
  })

  it('finds a tile\'s ancestor', () => {
    expect(ancestorTile(13, 6, 7, 4)).toEqual({x: 1, y: 0, level: 4})
    expect(ancestorTile(3, 2, 3, 4)).toEqual({x: 3, y: 2, level: 3})
  })

  it('is no detail at the low level: its ratio is 1', () => {
    const fine = Float32Array.from({length: SIZE * SIZE}, (_, i) => 0.01 + ((i % 7) * 0.05))
    const r = detailRatios(fine, fine, {x: 3, y: 1, level: 4, lowLevel: 4, size: SIZE})
    for (const v of r) {
      expect(v).toBeCloseTo(1, 5)
    }
  })

  it('is the tile over its ancestor, averaging about 1, and clamped', () => {
    // A ramp low-passed is the ramp: a fine tile with texture over it.
    const low = Float32Array.from({length: SIZE * SIZE}, (_, i) => 0.05 + (0.002 * i))
    const tile = {x: 5, y: 2, level: 5, lowLevel: 4, size: SIZE}
    const fine = new Float32Array(SIZE * SIZE)
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const lx = ((1 + ((i + 0.5) / SIZE)) / 2 * SIZE) - 0.5
        const ly = ((0 + ((j + 0.5) / SIZE)) / 2 * SIZE) - 0.5
        const texture = ((i + j) % 2 ? 1.2 : 0.8)
        fine[(j * SIZE) + i] = ((sampleBilinear(low, SIZE, lx, ly) + LUMA_EPS) * texture) - LUMA_EPS
      }
    }
    const r = detailRatios(fine, low, tile)
    const mean = r.reduce((s, v) => s + v, 0) / r.length
    expect(mean).toBeCloseTo(1, 5)
    expect(r[0]).toBeCloseTo(0.8, 4)
    expect(r[1]).toBeCloseTo(1.2, 4)
    const glint = detailRatios(new Float32Array(SIZE * SIZE).fill(1), new Float32Array(SIZE * SIZE).fill(0.01), tile)
    expect(glint[0]).toBeCloseTo(RATIO_MAX, 6)
    const shadow = detailRatios(new Float32Array(SIZE * SIZE), new Float32Array(SIZE * SIZE).fill(0.5), tile)
    expect(shadow[0]).toBeCloseTo(RATIO_MIN, 6)
  })

  it('gives each row its latitude in Web Mercator, and in a geographic tile', () => {
    const rect = {west: 0, east: Math.PI / 2, south: 0, north: 1.4844222297453324}
    const merc = tileLonLats(rect, 2, true)
    expect(Array.from(merc.lons)).toEqual([22.5, 67.5])
    // Mercator's rows crowd toward the pole: the upper row's centre is higher than the middle.
    expect(merc.lats[0]).toBeGreaterThan((85.05 / 2) + 20)
    const geo = tileLonLats(rect, 2, false)
    expect(geo.lats[0]).toBeCloseTo(85.05 * 0.75, 1)
  })

  it('keeps the base\'s colour, times the ratio', async () => {
    // A base of two tiles of 2 px, a brown left and a darker right, sampled
    // between texel centres.
    const brown = [140, 110, 70]
    const tilesData = [
      new Uint8ClampedArray([...brown, 255, ...brown, 255, ...brown, 255, ...brown, 255]),
      new Uint8ClampedArray([...brown, 255, ...brown, 255, ...brown, 255, ...brown, 255]),
    ]
    const base = new BaseSampler((x) => Promise.resolve(tilesData[x]), {tilesX: 2, tilesY: 1, tileSize: 2})
    await base.load(-180, 180, -90, 90)
    const lonLats = {lons: new Float64Array([-90, 90]), lats: new Float64Array([45, -45])}
    const none = transferTile(null, lonLats, base)
    expect(Array.from(none.slice(0, 4))).toEqual([...brown, 255])
    const out = transferTile(new Float32Array([2, 0.5, 1, 1]), lonLats, base)
    const lin = brown.map((b) => decodeByte(b))
    expect(out[0]).toBe(encodeByte(lin[0] * 2))
    expect(out[5]).toBe(encodeByte(lin[1] * 0.5))
    // Hue kept: the channels' ratios in linear light are the base's.
    const back = [out[0], out[1], out[2]].map(decodeByte)
    expect(back[1] / back[0]).toBeCloseTo(lin[1] / lin[0], 2)
  })

  it('samples the base across its tiles\' edges and the antimeridian', async () => {
    const tilesData = [
      new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
      new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
    ]
    const base = new BaseSampler((x) => Promise.resolve(tilesData[x]), {tilesX: 2, tilesY: 1, tileSize: 2})
    await base.load(-180, 180, -90, 90)
    const out = [0, 0, 0]
    // At 0°, half way between the black tile's last texel and the white's first.
    base.sample(0, 0, out)
    expect(out[0]).toBeCloseTo(0.5, 6)
    // At 180°, between the white's last and the black's first.
    base.sample(180, 0, out)
    expect(out[0]).toBeCloseTo(0.5, 6)
  })

  it('caches promises, least recently used out, and forgets a failure', async () => {
    const cache = new PromiseCache(2)
    let made = 0
    const make = () => {
      made++
      return Promise.resolve(made)
    }
    await cache.get('a', make)
    await cache.get('b', make)
    await cache.get('a', make)
    await cache.get('c', make)
    expect([...cache.map.keys()]).toEqual(['a', 'c'])
    expect(made).toBe(3)
    await cache.get('x', () => Promise.reject(new Error('no'))).catch(() => undefined)
    await Promise.resolve()
    expect(cache.map.has('x')).toBe(false)
  })
})


describe('DetailComposer', () => {
  const grid = {tilesX: 2, tilesY: 1, tileSize: 2}
  const brown = new Uint8ClampedArray([140, 110, 70, 255, 140, 110, 70, 255, 140, 110, 70, 255, 140, 110, 70, 255])
  const job = (over = {}) => {
    const reads = {fine: 0, low: 0, base: 0}
    return {
      reads,
      job: {
        key: '1/0/1', lowKey: '0/0/0', month: 11, grid, mercator: false,
        tile: {x: 1, y: 0, level: 1, lowLevel: 0, size: SIZE},
        rect: {west: 0, east: Math.PI / 2, south: 0, north: Math.PI / 4},
        fineLuma: () => {
          reads.fine++
          return new Float32Array(SIZE * SIZE).fill(0.2)
        },
        lowLuma: () => {
          reads.low++
          return new Float32Array(SIZE * SIZE).fill(0.1)
        },
        basePixels: () => {
          reads.base++
          return brown
        },
        ...over,
      },
    }
  }

  it('reads each image once: a second month\'s tile reads only its own Blue Marble', () => {
    const c = new DetailComposer()
    const first = job()
    const a = c.compose(first.job)
    expect(first.reads).toEqual({fine: 1, low: 1, base: 2})
    const again = job()
    expect(c.compose(again.job)).toEqual(a)
    expect(again.reads).toEqual({fine: 0, low: 0, base: 0})
    const other = job({month: 12})
    c.compose(other.job)
    expect(other.reads).toEqual({fine: 0, low: 0, base: 2})
  })

  it('makes the base times the ratio, clamped', () => {
    const {job: j} = job()
    const out = new DetailComposer().compose(j)
    // Ratio (0.2 + eps) / (0.1 + eps), about 1.97.
    const r = (0.2 + LUMA_EPS) / (0.1 + LUMA_EPS)
    expect(out[0]).toBe(encodeByte(decodeByte(140) * r))
  })

  it('makes the base alone for a discarded tile', () => {
    const {job: j} = job({fineLuma: () => null})
    const out = new DetailComposer().compose(j)
    expect(Array.from(out.slice(0, 4))).toEqual([140, 110, 70, 255])
  })
})
