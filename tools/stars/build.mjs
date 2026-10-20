#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {readCelestiaStars} from '../../js/scene/StarsCatalog.js'
import {buildCatalogueTiers} from '../../js/scene/catalogue/build.js'
import {CATALOGUE_TILES_DIR} from '../../js/scene/catalogue/tiers.js'


/**
 * Writes public/large/stars/v1/: the bundled catalogue, stars.dat, as
 * brightness tiers on the point-population engine (#259; js/scene/Stars.md
 * "Brightness tiers"), so the first load fetches the naked-eye sky and
 * every named star (160 KB gzipped) rather than the whole 1.8 MB file, and
 * the rest streams in.  stars.dat and starnames.dat stay where they are and
 * are the source (Gaia's merge reads stars.dat too: Gaia.md); the tiers
 * are committed (Git LFS: public/large/), and a test fails when they have
 * drifted from them (tools/stars/stars.test.js).
 *
 *   yarn stars           writes the tiers
 *   yarn stars --check   exits 1 if the tiers aren't what stars.dat and starnames.dat say
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
export const STARS_DAT = path.join(ROOT, 'public', 'data', 'stars.dat')
export const STAR_NAMES = path.join(ROOT, 'public', 'data', 'starnames.dat')
export const OUTPUT_DIR = path.join(ROOT, 'public', ...CATALOGUE_TILES_DIR.split('/'))


/**
 * @param {Buffer} buf
 * @returns {string} Its SHA-256, hex
 */
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')


/**
 * @returns {{files: Map<string, ArrayBuffer>, manifest: object}} The tiers
 *   stars.dat and starnames.dat make, by path under OUTPUT_DIR
 */
export function buildFromSource() {
  const dat = fs.readFileSync(STARS_DAT)
  const names = fs.readFileSync(STAR_NAMES)
  const raw = readCelestiaStars(dat.buffer.slice(dat.byteOffset, dat.byteOffset + dat.byteLength))
  return buildCatalogueTiers(raw, names.toString('utf8'), {
    generator: 'tools/stars/build.mjs (yarn stars)',
    source: {
      stars: {file: 'public/data/stars.dat', bytes: dat.byteLength, sha256: sha256(dat)},
      names: {file: 'public/data/starnames.dat', bytes: names.byteLength, sha256: sha256(names)},
    },
  })
}


/**
 * @param {string} dir
 * @returns {Array<string>} Every file under it, relative, sorted
 */
export function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    return []
  }
  const out = []
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), {withFileTypes: true})) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        walk(r)
      } else {
        out.push(r)
      }
    }
  }
  walk('')
  return out.sort()
}


/**
 * @param {Map<string, ArrayBuffer>} files
 * @param {string} [dir]
 * @returns {Array<string>} What differs: files missing, extra or changed
 */
export function differences(files, dir = OUTPUT_DIR) {
  const out = []
  const want = [...files.keys()].sort()
  const have = listFiles(dir)
  for (const f of have) {
    if (!files.has(f)) {
      out.push(`extra: ${f}`)
    }
  }
  for (const f of want) {
    const p = path.join(dir, f)
    if (!fs.existsSync(p)) {
      out.push(`missing: ${f}`)
    } else if (!Buffer.from(files.get(f)).equals(fs.readFileSync(p))) {
      out.push(`changed: ${f}`)
    }
  }
  return out
}


if (import.meta.main ?? (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))) {
  const {files, manifest} = buildFromSource()
  if (process.argv.includes('--check')) {
    const diff = differences(files)
    if (diff.length) {
      console.error(`public/${CATALOGUE_TILES_DIR} is out of date (run yarn stars):\n  ${diff.join('\n  ')}`)
      process.exit(1)
    }
    console.log(`public/${CATALOGUE_TILES_DIR} is up to date`)
  } else {
    fs.rmSync(OUTPUT_DIR, {recursive: true, force: true})
    for (const [rel, buf] of files) {
      const p = path.join(OUTPUT_DIR, rel)
      fs.mkdirSync(path.dirname(p), {recursive: true})
      fs.writeFileSync(p, Buffer.from(buf))
    }
    const bytes = [...files.values()].reduce((a, b) => a + b.byteLength, 0)
    console.log(`public/${CATALOGUE_TILES_DIR}: ${manifest.count} stars, the bright tier ${manifest.brightTier.stars} ` +
      `(${manifest.brightTier.toMag} to V 6.5), ${manifest.tileCount} tiles in ${Object.keys(manifest.packs).length} ` +
      `packs, ${files.size} files, ${bytes} bytes`)
  }
}
