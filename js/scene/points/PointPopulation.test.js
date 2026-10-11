import {describe, expect, it} from 'bun:test'
import {PerspectiveCamera, Vector3} from 'three'
import PointPopulation, {MAX_IN_FLIGHT} from './PointPopulation.js'
import {decodeStarTile} from './starTile.js'
import {syntheticPoints} from './syntheticPoints.js'
import {buildTiles} from '../gaia/build.js'
import {newStarsMaterial} from '../starsMaterial.js'
import {LIGHTYEAR_METER} from '../../shared.js'


/**
 * A synthetic population's files, served from memory, with a log of what
 * was asked for.
 *
 * @param {number} n
 * @param {number} cap
 * @returns {object}
 */
function served(n, cap) {
  const points = syntheticPoints(n, 5)
  const {files, manifest} = buildTiles(points, {name: 'synthetic test population', epoch: 2000}, {cap, maxOrder: 6})
  const requested = []
  const fetchFn = (url) => {
    const path = url.replace(/^base\//, '')
    requested.push(path)
    const buf = files.get(path)
    if (!buf) {
      return Promise.resolve({ok: false, status: 404})
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(buf))),
      arrayBuffer: () => Promise.resolve(buf.slice(0)),
    })
  }
  return {points, manifest, fetchFn, requested}
}


/**
 * @param {object} host
 * @param {object} s served()
 * @param {object} [opts]
 * @returns {PointPopulation}
 */
function population(host, s, opts = {}) {
  return new PointPopulation({
    name: 'test', baseUrl: 'base', decode: decodeStarTile, material: newStarsMaterial({motion: true}), host,
    fetchFn: s.fetchFn, ...opts,
  })
}


/**
 * Run frames until no tile is in flight.
 *
 * @param {PointPopulation} pop
 * @param {number} [max]
 * @returns {Promise<number>} Frames run
 */
async function settle(pop, max = 200) {
  for (let i = 0; i < max; i++) {
    pop.update()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (pop.status === 'ready' && pop.inFlight.size === 0 && i > 2) {
      pop.update()
      if (pop.inFlight.size === 0) {
        return i
      }
    }
  }
  return max
}


/** @returns {number} Points the population draws now */
function drawnPoints(pop) {
  let n = 0
  for (const t of pop.loaded.values()) {
    if (t.points.visible) {
      n += t.points.geometry.drawRange.count
    }
  }
  return n
}


