/**
 * The social posts an entry of the changelog is announced in (DESIGN.md
 * "What's new"; tools/posts/README.md): which platforms, and which URLs may
 * be linked to.  Plain, with no imports, so the changelog build (Node) and
 * the app both read it.
 */


/**
 * By platform key: the label, the accessible name of its icon, and the hosts
 * a post's URL may be on (and their subdomains: www., m.).  The order is the
 * icons'.
 */
export const SOCIAL_PLATFORMS = Object.freeze({
  x: Object.freeze({key: 'x', label: 'X', aria: 'on X', hosts: Object.freeze(['x.com', 'twitter.com'])}),
  facebook: Object.freeze({key: 'facebook', label: 'Facebook', aria: 'on Facebook', hosts: Object.freeze(['facebook.com'])}),
})


/**
 * @param {string} platform A key of SOCIAL_PLATFORMS
 * @param {any} url
 * @returns {?string} What is wrong with it as a link to a post on that
 *   platform: not https, not on one of its hosts, or not a URL at all; null
 *   if it is fine
 */
export function socialUrlProblem(platform, url) {
  const p = SOCIAL_PLATFORMS[platform]
  if (!p) {
    return `unknown platform "${platform}"`
  }
  if (typeof url !== 'string') {
    return 'not a URL'
  }
  let u
  try {
    u = new URL(url)
  } catch {
    return `"${url}" is not a URL`
  }
  if (u.protocol !== 'https:') {
    return `"${url}" is not https`
  }
  if (u.username || u.password) {
    return `"${url}" has a login in it`
  }
  const host = u.hostname.toLowerCase()
  if (!p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return `"${url}" is not on ${p.hosts.join(' or ')}`
  }
  return null
}


/**
 * @param {any} social A `{x, facebook}` of URLs, as an entry's `social`
 * @returns {?{[platform: string]: string}} Only the valid ones, in the icons'
 *   order; null if there are none
 */
export function validSocial(social) {
  const out = {}
  for (const key of Object.keys(SOCIAL_PLATFORMS)) {
    if (socialUrlProblem(key, social?.[key]) === null) {
      out[key] = new URL(social[key]).href
    }
  }
  return Object.keys(out).length > 0 ? out : null
}
