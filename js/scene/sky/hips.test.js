import {describe, expect, it} from 'bun:test'
import {locToVec, npix, pix2loc, pixelCone} from '../points/healpix.js'
import {equatorialToSceneUnit} from '../galacticFrame.js'
import {equatorialToScene} from '../rubin/wcs.js'
import {DEEPEST_ORDER, angle, apply, applyTransposed, cellGrid, cellsInDisc, chooseFormat, discMeetsCoverage,
  frameMatrix, lonLatToVec, newCoverage, selectOrder, tilePath, tilePixelDeg, tileUvToLoc} from './hips.js'


const toRad = Math.PI / 180
const arcsec = (a, b) => angle(a, b) / toRad * 3600
const vecOf = ({z, phi}) => locToVec(z, phi)


describe('tile addressing', () => {
  it('writes HiPS 1.0 paths, 10,000 tiles a directory', () => {
    expect(tilePath(3, 460, 'jpg')).toBe('Norder3/Dir0/Npix460.jpg')
    // A real one: JWST NIRCam's tile over the Pillars of Creation.
    expect(tilePath(12, 120681887, 'png')).toBe('Norder12/Dir120680000/Npix120681887.png')
    expect(tilePath(5, 9999, 'webp')).toBe('Norder5/Dir0/Npix9999.webp')
    expect(tilePath(5, 10000, 'webp')).toBe('Norder5/Dir10000/Npix10000.webp')
  })

  it('has order k\'s tile pixel at 58.63° / 2^(k+9) for 512 px tiles', () => {
    expect(tilePixelDeg(0, 1)).toBeCloseTo(58.6323, 3)
    // Rubin's First Look at order 12: 0.1″ a pixel, as its record says.
    expect(tilePixelDeg(12, 512) * 3600).toBeCloseTo(0.1006, 3)
    expect(tilePixelDeg(3, 256)).toBeCloseTo(2 * tilePixelDeg(3, 512), 12)
  })

  it('chooses the coarsest order whose pixel fits a screen pixel, within the survey\'s', () => {
    const survey = {minOrder: 0, maxOrder: 12, tileWidth: 512}
    // 3.5° over 1000 px is 12.6″ a pixel: order 5 is 12.9″, order 6 6.4″.
    expect(selectOrder(survey, 3.5, 1000)).toBe(6)
    // A wide view: the survey's coarsest.
    expect(selectOrder(survey, 120, 500)).toBe(0)
    expect(selectOrder({...survey, minOrder: 3}, 120, 500)).toBe(3)
    // Past the deepest: the deepest.
    expect(selectOrder(survey, 0.001, 1000)).toBe(12)
    // A survey deeper than healpix.js goes: its deepest order.
    expect(selectOrder({...survey, maxOrder: 15}, 0.001, 1000)).toBe(DEEPEST_ORDER)
    // 256 px tiles go one order deeper for the same screen.
    expect(selectOrder({...survey, tileWidth: 256}, 3.5, 1000)).toBe(7)
  })

  it('prefers webp, then png, then jpeg', () => {
    expect(chooseFormat(['png', 'webp'])).toBe('webp')
    expect(chooseFormat(['png', 'webp'], false)).toBe('png')
    expect(chooseFormat(['jpeg'])).toBe('jpg')
    expect(chooseFormat(['png', 'fits'])).toBe('png')
    expect(() => chooseFormat(['fits'])).toThrow()
  })
})


