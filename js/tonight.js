import {gmstRad} from './scene/celestialFrame.js'


/**
 * "Tonight's sky", the homepage's first card (DESIGN.md "Homepage"): the
 * visitor's own sky, from the ground where they are, tonight.
 *
 * - **When:** now, if it's night (the Sun more than 18° under the
 *   horizon: after astronomical dusk, before astronomical dawn); in the
 *   day or twilight, this evening's astronomical dusk, when the Sun next
 *   sinks past 18° (tonightTime).  Where it doesn't sink that far (a
 *   summer far north), the darkest moment of the next day.
 * - **Where:** the browser's location, asked for only when the card is
 *   clicked; else a city for the time zone, with no network call; else
 *   Greenwich (resolveLocation).
 *
 * The Sun's place is the app's own ephemeris (VSOP87C, Animation.vsopAt),
 * passed in as `sunAt`; lowPrecisionSun stands in for it before it loads.
 */


const DEG = Math.PI / 180
const DAY_MS = 86400000
const UNIX_EPOCH_JD = 2440587.5
const J2000_JD = 2451545.0


/** The Sun's altitude at astronomical dusk and dawn, degrees. */
export const ASTRONOMICAL_TWILIGHT_DEG = -18


/** How far ahead tonightTime looks, ms. */
const SEARCH_MS = DAY_MS
// The search's step, ms: the Sun moves under 4° in it, so no crossing of
// -18° is stepped over (the Sun's altitude changes direction only at its
// highest and lowest, which are hours apart).
const SEARCH_STEP_MS = 15 * 60000
// The bisection's end, ms.
const SEARCH_TOLERANCE_MS = 1000


/**
 * @param {number} ms Unix epoch milliseconds (UTC)
 * @returns {number} Julian Day (UTC)
 */
export function julianDay(ms) {
  return UNIX_EPOCH_JD + (ms / DAY_MS)
}


/**
 * The Sun's direction from Earth, in the ecliptic of date, to about 0.01°:
 * Meeus's low-precision formula (Astronomical Algorithms, ch. 25), for when
 * the app's ephemeris hasn't loaded, and for the tests.
 *
 * @param {number} jd Julian Day
 * @returns {{x: number, y: number, z: number}} A unit vector: x the
 *   equinox, z the ecliptic's north, as VSOP87C's axes
 */
export function lowPrecisionSun(jd) {
  const t = (jd - J2000_JD) / 36525
  const l0 = 280.46646 + (36000.76983 * t) + (0.0003032 * t * t)
  const m = (357.52911 + (35999.05029 * t) - (0.0001537 * t * t)) * DEG
  const c = ((1.914602 - (0.004817 * t) - (0.000014 * t * t)) * Math.sin(m)) +
    ((0.019993 - (0.000101 * t)) * Math.sin(2 * m)) + (0.000289 * Math.sin(3 * m))
  const lon = (l0 + c) * DEG
  return {x: Math.cos(lon), y: Math.sin(lon), z: 0}
}


/**
 * @param {number} jd
 * @returns {number} The mean obliquity of the ecliptic of date, radians
 */
export function obliquity(jd) {
  const t = (jd - J2000_JD) / 36525
  return (23.439291 - (0.0130042 * t)) * DEG
}


/**
 * The Sun's right ascension and declination, of date.
 *
 * @param {number} jd Julian Day
 * @param {function(number): {x: number, y: number, z: number}} [sunAt] As
 *   sunAltitude's
 * @returns {{ra: number, dec: number}} Radians
 */
export function sunEquatorial(jd, sunAt = lowPrecisionSun) {
  const s = sunAt(jd)
  const eps = obliquity(jd)
  // Ecliptic to equatorial, about the equinox.
  const x = s.x
  const y = (s.y * Math.cos(eps)) - (s.z * Math.sin(eps))
  const z = (s.y * Math.sin(eps)) + (s.z * Math.cos(eps))
  return {ra: Math.atan2(y, x), dec: Math.atan2(z, Math.hypot(x, y))}
}


/**
 * The Sun's altitude over the horizon at a place and time, without
 * refraction.
 *
 * @param {number} lat Degrees, north positive
 * @param {number} lng Degrees, east positive
 * @param {number} ms Unix epoch milliseconds
 * @param {function(number): {x: number, y: number, z: number}} [sunAt] The
 *   Sun from Earth at a Julian Day, ecliptic of date (any length)
 * @returns {number} Degrees
 */
export function sunAltitude(lat, lng, ms, sunAt = lowPrecisionSun) {
  const jd = julianDay(ms)
  const {ra, dec} = sunEquatorial(jd, sunAt)
  const hourAngle = gmstRad(jd) + (lng * DEG) - ra
  const phi = lat * DEG
  const sinAlt = (Math.sin(phi) * Math.sin(dec)) + (Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle))
  return Math.asin(Math.min(Math.max(sinAlt, -1), 1)) / DEG
}


