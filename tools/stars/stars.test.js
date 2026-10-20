import {describe, expect, it} from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import {OUTPUT_DIR, STARS_DAT, STAR_NAMES, buildFromSource, differences} from './build.mjs'
import AsterismsCatalog from '../../js/scene/AsterismsCatalog.js'
import StarsCatalog, {FAVES} from '../../js/scene/StarsCatalog.js'
import {decodeCatalogueTile} from '../../js/scene/catalogue/catalogueTile.js'
import {BRIGHT_TIER_MAG, LUMINOUS_LABEL_ABS_MAG, ROOTS_PACK, apparentMag} from '../../js/scene/catalogue/tiers.js'
import {catalogueIndex, matchCatalogue} from '../../js/scene/gaia/dedup.js'
import {HIPPARCOS_EPOCH, J2000_EPOCH, PC_TO_CATALOGUE_LY} from '../../js/scene/gaia/astrometry.js'
import {fromHalf} from '../../js/scene/points/float16.js'
import {ABS_MAG_SCALE, decodePack, decodeTile, packPath, tilePath} from '../../js/scene/points/tileFormat.js'
import {tileFromRow} from '../../js/scene/points/tileTree.js'
import {LIGHTYEAR_METER} from '../../js/shared.js'
import {toArrayBuffer} from '../../js/utils.js'


// The bundled catalogue's brightness tiers (js/scene/Stars.md, "Brightness
// tiers"), against their sources, stars.dat and starnames.dat.  The tiers
// are in Git LFS: a checkout without it holds pointer files, and the checks
// of the committed files say so and skip (CI pulls them).


const isLfsPointer = (file) => fs.existsSync(file) &&
  fs.readFileSync(file).subarray(0, 40).toString('utf8').startsWith('version https://git-lfs')
const COMMITTED = path.join(OUTPUT_DIR, packPath(ROOTS_PACK))
const lfsMissing = !fs.existsSync(COMMITTED) || isLfsPointer(COMMITTED)
if (lfsMissing) {
  console.warn(`${COMMITTED} isn't there or is a Git LFS pointer: git lfs pull, to check the committed tiers`)
}

const BUILT = buildFromSource()
const {manifest} = BUILT
const catalogue = new StarsCatalog().read(toArrayBuffer(fs.readFileSync(STARS_DAT)))
catalogue.readNames(fs.readFileSync(STAR_NAMES, 'utf8'))


/** @returns {Map<string, object>} Every tile of the built tiers, decoded, by key */
function decodedTiles() {
  const out = new Map()
  for (const name of Object.keys(manifest.packs)) {
    for (const e of decodePack(BUILT.files.get(packPath(name)))) {
      out.set(e.key, {name, ...decodeCatalogueTile(e.buf), raw: decodeTile(e.buf)})
    }
  }
  return out
}
const TILES = decodedTiles()
const ROOTS = [...TILES.entries()].filter(([key]) => key.startsWith('0/'))
const BRIGHT = new Set(ROOTS.flatMap(([, t]) => [...t.hips]))


describe('public/large/stars/v1', () => {
  it.skipIf(lfsMissing)('is what stars.dat and starnames.dat say (run `yarn stars` after changing either)', () => {
    expect(differences(BUILT.files)).toEqual([])
  })

  it('records its sources, the bright tier and the packs', () => {
    expect(manifest.format).toBe('celestiary-points')
    expect(manifest.source.stars.bytes).toBe(fs.statSync(STARS_DAT).size)
    expect(manifest.count).toBe(106747)
    expect(manifest.brightTier.stars).toBe(BRIGHT.size)
    // Every tile in exactly one pack, the roots in the bright tier's.
    const packed = Object.values(manifest.packs).flat()
    expect(new Set(packed).size).toBe(packed.length)
    expect(packed.sort()).toEqual(manifest.tiles.map((r) => `${r[0]}/${r[1]}`).sort())
    expect(manifest.packs[ROOTS_PACK].sort()).toEqual(ROOTS.map(([key]) => key).sort())
  })
})


