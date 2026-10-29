import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {TEFF_CLASS_BOUNDS, teffClass} from '../scene/points/starTile.js'
import {CESIUM_BODIES} from '../scene/cesium/bodies.js'
import {SPECTRAL_CLASSES} from '../scene/stellar.js'
import {
  GAIA_DR3,
  TEFF_CLASS_NAMES,
  cesiumBodyFacts,
  count,
  dsnFacts,
  galaxiesFacts,
  gaiaFacts,
  gibsFacts,
  mix,
  newYorkFacts,
  placesFacts,
  satellitesFacts,
  starNamesFacts,
  starsFacts,
  vsopFacts,
} from './facts.js'


/** @returns {object} label → value */
const byLabel = (facts) => Object.fromEntries(facts.map((f) => [f.label, f.value]))
const refs = {bodies: CESIUM_BODIES, spectralClasses: SPECTRAL_CLASSES}
const json = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))


describe('the credits dialog\'s facts', () => {
  it('sorts a star into its Harvard class by Teff, for a tile\'s counts', () => {
    expect([40000, 30000, 12000, 8000, 6500, 5772, 4500, 3000, 0].map(teffClass))
        .toEqual([0, 0, 1, 2, 3, 4, 5, 6, 6])
    expect(TEFF_CLASS_NAMES.length).toBe(TEFF_CLASS_BOUNDS.length + 1)
  })

  it('formats counts and a mix, largest first', () => {
    expect(count(925686)).toBe('925,686')
    expect(count(NaN)).toBe('?')
    expect(mix([['G', 20], ['K', 60], ['M', 20], ['O', 0]])).toBe('K 60%, G 20%, M 20%')
    expect(mix([['G', 0]])).toBe(null)
  })

  it('says what ion serves each body and, live, how much Cesium draws', () => {
    expect(byLabel(cesiumBodyFacts('earth', null, refs))).toMatchObject({Now: expect.stringContaining('Not loaded')})
    expect(cesiumBodyFacts('earth', null, refs)[0].value).toContain('World Terrain (ion asset 1)')
    expect(cesiumBodyFacts('earth', null, refs)[0].value).toContain('from globe tile level 5')
    // Earth, active, with Bing asked for: its globe's tiles by level.
    const tiles = [3, 5, 6, 7, 4].map((level) => ({level}))
    const earth = {ion: {imagery: true}, widget: {scene: {globe: {_surface: {_tilesToRender: tiles}}}}}
    const layers = {bodies: {earth}, active: [{name: 'earth'}], warming: [], fadeOf: () => 0.5}
    const f = byLabel(cesiumBodyFacts('earth', layers, refs))
    expect(f['Drawn by Cesium now']).toBe('All of the body\'s disc in view (fading in, 50%)')
    expect(f['Globe tiles drawn']).toBe('5, levels 3-7; 3 at Bing\'s levels')
    expect(f['With a token']).toBe('yes; Bing asked for')
    // The Moon, a tileset: its statistics.
    const moon = {tileset: {statistics: {selected: 42, numberOfTilesWithContentReady: 120, geometryByteLength: 3e6,
      texturesByteLength: 9e6}}}
    const m = byLabel(cesiumBodyFacts('moon', {bodies: {moon}, active: [], warming: [{name: 'moon'}]}, refs))
    expect(m['From ion']).toContain('Cesium Moon Terrain (ion asset 2684829)')
    expect(m['Drawn by Cesium now']).toBe('Not yet: its tiles are loading')
    expect(m.Tiles).toBe('42 drawn, 120 loaded')
    expect(m['In memory']).toBe('12.0 MB')
    // Mars on a guest page: counts not here.
    const g = byLabel(cesiumBodyFacts('mars', {bodies: {mars: {remote: true}}, active: [{name: 'mars'}]}, refs))
    expect(g.Tiles).toContain('guest page')
    expect(g['Drawn by Cesium now']).toBe('All of the body\'s disc in view')
  })

  it('gives Gaia\'s dates, the shipped catalogue from its manifest, and what\'s loaded and drawn, by type', () => {
    expect(GAIA_DR3).toEqual({from: '25 July 2014', to: '28 May 2017', months: 34, released: '13 June 2022'})
    expect(byLabel(gaiaFacts(null)).Shipped).toContain('Off')
    const manifest = {count: 925686, tileCount: 528, bytes: 27783252, title: 'Gaia DR3, G < 10.8',
      histogram: [[3, 0], [3.5, 4], [14, 1188]], report: {dropped: {hip: 88232}}, built: '2026-10-10T02:18:40Z'}
    const loaded = new Map([['0/1', {classes: Uint32Array.from([0, 10, 20, 10, 30, 30, 0])}],
      ['0/2', {classes: null}]])
    const gaia = {manifest, loaded, last: {drawn: 24, limit: 5.94},
      stats: () => ({loadedPoints: 8192, loadedTiles: 2})}
    const f = byLabel(gaiaFacts(gaia))
    expect(f.Observed).toBe('25 July 2014 to 28 May 2017 (34 months)')
    expect(f.Released).toBe('13 June 2022, as Gaia DR3')
    expect(f.Shipped).toBe('925,686 stars in 528 tiles (27.8 MB), Gaia DR3, G < 10.8')
    expect(f.Brightness).toContain('V 3.5 to 14.5 from the Sun')
    expect(f['Left out']).toBe('88,232 already in the bundled catalogue (Hipparcos)')
    expect(f['Loaded now']).toBe('8,192 stars in 2 tiles')
    expect(f['Drawn now']).toBe('24 stars, to magnitude 5.9')
    expect(f['Types loaded (by Teff)']).toBe('G 30%, K 30%, A 20%, B 10%, F 10%')
    expect(f.Built).toBe('from the ESA Gaia archive, 2026-10-10')
  })

  it('counts the bundled stars by type, and the names', () => {
    const starByHip = new Map([[0, {hipId: 0}], [1, {hipId: 1, kind: 0, spectralType: 4}],
      [2, {hipId: 2, kind: 0, spectralType: 5}], [3, {hipId: 3, kind: 1, spectralType: 0}],
      [4, {hipId: 4, kind: 0, spectralType: 5}]])
    const f = byLabel(starsFacts({numStars: 4, starByHip}, refs))
    expect(f['Loaded now']).toBe('4 stars')
    expect(f.Types).toBe('K 50%, G 25%, white dwarfs 25%')
    expect(byLabel(starNamesFacts({hipByName: new Map([['Sirius', 1], ['Vega', 2]])}))['Names known now']).toBe('2')
  })

  it('says what\'s loaded of the galaxies, satellites, networks, places, the ephemeris and New York', () => {
    expect(byLabel(galaxiesFacts(null))['Loaded now']).toContain('Not yet')
    expect(byLabel(galaxiesFacts({records: new Array(175)}))['Loaded now']).toBe('175 galaxies')
    const sats = byLabel(satellitesFacts({satellites: {records: new Array(447)},
      satelliteData: {fetched: '2026-10-23T17:20:27Z'}, networks: {S: {count: 11116}, I: {sats: {count: 80}}}}))
    expect(sats['Loaded now']).toBe('447 satellites, fetched 2026-10-23')
    expect(sats['Starlink loaded']).toBe('11,116')
    expect(sats['Iridium loaded']).toBe('80')
    expect(byLabel(satellitesFacts(null))['Loaded now']).toContain('Not yet')
    expect(byLabel(dsnFacts({networks: {D: {}}})).Now).toBe('Loaded')
    expect(byLabel(placesFacts({objects: {moon: {places: {entries: new Array(12)}}, sun: {}}}))['Loaded now'])
        .toBe('12 on moon')
    expect(byLabel(vsopFacts({vsop: () => {}})).Now).toBe('In use')
    expect(byLabel(newYorkFacts({status: 'ready'})).Now).toBe('The city is in')
  })

  it('reports the cloud day GIBS gave', () => {
    const ready = byLabel(gibsFacts({status: {kind: 'daily', ready: true, date: '2026-10-26', satellites: ['NOAA-20', 'SNPP']}}))
    expect(ready['Clouds now']).toBe('2026-10-26, from NOAA-20 and SNPP')
    expect(byLabel(gibsFacts({status: {kind: 'daily', ready: false, wanted: '2026-10-27', building: '2026-10-27',
      tilesDone: 3, tilesTotal: 15}}))['Clouds now']).toBe('building 2026-10-27 (3 of 15 tiles)')
    expect(byLabel(gibsFacts({status: {kind: 'bundled'}}))['Clouds now']).toContain('bundled')
  })

  it('quotes the bundled data\'s numbers as they are (a rebuild that changes one fails here)', () => {
    // The satellites' snapshot is refreshed twice a month, so its facts quote
    // only its number of groups.
    expect(Object.keys(json('public/data/earth/satellites/index.json').groups).length).toBe(8)
    const places = json('public/data/places-index.json').bodies
    expect([Object.values(places).reduce((a, v) => a + v.length, 0), Object.keys(places).length]).toEqual([8405, 24])
    expect(json('public/data/sparc/galaxies.json').galaxies.length).toBe(175)
    expect(Object.keys(json('public/data/periodicOrbits.json').systems).length).toBe(7)
    expect(Object.keys(json('js/scene/iauRotation.json').bodies).length).toBe(27)
    const names = readFileSync(new URL('../../public/data/starnames.dat', import.meta.url), 'utf8').trim().split('\n')
    expect(names.length).toBe(3369)
    // stars.dat's header: CELSTARS, a version, the count.
    const stars = readFileSync(new URL('../../public/data/stars.dat', import.meta.url))
    expect(stars.readUInt32LE(10)).toBe(106747)
    expect(byLabel(starsFacts(null, refs)).Shipped).toContain('106,747')
    expect(byLabel(satellitesFacts(null)).Shipped).toContain('8 groups')
    expect(byLabel(placesFacts(null)).Shipped).toContain('8,405 named features on 24 bodies')
  })
})
