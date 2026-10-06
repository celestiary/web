import {
  CLOUD_TILE_LEVEL,
  CLOUD_WHITE,
  COVERAGE_CLEAR,
  GAP_MARGIN,
  TILE_PX,
  cloudSource,
  coverageFromBundled,
  coverageFromColour,
  dilate,
  fillNarrowGaps,
  tileGrid,
  tileRect,
  tileUrl,
  unmixTile,
  utcDate,
} from './cloudSource.js'
import {FAR_FIELD_FADE_M, CLOUD_HEIGHT_M, farFieldOpacity} from './CloudShell.js'


const NOW = Date.parse('2026-10-06T12:00:00Z')
const at = (iso) => Date.parse(iso)
const layersOf = (s) => s.layers.map((l) => l.layer.replace('_CorrectedReflectance_TrueColor', ''))


describe('cloudSource', () => {
  it('takes a VIIRS day from 2018, NOAA-20 first and Suomi NPP for its gaps', () => {
    // Hurricane Ian, landfall in Florida.
    const s = cloudSource(at('2022-09-28T18:00:00Z'), NOW)
    expect(s).toMatchObject({kind: 'daily', date: '2022-09-28'})
    expect(layersOf(s)).toEqual(['VIIRS_NOAA20', 'VIIRS_SNPP'])
  })

  it('takes Suomi NPP before NOAA-20 flew, with MODIS Aqua behind it', () => {
    expect(layersOf(cloudSource(at('2017-09-06T12:00:00Z'), NOW))).toEqual(['VIIRS_SNPP', 'MODIS_Aqua'])
    expect(layersOf(cloudSource(at('2018-01-04T23:59:59Z'), NOW))).toEqual(['VIIRS_SNPP', 'MODIS_Aqua'])
    expect(layersOf(cloudSource(at('2018-01-05T00:00:00Z'), NOW))).toEqual(['VIIRS_NOAA20', 'VIIRS_SNPP'])
  })

  it('takes MODIS Aqua, then Terra, before VIIRS', () => {
    // Hurricane Katrina over the Gulf.
    const katrina = cloudSource(at('2005-08-28T17:00:00Z'), NOW)
    expect(katrina).toMatchObject({kind: 'daily', date: '2005-08-28'})
    expect(layersOf(katrina)).toEqual(['MODIS_Aqua', 'MODIS_Terra'])
    expect(layersOf(cloudSource(at('2001-09-11T13:00:00Z'), NOW))).toEqual(['MODIS_Terra'])
    expect(layersOf(cloudSource(at('2000-02-24T00:00:00Z'), NOW))).toEqual(['MODIS_Terra'])
  })

  it('falls back to the bundled texture before the satellites', () => {
    expect(cloudSource(at('2000-02-23T23:59:59Z'), NOW)).toEqual({kind: 'bundled', reason: 'before the satellites'})
    expect(cloudSource(at('1969-07-20T20:17:00Z'), NOW).kind).toBe('bundled')
  })

  it('shows the latest complete day for the present', () => {
    // At noon UTC, yesterday's mosaic is complete (27 h back is the 5th).
    expect(cloudSource(NOW, NOW)).toMatchObject({kind: 'daily', date: '2026-10-05'})
    // Just after midnight UTC, yesterday's isn't yet: the day before.
    const earlyNow = at('2026-10-06T01:00:00Z')
    expect(cloudSource(earlyNow, earlyNow)).toMatchObject({kind: 'daily', date: '2026-10-04'})
    // A clock a few hours ahead of real time is still the present.
    expect(cloudSource(NOW + (6 * 3600e3), NOW)).toMatchObject({kind: 'daily', date: '2026-10-05'})
  })

  it('falls back to the bundled texture in the future', () => {
    expect(cloudSource(at('2026-12-21T17:00:00Z'), NOW)).toEqual({kind: 'bundled', reason: 'future'})
  })

  it('falls back without a date', () => {
    expect(cloudSource(NaN, NOW).kind).toBe('bundled')
  })
})


describe('utcDate', () => {
  it('is the UTC calendar date', () => {
    expect(utcDate(at('2005-08-28T23:59:59Z'))).toBe('2005-08-28')
    expect(utcDate(at('2005-08-29T00:00:00Z'))).toBe('2005-08-29')
  })
})


