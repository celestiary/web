#!/usr/bin/env node
// Builds public/data/sparc/galaxies.json and public/data/sparc/curves.json:
// SPARC's 175 disc galaxies (Lelli, McGaugh & Schombert 2016, AJ 152, 157),
// each cross-matched by name for its sky position, position angle and optical
// photometry.  The design, the sources and what each field is for are in
// js/scene/Galaxies.md.  Tests never fetch; run this by hand to rebuild:
//
//   NODE_USE_ENV_PROXY=1 node tools/sparc/buildSparc.mjs [--cache DIR]
//
// (NODE_USE_ENV_PROXY=1 lets Node's fetch use an HTTPS proxy, Node >= 22.21.)
// --cache keeps every reply under DIR, so a rerun doesn't fetch again.
//
// What it fetches:
//
// - SPARC (https://astroweb.case.edu/SPARC/): Table 1 (SPARC_Lelli2016c.mrt:
//   type, distance, inclination, L[3.6], disc scale length, HI, V_flat),
//   the bulge luminosities (Bulges.mrt), the mass models (Table 2,
//   MassModels_Lelli2016c.mrt: the rotation curves and V_gas, V_disk,
//   V_bul) and the bulge-disc decompositions (BulgeDiskDec_LTG.zip: the
//   3.6 µm disc and bulge surface brightness profiles, as observed).
// - NED's name resolver (https://ned.ipac.caltech.edu/srs/ObjectLookup):
//   each name's preferred designation and its J2000 (ICRS) position.
// - SIMBAD's TAP (https://simbad.cds.unistra.fr/simbad/sim-tap): the galaxy
//   nearest NED's position within MATCH_ARCSEC, its main identifier, its
//   major axis's position angle (galdim_angle, with its bibcode) and its
//   morphological type.
// - VizieR (https://vizier.cds.unistra.fr): RC3 (VII/155, de Vaucouleurs et
//   al. 1991) for B_T, (B-V)_T, the corrected B_T^0 and (B-V)_T^0, the
//   Galactic extinction A_g, the de Vaucouleurs type with its bar family,
//   D25 and R25 and a position angle; and HyperLEDA's PGC 2003 (VII/237,
//   Paturel et al. 2003) for a position angle and D25 where RC3 has none.
import {inflateRawSync} from 'node:zlib'
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'


const SPARC = 'https://astroweb.case.edu/SPARC/'
const NED = 'https://ned.ipac.caltech.edu/srs/ObjectLookup'
const SIMBAD_TAP = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync'
const VIZIER = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv'
/** How far from NED's position a SIMBAD, RC3 or PGC entry may be, arcsec. */
const MATCH_ARCSEC = 30
/** RC3's positions are its B1950 ones precessed, tens of arcsec off for some: a wider cone, the nearest taken. */
const RC3_ARCSEC = 60
/**
 * SIMBAD object types that are galaxies, and their candidates ('AG?' is
 * how SIMBAD lists many large spirals; https://simbad.cds.unistra.fr/guide/otypes.htx).
 * Not 'PoG', part of a galaxy: an HII region or a Wolf-Rayet knot.
 */
const GALAXY_OTYPE = /^(G|LSB|bCG|SBG|H2G|EmG|AGN|AG|SyG|Sy1|Sy2|LIN|GiG|GiP|GiC|BiC|IG|PaG|rG|LeG|BClG)\??$/
/** Points kept of each profile (the decompositions have 100-300). */
const PROFILE_POINTS = 32

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', 'public', 'data', 'sparc')

const args = process.argv.slice(2)
const cacheDir = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null
if (cacheDir) {
  mkdirSync(cacheDir, {recursive: true})
}


/**
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.binary]
 * @returns {Promise<string|Buffer>}
 */