describe('frames', () => {
  it('turns equatorial vectors to the scene as wcs.js does', () => {
    for (const [ra, dec] of [[0, 0], [271.6, -23.9], [187.4, 6.9], [90, 89]]) {
      const v = apply(frameMatrix('equatorial'), lonLatToVec(ra, dec))
      expect(arcsec(v, equatorialToScene(ra, dec))).toBeLessThan(1e-6)
      const back = applyTransposed(frameMatrix('equatorial'), v)
      expect(arcsec(back, lonLatToVec(ra, dec))).toBeLessThan(1e-6)
    }
  })

  it('turns galactic vectors to the scene as galacticFrame.js places the centre and the pole', () => {
    const gc = apply(frameMatrix('galactic'), lonLatToVec(0, 0))
    const ngp = apply(frameMatrix('galactic'), lonLatToVec(0, 90))
    const toArr = (v) => [v.x, v.y, v.z]
    expect(arcsec(gc, toArr(equatorialToSceneUnit(266.40499, -28.93617)))).toBeLessThan(2)
    expect(arcsec(ngp, toArr(equatorialToSceneUnit(192.85948, 27.12825)))).toBeLessThan(2)
    expect(() => frameMatrix('ecliptic')).toThrow()
  })
})


describe('coverage', () => {
  // A cell at order 3 wholly in, and one at order 5.
  const moc = {3: [100], 5: [3000]}
  const cov = newCoverage(moc)

  it('holds its cells, their children, and their parents', () => {
    expect(cov.maxOrder).toBe(5)
    expect(cov.intersects(3, 100)).toBe(true)
    // The order-3 cell's children and grandchildren.
    expect(cov.intersects(4, 401)).toBe(true)
    expect(cov.intersects(9, (100 * (4 ** 6)) + 1234)).toBe(true)
    // The order-5 cell's parents (it's in order 3's 187, order 0's 2; the order-3 cell in order 0's 1).
    expect(cov.intersects(4, 750)).toBe(true)
    expect(cov.intersects(3, 187)).toBe(true)
    expect(cov.intersects(0, 2)).toBe(true)
    expect(cov.intersects(0, 1)).toBe(true)
    // Its children, but not its siblings'.
    expect(cov.intersects(7, (3000 * 16) + 5)).toBe(true)
    expect(cov.intersects(7, (3001 * 16) + 5)).toBe(false)
    expect(cov.intersects(5, 3001)).toBe(false)
    expect(cov.intersects(0, 0)).toBe(false)
  })

  it('is the whole sky without a MOC', () => {
    const all = newCoverage(null)
    expect(all.intersects(9, 123)).toBe(true)
    expect(discMeetsCoverage(all, [1, 0, 0], 0.01)).toBe(true)
  })
})


/**
 * Every cell that truly meets a disc, from a 9 × 9 sampling of each cell.
 *
 * @param {number} order
 * @param {Array<number>} centre
 * @param {number} radius
 * @returns {Set<number>}
 */
function bruteForce(order, centre, radius) {
  const out = new Set
  for (let p = 0; p < npix(order); p++) {
    let near = false
    for (let i = 0; i <= 8 && !near; i++) {
      for (let j = 0; j <= 8 && !near; j++) {
        near = angle(vecOf(pix2loc(order, p, i / 8, j / 8)), centre) <= radius
      }
    }
    if (near) {
      out.add(p)
    }
  }
  return out
}


describe('the cells in view', () => {
  it('holds every cell that meets the disc, and few that don\'t, against brute force', () => {
    let seed = 7
    const rand = () => {
      seed = ((seed * 16807) % 2147483647)
      return seed / 2147483647
    }
    for (let k = 0; k < 6; k++) {
      const centre = lonLatToVec(rand() * 360, (Math.asin((2 * rand()) - 1)) / toRad)
      const order = 4
      const radius = (2 + (rand() * 10)) * toRad
      const got = cellsInDisc(order, centre, radius)
      const truth = bruteForce(order, centre, radius)
      for (const p of truth) {
        expect(got).toContain(p)
      }
      // The extras only nearly meet it: within a cell's size.
      for (const p of got) {
        const cone = pixelCone(order, p)
        expect(angle(cone.centre, centre)).toBeLessThanOrEqual(radius + cone.radius + 1e-9)
      }
      expect(got.length).toBeLessThan((truth.size * 2) + 8)
      // Nearest first.
      expect(angle(vecOf(pix2loc(order, got[0])), centre)).toBeLessThanOrEqual(
          angle(vecOf(pix2loc(order, got.at(-1))), centre))
    }
  })

  it('finds the few deep cells of a narrow view, and only those in the coverage', () => {
    const centre = lonLatToVec(274.70, -13.84)
    const cells = cellsInDisc(12, centre, 0.05 * toRad)
    expect(cells.length).toBeGreaterThan(4)
    expect(cells.length).toBeLessThan(60)
    expect(cells).toContain(120681887)
    // A coverage of one order-10 cell: only its descendants.
    const cov = newCoverage({10: [Math.floor(120681887 / 16)]})
    const covered = cellsInDisc(12, centre, 0.05 * toRad, {coverage: cov})
    expect(covered.length).toBeGreaterThan(0)
    expect(covered.length).toBeLessThan(cells.length)
    for (const p of covered) {
      expect(Math.floor(p / 16)).toBe(Math.floor(120681887 / 16))
    }
    expect(discMeetsCoverage(cov, centre, 0.05 * toRad)).toBe(true)
    expect(discMeetsCoverage(cov, lonLatToVec(100, 20), 2 * toRad)).toBe(false)
  })
})


