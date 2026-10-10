#!/usr/bin/env bun
// Builds the Gaia DR3 star tiles under public/large/gaia/v1/ (js/scene/Gaia.md,
// "Rebuilding").  Run with bun (the library is ES modules under js/):
//
//   yarn gaia all                  # counts, fetch, tile: the one command
//   yarn gaia counts               # the archive's star counts by G; picks the cut
//   yarn gaia fetch [--cut 11.2]   # the rows, in 48 chunks, cached
//   yarn gaia tile                 # the cached rows to tiles and the manifest
//   yarn gaia catalogue --out DIR  # the bundled stars.dat through the same tile
//                                  # pipeline: a test population, not Gaia's
//
// Options: --target N (stars wanted; default 1,000,000), --cut G (skip the
// counts), --cache DIR (default tools/gaia/.cache, git-ignored), --out DIR
// (default public/large/gaia/v1), --chunk-order K (12 × 4^K jobs by source_id; default all,
// one job),
// --fetch-cut G (tile: the rows were fetched to this fainter cut; cut them
// to --cut, or the counts' cut, without fetching again).
//
// Network: gea.esac.esa.int only (the ESA Gaia archive's TAP service).
import {mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import StarsCatalog from '../../js/scene/StarsCatalog.js'
import {LIGHTYEAR_METER} from '../../js/shared.js'
import {TAP_URL, chooseCut, countsQuery, parseCsv, sourceIdChunks, sourceQuery} from '../../js/scene/gaia/adql.js'
import {MAX_ORDER, TILE_CAP, buildTiles, magnitudeHistogram, mergeGaia} from '../../js/scene/gaia/build.js'
import {GAIA_TILES_DIR} from '../../js/scene/gaia/gaiaPopulation.js'
import {catalogueRecord} from '../../js/scene/gaia/records.js'
import {runAsync} from './tap.mjs'


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BINS_PER_MAG = 20
const COUNTS_MAX_MAG = 13

const LICENCE = `Gaia DR3 star tiles for celestiary (js/scene/Gaia.md).

Derived from the European Space Agency (ESA) mission Gaia's third data
release, Gaia DR3 (Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1;
the mission: Gaia Collaboration, Prusti et al. 2016, A&A 595, A1), from the
ESA Gaia archive, with distances from Bailer-Jones et al. 2021 (AJ 161, 147).
Gaia data: ESA/Gaia/DPAC, licensed CC BY-SA 3.0 IGO
(https://creativecommons.org/licenses/by-sa/3.0/igo/).  These tiles are a
derived work (propagated to J2000.0, converted to V and to the scene's frame,
merged with the bundled catalogue) and are shared under the same licence.

This work has made use of data from the European Space Agency (ESA) mission
Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing
and Analysis Consortium (DPAC,
https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has
been provided by national institutions, in particular the institutions
participating in the Gaia Multilateral Agreement.
`


/**
 * @param {Array<string>} argv
 * @returns {{cmd: string, opts: object}}
 */
function parseArgs(argv) {
  const [cmd = 'help', ...rest] = argv
  const opts = {}
  for (let i = 0; i < rest.length; i++) {
    const m = (/^--([a-z-]+)$/).exec(rest[i])
    if (m) {
      opts[m[1]] = rest[i + 1]
      i++
    }
  }
  return {cmd, opts}
}


const log = (...args) => console.error(...args)


/**
 * @param {object} opts
 * @returns {object} Paths
 */
function paths(opts) {
  const cache = resolve(ROOT, opts.cache ?? 'tools/gaia/.cache')
  return {cache, counts: join(cache, 'counts.json'), out: resolve(ROOT, opts.out ?? `public/${GAIA_TILES_DIR}`)}
}


/**
 * The archive's counts by G, cached.
 *
 * @param {object} opts
 * @returns {Promise<Array<{bin: number, n: number}>>}
 */
async function counts(opts) {
  const p = paths(opts)
  if (existsSync(p.counts)) {
    return JSON.parse(readFileSync(p.counts, 'utf8')).rows
  }
  const query = countsQuery({maxMag: COUNTS_MAX_MAG, binsPerMag: BINS_PER_MAG})
  log(`Counting stars by G (G < ${COUNTS_MAX_MAG})...`)
  const rows = parseCsv(await runAsync(TAP_URL, query, {log}))
  mkdirSync(p.cache, {recursive: true})
  writeFileSync(p.counts, JSON.stringify({query, fetched: new Date().toISOString(), binsPerMag: BINS_PER_MAG, rows}, null, 1))
  return rows
}


/**
 * @param {object} opts
 * @returns {Promise<{cut: number, count: number}>}
 */
async function pickCut(opts) {
  if (opts.cut) {
    return {cut: parseFloat(opts.cut), count: NaN}
  }
  const rows = await counts(opts)
  const target = parseInt(opts.target ?? '1000000')
  const pick = chooseCut(rows, target, BINS_PER_MAG)
  log(`G < ${pick.cut}: ${pick.count} stars (target ${target})`)
  return pick
}


/**
 * @param {object} opts
 * @returns {Promise<{cut: number, dir: string, chunks: number}>}
 */
async function fetchRows(opts) {
  const {cut} = await pickCut(opts)
  const dir = join(paths(opts).cache, `g${cut}`)
  mkdirSync(dir, {recursive: true})
  const chunks = chunksFor(opts)
  for (const {cell, lo, hi} of chunks) {
    const file = join(dir, `${cell}.csv`)
    if (existsSync(file)) {
      continue
    }
    log(`chunk ${cell + 1}/${chunks.length}`)
    const csv = await runAsync(TAP_URL, sourceQuery({cut, lo, hi}), {log})
    // Written whole, after the job: a partial file is never taken for a chunk.
    writeFileSync(`${file}.tmp`, csv)
    rmSync(file, {force: true})
    writeFileSync(file, csv)
    rmSync(`${file}.tmp`, {force: true})
  }
  return {cut, dir, chunks: chunks.length}
}


/**
 * The jobs to fetch the sky in: one by default (a million rows is a third
 * of an anonymous job's limit, and one query on the magnitude is faster
 * than many on source_id ranges: a 1/48 chunk ran over 6 minutes, the
 * whole sky in one about MINUTES_PLACEHOLDER), or `--chunk-order K`'s 12 × 4^K
 * source_id ranges.
 *
 * @param {object} opts
 * @returns {Array<{cell: number, lo: bigint, hi: bigint}>}
 */
function chunksFor(opts) {
  const order = opts['chunk-order']
  if (order === undefined || order === 'all') {
    const [{lo}, last] = [sourceIdChunks(0)[0], sourceIdChunks(0)[11]]
    return [{cell: 0, lo, hi: last.hi}]
  }
  return sourceIdChunks(parseInt(order))
}


/** @returns {Array<object>} The bundled catalogue's stars, light-years */
function catalogueStars() {
  const catalog = new StarsCatalog()
  const buf = readFileSync(join(ROOT, 'public/data/stars.dat'))
  catalog.read(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  return [...catalog.starByHip.values()].map((s) => ({
    ...s, x: s.x / LIGHTYEAR_METER, y: s.y / LIGHTYEAR_METER, z: s.z / LIGHTYEAR_METER,
  }))
}


/**
 * The fetched rows against the archive's own counts, bin by bin (0.05 mag
 * of G): a fetch that lost a chunk or rows shows here.
 *
 * @param {Array<object>} rows
 * @param {number} cut
 * @param {string} countsFile
 * @returns {object}
 */
function checkAgainstCounts(rows, cut, countsFile) {
  if (!existsSync(countsFile)) {
    return {checked: false}
  }
  const archive = new Map()
  for (const {bin, n} of JSON.parse(readFileSync(countsFile, 'utf8')).rows) {
    if ((bin + 1) / BINS_PER_MAG <= cut + 1e-9) {
      archive.set(bin, n)
    }
  }
  const fetched = new Map()
  for (const r of rows) {
    const bin = Math.floor(r.phot_g_mean_mag * BINS_PER_MAG)
    fetched.set(bin, (fetched.get(bin) ?? 0) + 1)
  }
  const differ = []
  for (const bin of new Set([...archive.keys(), ...fetched.keys()])) {
    if ((archive.get(bin) ?? 0) !== (fetched.get(bin) ?? 0)) {
      differ.push([bin / BINS_PER_MAG, archive.get(bin) ?? 0, fetched.get(bin) ?? 0])
    }
  }
  const total = [...archive.values()].reduce((a, b) => a + b, 0)
  return {checked: true, archive: total, fetched: rows.length, binsDiffering: differ.sort((a, b) => a[0] - b[0])}
}


/**
 * @param {string} out
 * @param {Map<string, ArrayBuffer>} files
 */
function writeFiles(out, files) {
  rmSync(out, {recursive: true, force: true})
  for (const [path, buf] of files) {
    const file = join(out, path)
    mkdirSync(dirname(file), {recursive: true})
    writeFileSync(file, new Uint8Array(buf))
  }
}


/**
 * @param {object} opts
 * @returns {Promise<void>}
 */
async function tile(opts) {
  const {cut} = await pickCut(opts)
  // Rows fetched to a fainter cut can be cut here without fetching again.
  const fetchCut = opts['fetch-cut'] ? parseFloat(opts['fetch-cut']) : cut
  if (fetchCut < cut) {
    throw new Error(`--fetch-cut ${fetchCut} is brighter than the cut ${cut}`)
  }
  const dir = join(paths(opts).cache, `g${fetchCut}`)
  const csvs = readdirSync(dir).filter((f) => f.endsWith('.csv'))
  const expected = chunksFor(opts).length
  if (csvs.length !== expected) {
    throw new Error(`${csvs.length} of ${expected} chunks in ${dir}: run \`yarn gaia fetch\` first`)
  }
  const rows = []
  for (const f of csvs) {
    for (const row of parseCsv(readFileSync(join(dir, f), 'utf8'))) {
      if (row.phot_g_mean_mag < cut) {
        rows.push(row)
      }
    }
  }
  log(`${rows.length} rows; merging with the bundled catalogue...`)
  const archiveCheck = checkAgainstCounts(rows, cut, paths(opts).counts)
  log(`against the archive's counts: ${JSON.stringify(archiveCheck)}`)
  const {records, colourTable, report} = mergeGaia(rows, catalogueStars())
  const countsFile = paths(opts).counts
  const meta = {
    name: 'gaia-dr3',
    title: `Gaia DR3, G < ${cut}, less the bundled catalogue's stars`,
    epoch: 2000.0,
    frame: 'J2000 mean ecliptic, scene axes (X equinox, Y north ecliptic pole, Z = -ecliptic Y); positions in ' +
      'light-years (x LIGHTYEAR_METER = metres), velocities km/s',
    magnitude: 'Johnson V from Gaia G and BP-RP (Riello et al. 2021, Table C.2)',
    source: {
      archive: TAP_URL,
      query: sourceQuery({cut, lo: '<lo>', hi: '<hi>'}),
      chunks: expected,
      cut,
      counts: existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, 'utf8')) : null,
    },
    built: new Date().toISOString(),
    licence: 'CC BY-SA 3.0 IGO (ESA/Gaia/DPAC); see LICENSE.txt',
    colourTable,
    report: {...report, archiveCheck},
    histogram: magnitudeHistogram(records),
  }
  const {files, manifest} = buildTiles(records, meta, {cap: TILE_CAP, maxOrder: MAX_ORDER})
  files.set('LICENSE.txt', new TextEncoder().encode(LICENCE).buffer)
  const out = paths(opts).out
  writeFiles(out, files)
  log(`${manifest.count} stars in ${manifest.tileCount} tiles, ${(manifest.bytes / 1e6).toFixed(1)} MB, to ${out}`)
  log(JSON.stringify(report, null, 1))
}