describe('tiles', () => {
  it('lays GIBS level 2 out as 5 × 3 tiles over a 2560 × 1280 map', () => {
    expect(CLOUD_TILE_LEVEL).toBe(2)
    expect(tileGrid(2)).toEqual({cols: 5, rows: 3, tileDeg: 72, width: 2560, height: 1280})
    expect(tileGrid(3)).toEqual({cols: 10, rows: 5, tileDeg: 36, width: 5120, height: 2560})
    expect(tileGrid(1)).toMatchObject({cols: 3, rows: 2, width: 1280, height: 640})
  })

  it('clips the last row at the south pole', () => {
    expect(tileRect(2, 0, 0)).toEqual({x: 0, y: 0, w: TILE_PX, h: TILE_PX})
    expect(tileRect(2, 2, 4)).toEqual({x: 2048, y: 1024, w: 512, h: 256})
  })

  it('builds the WMTS REST URL', () => {
    expect(tileUrl('MODIS_Aqua_CorrectedReflectance_TrueColor', '2005-08-28', 2, 1, 3)).toBe(
        'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Aqua_CorrectedReflectance_TrueColor/' +
        'default/2005-08-28/250m/2/1/3.jpeg')
  })
})


describe('coverageFromColour', () => {
  const ocean = [2, 5, 20]
  const land = [80, 70, 40]

  it('is 0 for the ground as the Blue Marble has it, or a little hazier', () => {
    expect(coverageFromColour(...ocean, ...ocean)).toBe(0)
    expect(coverageFromColour(...land, ...land)).toBe(0)
    // Clear ocean in the mosaics is brighter than the Blue Marble's.
    const hazy = ocean.map((v) => v + (0.1 * ((CLOUD_WHITE * 255) - v)))
    expect(coverageFromColour(...hazy, ...ocean)).toBe(0)
  })

  it('is 1 for a white cloud top over any ground', () => {
    const white = [235, 235, 235]
    expect(coverageFromColour(...white, ...ocean)).toBe(1)
    expect(coverageFromColour(...white, ...land)).toBe(1)
  })

  it('unmixes a half-covered pixel to about a half', () => {
    const half = ocean.map((v) => (v + (CLOUD_WHITE * 255)) / 2)
    const c = coverageFromColour(...half, ...ocean)
    expect(c).toBeGreaterThan(0.45)
    expect(c).toBeLessThan(0.55)
  })

  it('takes the least of the channels: a colour shift in one is not cloud', () => {
    // Greener than in 2004: only green brightens.
    expect(coverageFromColour(80, 160, 40, ...land)).toBe(0)
  })

  it('marks black as no data (between swaths, polar night)', () => {
    expect(coverageFromColour(0, 0, 0, ...ocean)).toBe(-1)
    expect(coverageFromColour(3, 2, 1, ...land)).toBe(-1)
    expect(coverageFromColour(4, 2, 1, ...ocean)).toBeGreaterThanOrEqual(0)
  })

  it('stretches from COVERAGE_CLEAR', () => {
    const justClear = ocean.map((v) => v + (COVERAGE_CLEAR * ((CLOUD_WHITE * 255) - v)))
    expect(coverageFromColour(...justClear, ...ocean)).toBeLessThan(0.02)
  })
})


describe('coverageFromBundled', () => {
  it('drops the infrared picture\'s warm grey ground and keeps its white cloud', () => {
    expect(coverageFromBundled(0)).toBe(0)
    expect(coverageFromBundled(92)).toBe(0) // Australia: 0.29-0.36
    expect(coverageFromBundled(255)).toBe(1)
    expect(coverageFromBundled(166)).toBe(1)
    expect(coverageFromBundled(130)).toBeGreaterThan(0.4)
  })
})


describe('dilate', () => {
  it('grows a mask by a square', () => {
    const w = 7
    const h = 5
    const mask = new Uint8Array(w * h)
    mask[(2 * w) + 3] = 1
    const out = dilate(mask, w, h, 1)
    const set = []
    out.forEach((v, i) => v && set.push([i % w, Math.floor(i / w)]))
    expect(set.length).toBe(9)
    expect(set).toContainEqual([2, 1])
    expect(set).toContainEqual([4, 3])
  })
})