async function get(url, {binary = false} = {}) {
  const key = cacheDir ? join(cacheDir, createHash('sha1').update(url).digest('hex')) : null
  if (key && existsSync(key)) {
    const buf = readFileSync(key)
    return binary ? buf : buf.toString('utf8')
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        // A reply's body is left out: some services echo the request.
        throw new Error(`HTTP ${res.status} for ${new URL(url).host}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (key) {
        writeFileSync(key, buf)
      }
      return binary ? buf : buf.toString('utf8')
    } catch (e) {
      if (attempt >= 4) {
        throw e
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}


/**
 * The files of a zip archive (stored or deflated entries), by name.
 *
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
function unzip(buf) {
  const files = new Map()
  // The end of central directory record.
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) {
    eocd--
  }
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(dataAt, dataAt + size)
    files.set(name.split('/').pop(), method === 8 ? inflateRawSync(raw) : raw)
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}


/**
 * @param {string} s
 * @returns {number|null}
 */
function num(s) {
  const t = String(s ?? '').trim()
  if (t === '') {
    return null
  }
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}


/**
 * SPARC's Table 1.  Its columns are split on whitespace: the file's bytes
 * run one or two past its own byte-by-byte description, and no field is
 * blank or holds a space.
 *
 * @param {string} text
 * @returns {Array<object>}
 */
function parseTable1(text) {
  const lines = text.split('\n')
  const start = lines.findLastIndex((l) => l.startsWith('-----')) + 1
  const keys = ['name', 'T', 'D', 'eD', 'fD', 'inc', 'eInc', 'L36', 'eL36', 'Reff', 'SBeff', 'Rdisk', 'SBdisk', 'MHI',
    'RHI', 'Vflat', 'eVflat', 'Q', 'refs']
  return lines.slice(start).filter((l) => l.trim()).map((l) => {
    const cols = l.trim().split(/\s+/)
    if (cols.length !== keys.length) {
      throw new Error(`Table 1: ${cols.length} columns in "${l}"`)
    }
    return Object.fromEntries(keys.map((k, i) => [k, k === 'name' || k === 'refs' ? cols[i] : num(cols[i])]))
  })
}


/**
 * @param {string} text Bulges.mrt
 * @returns {Map<string, number>} L_bul at 3.6 µm, 1e9 L_sun
 */
function parseBulges(text) {
  const out = new Map()
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) {
      continue
    }
    const [name, l] = line.trim().split(/\s+/)
    out.set(name, num(l))
  }
  return out
}


/**
 * SPARC's Table 2, the mass models, by galaxy, split on whitespace as
 * Table 1 is.
 *
 * @param {string} text
 * @returns {Map<string, Array<Array<number>>>} [R kpc, Vobs, e_Vobs, Vgas, Vdisk, Vbul km/s]
 */
function parseMassModels(text) {
  const lines = text.split('\n')
  const start = lines.findLastIndex((l) => l.startsWith('-----')) + 1
  const out = new Map()
  for (const l of lines.slice(start)) {
    const cols = l.trim().split(/\s+/)
    if (cols.length !== 10) {
      continue
    }
    // ID, D, then R, Vobs, e_Vobs, Vgas, Vdisk, Vbul, SBdisk, SBbul.
    if (!out.has(cols[0])) {
      out.set(cols[0], [])
    }
    out.get(cols[0]).push(cols.slice(2, 8).map(num))
  }
  return out
}


/**
 * A decomposition's profiles (as observed, not corrected for inclination).
 *
 * @param {string} text A .dens file
 * @returns {Array<Array<number>>} [R kpc, SB_disk, SB_bulge L_sun/pc²]
 */
function parseDens(text) {
  return text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/).map(Number))
      .filter((r) => r.length >= 3 && r.every(Number.isFinite))
}


/**
 * The radius holding half a profile's light, by the trapezium rule over
 * 2πR·SB dR (the profile's own extent; SPARC extrapolates bulges linearly
 * past their data, which this counts).
 *
 * @param {Array<Array<number>>} rows [R, ...]
 * @param {number} c The column
 * @returns {number|null} kpc
 */
function halfLightRadius(rows, c) {
  const cum = [0]
  for (let i = 1; i < rows.length; i++) {
    const [r0, r1] = [rows[i - 1][0], rows[i][0]]
    cum.push(cum[i - 1] + (Math.PI * ((r0 * rows[i - 1][c]) + (r1 * rows[i][c])) * (r1 - r0)))
  }
  const total = cum[cum.length - 1]
  if (!(total > 0)) {
    return null
  }
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= total / 2) {
      const t = ((total / 2) - cum[i - 1]) / (cum[i] - cum[i - 1])
      return rows[i - 1][0] + (t * (rows[i][0] - rows[i - 1][0]))
    }
  }
  return null
}


/**
 * The disc's profile, face on (× cos i), resampled at PROFILE_POINTS radii
 * evenly in √R from its first to its last, rounded to 4 figures.
 *
 * @param {Array<Array<number>>} rows parseDens's
 * @param {number} incDeg
 * @returns {Array<Array<number>>} [R kpc, SB_disk L_sun/pc²]
 */
function discProfile(rows, incDeg) {
  const pts = rows.filter((r) => r[0] > 0 && r[1] > 0)
  if (pts.length < 2) {
    return []
  }
  const cosI = Math.cos(incDeg * Math.PI / 180)
  const lo = Math.sqrt(pts[0][0])
  const hi = Math.sqrt(pts[pts.length - 1][0])
  const out = []
  let j = 0
  for (let k = 0; k < PROFILE_POINTS; k++) {
    const r = (lo + ((hi - lo) * k / (PROFILE_POINTS - 1))) ** 2
    while (j < pts.length - 2 && pts[j + 1][0] < r) {
      j++
    }
    const [r0, s0] = pts[j]
    const [r1, s1] = pts[j + 1]
    // Log-linear between samples: the profile is near exponential.
    const t = Math.min(Math.max((r - r0) / (r1 - r0), 0), 1)
    const sb = Math.exp((Math.log(s0) * (1 - t)) + (Math.log(s1) * t)) * cosI
    out.push([sig(r, 4), sig(sb, 4)])
  }
  return out
}


/**
 * @param {number} v
 * @param {number} n
 * @returns {number} v to n significant figures
 */
function sig(v, n) {
  return v === 0 ? 0 : Number(v.toPrecision(n))
}


/**
 * NED's preferred name and position for a SPARC name.
 *
 * @param {string} name
 * @returns {Promise<{name: string, ra: number, dec: number}|null>}
 */
async function ned(name) {
  const text = await get(`${NED}?name=${encodeURIComponent(name)}`)
  const j = JSON.parse(text)
  const p = j?.Preferred
  if (j?.ResultCode !== 3 || !p?.Position) {
    return null
  }
  return {name: p.Name.replace(/\s+/g, ' ').trim(), ra: p.Position.RA, dec: p.Position.Dec, z: p.Redshift?.Value ?? null}
}


/**
 * The galaxy SIMBAD lists at a position: of the galaxies within
 * MATCH_ARCSEC, the largest by its major axis, so that a catalogued HII
 * region or knot in a galaxy isn't taken for it; the nearest where none
 * has a size.
 *
 * @param {number} ra
 * @param {number} dec
 * @param {Array<string>} names The galaxy's names (SPARC's, NED's preferred)
 * @returns {Promise<object|null>}
 */
async function simbad(ra, dec, names) {
  const q = `SELECT TOP 10 main_id, ra, dec, otype, galdim_majaxis, galdim_minaxis, galdim_angle, galdim_bibcode, morph_type,
    DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${ra}, ${dec})) * 3600 AS sep
    FROM basic WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${MATCH_ARCSEC / 3600})) = 1
    ORDER BY sep`
  const text = await get(`${SIMBAD_TAP}?request=doQuery&lang=adql&format=csv&query=${encodeURIComponent(q)}`)
  const rows = parseCsv(text).filter((r) => GALAXY_OTYPE.test(r.otype))
  // The one that has the name among its identifiers, if any does.
  const qi = `SELECT TOP 3000 b.main_id, i.id FROM basic AS b JOIN ident AS i ON i.oidref = b.oid
    WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', ${ra}, ${dec}, ${MATCH_ARCSEC / 3600})) = 1`
  const ids = parseCsv(await get(`${SIMBAD_TAP}?request=doQuery&lang=adql&format=csv&query=${encodeURIComponent(qi)}`))
  const wanted = new Set(names.map(normName))
  const named = new Set(ids.filter((r) => wanted.has(normName(r.id))).map((r) => r.main_id))
  const sized = rows.filter((r) => num(r.galdim_majaxis) > 0).sort((a, b) => num(b.galdim_majaxis) - num(a.galdim_majaxis))
  const g = rows.find((r) => named.has(r.main_id)) ?? sized[0] ?? rows[0]
  if (!g) {
    return null
  }
  return {
    id: g.main_id.replace(/\s+/g, ' ').trim(),
    // Matched by one of its names, or else as the largest galaxy there.
    byName: named.has(g.main_id),
    sep: sig(num(g.sep), 3),
    otype: g.otype,
    pa: num(g.galdim_angle),
    paRef: g.galdim_bibcode || null,
    majAxis: num(g.galdim_majaxis),
    minAxis: num(g.galdim_minaxis),
    morph: g.morph_type || null,
  }
}


