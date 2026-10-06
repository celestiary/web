/**
 * The target's path in the location hash (design/URLs.md, "Path"): what
 * the breadcrumb shows, as a path.
 *
 *   sun/earth           a body, as the loader names it
 *   sun/earth/austin    a place on a body: the body's path, then the
 *                       place's name as a slug
 *   hip:32349           a catalogue star, by HIP number (the search's id)
 *   asterism:orion      an asterism, by its name as a slug
 *
 * A place's last segment is told from a body's by the body above it: a
 * name in that body's `system` is a body (bodies win), anything else under
 * a body with places (`has_locations`) is a place.  So `sun/earth/moon` is
 * the Moon and `sun/earth/austin` is Austin, and old links keep their
 * meaning.
 */


const STAR_PREFIX = 'hip:'
const ASTERISM_PREFIX = 'asterism:'


/**
 * A name as it appears in a path: lower case, runs of anything but letters
 * and digits as one `-`, none at the ends.  The places' search ids use it
 * too (PlacesProvider).
 *
 * @param {string} s
 * @returns {string}
 */
export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}


/**
 * @param {object} target A target (Scene.setTarget): {kind: 'body', name},
 *   {kind: 'place', body, name, ...}, {kind: 'star', star, ...} or
 *   {kind: 'asterism', name, ...}
 * @param {Function} bodyPath name → the body's path ('sun/earth'), or null
 * @returns {?string} The target's path, or null if it has none yet (a
 *   body the loader hasn't placed)
 */
export function targetPath(target, bodyPath) {
  if (!target) {
    return null
  }
  switch (target.kind) {
    case 'body':
      return bodyPath(target.name) || null
    case 'place': {
      const p = bodyPath(target.body)
      return p ? `${p}/${slug(target.name)}` : null
    }
    case 'star': {
      const hipId = target.hipId ?? target.star?.hipId
      return Number.isInteger(hipId) ? `${STAR_PREFIX}${hipId}` : null
    }
    case 'asterism':
      return `${ASTERISM_PREFIX}${slug(target.name)}`
    default:
      return null
  }
}


/**
 * The path of the body a target is on or is, whose frame a camera near it
 * would be given in: a body's own, a place's body's; a star's is its own
 * path (the camera at that star); an asterism has none.
 *
 * @param {object} target
 * @param {Function} bodyPath As for targetPath
 * @returns {?string}
 */
export function targetFramePath(target, bodyPath) {
  if (!target) {
    return null
  }
  switch (target.kind) {
    case 'body':
      return bodyPath(target.name) || null
    case 'place':
      return bodyPath(target.body) || null
    case 'star':
      return targetPath(target, bodyPath)
    default:
      return null
  }
}


/**
 * Parse a path from the hash, as far as it can be without the bodies'
 * descriptors.
 *
 * @param {string} path
 * @returns {?({kind: 'star', hipId: number}|{kind: 'asterism', slug: string}|
 *   {kind: 'bodies', parts: Array<string>})} null if empty or malformed.
 *   `bodies` is a body path, or a body path then a place (resolvePlace)
 */
export function parseTargetPath(path) {
  if (!path) {
    return null
  }
  if (path.startsWith(STAR_PREFIX)) {
    const s = path.slice(STAR_PREFIX.length)
    const hipId = Number(s)
    return /^\d+$/.test(s) && Number.isSafeInteger(hipId) ? {kind: 'star', hipId} : null
  }
  if (path.startsWith(ASTERISM_PREFIX)) {
    const s = slug(path.slice(ASTERISM_PREFIX.length))
    return s ? {kind: 'asterism', slug: s} : null
  }
  const parts = path.split('/')
  if (parts.some((p) => !p || p.includes(':'))) {
    return null
  }
  return {kind: 'bodies', parts}
}


/**
 * Whether a body path's last segment is a place, once the body above it is
 * loaded.
 *
 * @param {Array<string>} parts A path's segments, as parseTargetPath gives
 * @param {object} loaded The loader's descriptors by name (Loader.loaded)
 * @returns {?({kind: 'body', path: string, name: string}|
 *   {kind: 'place', path: string, body: string, slug: string})} The body,
 *   or the place and its body's path; null while the body above the last
 *   segment isn't loaded (load `parts` less the last, then ask again)
 */
export function resolvePlace(parts, loaded) {
  const name = parts[parts.length - 1]
  const asBody = {kind: 'body', path: parts.join('/'), name}
  if (parts.length < 2) {
    return asBody
  }
  const parentName = parts[parts.length - 2]
  const parent = loaded?.[parentName]
  if (!parent || typeof parent !== 'object') {
    return null
  }
  if ((parent.system ?? []).includes(name) || !parent.has_locations) {
    return asBody
  }
  return {kind: 'place', path: parts.slice(0, -1).join('/'), body: parentName, slug: name}
}