describe('unmixTile', () => {
  // A 2 × 1 map of tiles 8 px square: the left tile white cloud over ocean,
  // with a black gap down its middle.
  const S = 8
  const W = 2 * S
  const ground = new Uint8ClampedArray(4 * W * S)
  for (let i = 0; i < W * S; i++) {
    ground.set([2, 5, 20, 255], 4 * i)
  }
  const tile = (gapCols) => {
    const t = new Uint8ClampedArray(4 * S * S)
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const v = gapCols.includes(i) ? 0 : 240
        t.set([v, v, v, 255], 4 * ((j * S) + i))
      }
    }
    return t
  }
  const region = {x: 0, y: 0, w: S, h: S}

  it('fills the gap and its margin from the fill, and marks it unseen', () => {
    const out = new Uint8Array(W * S)
    const fill = new Uint8Array(W * S).fill(7)
    const unseen = new Uint8Array(W * S).fill(1)
    const missing = unmixTile(tile([4]), S, region, ground, out, fill, unseen, W)
    // The gap column and GAP_MARGIN either side.
    expect(missing).toBe(S * ((2 * GAP_MARGIN) + 1))
    expect(out[4]).toBe(7)
    expect(unseen[4]).toBe(1)
    expect(out[4 - GAP_MARGIN - 1]).toBe(255)
    expect(unseen[0]).toBe(0)
    // The other tile is untouched.
    expect(out[S]).toBe(0)
    expect(unseen[S]).toBe(1)
  })

  it('with gapsOnly, a second layer writes only what is still unseen', () => {
    const out = new Uint8Array(W * S)
    const fill = new Uint8Array(W * S).fill(7)
    const unseen = new Uint8Array(W * S).fill(1)
    unmixTile(tile([4]), S, region, ground, out, fill, unseen, W)
    out[0] = 99
    // A clear second layer: ocean everywhere.
    const clear = new Uint8ClampedArray(4 * S * S)
    for (let i = 0; i < S * S; i++) {
      clear.set([2, 5, 20, 255], 4 * i)
    }
    const missing = unmixTile(clear, S, region, ground, out, fill, unseen, W, true)
    expect(missing).toBe(0)
    expect(out[4]).toBe(0)
    expect(unseen[4]).toBe(0)
    expect(out[0]).toBe(99)
  })
})


describe('farFieldOpacity', () => {
  it('is 1 from high up and 0 near the deck, smoothly between', () => {
    const [hi, lo] = FAR_FIELD_FADE_M
    expect(farFieldOpacity(400e3)).toBe(1)
    expect(farFieldOpacity(CLOUD_HEIGHT_M + hi)).toBe(1)
    expect(farFieldOpacity(CLOUD_HEIGHT_M + lo)).toBe(0)
    expect(farFieldOpacity(0)).toBe(0)
    expect(farFieldOpacity(CLOUD_HEIGHT_M + ((hi + lo) / 2))).toBeCloseTo(0.5, 6)
  })
})


describe('fillNarrowGaps', () => {
  it('fills a narrow gap from either side and leaves a wide one', () => {
    const w = 12
    const h = 3
    const out = new Uint8Array(w * h)
    const unseen = new Uint8Array(w * h)
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        out[(j * w) + i] = i < 6 ? 100 : 200
      }
      // A 2-pixel gap at 5-6 in every row.
      unseen[(j * w) + 5] = 1
      unseen[(j * w) + 6] = 1
      out[(j * w) + 5] = 7
      out[(j * w) + 6] = 7
    }
    // A run to the region's edge isn't filled.
    unseen[(1 * w) + 11] = 1
    out[(1 * w) + 11] = 7
    const n = fillNarrowGaps(out, unseen, {x: 0, y: 0, w, h}, w, 4)
    expect(n).toBe(2 * h)
    expect(out[5]).toBe(133)
    expect(out[6]).toBe(167)
    expect(unseen[5]).toBe(0)
    expect(out[(1 * w) + 11]).toBe(7)
    expect(unseen[(1 * w) + 11]).toBe(1)
    // Wider than maxRun: left alone.
    const out2 = new Uint8Array(w).fill(50)
    const unseen2 = new Uint8Array(w)
    unseen2.fill(1, 2, 9)
    expect(fillNarrowGaps(out2, unseen2, {x: 0, y: 0, w, h: 1}, w, 4)).toBe(0)
  })
})