/**
 * A designation compared without its spacing, case or leading zeros, and
 * with SPARC's and NED's spellings of a few catalogues as SIMBAD's
 * ('NGC0024', 'NGC 24' and 'NGC  24' are one; 'ESO079-G014' is 'ESO 79-14';
 * 'MESSIER 109' is 'M 109').
 *
 * @param {string} s
 * @returns {string}
 */
function normName(s) {
  return String(s).toUpperCase().replace(/^NAME /, '').replace(/^MESSIER/, 'M').replace(/-G(\d)/, '-$1')
      .replace(/[^A-Z0-9-]/g, '').replace(/(^|[A-Z-])0+(\d)/g, '$1$2')
}


/**
 * @param {string} text CSV with a header row and quoted strings
 * @returns {Array<object>}
 */
function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length === 0 || lines[0].startsWith('<')) {
    return []
  }
  const split = (line) => {
    const out = []
    let cur = ''
    let quoted = false
    for (const ch of line) {
      if (ch === '"') {
        quoted = !quoted
      } else if (ch === ',' && !quoted) {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out
  }
  const head = split(lines[0])
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])))
}


/**
 * The nearest row of a VizieR table within a radius of a position.
 *
 * @param {string} source e.g. 'VII/155/rc3'
 * @param {Array<string>} cols
 * @param {number} ra
 * @param {number} dec
 * @param {number} arcsec
 * @returns {Promise<object|null>}
 */
