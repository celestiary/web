import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {decodeIndexedPng, unfilter} from './png.js'
import {
  EDGE_CONCENTRATION, LOOKUP, MAP_HEIGHT, MAP_WIDTH, MIN_ICE_PIXELS, TILE_PX,
  SPREAD_PX, buildMap, daysToTry, polarStereographic, recordOf, sameDayIn, seaIceSource, spreadIntoLand, tilesOf,
} from './seaIceSource.js'


const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const MUR_TILE = 'mur25-2026-03-10-1-0-0.png'
const SSMIS_TILE = 'ssmis-n-1995-03-10-0-0-0.png'
const ms = (iso) => Date.parse(iso)


describe('decodeIndexedPng', () => {
  // The expected numbers are PIL's, from the same files (numpy over
  // Image.open(f) in mode P: the palette indices).
  it('reads GIBS\'s MUR25 tile\'s palette indices exactly', async () => {
    const {width, height, indices} = await decodeIndexedPng(fixture(MUR_TILE))
    expect([width, height]).toEqual([512, 512])
    expect(indices.reduce((a, b) => a + b, 0)).toBe(3510077)
    expect(indices.filter((v) => v === 0).length).toBe(225550)
    let row7 = 0
    for (let x = 0; x < 512; x++) {
      row7 += indices[(7 * 512) + x] * x
    }
    expect(row7).toBe(12594374)
  })

  it('reads an SSMIS polar tile', async () => {
    const {indices} = await decodeIndexedPng(fixture(SSMIS_TILE))
    expect(indices.reduce((a, b) => a + b, 0)).toBe(24084541)
    expect(indices[(400 * 512) + 300]).toBe(253)
  })

  it('refuses what isn\'t an 8-bit indexed PNG', async () => {
    await expect(decodeIndexedPng(new Uint8Array([1, 2, 3]))).rejects.toThrow('not a PNG')
  })

  it('undoes each of PNG\'s filters', () => {
    // 2 × 2: row 0 Sub (1), row 1 Paeth (4).
    const raw = new Uint8Array([1, 10, 5, 4, 3, 250])
    // Row 0: 10, 15.  Row 1: x0 Paeth(a 0, b 10, c 0) → 10, +3 = 13;
    // x1 Paeth(a 13, b 15, c 10): p 18, |5|, |3|, |8| → 15, +250 = 265 & 255 = 9.
    expect([...unfilter(raw, 2, 2)]).toEqual([10, 15, 13, 9])
  })
})


describe('the palettes', () => {
  it('MUR25: index is percent + 1, below the 15% edge drawn as water', () => {
    expect(LOOKUP.mur[0]).toBe(0)
    expect(LOOKUP.mur[101]).toBe(255)
    expect(LOOKUP.mur[51]).toBe(Math.round(0.5 * 255))
    expect(LOOKUP.mur[15]).toBe(0) // 14%
    expect(LOOKUP.mur[16]).toBe(Math.round(EDGE_CONCENTRATION * 255))
    expect(LOOKUP.mur[200]).toBe(0)
  })

  it('SSMIS: the pole hole is ice, the classes and padding nothing', () => {
    expect(LOOKUP.ssmis[1]).toBe(255)
    for (const i of [0, 2, 3, 4, 5, 254, 255]) {
      expect(LOOKUP.ssmis[i]).toBe(0)
    }
    expect(LOOKUP.ssmis[253]).toBe(Math.round(0.992 * 255))
    expect(LOOKUP.ssmis[130]).toBe(Math.round(0.5 * 255))
  })
})