describe('PointPopulation', () => {
  it('draws nothing and asks no more when there is no manifest', async () => {
    const requested = []
    const pop = new PointPopulation({
      name: 'none', baseUrl: 'nowhere/', decode: decodeStarTile, material: newStarsMaterial(),
      host: {camera: () => new PerspectiveCamera(), limitingMagnitude: () => 6.5},
      fetchFn: (url) => {
        requested.push(url)
        return Promise.resolve({ok: false, status: 404})
      },
    })
    await settle(pop, 5)
    expect(pop.status).toBe('absent')
    expect(requested).toEqual(['nowhere/index.json'])
    expect(pop.children.length).toBe(0)
  })

  it('loads the brightest tiles first and draws to the limit', async () => {
    const s = served(20000, 300)
    const camera = new PerspectiveCamera(45, 1.5, 1, 1e30)
    let limit = 4
    const pop = population({camera: () => camera, limitingMagnitude: () => limit}, s, {marginMag: 1})
    pop.update()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pop.status).toBe('ready')
    pop.update()
    // A few at a time.
    expect(pop.inFlight.size).toBeLessThanOrEqual(MAX_IN_FLIGHT)
    await settle(pop)
    // At limit 4 + 1 the whole sky's stars to 5 that are in the field are
    // drawn, and only order-0 tiles were needed (each holds 300, to ~mag 7).
    const tilesAsked = s.requested.filter((p) => p.endsWith('.bin'))
    expect(tilesAsked.every((p) => p.startsWith('0/'))).toBe(true)
    // What's drawn is what the field holds to the limit plus the margin.
    const dir = camera.getWorldDirection(new Vector3())
    const half = Math.atan(Math.tan(22.5 * Math.PI / 180) * Math.sqrt(1 + (1.5 * 1.5)))
    const inField = (p) => {
      const r = Math.hypot(p.x, p.y, p.z)
      return ((p.x * dir.x) + (p.y * dir.y) + (p.z * dir.z)) / r >= Math.cos(half)
    }
    const wantedInField = s.points.filter((p) => p.mag <= 5 && inField(p)).length
    expect(drawnPoints(pop)).toBeGreaterThanOrEqual(wantedInField)
    // The tiles drawn hold points outside the field too, but no point
    // past the cut: every drawn point is brighter than 5 (to the tile's
    // 0.001 mag rounding).
    for (const t of pop.loaded.values()) {
      if (t.points.visible) {
        expect(t.mags[t.points.geometry.drawRange.count - 1]).toBeLessThanOrEqual(5.002)
      }
    }
    // Deeper: a telescope's limit pages in finer tiles, over the field only.
    limit = 10
    camera.fov = 2
    camera.updateProjectionMatrix()
    s.requested.length = 0
    await settle(pop)
    const deeper = s.requested.filter((p) => p.endsWith('.bin'))
    expect(deeper.length).toBeGreaterThan(0)
    expect(deeper.some((p) => !p.startsWith('0/'))).toBe(true)
    expect(deeper.length).toBeLessThan(s.manifest.tileCount / 4)
  })

  it('holds the point budget', async () => {
    const s = served(20000, 300)
    const camera = new PerspectiveCamera(120, 1, 1, 1e30)
    const pop = population({camera: () => camera, limitingMagnitude: () => 20}, s, {budget: 3000})
    await settle(pop)
    expect(drawnPoints(pop)).toBeLessThanOrEqual(3000)
    expect(drawnPoints(pop)).toBeGreaterThan(2500)
    expect(pop.stats().budgetHit).toBe(true)
  })

  it('drops tiles it no longer draws past its memory', async () => {
    const s = served(20000, 300)
    const camera = new PerspectiveCamera(10, 1, 1, 1e30)
    const pop = population({camera: () => camera, limitingMagnitude: () => 20}, s, {memoryPoints: 2000})
    await settle(pop)
    camera.lookAt(-1, 0, 0)
    await settle(pop)
    camera.lookAt(0, 0, 1)
    await settle(pop)
    expect(pop.stats().evicted).toBeGreaterThan(0)
    expect(pop.stats().loadedPoints).toBeLessThanOrEqual(2000 + (300 * 20))
  })

  it('moves its stars by their epoch', () => {
    const s = served(10, 300)
    const pop = population({camera: () => null, limitingMagnitude: () => 6.5}, s)
    pop.setManifest({format: 'celestiary-points', tiles: [], epoch: 2000})
    pop.setDate(2451545.0 + (365.25 * 26))
    expect(pop.material.uniforms.uMotionYears.value).toBeCloseTo(26, 12)
  })

  it('works out the view from another star', () => {
    const s = served(10, 300)
    const camera = new PerspectiveCamera(45, 2, 1, 1e30)
    camera.position.set(40 * LIGHTYEAR_METER, 0, 0)
    camera.updateMatrixWorld()
    const pop = population({camera: () => camera, limitingMagnitude: () => 6.5}, s)
    const view = pop.view(camera)
    expect(view.camDist).toBeCloseTo(40, 9)
    expect(view.limit).toBe(7.5)
    // The half diagonal, and the sprite's reach past the edge at 1080 px.
    const pad = 48 * (Math.PI / 4) / 1080
    expect(view.halfAngle).toBeCloseTo(Math.atan(Math.tan(22.5 * Math.PI / 180) * Math.sqrt(5)) + pad, 12)
  })
})