async function vizierNearest(source, cols, ra, dec, arcsec) {
  const url = `${VIZIER}?-source=${source}&-c=${ra}%20${dec}&-c.rs=${arcsec}&-out=${cols.join(',')},_r&-sort=_r&-out.max=1`
  const text = await get(url)
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  // Header, units, dashes, then rows.
  if (lines.length < 4) {
    return null
  }
  const head = lines[0].split('\t')
  const row = lines[3].split('\t')
  return Object.fromEntries(head.map((h, i) => [h, (row[i] ?? '').trim()]))
}


/**
 * @param {number} ra
 * @param {number} dec
 * @returns {Promise<object|null>} RC3's photometry, type and shape
 */
async function rc3(ra, dec) {
  const r = await vizierNearest('VII/155/rc3', ['name', 'altname', 'PGC', 'type', 'T', 'D25', 'R25', 'PA', 'BT', 'B-VT',
    'B-VoT', 'BoT', 'Ag', 'Ai'], ra, dec, RC3_ARCSEC)
  if (!r) {
    return null
  }
  return {
    name: r.name.replace(/\s+/g, ' ').trim(),
    sep: num(r._r),
    type: r.type || null,
    T: num(r.T),
    logD25: num(r.D25),
    logR25: num(r.R25),
    pa: num(r.PA),
    BT: num(r.BT),
    BV: num(r['B-VT']),
    BV0: num(r['B-VoT']),
    BT0: num(r.BoT),
    Ag: num(r.Ag),
    Ai: num(r.Ai),
  }
}


/**
 * @param {number} ra
 * @param {number} dec
 * @returns {Promise<object|null>} HyperLEDA's PGC 2003 entry: PA and D25
 */
async function pgc2003(ra, dec) {
  const r = await vizierNearest('VII/237/pgc', ['PGC', 'MType', 'logD25', 'logR25', 'PA'], ra, dec, MATCH_ARCSEC)
  if (!r) {
    return null
  }
  return {pgc: num(r.PGC), sep: num(r._r), morph: r.MType || null, logD25: num(r.logD25), logR25: num(r.logR25),
    pa: num(r.PA)}
}


/**
 * Run fn over items, n at a time.
 *
 * @param {Array} items
 * @param {number} n
 * @param {Function} fn
 * @returns {Promise<Array>}
 */
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({length: n}, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}


/** Position angles within this, degrees (modulo 180°), agree. */
const PA_AGREE_DEG = 15


/**
 * The position angle.  The three sources disagree by 40-100° for a dozen
 * galaxies (UGC 2885: SIMBAD 90°, RC3 40°, HyperLEDA 41°), so where two
 * agree within PA_AGREE_DEG their mean is taken; where none agree, or only
 * one has an angle, the first of HyperLEDA's (an average over the
 * literature), RC3's and SIMBAD's.
 *
 * @param {object|null} s simbad's
 * @param {object|null} r rc3's
 * @param {object|null} p pgc2003's
 * @returns {{pa: number|null, paRef: string|null}}
 */