/**
 * The bundled catalogue through the tile pipeline, for checking the
 * renderer and loader without Gaia's data.  Labelled as what it is.
 *
 * @param {object} opts
 */
function catalogueTiles(opts) {
  if (!opts.out) {
    throw new Error('catalogue: --out DIR is required (a scratch directory; this is not Gaia data)')
  }
  const records = catalogueStars().filter((s) => s.hipId !== 0).map(catalogueRecord)
  const meta = {
    name: 'test-catalogue',
    title: 'TEST POPULATION: the bundled stars.dat through the tile pipeline (not Gaia data)',
    epoch: 1991.25,
    frame: 'as stars.dat',
    magnitude: 'V, as stars.dat',
    built: new Date().toISOString(),
  }
  const cap = parseInt(opts.cap ?? `${TILE_CAP}`)
  const {files, manifest} = buildTiles(records, meta, {cap, maxOrder: MAX_ORDER})
  const out = resolve(opts.out)
  writeFiles(out, files)
  log(`${manifest.count} stars in ${manifest.tileCount} tiles (cap ${cap}), ${(manifest.bytes / 1e6).toFixed(1)} MB, to ${out}`)
}


const {cmd, opts} = parseArgs(process.argv.slice(2))
const commands = {
  counts: async () => {
    const rows = await counts(opts)
    let total = 0
    for (const {bin, n} of rows) {
      total += n
      console.log(`${(bin / BINS_PER_MAG).toFixed(2)}\t${n}\t${total}`)
    }
    await pickCut(opts)
  },
  fetch: () => fetchRows(opts),
  tile: () => tile(opts),
  all: async () => {
    await fetchRows(opts)
    await tile(opts)
  },
  catalogue: () => catalogueTiles(opts),
}
if (!commands[cmd]) {
  log('usage: bun tools/gaia/gaia.mjs counts|fetch|tile|all|catalogue [--target N] [--cut G] [--out DIR]')
  process.exit(cmd === 'help' ? 0 : 1)
}
await commands[cmd]()
