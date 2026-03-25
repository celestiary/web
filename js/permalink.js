const SEPARATOR = '@'
const PARAM_SEP = ';'
const KV_SEP = '='

// SI meter prefixes, descending so first match wins
const METER_PREFIXES = [
  {suffix: 'Tm', factor: 1e12},
  {suffix: 'Gm', factor: 1e9},
  {suffix: 'Mm', factor: 1e6},
  {suffix: 'km', factor: 1e3},
  {suffix: 'm', factor: 1},
]


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
 * Encode a complete view state into a hash fragment.
 *
 * Format: path@<lat>,<lng>,<alt>;t=<d2000>jd;cq=<qx>,<qy>,<qz>,<qw>;fov=<fov>deg
 *
 * Position is encoded as geographic coordinates (Google Maps style) in the
 * body-fixed frame of the target object.  lat/lng in degrees (4 dp trimmed),
 * alt as SI-prefixed meters rounded to the nearest metre.
 *
 * See design/permalink.md for the full specification.
 *
 * @param {string} path  Celestial path, e.g. 'sun/earth/moon'
 * @param {number} d2000  Days from J2000.0 (= simTimeJulianDay() − 2451545.0)
 * @param {number} lat  Latitude in degrees (body-fixed, −90…+90)
 * @param {number} lng  Longitude in degrees (body-fixed, −180…+180)
 * @param {number} alt  Altitude above planet surface in meters
 * @param {{x:number, y:number, z:number, w:number}} quat  camera.quaternion (platform-local)
 * @param {number} fov  camera.fov in degrees
 * @returns {string}  Hash fragment without leading '#'
 */
export function encodePermalink(path, d2000, lat, lng, alt, quat, fov) {
  const pos = `${trimFloat(lat)},${trimFloat(lng)},${formatMeters(Math.round(alt))}`
  const t = `${parseFloat(d2000.toFixed(4))}jd`
  const cq = [quat.x, quat.y, quat.z, quat.w].map(trimFloat).join(',')
  const f = `${parseFloat(fov.toFixed(2))}deg`
  return `${path}${SEPARATOR}${pos}${PARAM_SEP}t=${t}${PARAM_SEP}cq=${cq}${PARAM_SEP}fov=${f}`
}


/**
 * Decode a hash fragment into view state.
 * Returns null for legacy path-only hashes (no '@') or malformed params.
 * Unknown parameter keys after the position prefix are silently ignored.
 *
 * @param {string} fragment  Hash content without leading '#'
 * @returns {{path:string, d2000:number, lat:number, lng:number, alt:number,
 *            quat:{x,y,z,w}, fov:number}|null}
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
  for (const pair of paramsStr.split(PARAM_SEP)) {
    const eq = pair.indexOf(KV_SEP)
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

  if ([lat, lng, alt, d2000, qx, qy, qz, qw, fov].some(isNaN)) {
    return null
  }
  return {path, d2000, lat, lng, alt, quat: {x: qx, y: qy, z: qz, w: qw}, fov}
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
