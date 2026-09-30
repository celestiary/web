/* global __DATA_BASE_URL__ */

/**
 * Where large data is fetched from.  See DESIGN.md "Data policy".
 *
 * Large bundled data (textures, the star catalogue, anything under
 * public/large/) is resolved against a configurable base, so a PR preview
 * can load it from the production site rather than carry its own copy.
 * The base is the DATA_BASE_URL build-time env var (esbuild/common.js).
 * Empty, the default, means the same origin and path as the page.
 */


/**
 * @param {string} path
 * @returns {boolean} Whether the path already has a scheme (`https:`) or is
 *   protocol-relative (`//host/…`), so it needs no base
 */
export function isAbsoluteUrl(path) {
  return (/^([a-z][a-z0-9+.-]*:|\/\/)/i).test(path)
}


/**
 * Resolve a path under the site's data against a base.  Plain string
 * joining, not `new URL()`, which would escape the `{z}/{x}/{y}` placeholders
 * of tile templates.
 *
 * @param {string} path Relative to the site root, e.g. `textures/mars.jpg`
 * @param {string} [base] A base URL, with or without a trailing slash.
 *   Empty or undefined leaves the path relative, so it resolves against the
 *   page's `<base href>` as it always has.
 * @returns {string}
 */
export function resolveDataUrl(path, base) {
  if (!base || isAbsoluteUrl(path)) {
    return path
  }
  const root = base.endsWith('/') ? base : `${base}/`
  return root + path.replace(/^(\.?\/)+/, '')
}


/**
 * @param {string} path Relative to the site root, e.g. `data/stars.dat`
 * @returns {string} The path against the build's data base URL
 */
export function dataUrl(path) {
  return resolveDataUrl(path, typeof __DATA_BASE_URL__ === 'string' ? __DATA_BASE_URL__ : '')
}
