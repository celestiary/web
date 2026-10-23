import {SUPPORTED_DAYS_FROM_J2000} from './Time.js'
import {clampEv, roundEv} from './scene/evCompensation.js'
import {clampStarMag, roundStarMag} from './scene/starMagnitude.js'


const SEPARATOR = '@'
const PARAM_SEP = ';'
const KV_SEP = '='
// State tokens (design/URLs.md): `;label:value`, the value a `,` list of
// flags and `name=value`s, a named value's list joined by `+`.
const TOKEN_SEP = ':'
const LIST_SEP = ','
const VALUE_LIST_SEP = '+'
// The orbital elements' codes, in their listed order (orbitElements.js CODES;
// not imported, so a link's parse doesn't load the orbit code).
const ORBIT_CODES = ['a', 'e', 'i', 'node', 'peri', 'at']
/** The orbit diagrams' opacity at the far side of their orbits, by default. */
export const ORBIT_FADE_DEFAULT = 0.5
// The three-body periodic orbits' families (periodicOrbits.js FAMILIES'
// codes), in the order the panel lists them.
export const PERIODIC_CODES = ['l1l', 'l2l', 'l1h', 'l2h', 'dro', 'nrho']
// The craft's flights (craft/flights.js FLIGHTS' codes).
export const CRAFT_CODES = ['tli', 'blt']
const J2000_JD = 2451545
// A departure's days from J2000 in a link: to a thousandth (86 s).
const CRAFT_DAY_DIGITS = 3
const PLAIN_WORD = /^[\w.-]+$/
// A `from=` frame path: a body path ('sun/earth') or a star ('hip:32349').
const FRAME_PATH = /^([a-z0-9_-]+(\/[a-z0-9_-]+)*|hip:\d+)$/