describe('the tiers hold the catalogue', () => {
  it('every star of stars.dat, once, as stars.dat gives it', () => {
    const seen = new Map()
    for (const [key, t] of TILES) {
      t.stars.forEach((s) => {
        expect(seen.has(s.hipId)).toBe(false)
        seen.set(s.hipId, key)
        // The same star: the stored float32 position, magnitude and
        // class, so the same lumens, radius and Teff.
        expect(s).toEqual(catalogue.starByHip.get(s.hipId))
      })
    }
    // All but the Sun, which isn't in stars.dat (StarsCatalog adds it).
    expect(seen.size).toBe(catalogue.starByHip.size - 1)
    expect(seen.has(0)).toBe(false)
  })

  it('so Gaia\'s merge with stars.dat holds for them: no Gaia star repeats one of theirs', () => {
    // Gaia's tiles were built against stars.dat (gaia/dedup.js), which the
    // tiers hold exactly (above).  Its brightest, the roots (49,152 stars,
    // where most of the catalogue's are), checked again against the
    // tiers' stars: each Gaia star carried back to the catalogue's epoch
    // by its own motion, and none within 2″ of a catalogue star with V not
    // 0.75 brighter (dedup's position test).
    const gaiaDir = path.join(OUTPUT_DIR, '..', '..', 'gaia', 'v1')
    const gaiaIndex = JSON.parse(fs.readFileSync(path.join(gaiaDir, 'index.json'), 'utf8'))
    const roots = gaiaIndex.tiles.filter((r) => r[0] === 0)
    if (isLfsPointer(path.join(gaiaDir, tilePath(0, roots[0][1])))) {
      return
    }
    const stars = []
    for (const t of TILES.values()) {
      t.stars.forEach((s, i) => stars.push({hipId: s.hipId, x: t.raw.position[3 * i], y: t.raw.position[(3 * i) + 1],
        z: t.raw.position[(3 * i) + 2], mag: t.mags[i]}))
    }
    const index = catalogueIndex(stars)
    const kmPerLy = LIGHTYEAR_METER / 1000
    const back = (J2000_EPOCH - HIPPARCOS_EPOCH) * 365.25 * 86400
    let checked = 0
    let matched = 0
    for (const row of roots) {
      const g = decodeTile(toArrayBuffer(fs.readFileSync(path.join(gaiaDir, tilePath(row[0], row[1])))))
      for (let i = 0; i < g.count; i++) {
        const v = [0, 1, 2].map((k) => (g.velocity ? fromHalf(g.velocity[(3 * i) + k]) : 0))
        const p = [0, 1, 2].map((k) => g.position[(3 * i) + k] - (v[k] * back / kmPerLy))
        const r = Math.hypot(...p)
        const mag = (g.absMag[i] / ABS_MAG_SCALE) + (5 * Math.log10(Math.hypot(g.position[3 * i],
            g.position[(3 * i) + 1], g.position[(3 * i) + 2]) / PC_TO_CATALOGUE_LY / 10))
        if (matchCatalogue({hip: null, dirHip: p.map((c) => c / r), v: mag}, index)) {
          matched++
        }
        checked++
      }
    }
    expect(checked).toBe(roots.reduce((a, r) => a + r[2], 0))
    expect(matched).toBe(0)
  }, 60000)
})


describe('the bright tier', () => {
  it('is the naked-eye sky: every star to V 6.5 from the Sun', () => {
    let n = 0
    for (const [hip, s] of catalogue.starByHip) {
      const ly = [s.x, s.y, s.z].map((c) => Math.fround(c / LIGHTYEAR_METER))
      if (hip !== 0 && apparentMag(s.absMag, ...ly) <= BRIGHT_TIER_MAG) {
        expect(BRIGHT.has(hip)).toBe(true)
        n++
      }
    }
    expect(n).toBe(8746)
    expect(manifest.brightTier.toMag).toBe(8746)
  })

  it('has every star the app names: the names, the label sheet, the favourites, the asterisms', () => {
    // The names (so the search's every entry, and the target's label).
    for (const hip of catalogue.namesByHip.keys()) {
      if (hip !== 0 && catalogue.starByHip.has(hip)) {
        expect(BRIGHT.has(hip)).toBe(true)
      }
    }
    // The label sheet's (Stars.js showLabels): the favourites, the named
    // and the very luminous by number.
    for (const hip of FAVES.keys()) {
      expect(hip === 0 || BRIGHT.has(hip)).toBe(true)
    }
    for (const [hip, s] of catalogue.starByHip) {
      if (hip !== 0 && s.absMag < LUMINOUS_LABEL_ABS_MAG) {
        expect(BRIGHT.has(hip)).toBe(true)
      }
    }
    // The asterisms' stars, as Asterisms.js finds them by name.
    const asterisms = new AsterismsCatalog(catalogue).read(fs.readFileSync('./public/data/asterisms.dat', 'utf-8'))
    let members = 0
    for (const a of asterisms.byName.values()) {
      for (const p of a.paths) {
        for (const name of p) {
          const [, , hip] = catalogue.reifyName(name)
          if (hip && catalogue.starByHip.has(hip)) {
            expect(BRIGHT.has(hip)).toBe(true)
            members++
          }
        }
      }
    }
    expect(members).toBeGreaterThan(800)
    // Proxima, V 11, is named, so in it.
    expect(BRIGHT.has(70890)).toBe(true)
  })

  it('is one pack, a tenth of stars.dat', () => {
    expect(ROOTS.every(([, t]) => t.name === ROOTS_PACK)).toBe(true)
    expect(manifest.brightTier.stars).toBe(8880)
    expect(manifest.packBytes[ROOTS_PACK]).toBeLessThan(fs.statSync(STARS_DAT).size / 10)
  })
})


describe('the tree\'s bounds hold', () => {
  it('each tile\'s stars are within its row, and every star below it is fainter than its magSub', () => {
    const info = new Map(manifest.tiles.map((r) => [`${r[0]}/${r[1]}`, tileFromRow(r)]))
    for (const [key, t] of TILES) {
      const row = info.get(key)
      expect(t.count).toBe(row.count)
      expect(t.mags[0]).toBeGreaterThanOrEqual(row.magBright)
      expect(t.mags[t.count - 1]).toBeLessThanOrEqual(row.magFaint)
      // Sorted, for the draw range's binary search.
      for (let i = 1; i < t.count; i++) {
        expect(t.mags[i]).toBeGreaterThanOrEqual(t.mags[i - 1])
      }
      if (row.order > 0) {
        // Its root's bound: the brightest below the bright tier.
        const root = info.get(`0/${row.pix >> (2 * row.order)}`)
        expect(t.mags[0]).toBeGreaterThanOrEqual(root.magSub)
      }
    }
    // The roots hold a few faint named stars, so their magSub is the
    // naked eye's limit, not their faintest.
    for (const [, t] of ROOTS) {
      expect(t.mags[t.count - 1]).toBeGreaterThan(BRIGHT_TIER_MAG)
    }
    expect(Math.min(...[...info.values()].filter((r) => r.order === 0).map((r) => r.magSub)))
        .toBeGreaterThanOrEqual(BRIGHT_TIER_MAG)
  })
})

