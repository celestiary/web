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


/** A `near` query's most anchors. */
export const MAX_NEAR = 256


/**
 * @param {string} id e.g. 'norad:25544'
 * @returns {string} its scheme, e.g. 'norad'
 */
export function schemeOf(id) {
  const i = id.indexOf(':')
  return i < 0 ? id : id.slice(0, i)
}


/**
 * A host's subscription, compiled so the layer can skip what nobody asked
 * for: whole schemes it never walks, exact ids it looks up rather than
 * matching every record against.  Each pattern is an exact id,
 * `scheme:*`, `*`, or (a proposal for portal RFC #39 Q15, design/LayerMode.md
 * "Anchors") `{near: {p: [x, y, z], n}, pattern}`: the n anchors nearest p
 * (ECEF metres, at the frame's time) of those matching `pattern` (a string
 * as above; default `*`).
 *
 * @param {Array<string|object>} patterns
 * @returns {{all: boolean, schemes: Set<string>, exact: Map<string, Set<string>>, near: Array<object>,
 *   wants: Function, wantsScheme: Function, whole: Function}}
 */
export function compileSubscription(patterns) {
  const exact = new Map()
  const schemes = new Set()
  const near = []
  let all = false
  for (const p of patterns ?? []) {
    if (typeof p === 'string') {
      if (p === '*') {
        all = true
      } else if (p.endsWith(':*')) {
        schemes.add(p.slice(0, -2))
      } else if (p) {
        const scheme = schemeOf(p)
        if (!exact.has(scheme)) {
          exact.set(scheme, new Set())
        }
        exact.get(scheme).add(p)
      }
    } else if (p && typeof p === 'object' && p.near && Array.isArray(p.near.p) && p.near.p.length === 3 &&
        p.near.p.every(Number.isFinite)) {
      const n = Math.min(MAX_NEAR, Math.max(1, Math.floor(Number(p.near.n) || 1)))
      const match = compileSubscription([typeof p.pattern === 'string' ? p.pattern : '*'])
      near.push({p: p.near.p.slice(), n, match})
    }
  }
  /**
   * @param {string} scheme
   * @returns {boolean} whether all of it is wanted
   */
  const whole = (scheme) => all || schemes.has(scheme)
  return {
    all, schemes, exact, near, whole,
    /**
     * @param {string} id
     * @returns {boolean} whether it's wanted by id or scheme
     */
    wants: (id) => {
      const scheme = schemeOf(id)
      return whole(scheme) || Boolean(exact.get(scheme)?.has(id))
    },
    /**
     * @param {string} scheme
     * @returns {boolean} whether any of it is wanted, by id or whole
     */
    wantsScheme: (scheme) => whole(scheme) || exact.has(scheme),
  }
}


/**
 * @param {Array<string>} patterns as compileSubscription
 * @returns {function(string): boolean} whether an id is subscribed
 */
export function anchorMatcher(patterns) {
  return compileSubscription(patterns).wants
}


/** What a host gets before it subscribes: nothing (RFC 0001 §8.1). */
export const DEFAULT_SUBSCRIPTION = []