// Significant figures of the field of view in a link (formatFov).
const FOV_DIGITS = 4
// The field of view a link can set, degrees: past these the camera is
// degenerate (a zero or negative field, or a flat one).
export const FOV_MIN = 1e-4
export const FOV_MAX = 179

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
// `T` is the tracking flag ('t': the camera keeps the target centred, every
// frame).  It is restored after the target is set (Celestiary._arrive); the
// camera's `cq` alone would hold the view only until the target moved.
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
  G: true, // galaxy labels, the 'e' key (Celestia's), shown by magnitude (Galaxies.md)
  C: false, // globular-cluster labels, the 'E' key (Celestia's); none yet (#228)
  x: true, // human expansion lines (shown once computed)
  v: true, // nav panels / heads-up display
  L: false, // landed at surface — see Scene.land
  T: false, // tracking the target — see Scene.track
  F: false, // following the target's orbit — see Scene.follow
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
 * A field of view as the link carries it: four significant figures, so
 * 45 is `45`, 0.0714 (a telescope's) is `0.0714` and a wide 120.456 is
 * `120.5`.  Two decimal places would round a telescope's 0.0714 to 0.07, 2%
 * off, and a fraction of a hundredth of a degree to 0, which is no camera.
 *
 * @param {number} fov Degrees
 * @returns {string}
 */
function formatFov(fov) {
  return String(parseFloat(fov.toPrecision(FOV_DIGITS)))
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


// Days from J2000 to 6 decimals, 0.09 s: the clock a link shows comes back
// to its second, where 4 (8.6 s) brought it back up to 4 s off.
const TIME_DIGITS = 6


/**
 * Encode a complete view state into a hash fragment.
 *
 * Format: path@<lat>,<lng>,<alt>;t=<d2000>jd;cq=<qx>,<qy>,<qz>,<qw>;fov=<fov>deg[;ev=<stops>][;s=<flags>]
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
 * `ev=` is the user's exposure compensation in stops (evCompensation.js),
 * 2 decimal places, left out at 0.  `sm=` is the stars' setting (`[` and
 * `]`), magnitudes over the naked eye's limit, 2 decimal places, left out
 * at 0.
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
 * @param {number} [ev]  The exposure compensation, stops; left out if 0
 * @param {number} [sm]  The stars' limiting magnitude over the naked eye's
 *   (starMagnitude.js), magnitudes; left out if 0
 * @returns {string}  Hash fragment without leading '#'
 */
export function encodePermalink(path, d2000, lat, lng, alt, quat, fov, settings, tokens, from, ev = 0, sm = 0) {
  const pos = `${trimFloat(lat)},${trimFloat(lng)},${formatMeters(Math.round(alt))}`
  const t = `${parseFloat(d2000.toFixed(TIME_DIGITS))}jd`
  const cq = [quat.x, quat.y, quat.z, quat.w].map(trimFloat).join(',')
  const f = `${formatFov(fov)}deg`
  let frag = `${path}${SEPARATOR}${pos}`
  if (from && from !== path) {
    frag += `${PARAM_SEP}from=${from}`
  }
  frag += `${PARAM_SEP}t=${t}${PARAM_SEP}cq=${cq}${PARAM_SEP}fov=${f}`
  const evRounded = roundEv(ev)
  if (evRounded !== 0) {
    frag += `${PARAM_SEP}ev=${evRounded}`
  }
  const smRounded = roundStarMag(sm)
  if (smRounded !== 0) {
    frag += `${PARAM_SEP}sm=${smRounded}`
  }
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
 * a malformed one is null.  `ev` is the exposure compensation in stops, 0
 * when the link has none or a bad one, and held to the range (a `+` sign is
 * accepted).
 *
 * @param {string} fragment  Hash content without leading '#'
 * @returns {{path:string, d2000:number, lat:number, lng:number, alt:number,
 *            quat:{x,y,z,w}, fov:number, ev:number, sm:number, settings:object, tokens:object,
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
  const ev = clampEv(parseFloat(params['ev']))
  const sm = clampStarMag(parseFloat(params['sm']))
  return {
    path, d2000: d2000InRange, lat, lng, alt, quat: {x: qx, y: qy, z: qz, w: qw},
    fov: Math.min(Math.max(fov, FOV_MIN), FOV_MAX), ev, sm, settings, tokens, from,
  }
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
 * The `time:` token (design/URLs.md): the clock when it isn't running at
 * real time.  `pause` is a flag; `rate=N` is the signed multiplier on real
 * time (`rate=8` eight times, `rate=-2` backwards at twice), which Time
 * keeps at powers of two.  The rate is the one in force: a paused clock
 * keeps it, to resume at.  Left out (null) when running at 1.
 *
 * @param {boolean} paused
 * @param {number} rate Time.timeScale
 * @returns {?string}
 */
export function encodeTimeToken(paused, rate) {
  const r = Number.isFinite(rate) && rate !== 0 ? Math.round(rate) : 1
  const value = formatTokenValue(paused ? ['pause'] : [], {rate: r === 1 ? null : r})
  return value || null
}


/**
 * The inverse of encodeTimeToken.  A token of anything else is the
 * defaults, running at real time.
 *
 * @param {string} [value] The token's value, undefined if the link has none
 * @returns {{paused: boolean, rate: number}} `rate` as written, 1 if it is
 *   absent, zero or not a number (Time.setRate holds it to what it runs at)
 */
export function decodeTimeToken(value) {
  const {flags, named} = parseTokenValue(value)
  const rate = parseFloat(named.rate)
  return {paused: flags.includes('pause'), rate: Number.isFinite(rate) && rate !== 0 ? rate : 1}
}


/**
 * The `orbits:` token (design/URLs.md): the orbital elements lit on each
 * body's orbit, `body=code+code`, the codes in their listed order
 * (orbitElements.js CODES); and `fade=` the diagrams' opacity at the far side
 * of their orbits, in percent, where it isn't the default.  Left out (null)
 * when there's nothing to say.
 *
 * @param {Map<string, Set<string>>} elements Scene.getOrbitElements()
 * @param {number} [fade] Scene.getOrbitFade(), 0 to 1
 * @returns {?string}
 */
export function encodeOrbitsToken(elements, fade = ORBIT_FADE_DEFAULT) {
  const percent = Math.round(Math.min(Math.max(fade, 0), 1) * 100)
  const named = {fade: percent === Math.round(ORBIT_FADE_DEFAULT * 100) ? null : percent}
  for (const [body, codes] of elements ?? []) {
    const listed = ORBIT_CODES.filter((c) => codes.has(c))
    if (listed.length > 0 && PLAIN_WORD.test(body)) {
      named[body] = listed
    }
  }
  return formatTokenValue([], named) || null
}


/**
 * The inverse of encodeOrbitsToken.  Unknown codes are dropped; bodies are
 * kept as written, for the scene to find (or not).
 *
 * @param {string} [value] The token's value, undefined if the link has none
 * @returns {Map<string, Set<string>>}
 */
export function decodeOrbitsToken(value) {
  const elements = new Map
  for (const [body, list] of Object.entries(parseTokenValue(value).named)) {
    if (body === 'fade') {
      continue
    }
    const codes = new Set(parseValueList(list).filter((c) => ORBIT_CODES.includes(c)))
    if (codes.size > 0) {
      elements.set(body, codes)
    }
  }
  return elements
}


/**
 * The orbits token's fade (encodeOrbitsToken).
 *
 * @param {string} [value] The token's value
 * @returns {number} 0 to 1; the default without one
 */
export function decodeOrbitsFade(value) {
  const percent = parseFloat(parseTokenValue(value).named.fade)
  return Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) / 100 : ORBIT_FADE_DEFAULT
}


/**
 * The `periodic:` token (design/URLs.md): the three-body periodic orbits
 * shown (periodicOrbits.js), `secondary=code+code` for each pair by its
 * secondary (`moon` is the Earth-Moon pair), `frame=inertial` where
 * they're drawn fixed in space, not turning with the pair, and the flag
 * `manifolds` where their invariant manifolds are drawn too.  Left out
 * (null) when none are on.
 *
 * @param {Map<string, Set<string>>} families Scene.getPeriodic()
 * @param {string} [frame] 'rotating' (the default) or 'inertial'
 * @param {boolean} [manifolds]
 * @returns {?string}
 */
export function encodePeriodicToken(families, frame = 'rotating', manifolds = false) {
  const named = {}
  for (const [body, codes] of families ?? []) {
    const listed = PERIODIC_CODES.filter((c) => codes.has(c))
    if (listed.length > 0 && PLAIN_WORD.test(body)) {
      named[body] = listed
    }
  }
  if (Object.keys(named).length === 0) {
    return null
  }
  if (frame === 'inertial') {
    named.frame = 'inertial'
  }
  return formatTokenValue(manifolds ? ['manifolds'] : [], named) || null
}


/**
 * The inverse of encodePeriodicToken.  Unknown codes are dropped.
 *
 * @param {string} [value] The token's value, undefined if the link has none
 * @returns {{families: Map<string, Set<string>>, frame: string, manifolds: boolean}}
 */
export function decodePeriodicToken(value) {
  const {flags, named} = parseTokenValue(value)
  const families = new Map
  for (const [body, list] of Object.entries(named)) {
    if (body === 'frame') {
      continue
    }
    const codes = new Set(parseValueList(list).filter((c) => PERIODIC_CODES.includes(c)))
    if (codes.size > 0) {
      families.set(body, codes)
    }
  }
  return {families, frame: named.frame === 'inertial' ? 'inertial' : 'rotating', manifolds: flags.includes('manifolds')}
}


/**
 * The `craft:` token (design/URLs.md): the craft flown (craft/flights.js),
 * `code=day` each, the day its departure's Julian Ephemeris Day less
 * J2000's (as `t=` writes the time, but TT).  Left out (null) when none are.
 *
 * @param {Map<string, number>} craft Scene.getCraft(): code → departure JDE
 * @returns {?string}
 */
export function encodeCraftToken(craft) {
  const named = {}
  for (const code of CRAFT_CODES) {
    const jde = craft?.get(code)
    if (Number.isFinite(jde)) {
      named[code] = Number((jde - J2000_JD).toFixed(CRAFT_DAY_DIGITS))
    }
  }
  return formatTokenValue([], named) || null
}


/**
 * The inverse of encodeCraftToken.  Unknown codes, and days that aren't
 * numbers or are past the supported dates, are dropped.
 *
 * @param {string} [value] The token's value, undefined if the link has none
 * @returns {Map<string, number>} code → departure JDE
 */
export function decodeCraftToken(value) {
  const {named} = parseTokenValue(value)
  const craft = new Map
  for (const code of CRAFT_CODES) {
    const day = Number(named[code])
    if (named[code] !== undefined && Number.isFinite(day) && Math.abs(day) <= SUPPORTED_DAYS_FROM_J2000) {
      craft.set(code, J2000_JD + day)
    }
  }
  return craft
}


// A `pop:` group list naming no group: all switched off.
const NO_GROUPS = 'none'
// A `pop:` key's suffix for a population's label budget: `earth.labels=40`.
const LABELS_SUFFIX = '.labels'


/**
 * The `pop:` token (design/URLs.md): each body's population as the info
 * panel left it, where it isn't as it starts.  `<body>=<group>+<group>` the
 * groups shown (`none` for none; left out when all are); `<body>.labels=N`
 * how many names show (left out at its default); `<body>.<group>=N` how many
 * of a counted group show, the first in its order (`earth.starlink=2000`;
 * left out at its default).  Left out (null) when every population is as
 * it starts.
 *
 * @param {Map<string, {shown: ?Set<string>, labels: ?number, counts?: ?Map<string, number>}>} [state]
 *     Scene.getPopulationState
 * @returns {?string}
 */
export function encodePopulationToken(state) {
  const named = {}
  for (const [body, {shown, labels, counts}] of state ?? []) {
    if (!PLAIN_WORD.test(body)) {
      continue
    }
    if (shown) {
      const keys = [...shown].filter((k) => PLAIN_WORD.test(k) && k !== NO_GROUPS)
      named[body] = keys.length > 0 ? keys : NO_GROUPS
    }
    if (Number.isInteger(labels) && labels >= 0) {
      named[`${body}${LABELS_SUFFIX}`] = labels
    }
    for (const [group, n] of counts ?? []) {
      if (PLAIN_WORD.test(group) && `.${group}` !== LABELS_SUFFIX && Number.isInteger(n) && n >= 0) {
        named[`${body}.${group}`] = n
      }
    }
  }
  return formatTokenValue([], named) || null
}


/**
 * The inverse of encodePopulationToken.
 *
 * @param {string} [value] The token's value, undefined if the link has none
 * @returns {Map<string, {shown: ?Set<string>, labels: ?number, counts: ?Map<string, number>}>}
 */
export function decodePopulationToken(value) {
  const out = new Map
  const entry = (body) => {
    if (!out.has(body)) {
      out.set(body, {shown: null, labels: null, counts: null})
    }
    return out.get(body)
  }
  for (const [key, v] of Object.entries(parseTokenValue(value).named)) {
    const dot = key.indexOf('.')
    if (dot > 0) {
      // `<body>.labels` or `<body>.<group>`: a body's name has no dot.
      const n = Number(v)
      const body = key.slice(0, dot)
      const what = key.slice(dot + 1)
      if (!what || !Number.isInteger(n) || n < 0) {
        continue
      }
      if (`.${what}` === LABELS_SUFFIX) {
        entry(body).labels = n
      } else {
        (entry(body).counts ??= new Map).set(what, n)
      }
    } else if (PLAIN_WORD.test(key)) {
      entry(key).shown = new Set(parseValueList(v).filter((k) => k !== NO_GROUPS))
    }
  }
  return out
}


/** The `layers:` token's flags: the optional layers switched on (design/URLs.md). */
export const LAYER_FLAGS = Object.freeze({newYork: 'nyc'})


/**
 * The `layers:` token (design/URLs.md): the optional layers switched on.
 * `nyc` is Slop New York, Manhattan's 3D city on Earth's Cesium layer
 * (CESIUM.md, "New York").  Left out (null) when none is, its default.
 *
 * @param {{newYork?: boolean}} [layers]
 * @returns {?string}
 */
export function encodeLayersToken(layers) {
  const flags = Object.entries(LAYER_FLAGS).filter(([key]) => layers?.[key] === true).map(([, flag]) => flag)
  return formatTokenValue(flags) || null
}


/**
 * The inverse of encodeLayersToken.  Unknown flags and named values are
 * ignored, so a link from a newer build still opens.
 *
 * @param {string} [value] The token's value, undefined if the link has none
 * @returns {{newYork: boolean}}
 */
export function decodeLayersToken(value) {
  const {flags} = parseTokenValue(value)
  return {newYork: flags.includes(LAYER_FLAGS.newYork)}
}


/**
 * The `info:` token (design/URLs.md): the info panel's sections as the user
 * left them.  `closed`, the panel folded; `open=` and `shut=` its sections,
 * by their place in a body's props or their panel name, opened or shut
 * against their defaults.  Left out (null) when all are as they start.
 *
 * @param {{closed: boolean, open: Set<string>, shut: Set<string>}} [state]
 *     ControlPanel.uiState
 * @returns {?string}
 */
export function encodeInfoToken(state) {
  if (!state) {
    return null
  }
  const plain = (keys) => [...(keys ?? [])].filter((k) => PLAIN_WORD.test(k)).sort()
  return formatTokenValue(state.closed ? ['closed'] : [], {open: plain(state.open), shut: plain(state.shut)}) || null
}


/**
 * The inverse of encodeInfoToken.
 *
 * @param {string} [value] The token's value, undefined if the link has none
 * @returns {{closed: boolean, open: Set<string>, shut: Set<string>}}
 */
export function decodeInfoToken(value) {
  const {flags, named} = parseTokenValue(value)
  const plain = (list) => new Set(parseValueList(list).filter((k) => PLAIN_WORD.test(k)))
  return {closed: flags.includes('closed'), open: plain(named.open), shut: plain(named.shut)}
}


/**
 * The guide's orbit page's `orbit:` token (design/URLs.md): one orbit's
 * elements at a moment, as the app's orbit list links to them, so the guide
 * shows that orbit, at that moment, with the same elements lit.
 *
 * @param {string} body
 * @param {object} el orbitElements.js's form: a (m), e, i, node, peri,
 *     meanLongitude (degrees), plane
 * @param {Set<string>} [codes] the elements lit (ORBIT_CODES)
 * @param {number} [jd] the moment, Julian Day (UTC)
 * @returns {string} the token, `orbit:…`
 */
export function encodeGuideOrbitToken(body, el, codes = new Set, jd = null) {
  const value = formatTokenValue([], {
    body: PLAIN_WORD.test(body) ? body : null,
    a: Math.round(el.a),
    e: el.e.toFixed(6),
    i: el.i.toFixed(4),
    node: el.node.toFixed(4),
    peri: el.peri.toFixed(4),
    L: el.meanLongitude.toFixed(4),
    plane: PLAIN_WORD.test(el.plane ?? '') ? el.plane : null,
    jd: Number.isFinite(jd) ? jd.toFixed(4) : null,
    lit: ORBIT_CODES.filter((c) => codes.has(c)),
  })
  return `orbit${TOKEN_SEP}${value}`
}


/**
 * The inverse of encodeGuideOrbitToken, from a page's hash.
 *
 * @param {string} [hash] `#orbit:…`, or with other tokens around it
 * @returns {?object} {body, a, e, i, node, peri, meanLongitude, plane, jd,
 *     lit: Set}, or null without a whole orbit
 */
export function decodeGuideOrbitToken(hash) {
  const token = (hash ?? '').replace(/^#/, '').split(PARAM_SEP).find((t) => t.startsWith(`orbit${TOKEN_SEP}`))
  if (!token) {
    return null
  }
  const {named} = parseTokenValue(token.substring(token.indexOf(TOKEN_SEP) + 1))
  const num = (k) => parseFloat(named[k])
  const orbit = {
    body: named.body ?? null, a: num('a'), e: num('e'), i: num('i'), node: num('node'), peri: num('peri'),
    meanLongitude: num('L'), plane: named.plane ?? null, jd: Number.isFinite(num('jd')) ? num('jd') : null,
    lit: new Set(parseValueList(named.lit).filter((c) => ORBIT_CODES.includes(c))),
  }
  const whole = ['a', 'e', 'i', 'node', 'peri', 'meanLongitude'].every((k) => Number.isFinite(orbit[k])) &&
    orbit.a > 0 && orbit.e >= 0 && orbit.e < 1
  return whole ? orbit : null
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