describe('a cell\'s grid', () => {
  it('lays the tile\'s image on the cell: top-left south, top-right west, bottom-left east, bottom-right north', () => {
    const order = 10
    const pix = 7542617
    const at = (u, v) => vecOf(tileUvToLoc(order, pix, u, v))
    expect(arcsec(at(0, 0), vecOf(pix2loc(order, pix, 0, 0)))).toBeLessThan(1e-6)
    expect(arcsec(at(1, 0), vecOf(pix2loc(order, pix, 0, 1)))).toBeLessThan(1e-6)
    expect(arcsec(at(0, 1), vecOf(pix2loc(order, pix, 1, 0)))).toBeLessThan(1e-6)
    expect(arcsec(at(1, 1), vecOf(pix2loc(order, pix, 1, 1)))).toBeLessThan(1e-6)
  })

  it('puts the stars of a real tile on their catalogue places (JWST NIRCam over M16)', () => {
    // ESASky's JWST NIRCam_Imaging HiPS, tile Norder10/Npix7542617 (Sky.md,
    // "The tile's orientation"): each star's centroid in the tile's 512 px,
    // measured (column, row from the top-left), against Gaia DR3's place.
    const stars = [
      {gaia: '4146597582048485760', ra: 274.709393077769, dec: -13.883627595101226, px: [69.4, 153.53]},
      {gaia: '4146597616408210560', ra: 274.70018432357756, dec: -13.882395438592892, px: [131.28, 108.33]},
      {gaia: '4146597655062343296', ra: 274.7069166234611, dec: -13.872544202490303, px: [157.52, 213.46]},
    ]
    for (const s of stars) {
      const v = vecOf(tileUvToLoc(10, 7542617, s.px[0] / 512, s.px[1] / 512))
      // A tile pixel at order 10 is 0.40″.
      expect(arcsec(v, lonLatToVec(s.ra, s.dec))).toBeLessThan(0.2)
    }
  })

  it('builds the grid row by row from the top-left, uv down the image', () => {
    const m = frameMatrix('equatorial')
    const g = cellGrid(6, 29463, m, 8)
    expect(g.positions.length).toBe(81 * 3)
    expect(g.index.length).toBe(8 * 8 * 6)
    const corner = (k) => [g.positions[k * 3], g.positions[(k * 3) + 1], g.positions[(k * 3) + 2]]
    expect(arcsec(corner(0), apply(m, vecOf(pix2loc(6, 29463, 0, 0))))).toBeLessThan(0.01)
    expect(arcsec(corner(8), apply(m, vecOf(pix2loc(6, 29463, 0, 1))))).toBeLessThan(0.01)
    expect(arcsec(corner(80), apply(m, vecOf(pix2loc(6, 29463, 1, 1))))).toBeLessThan(0.01)
    expect([g.uvs[16], g.uvs[17]]).toEqual([1, 0])
    expect([g.uvs[18], g.uvs[19]]).toEqual([0, 0.125])
  })
})
