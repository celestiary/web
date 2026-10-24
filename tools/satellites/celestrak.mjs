// CelesTrak's GP data, asked for politely (js/scene/satellites/Satellites.md,
// the data): one request a group, kept in a cache directory for two hours
// so a run that stopped part way, or a second script, doesn't ask again.
// CelesTrak asks machine clients to stop at the first answer that isn't a
// 200 and report it to a person (https://celestrak.org/usage-policy.php),
// so this throws there.  Node's fetch reads HTTPS_PROXY only with
// NODE_USE_ENV_PROXY=1, which the yarn scripts set.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'


/** How long a cached answer is used again, ms: CelesTrak's update interval. */
export const CACHE_MS = 2 * 3600e3
const USER_AGENT = 'celestiary (https://celestiary.org/; tools/satellites)'


/**
 * @param {string} url
 * @param {?string} cacheDir a directory to keep answers in, or null
 * @returns {string} the file a URL's answer is cached in
 */
export function cacheFile(url, cacheDir) {
  return path.join(cacheDir, `${crypto.createHash('sha1').update(url).digest('hex')}.json`)
}


/**
 * @param {string} url
 * @param {?string} cacheDir
 * @returns {Promise<Array<object>>} the group's OMM records
 */
export async function fetchGroup(url, cacheDir = null) {
  const file = cacheDir ? cacheFile(url, cacheDir) : null
  if (file && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < CACHE_MS) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  const rsp = await fetch(url, {headers: {'user-agent': USER_AGENT}})
  const text = await rsp.text()
  if (!rsp.ok || !text.startsWith('[')) {
    throw new Error(`${url}: ${rsp.status} ${text.slice(0, 200)}`)
  }
  if (file) {
    fs.mkdirSync(cacheDir, {recursive: true})
    fs.writeFileSync(file, text)
  }
  return JSON.parse(text)
}
