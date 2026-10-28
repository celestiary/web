import {afterEach, describe, expect, it} from 'bun:test'
import {PerspectiveCamera} from 'three'
import PointPopulation from '../points/PointPopulation.js'
import {decodeStarTile} from '../points/starTile.js'
import {syntheticPoints} from '../points/syntheticPoints.js'
import {buildTiles} from './build.js'
import {newStarsMaterial} from '../starsMaterial.js'
import {clearCredits, followCredit, getCredits, hasCredit} from '../../credits.js'
import {GAIA_CREDIT, GAIA_CREDIT_ID, creditGaia, gaiaDrawn} from './gaiaPopulation.js'


/**
 * A synthetic population served from memory (as PointPopulation.test.js's).
 *
 * @param {object} host
 * @returns {PointPopulation}
 */
function population(host) {
  const {files} = buildTiles(syntheticPoints(4000, 7), {name: 'synthetic', epoch: 2000}, {cap: 300, maxOrder: 4})
  const fetchFn = (url) => {
    const buf = files.get(url.replace(/^base\//, ''))
    return Promise.resolve(buf ? {
      ok: true,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(buf))),
      arrayBuffer: () => Promise.resolve(buf.slice(0)),
    } : {ok: false, status: 404})
  }
  return new PointPopulation({
    name: 'test', baseUrl: 'base', decode: decodeStarTile, material: newStarsMaterial({motion: true}), host, fetchFn,
  })
}


describe('Gaia\'s credit', () => {
  afterEach(() => clearCredits())

  it('credits ESA/Gaia/DPAC, linked to Gaia\'s page, and the licence by its URI', () => {
    expect(GAIA_CREDIT.map((c) => c.text)).toEqual(['ESA/Gaia/DPAC', 'CC BY-SA 3.0 IGO'])
    expect(GAIA_CREDIT[0].href).toBe('https://www.cosmos.esa.int/gaia')
    expect(GAIA_CREDIT[1].href).toBe('https://creativecommons.org/licenses/by-sa/3.0/igo/')
    creditGaia(true)
    expect(getCredits()[0]).toMatchObject({id: GAIA_CREDIT_ID, persistence: 'timed'})
    creditGaia(false)
    expect(hasCredit(GAIA_CREDIT_ID)).toBe(false)
  })

  it('is in while Gaia\'s stars are drawn: tiles loaded, in the field, to the limit, nothing over them hidden', async () => {
    const camera = new PerspectiveCamera(45, 1.5, 1, 1e30)
    let limit = -30
    const pop = population({camera: () => camera, limitingMagnitude: () => limit})
    const credit = followCredit(creditGaia, 2)
    const frame = async () => {
      pop.update()
      credit(gaiaDrawn(pop))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    // No manifest yet, then a limit no star reaches (the day sky).
    expect(gaiaDrawn(null)).toBe(false)
    for (let i = 0; i < 20; i++) {
      await frame()
    }
    expect(pop.status).toBe('ready')
    expect(pop.last.drawn).toBe(0)
    expect(hasCredit(GAIA_CREDIT_ID)).toBe(false)
    // Night: the tiles load and draw.
    limit = 8
    for (let i = 0; i < 40 && !(pop.last.drawn > 0); i++) {
      await frame()
    }
    await frame()
    expect(pop.last.drawn).toBeGreaterThan(0)
    expect(hasCredit(GAIA_CREDIT_ID)).toBe(true)
    // The stars hidden (a parent's visible off): out, after the grace.
    const parent = {visible: false}
    pop.parent = parent
    expect(gaiaDrawn(pop)).toBe(false)
    pop.parent = null
    // Day again: out once the grace has passed.
    limit = -30
    await frame()
    expect(hasCredit(GAIA_CREDIT_ID)).toBe(true)
    await frame()
    expect(hasCredit(GAIA_CREDIT_ID)).toBe(false)
  })
})
