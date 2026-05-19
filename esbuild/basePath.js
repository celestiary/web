/**
 * Coerce a deploy base into the form `/foo/` (leading + trailing slash,
 * with any runs of `/` collapsed to a single `/`).  Empty or `/` stays `/`.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeBasePath(input) {
  let p = (input || '').trim()
  if (!p || p === '/') return '/'
  if (!p.startsWith('/')) p = `/${p}`
  if (!p.endsWith('/')) p = `${p}/`
  return p.replace(/\/{2,}/g, '/')
}