function pickPa(s, r, p) {
  const have = [['PGC2003', p?.pa], ['RC3', r?.pa], [`SIMBAD ${s?.paRef ?? ''}`.trim(), s?.pa]]
      .filter(([, pa]) => pa !== null && pa !== undefined)
  const diff = (a, b) => Math.abs((((a - b) % 180) + 270) % 180 - 90)
  for (let i = 0; i < have.length; i++) {
    for (let j = i + 1; j < have.length; j++) {
      if (diff(have[i][1], have[j][1]) <= PA_AGREE_DEG) {
        // The mean on the half-circle: b moved to within 90° of a.
        const a = have[i][1]
        let b = have[j][1]
        b += Math.round((a - b) / 180) * 180
        return {pa: Math.round((((a + b) / 2) % 180 + 180) % 180), paRef: `${have[i][0]} and ${have[j][0]}`}
      }
    }
  }
  return have.length ? {pa: have[0][1], paRef: have[0][0]} : {pa: null, paRef: null}
}


const main = async () => {
  const [table1, bulges, massModels, decomp] = await Promise.all([
    get(`${SPARC}SPARC_Lelli2016c.mrt`),
    get(`${SPARC}Bulges.mrt`),
    get(`${SPARC}MassModels_Lelli2016c.mrt`),
    get(`${SPARC}BulgeDiskDec_LTG.zip`, {binary: true}),
  ])
  const rows = parseTable1(table1)
  const lbul = parseBulges(bulges)
  const curves = parseMassModels(massModels)
  const dens = unzip(decomp)
  const failed = []
  const galaxies = await pool(rows, 4, async (row) => {
    const n = await ned(row.name).catch(() => null)
    if (!n) {
      failed.push({name: row.name, why: 'NED did not resolve the name'})
      return null
    }
    const [s, r, p] = await Promise.all([
      simbad(n.ra, n.dec, [row.name, n.name]).catch(() => null),
      rc3(n.ra, n.dec).catch(() => null),
      pgc2003(n.ra, n.dec).catch(() => null),
    ])
    const profile = dens.has(`${row.name}.dens`) ? parseDens(dens.get(`${row.name}.dens`).toString('utf8')) : []
    const {pa, paRef} = pickPa(s, r, p)
    const L36bul = lbul.get(row.name) ?? 0
    const curve = curves.get(row.name) ?? []
    return {
      ...row,
      L36bul,
      // The curve's highest observed velocity, for where V_flat isn't given.
      Vmax: curve.reduce((m, c) => Math.max(m, c[1] ?? 0), 0),
      display: n.name,
      ra: sig(n.ra, 9),
      dec: sig(n.dec, 9),
      posRef: 'NED',
      z: n.z,
      pa,
      paRef,
      simbad: s,
      rc3: r,
      pgc: p,
      bulgeRe: L36bul > 0 ? sig(halfLightRadius(profile, 2) ?? 0, 3) : 0,
      discRe: sig(halfLightRadius(profile, 1) ?? 0, 3),
      disc: discProfile(profile, row.inc),
    }
  })
  const out = galaxies.filter(Boolean)
  const curvesOut = {}
  for (const g of out) {
    curvesOut[g.name] = (curves.get(g.name) ?? []).map((v) => v.map((x) => sig(x, 4)))
  }
  mkdirSync(OUT, {recursive: true})
  const meta = {
    source: 'SPARC (Lelli, McGaugh & Schombert 2016, AJ 152, 157), astroweb.case.edu/SPARC; ' +
      'positions NED; position angles SIMBAD, RC3 (VII/155) or PGC 2003 (VII/237); photometry RC3',
    built: new Date().toISOString().slice(0, 10),
    failed,
  }
  writeFileSync(join(OUT, 'galaxies.json'), `${JSON.stringify({meta, galaxies: out})}\n`)
  writeFileSync(join(OUT, 'curves.json'), `${JSON.stringify({
    meta: {source: 'SPARC Table 2 (MassModels_Lelli2016c.mrt)',
      columns: ['R kpc', 'Vobs km/s', 'e_Vobs km/s', 'Vgas km/s', 'Vdisk km/s (M/L 1 at 3.6 um)', 'Vbul km/s (M/L 1)']},
    curves: curvesOut,
  })}\n`)
  const noPa = out.filter((g) => g.pa === null).map((g) => g.name)
  console.warn(`${out.length} galaxies, ${failed.length} failed to resolve; ${noPa.length} without a position angle: ` +
    `${noPa.join(' ')}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
