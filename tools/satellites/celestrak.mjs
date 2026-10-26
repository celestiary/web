// CelesTrak's GP data, asked for politely (js/scene/satellites/Satellites.md,
// the data), for `yarn satellites` and `yarn networks` both: one request a
// group, kept in a cache directory for two hours, so a run that stopped part
// way, or the other script, doesn't ask again (CelesTrak answers a second
// download of a set that hasn't updated with a 403).  The answers are OMM as
// CSV, CelesTrak's default and its own format, which it says it won't
// change, and a third the size of its JSON
// (https://celestrak.org/NORAD/documentation/gp-data-formats.php).
// CelesTrak asks machine clients to stop at the first answer that isn't a
// 200, a redirect included, and report it to a person
// (https://celestrak.org/usage-policy.php), so this throws there.  Node's
// fetch reads HTTPS_PROXY only with NODE_USE_ENV_PROXY=1, which the yarn
// scripts set.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'


/** How long a cached answer is used again, ms: CelesTrak's update interval. */
export const CACHE_MS = 2 * 3600e3
/** Where answers are kept unless a script is given `--cache DIR` (git ignores it). */
export const DEFAULT_CACHE = new URL('./.cache/', import.meta.url).pathname
const USER_AGENT = 'celestiary (https://celestiary.org/; tools/satellites)'
// The OMM fields that are text; the rest are numbers.
const TEXT_FIELDS = new Set(['OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'CLASSIFICATION_TYPE'])
// The fields every record must have, as numbers or text: what SGP4 starts from.
const REQUIRED = [
  'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
]


/**
 * @param {string} line one line of CSV, fields optionally in double quotes
 * @returns {Array<string>}
 */
function csvFields(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let k = 0; k < line.length; k++) {
    const c = line[k]
    if (quoted) {
      if (c === '"' && line[k + 1] === '"') {
        field += '"'
        k++
      } else if (c === '"') {
        quoted = false
      } else {
        field += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      out.push(field)
      field = ''
    } else {
      field += c
    }
  }
  out.push(field)
  return out
}


/**
 * CelesTrak's GP CSV as the OMM records its JSON gives: numbers as numbers
 * (`.1189007E-3` is JSON's 0.0001189007), a blank field null (an analyst
 * object's OBJECT_NAME).
 *
 * @param {string} text the answer
 * @returns {Array<object>}
 * @throws if it isn't GP CSV (CelesTrak's "No GP data found" comes as a
 *   200), or a record lacks a field SGP4 needs or has one that isn't a number
 */
export function parseGpCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const header = csvFields(lines[0] ?? '')
  const missing = REQUIRED.filter((f) => !header.includes(f))
  if (header[0] !== 'OBJECT_NAME' || missing.length > 0) {
    throw new Error(`not CelesTrak's GP CSV (missing ${missing.join(', ')}): ${text.slice(0, 200)}`)
  }
  return lines.slice(1).map((line, row) => {
    const values = csvFields(line)
    if (values.length !== header.length) {
      throw new Error(`row ${row + 1} has ${values.length} fields, not ${header.length}: ${line}`)
    }
    const rec = {}
    header.forEach((f, i) => {
      const v = values[i].trim()
      rec[f] = v === '' ? null : (TEXT_FIELDS.has(f) ? v : Number(v))
      if (typeof rec[f] === 'number' && !Number.isFinite(rec[f])) {
        throw new Error(`row ${row + 1}: ${f} isn't a number: ${v}`)
      }
    })
    for (const f of REQUIRED) {
      if (rec[f] === null) {
        throw new Error(`row ${row + 1}: no ${f}: ${line}`)
      }
    }
    return rec
  })
}


/**
 * @param {string} url
 * @param {string} cacheDir
 * @returns {string} the file a URL's answer is cached in
 */
export function cacheFile(url, cacheDir) {
  return path.join(cacheDir, `${crypto.createHash('sha1').update(url).digest('hex')}.csv`)
}


/**
 * @param {string} url gpUrl's
 * @param {object} [opts]
 * @param {string} [opts.cacheDir] where answers are kept, DEFAULT_CACHE
 * @param {boolean} [opts.offline] use the cache whatever its age, and ask
 *   nothing (to rebuild the files from the last fetch)
 * @param {Function} [opts.fetchFn] fetch, for the tests
 * @returns {Promise<{records: Array<object>, fetchedMs: number}>} the group's
 *   OMM records, and when CelesTrak answered (a cached answer's time)
 */
export async function fetchGroup(url, {cacheDir = DEFAULT_CACHE, offline = false, fetchFn = fetch} = {}) {
  const file = cacheFile(url, cacheDir)
  if (fs.existsSync(file) && (offline || Date.now() - fs.statSync(file).mtimeMs < CACHE_MS)) {
    return {records: parseGpCsv(fs.readFileSync(file, 'utf8')), fetchedMs: fs.statSync(file).mtimeMs}
  }
  if (offline) {
    throw new Error(`${url}: not in the cache (${cacheDir}), and --offline`)
  }
  // A redirect is an error to CelesTrak (it counts them towards a block):
  // stop there rather than follow it.
  const rsp = await fetchFn(url, {headers: {'user-agent': USER_AGENT}, redirect: 'manual'})
  const text = await rsp.text()
  if (rsp.status !== 200) {
    throw new Error(`${url}: ${rsp.status} ${text.slice(0, 200)}`)
  }
  let records
  try {
    records = parseGpCsv(text)
  } catch (err) {
    throw new Error(`${url}: ${err.message}`)
  }
  fs.mkdirSync(cacheDir, {recursive: true})
  fs.writeFileSync(file, text)
  return {records, fetchedMs: Date.now()}
}
