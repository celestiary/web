import {describe, expect, it} from 'bun:test'
import SeaIceMap, {mapLimit} from './SeaIceMap.js'
import {seaIceShaderMod, newSeaIceUniforms, setSeaIceMap, SEA_ICE_RGB} from './seaIceShader.js'
import {MAP_WIDTH, TILE_PX, seaIceSource} from './seaIceSource.js'


const NOW = Date.parse('2026-11-22T16:00:00Z')
// A tile of MUR25's palette index 91 (90%) everywhere, or of index 0 (no data: an empty day).
const iceTile = () => new Uint8Array(TILE_PX * TILE_PX).fill(91)
const emptyTile = () => new Uint8Array(TILE_PX * TILE_PX)


/**
 * @param {function(string): ?Uint8Array} tileOf url → tile
 * @returns {{fetchTile: Function, urls: Array<string>}}
 */
function fakeGibs(tileOf) {
  const urls = []
  return {urls, fetchTile: (url) => {
    urls.push(url)
    return Promise.resolve(tileOf(url))
  }}
}


describe('SeaIceMap.load', () => {
  it('a whole day goes in the texture in one upload, and its version moves on', async () => {
    const gibs = fakeGibs(() => iceTile())
    const map = new SeaIceMap({fetchTile: gibs.fetchTile, enabled: true})
    const ok = await map.load(seaIceSource(Date.parse('2026-03-10T00:00:00Z'), NOW))
    expect(ok).toBe(true)
    expect(gibs.urls.length).toBe(6)
    expect(map.version).toBe(1)
    expect(map.texture.version).toBe(1) // needsUpdate
    expect(map.status).toMatchObject({date: '2026-03-10', record: 'mur', ready: true})
    expect(map.concentration[0]).toBe(Math.round(0.9 * 255))
  })

  it('a day GIBS answers with empty tiles gives way to the day before', async () => {
    const gibs = fakeGibs((url) => (url.includes('/2021-02-20/') ? emptyTile() : iceTile()))
    const map = new SeaIceMap({fetchTile: gibs.fetchTile, enabled: true})
    await map.load(seaIceSource(Date.parse('2021-02-20T12:00:00Z'), NOW))
    expect(map.status.date).toBe('2021-02-19')
    expect(map.status.tried.map((t) => t.date)).toEqual(['2021-02-20', '2021-02-19'])
  })

  it('a missing tile tries the days before, and keeps the one with most ice if none is whole', async () => {
    const gibs = fakeGibs((url) => (url.endsWith('/1/2.png') ? null : iceTile()))
    const map = new SeaIceMap({fetchTile: gibs.fetchTile, enabled: true})
    await map.load(seaIceSource(Date.parse('2026-03-10T00:00:00Z'), NOW))
    expect(map.status.tried.length).toBe(4)
    expect(map.status.date).toBe('2026-03-10')
    expect(map.version).toBe(1)
  })

  it('no ice at all leaves the map as it was', async () => {
    const map = new SeaIceMap({fetchTile: () => Promise.resolve(null), enabled: true})
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(await map.load(seaIceSource(Date.parse('2026-03-10T00:00:00Z'), NOW))).toBe(false)
    } finally {
      console.warn = warn
    }
    expect(map.version).toBe(0)
  })

  it('a newer load stops an older one between days', async () => {
    const map = new SeaIceMap({fetchTile: () => Promise.resolve(emptyTile()), enabled: true})
    const first = map.load(seaIceSource(Date.parse('2026-03-10T00:00:00Z'), NOW))
    map._generation++
    expect(await first).toBe(false)
  })
})


describe('SeaIceMap.update', () => {
  it('waits for the date to stand a second, and loads nothing in tests by default', () => {
    expect(new SeaIceMap().enabled).toBe(false)
    const loads = []
    const map = new SeaIceMap({enabled: true, fetchTile: () => Promise.resolve(iceTile())})
    map.load = (source) => {
      loads.push(source.date)
      return Promise.resolve(true)
    }
    const sim = Date.parse('2026-03-10T00:00:00Z')
    map.update(sim, NOW, 0)
    map.update(sim, NOW, 500)
    expect(loads).toEqual([])
    map.update(sim, NOW, 1001)
    map.update(sim, NOW, 2000)
    expect(loads).toEqual(['2026-03-10'])
    // A clock passing through days starts nothing.
    for (let d = 1; d < 20; d++) {
      map.update(sim + (d * 864e5), NOW, 2000 + (d * 100))
    }
    expect(loads.length).toBe(1)
  })
})


describe('the fade and the picture', () => {
  it('fades in from the first frame drawn once the scene is shown; whole if before', async () => {
    const map = new SeaIceMap({fetchTile: () => Promise.resolve(iceTile()), enabled: true, fadeInMs: 1000})
    expect(map.gain(0)).toBe(0)
    map.drawn(0) // nothing in yet: no fade starts
    expect(map.gain(500)).toBe(0)
    await map.load(seaIceSource(Date.parse('2026-03-10T00:00:00Z'), NOW))
    map.drawn(1000)
    expect(map.gain(1000)).toBe(0)
    expect(map.gain(1500)).toBeCloseTo(0.5, 5)
    expect(map.gain(2000)).toBe(1)
    const early = new SeaIceMap({fetchTile: () => Promise.resolve(iceTile()), enabled: true, shown: () => false})
    await early.load(seaIceSource(Date.parse('2026-03-10T00:00:00Z'), NOW))
    early.drawn(0)
    expect(early.gain(0)).toBe(1)
  })

  it('rgba: the ice\'s colour, concentration in alpha', async () => {
    const map = new SeaIceMap({fetchTile: () => Promise.resolve(iceTile()), enabled: true})
    await map.load(seaIceSource(Date.parse('2026-03-10T00:00:00Z'), NOW))
    const px = map.rgba(SEA_ICE_RGB)
    expect(px.length).toBe(MAP_WIDTH * 640 * 4)
    expect([...px.slice(0, 4)]).toEqual([...SEA_ICE_RGB, Math.round(0.9 * 255)])
  })

  it('mapLimit keeps the order and the limit', async () => {
    let inFlight = 0
    let most = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      most = Math.max(most, ++inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return x * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14])
    expect(most).toBe(3)
  })
})


describe('seaIceShaderMod', () => {
  it('adds its uniforms and its step before the normal, leaving the chunk', () => {
    const map = new SeaIceMap()
    const uniforms = newSeaIceUniforms()
    expect(uniforms.uSeaIceMap.value.image.width).toBe(1) // the stand-in, no ice
    setSeaIceMap(uniforms, map)
    const shader = {uniforms: {}, fragmentShader: '#include <common>\nA\n#include <normal_fragment_begin>\nB'}
    seaIceShaderMod(uniforms)(shader)
    expect(shader.uniforms.uSeaIceMap.value).toBe(map.texture)
    expect(shader.fragmentShader).toContain('uniform sampler2D uSeaIceMap;')
    expect(shader.fragmentShader).toContain('metalnessFactor *= 1.0 - seaIce;')
    expect(shader.fragmentShader.indexOf('seaIce *=')).toBeLessThan(shader.fragmentShader.indexOf('#include <normal_fragment_begin>'))
    expect(shader.fragmentShader).toContain('#include <normal_fragment_begin>')
    // The ice's colour decoded from sRGB: 0xe2 is 0.76 linear.
    expect(uniforms.uSeaIceColor.value.x).toBeCloseTo(0.7605, 3)
  })
})
