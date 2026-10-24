// The anchors layer mode publishes (design/LayerMode.md, "Anchors"): named
// points a host can join its own things to (an AS's node to a Starlink
// satellite, a dish to its complex's network).  The ids are portal RFC
// 0001's (§8.2, `prefix:local`, each local part in one canonical
// spelling), and are made only here, so they follow the RFC's registry.


/** The prefixes, by what they name (RFC 0001 §8.2). */
export const SCHEMES = {
  satellite: 'norad',
  // The DSN's antennas and complexes share one prefix.
  dish: 'dsn',
  site: 'dsn',
  spacecraft: 'dsn-sc',
  naif: 'naif',
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
 * @returns {string} e.g. 'dsn:GDSCC'
 */
export function siteAnchor(site) {
  return `${SCHEMES.site}:${String(site).toUpperCase()}`
}


/**
 * @param {string} code DSN Now's spacecraft code, e.g. 'VGR1'
 * @returns {string} e.g. 'dsn-sc:VGR1'
 */
export function spacecraftAnchor(code) {
  return `${SCHEMES.spacecraft}:${String(code).toUpperCase()}`
}


/**
 * @param {number} id a NAIF SPICE id, e.g. −31
 * @returns {?string} e.g. 'naif:-31', or null if it isn't one
 */
export function naifAnchor(id) {
  return Number.isInteger(id) && id !== 0 ? `${SCHEMES.naif}:${id}` : null
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


/** What a host gets before it subscribes: nothing (RFC 0001 §8.1). */
export const DEFAULT_SUBSCRIPTION = []
