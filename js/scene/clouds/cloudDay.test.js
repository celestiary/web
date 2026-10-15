import {
  COMPLETE_BAND_DEG,
  INCOMPLETE_SHARE,
  SEAM_FADE_DEG,
  bandRows,
  blendSeam,
  buildDay,
  buildSeam,
  chooseDay,
  fadeSeam,
  fallbackSources,
  seamColumns,
  seamSource,
  seamWeight,
  unseenBelowPolar,
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
function tile(seen = () => true, colour = CLOUD) {
  const px = new Uint8ClampedArray(TILE_PX * TILE_PX * 4)
  for (let j = 0; j < TILE_PX; j++) {
    for (let i = 0; i < TILE_PX; i++) {
      px.set(seen(i, j) ? [...colour, 255] : [0, 0, 0, 255], 4 * ((j * TILE_PX) + i))
    }
  }
  return px
}
const FULL = tile()
const BLACK = tile(() => false)
// Seen, and the ocean's own colour: unmixes to no cloud.
const CLEAR = tile(() => true, OCEAN)


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

  describe('the bundled texture', () => {
    // North of 72° N unseen (polar night), the rest seen.
    const polarNight = ({row}) => (row === 0 ? tile((i, j) => j > 128) : FULL)
    const lazy = () => {
      const asked = []
      const get = () => {
        asked.push(true)
        return Promise.resolve(bundled)
      }
      return {asked, get}
    }

    it('is not asked for when every pixel is seen', async () => {
      const {asked, get} = lazy()
      const day = await build(fetcher(() => FULL), {bundled: get})
      expect(day).toMatchObject({complete: true, filled: 0})
      expect(asked.length).toBe(0)
      expect(day.coverage.every((v) => v === 255)).toBe(true)
    })

    it('is asked for once, after the tiles, when some pixels are unseen, and fills only those', async () => {
      const {asked, get} = lazy()
      const fetchTile = fetcher(polarNight)
      let askedAfter = -1
      const day = await build((url) => {
        // Every tile is fetched before the bundled texture is asked for.
        askedAfter = asked.length
        return fetchTile(url)
      }, {bundled: get})
      expect(askedAfter).toBe(0)
      expect(asked.length).toBe(1)
      expect(day.filled).toBeGreaterThan(0)
      expect(day.filled).toBe(day.unseen.reduce((n, v) => n + v, 0))
      for (let k = 0; k < day.coverage.length; k += 101) {
        expect(day.coverage[k]).toBe(day.unseen[k] ? BUNDLED : 255)
      }
    })

    it('fills a tile neither layer has, as when it began the map', async () => {
      const {asked, get} = lazy()
      const day = await build(fetcher(({row, col}) => (row === 1 && col === 2 ? null : FULL)), {bundled: get, stopAbove: Infinity})
      expect(asked.length).toBe(1)
      const r = tileRect(CLOUD_TILE_LEVEL, 1, 2)
      expect(day.filled).toBe(r.w * r.h)
    })

    it('is told the gaps are polar, so a coarse copy does, when they are above 50° N', async () => {
      const needs = []
      await build(fetcher(polarNight), {bundled: (need) => needs.push(need) && bundled})
      expect(needs).toEqual([{detail: false}])
    })

    it('is told the full texture is wanted for a tile no layer served', async () => {
      const needs = []
      await build(fetcher(({row, col}) => (row === 1 && col === 2 ? null : FULL)),
          {bundled: (need) => needs.push(need) && bundled, stopAbove: Infinity})
      expect(needs).toEqual([{detail: true}])
    })

    it('is the same, given as an array or as a function', async () => {
      const serve = fetcher(polarNight)
      const a = await build(serve, {bundled})
      const b = await build(serve, {bundled: lazy().get})
      expect(Buffer.from(a.coverage).equals(Buffer.from(b.coverage))).toBe(true)
      expect(a.filled).toBe(b.filled)
    })

    it('is not asked for by a day that is given up on: it isn\'t shown', async () => {
      const {asked, get} = lazy()
      const day = await build(fetcher(({row, col}) => (row === 1 && col === 2 ? null : FULL)), {bundled: get})
      expect(day.aborted).toBe(true)
      expect(day.filled).toBe(0)
      expect(asked.length).toBe(0)
    })

    it('leaves the unseen pixels clear if it can\'t be had', async () => {
      const day = await build(fetcher(polarNight), {bundled: () => Promise.resolve(null)})
      expect(day).toMatchObject({complete: true, filled: 0})
      const r = tileRect(CLOUD_TILE_LEVEL, 0, 0)
      expect(day.coverage[(r.y * W) + r.x]).toBe(0)
    })
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


describe('unseenBelowPolar', () => {
  const rows = (from, to) => {
    const unseen = new Uint8Array(W * H)
    unseen.fill(1, from * W, to * W)
    return unseen
  }

  it('is false for the polar caps, true for gaps in the band the satellites see in daylight', () => {
    const band = bandRows(H)
    expect(unseenBelowPolar(rows(0, band.top), W, H)).toBe(false)
    expect(unseenBelowPolar(rows(band.bottom, H), W, H)).toBe(false)
    expect(unseenBelowPolar(rows(band.top, band.top + 20), W, H)).toBe(true)
  })

  it('allows a sliver: no more than 0.2% of the band', () => {
    const band = bandRows(H)
    const unseen = new Uint8Array(W * H)
    unseen.fill(1, band.top * W, (band.top * W) + (0.001 * (band.bottom - band.top) * W))
    expect(unseenBelowPolar(unseen, W, H)).toBe(false)
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


describe('the antimeridian fade', () => {
  const COLUMNS = seamColumns(W)
  const TOP = bandRows(H).top

  /** @returns {Uint8Array} A map: clear (0) but for the east edge's columns, cloudy (255) */
  function dayMap() {
    const map = new Uint8Array(W * H)
    for (let j = 0; j < H; j++) {
      map.fill(255, (j * W) + W - COLUMNS, (j + 1) * W)
    }
    return map
  }
  const cloudyBefore = () => ({coverage: new Uint8Array(W * H).fill(255), unseen: new Uint8Array(W * H)})

  describe('the weights', () => {
    it('are 20° of columns, 1 at the cut falling in a line to 0 at its far edge', () => {
      expect(SEAM_FADE_DEG).toBe(20)
      expect(COLUMNS).toBe(Math.round(W * 20 / 360))
      expect(seamWeight(0, COLUMNS)).toBeCloseTo(1 - (0.5 / COLUMNS), 10)
      expect(seamWeight(COLUMNS - 1, COLUMNS)).toBeCloseTo(0.5 / COLUMNS, 10)
      expect(seamWeight(Math.floor(COLUMNS / 2), COLUMNS)).toBeCloseTo(0.5, 2)
      for (let x = 1; x < COLUMNS; x++) {
        expect(seamWeight(x, COLUMNS)).toBeLessThan(seamWeight(x - 1, COLUMNS))
      }
    })

    it('are symmetric about the middle of the band, and none outside it', () => {
      for (let x = 0; x < COLUMNS; x++) {
        expect(seamWeight(x, COLUMNS) + seamWeight(COLUMNS - 1 - x, COLUMNS)).toBeCloseTo(1, 10)
      }
      expect(seamWeight(COLUMNS, COLUMNS)).toBe(0)
      expect(seamWeight(W - 1, COLUMNS)).toBe(0)
    })
  })

  describe('seamSource', () => {
    it('is the day before, with its own layers', () => {
      expect(seamSource(DAY).date).toBe('2026-10-10')
      expect(layersOf(seamSource(DAY))).toEqual(['VIIRS_NOAA20', 'VIIRS_SNPP'])
      // NOAA-20 began on 2018-01-05: the day before is Suomi NPP and Aqua.
      expect(layersOf(seamSource(dailySource('2018-01-05')))).toEqual(['VIIRS_SNPP', 'MODIS_Aqua'])
    })

    it('crosses months, years and leap days', () => {
      expect(seamSource(dailySource('2026-03-01')).date).toBe('2026-02-28')
      expect(seamSource(dailySource('2024-03-01')).date).toBe('2024-02-29')
      expect(seamSource(dailySource('2026-01-01')).date).toBe('2025-12-31')
      expect(seamSource(dailySource('2017-01-01')).date).toBe('2016-12-31')
    })

    it('is none on the first day of the satellites', () => {
      expect(seamSource(dailySource('2000-02-24'))).toBe(null)
      expect(seamSource(dailySource('2000-02-25')).date).toBe('2000-02-24')
    })
  })

  describe('blendSeam', () => {
    it('puts the day before\'s clouds at the cut and the day\'s own at the fade\'s far edge', () => {
      const map = dayMap()
      const j = TOP + 100
      const own = (x) => map[(j * W) + x]
      // Before: the cut is a step of the whole range, from the east edge's cloud to the west's clear.
      expect(Math.abs(own(W - 1) - own(0))).toBe(255)
      const changed = blendSeam(map, cloudyBefore(), W, H)
      expect(changed).toBe(COLUMNS * H)
      // After: the cloud meets across it, within a level or two.
      expect(Math.abs(own(W - 1) - own(0))).toBeLessThanOrEqual(1)
      // Then a straight run down to the day's own clear at the far edge.
      const mid = Math.floor(COLUMNS / 2)
      expect(own(mid)).toBeGreaterThan(120)
      expect(own(mid)).toBeLessThan(135)
      expect(own(COLUMNS - 1)).toBeLessThanOrEqual(2)
      for (let x = 1; x < COLUMNS; x++) {
        expect(own(x)).toBeLessThanOrEqual(own(x - 1))
        // No step anywhere in the fade is more than a few levels (255 / 142 = 1.8).
        expect(own(x - 1) - own(x)).toBeLessThanOrEqual(3)
      }
    })

    it('leaves everything east of the fade\'s far edge, and the east edge, as it was', () => {
      const map = dayMap()
      const before = Uint8Array.from(map)
      blendSeam(map, cloudyBefore(), W, H)
      for (let j = 0; j < H; j += 61) {
        for (let x = COLUMNS; x < W; x++) {
          expect(map[(j * W) + x]).toBe(before[(j * W) + x])
        }
      }
    })

    it('fades the day before in only where it saw the ground', () => {
      const map = dayMap()
      const before = cloudyBefore()
      // Polar night in the day before: unseen from 70° N up.
      const rows = Math.round(20 * H / 180)
      before.unseen.fill(1, 0, rows * W)
      const changed = blendSeam(map, before, W, H)
      expect(changed).toBe(COLUMNS * (H - rows))
      expect(map[0]).toBe(0)
      expect(map[(rows * W)]).toBeGreaterThan(250)
    })

    it('keeps the day\'s own clouds at its east edge: the day after is not used', () => {
      const map = dayMap()
      blendSeam(map, cloudyBefore(), W, H)
      expect(map[((TOP + 5) * W) + W - 1]).toBe(255)
    })
  })

  describe('buildSeam', () => {
    it('builds the westernmost column of tiles of the day before, and nothing else', async () => {
      const fetchTile = fetcher(() => FULL)
      const day = await buildSeam({source: seamSource(DAY), ground, fetchTile})
      expect(day).toMatchObject({complete: true, failed: 0, unseenShare: 0, filled: 0})
      expect(fetchTile.requests.toSorted()).toEqual([0, 1, 2].map((row) => `VIIRS_NOAA20 2026-10-10 ${row} 0`))
      // The column is the day before's; the rest of the map is unseen, and
      // isn't filled from the bundled texture, which the strip never needs.
      expect(day.coverage[(TOP * W) + 5]).toBe(255)
      expect(day.coverage[(TOP * W) + TILE_PX + 5]).toBe(0)
      expect(day.unseen[(TOP * W) + TILE_PX + 5]).toBe(1)
    })

    it('judges the column as a day is: a missing tile in the band is incomplete', async () => {
      const day = await buildSeam({source: seamSource(DAY), ground, fetchTile: fetcher(({row}) => (row === 1 ? null : FULL))})
      expect(day.complete).toBe(false)
    })
  })

  describe('fadeSeam', () => {
    const shown = DAY
    // The day's own clouds are clear; the day before's are cloudy.
    const serve = ({date}) => (date === '2026-10-11' ? CLEAR : FULL)
    const run = async (fetchTile, map = dayMap(), opts = {}) => {
      const grounds = []
      const groundOf = (s) => {
        grounds.push(s.date)
        return ground
      }
      const result = await fadeSeam({map, shown, groundOf, fetchTile, ...opts})
      return {result, map, grounds}
    }

    it('fades the day before into the cut: 3 tiles, its own ground', async () => {
      const fetchTile = fetcher(serve)
      const before = dayMap()
      const {result, map, grounds} = await run(fetchTile)
      expect(result).toMatchObject({date: '2026-10-10', state: 'blended', unseenShare: 0})
      expect(grounds).toEqual(['2026-10-10'])
      expect(fetchTile.requests.length).toBe(3)
      expect(fetchTile.requests.every((r) => r.startsWith('VIIRS_NOAA20 2026-10-10 '))).toBe(true)
      const j = TOP + 50
      expect(Math.abs(map[(j * W) + W - 1] - map[j * W])).toBeLessThanOrEqual(1)
      expect(map[(j * W) + COLUMNS]).toBe(before[(j * W) + COLUMNS])
    })

    it('takes the day before across a year\'s end, with that month\'s ground', async () => {
      const fetchTile = fetcher(() => FULL)
      const grounds = []
      const result = await fadeSeam({
        map: dayMap(), shown: dailySource('2026-01-01'), fetchTile,
        groundOf: (s) => {
          grounds.push(s.date)
          return ground
        },
      })
      expect(result).toMatchObject({date: '2025-12-31', state: 'blended'})
      expect(grounds).toEqual(['2025-12-31'])
      expect(fetchTile.requests.every((r) => r.startsWith('VIIRS_NOAA20 2025-12-31 '))).toBe(true)
    })

    it('leaves the cut when the day before is incomplete: swaths missing in the band', async () => {
      const before = dayMap()
      const {result, map} = await run(fetcher(({date, row}) => (date === '2026-10-11' ? CLEAR : (row === 1 ? BLACK : FULL))))
      expect(result).toMatchObject({date: '2026-10-10', state: 'incomplete'})
      expect(result.unseenShare).toBeGreaterThan(INCOMPLETE_SHARE)
      expect(map).toEqual(before)
    })

    it('leaves the cut when a tile of the day before fails', async () => {
      const before = dayMap()
      const {result, map} = await run(fetcher(({date, row}) => (date === '2026-10-11' ? CLEAR : (row === 0 ? null : FULL))))
      expect(result.state).toBe('incomplete')
      expect(map).toEqual(before)
    })

    it('fades where it can when only the polar tile fails: that tile\'s pixels are the day\'s own', async () => {
      const before = dayMap()
      const {result, map} = await run(fetcher(({row}) => (row === 2 ? null : FULL)))
      expect(result.state).toBe('blended')
      const polar = tileRect(CLOUD_TILE_LEVEL, 2, 0)
      expect(map[(polar.y + 5) * W]).toBe(before[(polar.y + 5) * W])
      expect(map[(TOP * W)]).toBeGreaterThan(250)
    })

    it('leaves the cut, and says so, when the day before\'s ground fails', async () => {
      const before = dayMap()
      const warn = console.warn
      console.warn = () => {}
      try {
        const map = dayMap()
        const result = await fadeSeam({
          map, shown, fetchTile: fetcher(() => FULL), groundOf: () => Promise.reject(new Error('no ground')),
        })
        expect(result).toMatchObject({date: '2026-10-10', state: 'failed'})
        expect(map).toEqual(before)
      } finally {
        console.warn = warn
      }
    })

    it('does nothing before the satellites', async () => {
      const fetchTile = fetcher(() => FULL)
      const before = dayMap()
      const result = await fadeSeam({
        map: before, shown: dailySource('2000-02-24'), fetchTile, groundOf: () => ground,
      })
      expect(result).toMatchObject({date: null, state: 'none'})
      expect(fetchTile.requests.length).toBe(0)
      expect(before).toEqual(dayMap())
    })

    it('answers null, the map untouched, once stale', async () => {
      const before = dayMap()
      const {result, map} = await run(fetcher(() => FULL), dayMap(), {stale: () => true})
      expect(result).toBe(null)
      expect(map).toEqual(before)
    })
  })
})
