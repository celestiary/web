import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'bun:test'
import StarsCatalog from '../StarsCatalog.js'
import {LIGHTYEAR_METER} from '../../shared.js'
import {toArrayBuffer} from '../../utils.js'
import {catalogueIndex, matchCatalogue} from './dedup.js'
import {catalogueApparentMag} from './records.js'


const ARCSEC = Math.PI / (180 * 3600)


/**
 * A direction `arcsec` away from `dir`, toward `toward`.
 *
 * @param {Array<number>} dir Unit
 * @param {number} arcsec
 * @param {Array<number>} toward Any vector not along dir
 * @returns {Array<number>} Unit
 */
function offset(dir, arcsec, toward) {
  const dot = (toward[0] * dir[0]) + (toward[1] * dir[1]) + (toward[2] * dir[2])
  const perp = toward.map((c, i) => c - (dot * dir[i]))
  const r = Math.hypot(...perp)
  const a = arcsec * ARCSEC
  return dir.map((c, i) => (Math.cos(a) * c) + (Math.sin(a) * perp[i] / r))
}


/** @returns {Array<object>} The bundled catalogue's stars, light-years, with their apparent magnitudes */
function catalogueStars() {
  const c = new StarsCatalog()
  c.read(toArrayBuffer(readFileSync('./public/data/stars.dat')))
  return [...c.starByHip.values()].filter((s) => s.hipId !== 0).map((s) => {
    const star = {...s, x: s.x / LIGHTYEAR_METER, y: s.y / LIGHTYEAR_METER, z: s.z / LIGHTYEAR_METER}
    star.mag = catalogueApparentMag(star)
    return star
  })
}


describe('dedup', () => {
  const stars = catalogueStars()
  const index = catalogueIndex(stars)
  const byHip = new Map(stars.map((s) => [s.hipId, s]))
  const dirOf = (s) => {
    const r = Math.hypot(s.x, s.y, s.z)
    return [s.x / r, s.y / r, s.z / r]
  }

  it('drops a Gaia star whose Hipparcos match the catalogue has', () => {
    const rec = {hip: 32349, dirHip: [1, 0, 0], v: 20}
    expect(matchCatalogue(rec, index)).toEqual({by: 'hip', hip: 32349, sepArcsec: NaN})
  })

  it('drops one by position and magnitude, and keeps one that isn\'t the catalogue\'s', () => {
    // Made-up Gaia records beside real catalogue stars (Barnard's Star,
    // V 9.5; Vega, V 0.03), with no Hipparcos match.
    for (const hip of [87937, 91262]) {
      const s = byHip.get(hip)
      const dir = dirOf(s)
      const near = {hip: null, dirHip: offset(dir, 1.2, [0, 0, 1]), v: s.mag + 0.3}
      expect(matchCatalogue(near, index)).toMatchObject({by: 'position', hip})
      expect(matchCatalogue(near, index).sepArcsec).toBeCloseTo(1.2, 4)
      // A companion fainter by 5 mag is in the entry's light too.
      expect(matchCatalogue({...near, v: s.mag + 5}, index)?.hip).toBe(hip)
      // Too far, or too bright to be the catalogue star: a new star.
      expect(matchCatalogue({...near, dirHip: offset(dir, 2.5, [0, 0, 1])}, index)).toBeNull()
      expect(matchCatalogue({...near, v: s.mag - 1}, index)).toBeNull()
      // An unmatched Hipparcos number the catalogue lacks is no match by number.
      expect(matchCatalogue({...near, hip: 999999}, index)?.by).toBe('position')
    }
  })

  it('matches a position-only solution farther, at the same magnitude', () => {
    const s = byHip.get(91262)
    const far = {hip: null, dirHip: offset(dirOf(s), 12, [0, 1, 0]), v: s.mag + 0.2}
    expect(matchCatalogue(far, index)).toBeNull()
    expect(matchCatalogue({...far, positionOnly: true}, index)?.hip).toBe(91262)
    expect(matchCatalogue({...far, positionOnly: true, v: s.mag + 2}, index)).toBeNull()
  })

  it('finds a match across a cell\'s edge', () => {
    // Probe each side of many cell boundaries: a star 1.9″ off in every
    // direction from a catalogue star is still found.
    let found = 0
    let tried = 0
    for (const s of stars.slice(0, 3000)) {
      const dir = dirOf(s)
      for (const toward of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, -1, 0]]) {
        tried++
        if (matchCatalogue({hip: null, dirHip: offset(dir, 1.9, toward), v: s.mag}, index)) {
          found++
        }
      }
    }
    expect(found).toBe(tried)
  })
})