describe('polarStereographic', () => {
  // Reference points from pyproj 3 (PROJ), EPSG:4326 to 3413 and 3031.
  const cases = [
    ['north', 70, -45, 0, -2187927.649],
    ['north', 60, 0, 2349829.162, -2349829.162],
    ['north', 75, 100, 937154.78, 1338395.73],
    ['north', 85, -170, -443953.131, 310859.329],
    ['south', -71, 0, 0, 2082760.109],
    ['south', -60, 45, 2356881.674, 2356881.674],
    ['south', -78, -170, -227205.383, -1288545.757],
  ]
  for (const [hemisphere, lat, lon, x, y] of cases) {
    it(`${hemisphere} ${lat}, ${lon} within a metre of PROJ`, () => {
      const [px, py] = polarStereographic(lat, lon, hemisphere)
      expect(Math.abs(px - x)).toBeLessThan(1)
      expect(Math.abs(py - y)).toBeLessThan(1)
    })
  }
})


describe('seaIceSource', () => {
  const now = ms('2026-11-22T16:00:00Z')

  it('a day in MUR25\'s record is itself', () => {
    expect(seaIceSource(ms('2026-03-10T12:00:00Z'), now)).toEqual(
        {date: '2026-03-10', wanted: '2026-03-10', record: 'mur', standin: null})
  })

  it('before 2002-09 is NSIDC\'s', () => {
    expect(seaIceSource(ms('1995-03-10T00:00:00Z'), now).record).toBe('ssmis')
    expect(recordOf('2002-08-31')).toBe('ssmis')
    expect(recordOf('2002-09-01')).toBe('mur')
    expect(recordOf('1978-10-25')).toBe(null)
  })

  it('the present is the latest day GIBS has', () => {
    const s = seaIceSource(now, now)
    expect(s.date).toBe('2026-11-21')
    expect(s.standin).toBe(null)
  })

  it('the future and before the record are another year\'s same day, said so', () => {
    expect(seaIceSource(ms('2030-03-10T00:00:00Z'), now)).toMatchObject({date: '2026-03-10', standin: 'future'})
    // Past the latest day this year: last year's.
    expect(seaIceSource(ms('2030-12-25T00:00:00Z'), now)).toMatchObject({date: '2025-12-25', standin: 'future'})
    expect(seaIceSource(ms('1969-07-20T00:00:00Z'), now)).toMatchObject({date: '1979-07-20', record: 'ssmis',
      standin: 'before the record'})
  })

  it('29 February in a common year is the 28th', () => {
    expect(sameDayIn('2028-02-29', 2026)).toBe('2026-02-28')
    expect(sameDayIn('2028-02-29', 2024)).toBe('2024-02-29')
  })

  it('a day\'s gap is filled from the days before, in their own record', () => {
    expect(daysToTry({date: '2021-02-20'})).toEqual(['2021-02-20', '2021-02-19', '2021-02-18', '2021-02-17'])
    expect(daysToTry({date: '2002-09-01'})).toEqual(['2002-09-01', '2002-08-31', '2002-08-30', '2002-08-29'])
    // SSMIS's every-other-day years try the next day second.
    expect(daysToTry({date: '1985-01-10'})[1]).toBe('1985-01-11')
    expect(daysToTry({date: '1978-10-26'})).toEqual(['1978-10-26', '1978-10-27'])
  })
})