/**
 * When to show tonight's sky.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} nowMs
 * @param {Function} [sunAt] As sunAltitude
 * @returns {{ms: number, kind: string}} kind 'now' (it's night), 'dusk'
 *   (this evening's astronomical dusk) or 'darkest' (no astronomical night
 *   in the next day: its darkest moment)
 */
export function tonightTime(lat, lng, nowMs, sunAt = lowPrecisionSun) {
  const alt = (ms) => sunAltitude(lat, lng, ms, sunAt)
  const twilight = ASTRONOMICAL_TWILIGHT_DEG
  let prev = alt(nowMs)
  if (prev < twilight) {
    return {ms: nowMs, kind: 'now'}
  }
  let darkest = {ms: nowMs, alt: prev}
  for (let t = nowMs + SEARCH_STEP_MS; t <= nowMs + SEARCH_MS; t += SEARCH_STEP_MS) {
    const a = alt(t)
    if (a < darkest.alt) {
      darkest = {ms: t, alt: a}
    }
    if (prev >= twilight && a < twilight) {
      // Bisect the crossing.
      let lo = t - SEARCH_STEP_MS
      let hi = t
      while (hi - lo > SEARCH_TOLERANCE_MS) {
        const mid = (lo + hi) / 2
        if (alt(mid) >= twilight) {
          lo = mid
        } else {
          hi = mid
        }
      }
      return {ms: Math.round(hi), kind: 'dusk'}
    }
    prev = a
  }
  return {ms: darkest.ms, kind: 'darkest'}
}


/** Where the visitor is when nothing better says: the Royal Observatory. */
export const DEFAULT_LOCATION = Object.freeze({lat: 51.4779, lng: -0.0015, name: 'Greenwich'})


/**
 * A city for each common IANA time zone, to stand in for a location the
 * browser won't give: a coarse guess, in the right part of the sky.
 */
export const TIME_ZONE_CITIES = Object.freeze({
  'Africa/Cairo': [30.04, 31.24, 'Cairo'],
  'Africa/Johannesburg': [-26.2, 28.05, 'Johannesburg'],
  'Africa/Lagos': [6.52, 3.38, 'Lagos'],
  'Africa/Nairobi': [-1.29, 36.82, 'Nairobi'],
  'America/Anchorage': [61.22, -149.9, 'Anchorage'],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38, 'Buenos Aires'],
  'America/Bogota': [4.71, -74.07, 'Bogotá'],
  'America/Chicago': [41.88, -87.63, 'Chicago'],
  'America/Denver': [39.74, -104.99, 'Denver'],
  'America/Halifax': [44.65, -63.57, 'Halifax'],
  'America/Lima': [-12.05, -77.04, 'Lima'],
  'America/Los_Angeles': [34.05, -118.24, 'Los Angeles'],
  'America/Mexico_City': [19.43, -99.13, 'Mexico City'],
  'America/New_York': [40.71, -74.01, 'New York'],
  'America/Phoenix': [33.45, -112.07, 'Phoenix'],
  'America/Santiago': [-33.45, -70.67, 'Santiago'],
  'America/Sao_Paulo': [-23.55, -46.63, 'São Paulo'],
  'America/St_Johns': [47.56, -52.71, 'St. John\'s'],
  'America/Toronto': [43.65, -79.38, 'Toronto'],
  'America/Vancouver': [49.28, -123.12, 'Vancouver'],
  'Asia/Bangkok': [13.76, 100.5, 'Bangkok'],
  'Asia/Dhaka': [23.81, 90.41, 'Dhaka'],
  'Asia/Dubai': [25.2, 55.27, 'Dubai'],
  'Asia/Hong_Kong': [22.32, 114.17, 'Hong Kong'],
  'Asia/Jakarta': [-6.21, 106.85, 'Jakarta'],
  'Asia/Jerusalem': [31.77, 35.21, 'Jerusalem'],
  'Asia/Karachi': [24.86, 67.0, 'Karachi'],
  'Asia/Kolkata': [22.57, 88.36, 'Kolkata'],
  'Asia/Manila': [14.6, 120.98, 'Manila'],
  'Asia/Seoul': [37.57, 126.98, 'Seoul'],
  'Asia/Shanghai': [31.23, 121.47, 'Shanghai'],
  'Asia/Singapore': [1.35, 103.82, 'Singapore'],
  'Asia/Taipei': [25.03, 121.57, 'Taipei'],
  'Asia/Tehran': [35.69, 51.39, 'Tehran'],
  'Asia/Tokyo': [35.68, 139.69, 'Tokyo'],
  'Atlantic/Reykjavik': [64.15, -21.94, 'Reykjavík'],
  'Australia/Adelaide': [-34.93, 138.6, 'Adelaide'],
  'Australia/Brisbane': [-27.47, 153.03, 'Brisbane'],
  'Australia/Melbourne': [-37.81, 144.96, 'Melbourne'],
  'Australia/Perth': [-31.95, 115.86, 'Perth'],
  'Australia/Sydney': [-33.87, 151.21, 'Sydney'],
  'Europe/Amsterdam': [52.37, 4.9, 'Amsterdam'],
  'Europe/Athens': [37.98, 23.73, 'Athens'],
  'Europe/Berlin': [52.52, 13.4, 'Berlin'],
  'Europe/Dublin': [53.35, -6.26, 'Dublin'],
  'Europe/Helsinki': [60.17, 24.94, 'Helsinki'],
  'Europe/Istanbul': [41.01, 28.98, 'Istanbul'],
  'Europe/Lisbon': [38.72, -9.14, 'Lisbon'],
  'Europe/London': [51.51, -0.13, 'London'],
  'Europe/Madrid': [40.42, -3.7, 'Madrid'],
  'Europe/Moscow': [55.76, 37.62, 'Moscow'],
  'Europe/Paris': [48.86, 2.35, 'Paris'],
  'Europe/Rome': [41.9, 12.5, 'Rome'],
  'Europe/Stockholm': [59.33, 18.07, 'Stockholm'],
  'Europe/Warsaw': [52.23, 21.01, 'Warsaw'],
  'Europe/Zurich': [47.38, 8.54, 'Zurich'],
  'Pacific/Auckland': [-36.85, 174.76, 'Auckland'],
  'Pacific/Honolulu': [21.31, -157.86, 'Honolulu'],
})


