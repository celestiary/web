// The anchors layer mode publishes (design/LayerMode.md, "Anchors"): named
// points a host can join its own things to (an AS's node to a Starlink
// satellite, a dish to its complex's network).  URI-style ids, made only
// here so the scheme can follow the anchor RFC: change these and the
// layer's ids change with them.


/** The schemes, by what they name. */
export const SCHEMES = {
  satellite: 'norad',
  dish: 'dsn',
  site: 'dsn-site',
  spacecraft: 'spacecraft',
}


/**
 * @param {number} id NORAD catalogue number
 * @returns {string} e.g. 'norad:25544'
 */
export function satelliteAnchor(id) {
  return `${SCHEMES.satellite}:${id}`
}


/**
 * @param {string} dish DSN Now's name, e.g. 'DSS43'
 * @returns {string} e.g. 'dsn:DSS-43'
 */
export function dishAnchor(dish) {
  return `${SCHEMES.dish}:${String(dish).replace(/^DSS-?(\d+)$/i, 'DSS-$1')}`
}


/**
 * @param {string} site DSN Now's complex, e.g. 'gdscc'
 * @returns {string} e.g. 'dsn-site:gdscc'
 */
export function siteAnchor(site) {
  return `${SCHEMES.site}:${site}`
}


/**
 * @param {string} code DSN Now's spacecraft code, e.g. 'VGR1'
 * @returns {string} e.g. 'spacecraft:vgr1'
 */
export function spacecraftAnchor(code) {
  return `${SCHEMES.spacecraft}:${String(code).toLowerCase()}`
}


/**
 * A host's subscription: exact ids, `scheme:*`, or `*`.
 *
 * @param {Array<string>} patterns
 * @returns {function(string): boolean} whether an id is subscribed
 */
export function anchorMatcher(patterns) {
  const exact = new Set()
  const prefixes = []
  let all = false
  for (const p of patterns ?? []) {
    if (p === '*') {
      all = true
    } else if (p.endsWith(':*')) {
      prefixes.push(p.slice(0, -1))
    } else {
      exact.add(p)
    }
  }
  return (id) => all || exact.has(id) || prefixes.some((pre) => id.startsWith(pre))
}


/** What a host gets before it subscribes: the DSN's, a few dozen. */
export const DEFAULT_SUBSCRIPTION = [`${SCHEMES.dish}:*`, `${SCHEMES.site}:*`, `${SCHEMES.spacecraft}:*`]