describe('buildMap', () => {
  it('MUR25: its 3 × 2 tiles, the map their top left', () => {
    const specs = tilesOf('2026-03-10')
    expect(specs.length).toBe(6)
    expect(specs[0].url).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/' +
      'GHRSST_L4_MUR25_Sea_Ice_Concentration/default/2026-03-10/2km/1/0/0.png')
    // Each tile filled with its own index: map pixels take the tile they fall in.
    const tiles = specs.map((s, i) => new Uint8Array(TILE_PX * TILE_PX).fill(51 + (10 * i)))
    const {map, missing} = buildMap('2026-03-10', tiles)
    expect(missing).toBe(0)
    expect(map.length).toBe(MAP_WIDTH * MAP_HEIGHT)
    expect(map[0]).toBe(LOOKUP.mur[51]) // tile 0/0
    expect(map[MAP_WIDTH - 1]).toBe(LOOKUP.mur[71]) // tile 0/2, its first 256 columns
    expect(map[(MAP_HEIGHT - 1) * MAP_WIDTH]).toBe(LOOKUP.mur[81]) // tile 1/0, its first 128 rows
  })

  it('the real tile: March\'s Arctic in the map\'s top rows', async () => {
    const {indices} = await decodeIndexedPng(fixture(MUR_TILE))
    const tiles = tilesOf('2026-03-10').map((s, i) => (i === 0 ? indices : null))
    const {map, icePixels, missing} = buildMap('2026-03-10', tiles)
    expect(missing).toBe(5)
    expect(icePixels).toBeGreaterThan(MIN_ICE_PIXELS)
    // Hudson Bay, 60° N 85° W, frozen in March; the tropical Pacific not.
    const at = (lat, lon) => map[(Math.floor((90 - lat) / 180 * MAP_HEIGHT) * MAP_WIDTH) +
      Math.floor((lon + 180) / 360 * MAP_WIDTH)]
    expect(at(60, -85)).toBeGreaterThan(200)
    expect(at(10, -150)).toBe(0)
  })

  it('SSMIS: the polar tiles reprojected, the pole ice', async () => {
    const {indices} = await decodeIndexedPng(fixture(SSMIS_TILE))
    const specs = tilesOf('1995-03-10')
    expect(specs.length).toBe(8)
    // Every north tile the pole hole (ice): the whole cap's ice.
    const hole = new Uint8Array(TILE_PX * TILE_PX).fill(1)
    const tiles = specs.map((s) => (s.hemisphere === 'north' ? hole : null))
    const {map} = buildMap('1995-03-10', tiles)
    expect(map[MAP_WIDTH / 2]).toBe(255) // the top row: the north pole
    expect(map[(MAP_HEIGHT - 1) * MAP_WIDTH]).toBe(0) // the south's tiles not had
    expect(indices.length).toBe(TILE_PX * TILE_PX)
  })

  it('SSMIS: the fixture\'s Arctic lands where it should', async () => {
    // The top left tile of EPSG:3413 (x < 0, y > 0) is the Pacific side:
    // the Bering Sea, the Chukchi and East Siberian Seas, iced in March.
    const {indices} = await decodeIndexedPng(fixture(SSMIS_TILE))
    const specs = tilesOf('1995-03-10')
    const tiles = specs.map((s) => (s.hemisphere === 'north' && s.row === 0 && s.col === 0 ? indices : null))
    const {map} = buildMap('1995-03-10', tiles)
    const at = (lat, lon) => map[(Math.floor((90 - lat) / 180 * MAP_HEIGHT) * MAP_WIDTH) +
      Math.floor((lon + 180) / 360 * MAP_WIDTH)]
    expect(at(73, 170)).toBeGreaterThan(200) // the East Siberian Sea
    expect(at(64, -172)).toBeGreaterThan(100) // the northern Bering Sea
  })
})


describe('spreadIntoLand', () => {
  it('the ice reaches SPREAD_PX into the land, not into open water, and wraps at ±180°', () => {
    const map = new Uint8Array(MAP_WIDTH * MAP_HEIGHT)
    const land = new Uint8Array(MAP_WIDTH * MAP_HEIGHT)
    const row = 100 * MAP_WIDTH
    // Ice at column 0; land to its west (wrapping) and east, open water beyond the east's land.
    map[row] = 200
    for (let x = 1; x <= 5; x++) {
      land[row + x] = 1
      land[row + MAP_WIDTH - x] = 1
    }
    map[row - MAP_WIDTH + 1] = 0 // water above: stays 0
    spreadIntoLand(map, land)
    expect(SPREAD_PX).toBe(2)
    expect([...map.slice(row, row + 5)]).toEqual([200, 200, 200, 0, 0])
    expect(map[row + MAP_WIDTH - 2]).toBe(200)
    expect(map[row + MAP_WIDTH - 3]).toBe(0)
    expect(map[row - MAP_WIDTH + 1]).toBe(0)
  })
})
