import {
  COMPLETE_BAND_DEG,
  INCOMPLETE_SHARE,
  bandRows,
  buildDay,
  chooseDay,
  fallbackSources,
  unseenInBand,
} from './cloudDay.js'
import {CLOUD_TILE_LEVEL, TILE_PX, cloudSource, dailySource, previousDate, tileGrid, tileRect} from './cloudSource.js'


const {width: W, height: H} = tileGrid(CLOUD_TILE_LEVEL)
const layersOf = (s) => s.layers.map((l) => l.layer.replace('_CorrectedReflectance_TrueColor', ''))

// The ground: a dark ocean everywhere.  A thick cloud over it unmixes to
// full coverage, and the bundled texture's coverage is a constant 77 (so
// its pixels can be told apart).
const OCEAN = [10, 20, 60]
const CLOUD = [235, 235, 235]
const BUNDLED = 77
const ground = new Uint8ClampedArray(W * H * 4)
for (let i = 0; i < W * H; i++) {
  ground.set([...OCEAN, 255], 4 * i)
}
const bundled = new Uint8Array(W * H).fill(BUNDLED)


/**
 * @param {function(number, number): boolean} seen (i, j) within the tile:
 *   whether the satellite saw that pixel (cloud), or not (black)
 * @returns {Uint8ClampedArray} A tile's RGBA
 */
function tile(seen = () => true) {
  const px = new Uint8ClampedArray(TILE_PX * TILE_PX * 4)
  for (let j = 0; j < TILE_PX; j++) {
    for (let i = 0; i < TILE_PX; i++) {
      px.set(seen(i, j) ? [...CLOUD, 255] : [0, 0, 0, 255], 4 * ((j * TILE_PX) + i))
    }
  }
  return px
}
const FULL = tile()
const BLACK = tile(() => false)


/**
 * @param {function(object): ?Uint8ClampedArray} serve By {layer, date, row, col}
 * @returns {function(string): Promise<?Uint8ClampedArray>} A fetchTile over it
 */
function fetcher(serve) {
  const requests = []
  const fetchTile = (url) => {
    const [, layer, date, row, col] = url.match(/best\/(\w+?)_CorrectedReflectance_TrueColor\/default\/([\d-]+)\/250m\/\d+\/(\d+)\/(\d+)/)
    requests.push(`${layer} ${date} ${row} ${col}`)
    return Promise.resolve(serve({layer, date, row: Number(row), col: Number(col)}))
  }
  fetchTile.requests = requests
  return fetchTile
}

const DAY = dailySource('2026-10-11')
const build = (fetchTile, opts = {}) => buildDay({source: DAY, ground, bundled, fetchTile, ...opts})


describe('bandRows', () => {
  it('is the map\'s rows within 50° N and S', () => {
    const band = bandRows(H)
    expect(band.top).toBe(Math.round(40 * H / 180))
    expect(band.bottom).toBe(Math.round(140 * H / 180))
    expect(COMPLETE_BAND_DEG).toBe(50)
  })

  it('counts a rect\'s unseen pixels within it only', () => {
    const unseen = new Uint8Array(W * H).fill(1)
    const band = bandRows(H)
    // The polar row of tiles (54° S on) is outside it.
    expect(unseenInBand(unseen, tileRect(CLOUD_TILE_LEVEL, 2, 0), W, band)).toBe(0)
    expect(unseenInBand(unseen, tileRect(CLOUD_TILE_LEVEL, 1, 0), W, band)).toBe(TILE_PX * (band.bottom - TILE_PX))
  })
})


describe('fallbackSources', () => {
  it('is the day, then the two before it', () => {
    expect(fallbackSources(DAY).map((s) => s.date)).toEqual(['2026-10-11', '2026-10-10', '2026-10-09'])
  })

  it('gives each day its own layers', () => {
    const sources = fallbackSources(dailySource('2018-01-05'))
    expect(sources.map((s) => s.date)).toEqual(['2018-01-05', '2018-01-04', '2018-01-03'])
    expect(layersOf(sources[0])).toEqual(['VIIRS_NOAA20', 'VIIRS_SNPP'])
    expect(layersOf(sources[1])).toEqual(['VIIRS_SNPP', 'MODIS_Aqua'])
  })

  it('stops at the first satellite day', () => {
    expect(fallbackSources(dailySource('2000-02-25')).map((s) => s.date)).toEqual(['2000-02-25', '2000-02-24'])
  })

  it('crosses months and years', () => {
    expect(previousDate('2026-03-01')).toBe('2026-02-28')
    expect(previousDate('2026-01-01')).toBe('2025-12-31')
  })
})


