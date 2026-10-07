import {SUPPORTED_DAYS_FROM_J2000} from './Time.js'


const SEPARATOR = '@'
const PARAM_SEP = ';'
const KV_SEP = '='
// State tokens (design/URLs.md): `;label:value`, the value a `,` list of
// flags and `name=value`s, a named value's list joined by `+`.
const TOKEN_SEP = ':'
const LIST_SEP = ','
const VALUE_LIST_SEP = '+'
// A `from=` frame path: a body path ('sun/earth') or a star ('hip:32349').
const FRAME_PATH = /^([a-z0-9_-]+(\/[a-z0-9_-]+)*|hip:\d+)$/

// SI meter prefixes, descending so first match wins
const METER_PREFIXES = [
  {suffix: 'Tm', factor: 1e12},
  {suffix: 'Gm', factor: 1e9},
  {suffix: 'Mm', factor: 1e6},
  {suffix: 'km', factor: 1e3},
  {suffix: 'm', factor: 1},
]


// Toggleable scene settings — see Scene.js.  The `s=` permalink parameter is
// a string of single-letter codes; each letter present means that setting is
// in its NON-default state.  Empty / missing param = all defaults.  This
// keeps the URL trivially short for the common case of a fresh viewer who
// hasn't customized anything, while still being able to round-trip any
// configuration faithfully.
//
// `L` is a special case that doesn't map to a Scene toggle method: it's
// the "landed at the surface" flag (Scene.land).  When present on decode,
// Celestiary calls scene.land(lat, lng, alt) to restore the pinned-surface
// view rather than the orbit-style camera quaternion.  Backward compatible:
// pre-L permalinks decode landed=false.
//
// `A` is the AR-fallback flag.  When present on decode, Celestiary
// best-effort enters AR mode at the saved lat/lng/alt — sensors then
// overwrite camera orientation each frame, so the saved `cq` quaternion
// is not authoritative on AR-flagged permalinks.  When AR is unsupported
// (desktop, denied permissions), the permalink falls through to the
// regular landed-with-saved-orientation restore.  Encoding rule
// (encodePermalink): set A=1 whenever AR is active at capture time;
// position fields are still written so non-AR viewers see something.
export const SETTINGS_DEFAULTS = Object.freeze({
  a: true, // asterisms (constellation lines)
  l: true, // star labels
  p: true, // planet/moon labels
  o: true, // orbits
  e: false, // equatorial reference grid
  c: false, // ecliptic reference grid
  g: false, // galactic reference grid
  U: true, // procedural Milky Way galaxy (Celestia convention: 'U')
  x: true, // human expansion lines (shown once computed)
  v: true, // nav panels / heads-up display
  L: false, // landed at surface — see Scene.land
  A: false, // AR-fallback — enter AR sky view if device supports
})


/**
 * Encode the current settings object as a compact letter-flag string for the
 * permalink `s=` parameter.  Each letter present means "non-default state".
 *
 * @param {object} settings - flat {key: bool} map matching SETTINGS_DEFAULTS
 * @returns {string}
 */
export function encodeSettings(settings) {
  let out = ''
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    if (settings[key] !== SETTINGS_DEFAULTS[key]) {
      out += key
    }
  }
  return out
}


/**
 * Decode the settings flag string back to a full {key: bool} map (every key
 * from SETTINGS_DEFAULTS is present, defaulted unless flagged).
 *
 * @param {string} s - flag string from `s=` param (may be undefined)
 * @returns {object}
 */
export function decodeSettings(s) {
  const out = {...SETTINGS_DEFAULTS}
  if (!s) {
    return out
  }
  for (const ch of s) {
    if (Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, ch)) {
      out[ch] = !SETTINGS_DEFAULTS[ch]
    }
  }
  return out
}


/**
 * Trim a float to at most 4 decimal places, stripping trailing zeros.
 *
 * @param {number} v
 * @returns {string}
 */
function trimFloat(v) {
  return parseFloat(v.toFixed(4)).toString()
}


/**
 * Format an integer metre value as a compact SI-prefixed string.
 * Zero is encoded as the bare token '0'.
 *
 * @param {number} m  Metres (integer)
 * @returns {string}
 */
function formatMeters(m) {
  if (m === 0) {
    return '0'
  }
  const abs = Math.abs(m)
  for (const {suffix, factor} of METER_PREFIXES) {
    if (abs >= factor) {
      return `${parseFloat((m / factor).toFixed(6))}${suffix}`
    }
  }
  return `${m}m`
}


/**
 * Parse an SI-prefixed metre string back to metres.
 * '0' with no suffix → 0.
 *
 * @param {string} s
 * @returns {number}  NaN if unparseable
 */