/**
 * @param {?string} timeZone An IANA zone, as Intl gives it
 * @returns {?{lat: number, lng: number, name: string}} Its city, if listed
 */
export function timeZoneLocation(timeZone) {
  const city = timeZone ? TIME_ZONE_CITIES[timeZone] : null
  return city ? {lat: city[0], lng: city[1], name: city[2]} : null
}


/** @returns {?string} The browser's time zone, if it says */
export function browserTimeZone() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  } catch {
    return null
  }
}


/** How long to wait for the browser's location, ms. */
export const GEOLOCATION_TIMEOUT_MS = 10000


/**
 * The browser's location, once: a prompt the first time.
 *
 * @param {object} [geolocation] navigator.geolocation
 * @returns {Promise<{lat: number, lng: number}>} Rejects if refused,
 *   unavailable or too slow
 */
export function browserLocation(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation?.getCurrentPosition) {
      reject(new Error('No geolocation'))
      return
    }
    geolocation.getCurrentPosition(
        (pos) => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude}),
        reject,
        {enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 10 * 60000})
  })
}


/**
 * Where the visitor is, by the best source that answers: the browser's
 * location, else their time zone's city, else Greenwich.
 *
 * @param {object} [sources]
 * @param {Function} [sources.locate] Resolves {lat, lng}, or rejects
 *   (browserLocation)
 * @param {?string} [sources.timeZone] (browserTimeZone)
 * @returns {Promise<{lat: number, lng: number, name: ?string, source: string}>}
 *   source 'geolocation', 'timezone' or 'default'
 */
export async function resolveLocation({locate = browserLocation, timeZone = browserTimeZone()} = {}) {
  try {
    const at = await locate()
    if (Number.isFinite(at?.lat) && Number.isFinite(at?.lng)) {
      return {lat: at.lat, lng: at.lng, name: null, source: 'geolocation'}
    }
  } catch {
    // Refused, unavailable or too slow: the next source.
  }
  const zone = timeZoneLocation(timeZone)
  if (zone) {
    return {...zone, source: 'timezone'}
  }
  return {...DEFAULT_LOCATION, source: 'default'}
}


/**
 * What the readout says of it.
 *
 * @param {{name: ?string, source: string}} where resolveLocation's
 * @param {{ms: number, kind: string}} when tonightTime's
 * @param {Function} [formatTime] ms to a clock time
 * @returns {string}
 */
export function formatTonight(where, when, formatTime = defaultFormatTime) {
  const from = {
    geolocation: 'from your location',
    timezone: `from ${where.name} (your time zone)`,
    default: `from ${where.name} (no location)`,
  }[where.source] ?? ''
  const at = {
    now: 'now',
    dusk: `at dusk, ${formatTime(when.ms)}`,
    darkest: `at its darkest, ${formatTime(when.ms)}`,
  }[when.kind] ?? ''
  return `Tonight's sky ${from}, ${at}`
}


/**
 * @param {number} ms
 * @returns {string} e.g. "20:41", in the visitor's own zone
 */
function defaultFormatTime(ms) {
  return new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
}