describe('buildDay', () => {
  it('builds a complete day whole', async () => {
    const fetchTile = fetcher(() => FULL)
    const day = await build(fetchTile)
    expect(day).toMatchObject({complete: true, aborted: false, failed: 0, unseenShare: 0})
    // Every pixel is the mosaic's cloud; the secondary isn't asked for.
    expect(day.coverage.every((v) => v === 255)).toBe(true)
    expect(fetchTile.requests.length).toBe(15)
    expect(fetchTile.requests.every((r) => r.startsWith('VIIRS_NOAA20 2026-10-11'))).toBe(true)
  })

  it('fills the primary\'s gaps from the secondary', async () => {
    // NOAA-20 missed the west half of the tile at −108° to −36°; Suomi NPP saw it.
    const day = await build(fetcher(({layer, row, col}) => {
      if (layer === 'VIIRS_NOAA20' && row === 1 && col === 1) {
        return tile((i) => i >= TILE_PX / 2)
      }
      return FULL
    }))
    expect(day.complete).toBe(true)
    const r = tileRect(CLOUD_TILE_LEVEL, 1, 1)
    expect(day.coverage[((r.y + 100) * W) + r.x + 10]).toBe(255)
  })

  it('finds a day with a tile neither layer has incomplete, and stops there', async () => {
    // The tile from −36° to 36°, 18° N to 54° S: its western edge is where
    // #243's seam was.
    const fetchTile = fetcher(({row, col}) => (row === 1 && col === 2 ? null : FULL))
    const day = await build(fetchTile)
    expect(day).toMatchObject({complete: false, aborted: true, failed: 1})
    expect(day.unseenShare).toBeGreaterThan(INCOMPLETE_SHARE)
    // It stopped soon after, not fetching the rest of the day.
    expect(fetchTile.requests.length).toBeLessThan(15 + 4)
  })

  it('gives a tile neither layer has the bundled texture\'s clouds, not none', async () => {
    const day = await build(fetcher(({row, col}) => (row === 1 && col === 2 ? null : FULL)), {stopAbove: Infinity})
    expect(day).toMatchObject({complete: false, aborted: false, failed: 1})
    const r = tileRect(CLOUD_TILE_LEVEL, 1, 2)
    for (let j = r.y; j < r.y + r.h; j += 37) {
      expect(day.coverage[(j * W) + r.x]).toBe(BUNDLED)
      expect(day.coverage[(j * W) + r.x - 1]).toBe(255)
    }
  })

  it('finds an unfinished day incomplete: swaths in one tile, not yet in the next', async () => {
    // As GIBS served 2026-10-12 on the 13th: a tile edge with the swaths on
    // one side and black on the other, in both layers.
    const day = await build(fetcher(({row, col}) => (row === 1 && col <= 1 ? BLACK : FULL)))
    expect(day.complete).toBe(false)
  })

  it('takes polar night, and a missing polar tile, as complete', async () => {
    const day = await build(fetcher(({row, col}) => {
      if (row === 2) {
        return col === 0 ? null : BLACK
      }
      // North of 72° N unseen.
      return row === 0 ? tile((i, j) => j > 128) : FULL
    }))
    expect(day.complete).toBe(true)
  })

  it('answers null once stale', async () => {
    let n = 0
    const day = await build(fetcher(() => FULL), {stale: () => ++n > 20})
    expect(day).toBe(null)
  })
})


describe('chooseDay', () => {
  const builder = (completeDates) => {
    const calls = []
    const fn = (source, stopAbove) => {
      calls.push([source.date, stopAbove])
      return Promise.resolve({complete: completeDates.includes(source.date), coverage: source.date})
    }
    fn.calls = calls
    return fn
  }

  it('shows the wanted day when it is complete', async () => {
    const b = builder(['2026-10-11'])
    const {source} = await chooseDay(fallbackSources(DAY), b)
    expect(source.date).toBe('2026-10-11')
    expect(b.calls).toEqual([['2026-10-11', INCOMPLETE_SHARE]])
  })

  it('shows the latest complete day before an incomplete one', async () => {
    // 2026-10-13: the present was the 12th, which GIBS hadn't finished.
    const present = cloudSource(Date.parse('2026-10-13T15:00:00Z'), Date.parse('2026-10-13T22:00:00Z'))
    expect(present.date).toBe('2026-10-12')
    const b = builder(['2026-10-11', '2026-10-10'])
    const {source} = await chooseDay(fallbackSources(present), b)
    expect(source.date).toBe('2026-10-11')
  })

  it('shows the wanted day, gaps and all, when none is complete', async () => {
    const b = builder([])
    const {source} = await chooseDay(fallbackSources(DAY), b)
    expect(source.date).toBe('2026-10-11')
    expect(b.calls.map((c) => c[0])).toEqual(['2026-10-11', '2026-10-10', '2026-10-09', '2026-10-11'])
    expect(b.calls.at(-1)[1]).toBe(Infinity)
  })

  it('answers null when a build goes stale', async () => {
    expect(await chooseDay(fallbackSources(DAY), () => Promise.resolve(null))).toBe(null)
  })
})