function parseMeters(s) {
  if (s === '0') {
    return 0
  }
  for (const {suffix, factor} of METER_PREFIXES) {
    if (s.endsWith(suffix)) {
      return Math.round(parseFloat(s.slice(0, -suffix.length)) * factor)
    }
  }
  return NaN
}


/**
 * The address-bar URL for a permalink fragment: relative to the document's
 * base, as `#fragment` resolves, but with the page's query string kept, so a
 * flag such as `?perf=1` or `?hdr=0` survives the app rewriting the hash.
 *
 * @param {string} fragment The fragment, without the '#'
 * @param {string|undefined} baseHref document.baseURI
 * @param {string|undefined} search location.search
 * @returns {string}
 */
export function permalinkHref(fragment, baseHref, search) {
  try {
    const url = new URL(`#${fragment}`, baseHref)
    url.search = search ?? ''
    return url.href
  } catch {
    return `#${fragment}`
  }
}


/**
 * Encode a complete view state into a hash fragment.
 *
 * Format: path@<lat>,<lng>,<alt>;t=<d2000>jd;cq=<qx>,<qy>,<qz>,<qw>;fov=<fov>deg[;s=<flags>]
 *
 * Position is encoded as geographic coordinates (Google Maps style) in the
 * body-fixed frame of the target object.  lat/lng in degrees (4 dp trimmed),
 * alt as SI-prefixed meters rounded to the nearest metre.  The optional
 * `s=` flag string round-trips toggleable scene settings (asterisms, grids,
 * etc.) — see SETTINGS_DEFAULTS / encodeSettings.  Omitted when every
 * setting is at its default, so the common case stays short.
 *
 * `from=` names the body (or star) whose frame the position and `cq` are in,
 * when it isn't the path's own (the target's): the camera's frame stays
 * where the camera is when the target changes (targetPath.js).  Written
 * after the position.
 *
 * State tokens (`;label:value`, design/URLs.md) follow, in the order given.
 *
 * See js/permalink.md for the full specification.
 *
 * @param {string} path  The target's path, e.g. 'sun/earth/moon', 'sun/earth/austin', 'hip:32349'
 * @param {number} d2000  Days from J2000.0 (= simTimeJulianDay() − 2451545.0)
 * @param {number} lat  Latitude in degrees (body-fixed, −90…+90)
 * @param {number} lng  Longitude in degrees (body-fixed, −180…+180)
 * @param {number} alt  Altitude above planet surface in meters
 * @param {{x:number, y:number, z:number, w:number}} quat  camera.quaternion (platform-local)
 * @param {number} fov  camera.fov in degrees
 * @param {object} [settings]  Scene settings map matching SETTINGS_DEFAULTS
 * @param {object} [tokens]  State tokens, {label: value}; a null or undefined
 *   value is left out, an empty string written as a bare `label:`
 * @param {string} [from]  The path of the camera's frame body (or star), if
 *   not the path's own; left out if null or equal to `path`
 * @returns {string}  Hash fragment without leading '#'
 */
export function encodePermalink(path, d2000, lat, lng, alt, quat, fov, settings, tokens, from) {
  const pos = `${trimFloat(lat)},${trimFloat(lng)},${formatMeters(Math.round(alt))}`
  const t = `${parseFloat(d2000.toFixed(4))}jd`
  const cq = [quat.x, quat.y, quat.z, quat.w].map(trimFloat).join(',')
  const f = `${parseFloat(fov.toFixed(2))}deg`
  let frag = `${path}${SEPARATOR}${pos}`
  if (from && from !== path) {
    frag += `${PARAM_SEP}from=${from}`
  }
  frag += `${PARAM_SEP}t=${t}${PARAM_SEP}cq=${cq}${PARAM_SEP}fov=${f}`
  if (settings) {
    const flags = encodeSettings(settings)
    if (flags) {
      frag += `${PARAM_SEP}s=${flags}`
    }
  }
  for (const [label, value] of Object.entries(tokens ?? {})) {
    if (value !== null && value !== undefined) {
      frag += `${PARAM_SEP}${label}${TOKEN_SEP}${value}`
    }
  }
  return frag
}


/**
 * Decode a hash fragment into view state.
 * Returns null for legacy path-only hashes (no '@') or malformed params,
 * including a non-finite number.  The time is clamped to the dates Time
 * supports (J2000 ± SUPPORTED_DAYS_FROM_J2000).  Unknown parameter keys
 * after the position prefix are silently ignored.  State tokens
 * (`label:value`) are returned as given, in `tokens`.  `from` is the
 * camera's frame path when the link names one (else null: the path's own);
 * a malformed one is null.
 *
 * @param {string} fragment  Hash content without leading '#'
 * @returns {{path:string, d2000:number, lat:number, lng:number, alt:number,
 *            quat:{x,y,z,w}, fov:number, settings:object, tokens:object,
 *            from:?string}|null}
 */
