#!/usr/bin/env node
// Regenerates public/data/places/<body>.json from the IAU Gazetteer of
// Planetary Nomenclature (USGS Astrogeology; js/scene/places.md, "The
// Gazetteer").
//
//   node tools/places/build.mjs                 every body below
//   node tools/places/build.mjs moon mars       just these
//   node tools/places/build.mjs --cache DIR     keep the downloads in DIR
//                                               (default: tools/places/.cache,
//                                               ignored by git)
//   node tools/places/build.mjs --check         write nothing; print the tier
//                                               counts and each tier 0
//
// Each body's "center points" shapefile is downloaded from the data bucket the
// Gazetteer's site serves its downloads from (the site itself,
// planetarynames.wr.usgs.gov, need not be reachable), once: a cached zip is
// reused, so a rebuild offline is the same as the first.  The catalogues are
// deterministic for a given download.
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {readDbf, readZip} from './readers.mjs'
import {parseRadiusM, placeOf, tierPlaces} from './tiers.mjs'


export const BUCKET = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com'

// Celestiary's body (its descriptor in public/data/<body>.json) to the
// Gazetteer's target name.  Earth keeps its own city tiers (places.md), and
// Ceres and Vesta are in the Gazetteer but not bodies here yet: add them to
// this table when they have descriptors.
export const BODIES = {
  mercury: 'MERCURY',
  venus: 'VENUS',
  moon: 'MOON',
  mars: 'MARS',
  phobos: 'PHOBOS',
  deimos: 'DEIMOS',
  io: 'IO',
  europa: 'EUROPA',
  ganymede: 'GANYMEDE',
  callisto: 'CALLISTO',
  dione: 'DIONE',
  hyperion: 'HYPERION',
  iapetus: 'IAPETUS',
  janus: 'JANUS',
  rhea: 'RHEA',
  tethys: 'TETHYS',
  titan: 'TITAN',
  titania: 'TITANIA',
  oberon: 'OBERON',
  triton: 'TRITON',
  proteus: 'PROTEUS',
  pluto: 'PLUTO',
  charon: 'CHARON',
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

const MISSION_KINDS = new Set(['landing', 'lander', 'rover'])

const ATTRIBUTION = 'IAU Gazetteer of Planetary Nomenclature, USGS Astrogeology Science Center and the IAU ' +
    'Working Group for Planetary System Nomenclature (WGPSN); planetarynames.wr.usgs.gov. Public domain.'


/**
 * @param {string} name The Gazetteer's target ("MARS")
 * @param {string} cache Directory for downloads
 * @returns {Promise<{zip: Buffer, modified: string}>} The center-points zip,
 *   and its Last-Modified date (YYYY-MM-DD) as the bucket gave it when downloaded
 */
async function download(name, cache) {
  const file = join(cache, `${name}_nomenclature_center_pts.zip`)
  const meta = `${file}.json`
  if (existsSync(file) && existsSync(meta)) {
    return {zip: readFileSync(file), modified: JSON.parse(readFileSync(meta, 'utf8')).modified}
  }
  const url = `${BUCKET}/${name}_nomenclature_center_pts.zip`
  const rsp = await fetch(url)
  if (!rsp.ok) {
    throw new Error(`${url}: ${rsp.status}`)
  }
  const zip = Buffer.from(await rsp.arrayBuffer())
  const modified = new Date(rsp.headers.get('last-modified')).toISOString().slice(0, 10)
  mkdirSync(cache, {recursive: true})
  writeFileSync(file, zip)
  writeFileSync(meta, JSON.stringify({url, modified}))
  return {zip, modified}
}


/**
 * @param {Array<object>} places
 * @returns {string} The catalogue's `places` array, a place to a line
 */
function placesJson(places) {
  return places.map((p) => `    ${JSON.stringify(p).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^{/, '{')}`)
      .join(',\n')
}


/**
 * @param {string} body
 * @param {string} cache
 * @returns {Promise<{json: string, places: Array<object>, stats: object}>}
 */
export async function buildBody(body, cache) {
  const target = BODIES[body]
  const {zip, modified} = await download(target, cache)
  const files = readZip(zip)
  const dbf = [...files.keys()].find((k) => k.endsWith('.dbf'))
  const cpg = [...files.keys()].find((k) => k.endsWith('.cpg'))
  const encoding = cpg ? files.get(cpg).toString('latin1').trim().toLowerCase().replace(/^utf-?8$/, 'utf-8') : 'utf-8'
  const rows = readDbf(files.get(dbf), encoding || 'utf-8')
  const features = rows.map(placeOf).filter(Boolean)
  const newest = rows.reduce((a, r) => (r.approvaldt > a ? r.approvaldt : a), '').slice(0, 10).replaceAll('/', '-')

  const descriptor = JSON.parse(readFileSync(join(root, `public/data/${body}.json`), 'utf8'))
  const diameterKm = (2 * parseRadiusM(descriptor.radius)) / 1000
  const curatedFile = join(here, 'curated', `${body}.json`)
  const curated = existsSync(curatedFile) ? JSON.parse(readFileSync(curatedFile, 'utf8')).places : []
  const promote = JSON.parse(readFileSync(join(here, 'promote.json'), 'utf8'))[body] ?? {}
  for (const [n, t] of Object.entries(promote)) {
    curated.push({n, t}) // no position: promotes the Gazetteer's
  }
  const places = tierPlaces(features, diameterKm, curated)

  const header = {
    _attribution: ATTRIBUTION + (curated.some((c) => MISSION_KINDS.has(c.k)) ?
        ' Landing sites from NASA and Roscosmos mission records.' : ''),
    _body: body,
    _source: `${BUCKET}/${target}_nomenclature_center_pts.zip`,
    _sourceModified: modified,
    _newestApproval: newest,
    _generator: 'tools/places/build.mjs',
    _lngConvention: 'east-positive (+E), -180..+180',
    _latConvention: 'planetocentric',
  }
  const json = `{\n${Object.entries(header).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n` +
      `  "places": [\n${placesJson(places)}\n  ]\n}\n`
  const stats = {rows: rows.length, features: features.length, tiers: [0, 1, 2, 3].map((t) => places.filter((p) => p.t === t).length)}
  return {json, places, stats, curated, features}
}


/** The command line. */
async function main() {
  const args = process.argv.slice(2)
  let cache = join(here, '.cache')
  let check = false
  const only = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cache') {
      cache = resolve(args[++i])
    } else if (args[i] === '--check') {
      check = true
    } else if (BODIES[args[i]]) {
      only.push(args[i])
    } else {
      throw new Error(`unknown argument ${args[i]}`)
    }
  }
  for (const body of only.length ? only : Object.keys(BODIES)) {
    const {json, places, stats, curated, features} = await buildBody(body, cache)
    const names = new Set(features.map((f) => f.n.toLowerCase()))
    for (const c of curated.filter((x) => x.lat === undefined)) {
      if (!names.has(c.n.toLowerCase())) {
        console.warn(`  ${body}: curated promotion "${c.n}" is not a Gazetteer name`)
      }
    }
    console.log(`${body}: ${stats.rows} rows, ${stats.features} places, tiers ${stats.tiers.join('/')}, ${json.length} bytes`)
    if (check) {
      console.log(`  tier 0: ${places.filter((p) => p.t === 0).map((p) => p.n).join(', ')}`)
    } else {
      const out = join(root, 'public/data/places', `${body}.json`)
      mkdirSync(dirname(out), {recursive: true})
      writeFileSync(out, json)
    }
  }
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