export function decodePermalink(fragment) {
  const atIdx = fragment.indexOf(SEPARATOR)
  if (atIdx === -1) {
    return null
  }
  const path = fragment.substring(0, atIdx)
  const rest = fragment.substring(atIdx + 1)

  // First semicolon separates the positional prefix from named params
  const firstSemi = rest.indexOf(PARAM_SEP)
  if (firstSemi === -1) {
    return null
  }
  const posStr = rest.substring(0, firstSemi)
  const paramsStr = rest.substring(firstSemi + 1)

  const posParts = posStr.split(',')
  if (posParts.length !== 3) {
    return null
  }
  const lat = parseFloat(posParts[0])
  const lng = parseFloat(posParts[1])
  const alt = parseMeters(posParts[2])

  const params = {}
  const tokens = {}
  for (const pair of paramsStr.split(PARAM_SEP)) {
    const eq = pair.indexOf(KV_SEP)
    const colon = pair.indexOf(TOKEN_SEP)
    // A state token's label comes before any `=` in its value.
    if (colon !== -1 && (eq === -1 || colon < eq)) {
      tokens[pair.substring(0, colon)] = pair.substring(colon + 1)
      continue
    }
    if (eq === -1) {
      continue
    }
    params[pair.substring(0, eq)] = pair.substring(eq + 1)
  }

  const tStr = params['t']
  const cqStr = params['cq']
  const fovStr = params['fov']
  if (!tStr || !cqStr || !fovStr) {
    return null
  }
  if (!tStr.endsWith('jd') || !fovStr.endsWith('deg')) {
    return null
  }

  const d2000 = parseFloat(tStr.slice(0, -2))
  const [qx, qy, qz, qw] = cqStr.split(',').map(Number)
  const fov = parseFloat(fovStr.slice(0, -3))

  if (![lat, lng, alt, d2000, qx, qy, qz, qw, fov].every(Number.isFinite)) {
    return null
  }
  // Past the ephemerides' range the planets are garbage (Time.js).
  const d2000InRange = Math.min(Math.max(d2000, -SUPPORTED_DAYS_FROM_J2000), SUPPORTED_DAYS_FROM_J2000)
  // Settings are always returned as a complete map (defaults + any flagged
  // overrides) so callers don't need to know the default table.
  const settings = decodeSettings(params['s'])
  const from = FRAME_PATH.test(params['from'] ?? '') && params['from'] !== path ? params['from'] : null
  return {path, d2000: d2000InRange, lat, lng, alt, quat: {x: qx, y: qy, z: qz, w: qw}, fov, settings, tokens, from}
}


/**
 * Split a state token's value into its flags and named values:
 * `open,view=a,pin=a+b` → {flags: ['open'], named: {view: 'a', pin: 'a+b'}}.
 *
 * @param {string} [value]
 * @returns {{flags: Array<string>, named: object}}
 */
export function parseTokenValue(value) {
  const flags = []
  const named = {}
  for (const part of (value ?? '').split(LIST_SEP)) {
    if (!part) {
      continue
    }
    const eq = part.indexOf(KV_SEP)
    if (eq === -1) {
      flags.push(part)
    } else {
      named[part.substring(0, eq)] = part.substring(eq + 1)
    }
  }
  return {flags, named}
}


/**
 * The inverse of parseTokenValue: flags first, then named values, each
 * left out if null, undefined or an empty list.  Names and values are
 * plain words and numbers (letters, digits, `.`, `-`, `_`), as written.
 *
 * @param {Array<string>} flags
 * @param {object} named {name: string|number|Array}
 * @returns {string}
 */
export function formatTokenValue(flags, named = {}) {
  const parts = [...flags]
  for (const [name, value] of Object.entries(named)) {
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      continue
    }
    parts.push(`${name}${KV_SEP}${Array.isArray(value) ? value.join(VALUE_LIST_SEP) : value}`)
  }
  return parts.join(LIST_SEP)
}


/**
 * @param {string} [value] A named value's list, `a+b`
 * @returns {Array<string>}
 */
export function parseValueList(value) {
  return value ? value.split(VALUE_LIST_SEP).filter(Boolean) : []
}


/**
 * A number for a state token: at most 4 decimal places, trailing zeros
 * trimmed, as the view's floats.
 *
 * @param {number} v
 * @returns {string}
 */
export function formatTokenNumber(v) {
  return trimFloat(v)
}


/**
 * Extract the celestial path from any hash fragment (legacy or permalink).
 *
 * @param {string} fragment  Hash content without leading '#'
 * @returns {string}
 */
export function pathFromFragment(fragment) {
  const atIdx = fragment.indexOf(SEPARATOR)
  return atIdx === -1 ? fragment : fragment.substring(0, atIdx)
}
