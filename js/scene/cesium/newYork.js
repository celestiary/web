/**
 * Slop New York at Manhattan on Cesium's Earth: the switch, where the guest
 * comes from, and when it's wanted.  Pure; the loading and the wiring are
 * newYorkGuest.js, imported only when the city is wanted.  CESIUM.md, "New
 * York".
 *
 * The chain: celestiary (three.js) hosts Cesium, Earth's layer, a NetGL
 * guest; Cesium draws the city, a NetGL guest of its own, inside its frame
 * through `scene.externalRenderers` (our Cesium patch).
 */


/**
 * Where the guest is served from: slop-newyork's GitHub Pages site (its
 * main branch).  Its scripts load from there at run time, not from
 * celestiary's bundle: the city is a separate app on a separate three.js
 * (the dev build, through the page's import map, public/index.html).
 */
export const DEFAULT_GUEST_BASE = 'https://pablo-mayrgundter.github.io/slop-newyork/'


/**
 * The prefixes `?nycGuest=` may point at.  The guest's code runs in
 * celestiary's page, so a link must not be able to load any script from
 * anywhere: slop-newyork's own site (production and its PR previews, under
 * pr-preview/) and a local server for development.
 */
const GUEST_BASE_PREFIXES = [DEFAULT_GUEST_BASE]
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])


/**
 * The page's New York switch: `?nyc=1` turns it on (off by default, an
 * experiment); `?nycGuest=<url>` loads the guest from another copy of
 * slop-newyork (its PR preview, say, `.../slop-newyork/pr-preview/pr-1/`),
 * if allowed (guestBaseAllowed); `?nycShadows=1` draws the city's sun
 * shadows (off: a shadow map is two more renders of the city a frame).
 *
 * @param {string} [search] location.search
 * @returns {{enabled: boolean, guestBase: string, shadows: boolean}}
 */
export function newYorkOptions(search) {
  const params = new URLSearchParams(search ?? '')
  const asked = params.get('nycGuest')
  let guestBase = DEFAULT_GUEST_BASE
  if (asked) {
    const base = asked.endsWith('/') ? asked : `${asked}/`
    if (guestBaseAllowed(base)) {
      guestBase = base
    } else {
      console.warn(`[new york] ignoring nycGuest=${asked}: only ${GUEST_BASE_PREFIXES.join(', ')} or a local server`)
    }
  }
  return {
    enabled: params.get('nyc') === '1',
    guestBase,
    shadows: params.get('nycShadows') === '1',
  }
}


/**
 * @param {string} base A guest base URL, ending in '/'
 * @returns {boolean} Whether celestiary may load the guest from it
 */
export function guestBaseAllowed(base) {
  let url
  try {
    url = new URL(base)
  } catch {
    return false
  }
  if (LOCAL_HOSTS.has(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:')) {
    return true
  }
  return url.protocol === 'https:' && GUEST_BASE_PREFIXES.some((prefix) => url.href.startsWith(prefix))
}


/**
 * The guest's frame origin (slop-newyork guest.js LON0, LAT0: 5th Avenue and
 * 42nd Street), degrees.  For the range test only: the guest places itself.
 */
export const NYC_LON = -73.98185
export const NYC_LAT = 40.75318

// WGS84.
const WGS84_A = 6378137
const WGS84_E2 = 6.69437999014e-3


/**
 * @param {number} lonDeg
 * @param {number} latDeg
 * @returns {Array<number>} The point on the WGS84 ellipsoid, ECEF metres
 */
export function wgs84Ecef(lonDeg, latDeg) {
  const lon = lonDeg * Math.PI / 180
  const lat = latDeg * Math.PI / 180
  const n = WGS84_A / Math.sqrt(1 - (WGS84_E2 * (Math.sin(lat) ** 2)))
  return [
    n * Math.cos(lat) * Math.cos(lon),
    n * Math.cos(lat) * Math.sin(lon),
    n * (1 - WGS84_E2) * Math.sin(lat),
  ]
}


const NYC_ECEF = wgs84Ecef(NYC_LON, NYC_LAT)


/**
 * Within this of the city's origin, metres, and under SHOW_BELOW_M, the city
 * is drawn (and loaded, the first time): from there its towers are a few
 * pixels or more.  The island is 21 km long.
 */
export const SHOW_WITHIN_M = 6e4
/** The highest camera, over the ground, metres, the city is drawn from. */
export const SHOW_BELOW_M = 3e4
/** Farther than this, metres, the city is freed. */
export const FREE_BEYOND_M = 3e5


/**
 * What the city should be, from where the camera is.
 *
 * @param {Array<number>} cameraEcef Cesium's camera position, ECEF metres
 * @param {number} heightM The camera's height over the ground, metres
 * @returns {'show'|'keep'|'free'} 'show': loaded and drawn; 'keep': loaded
 *   (if it is) but not drawn; 'free': not wanted from here
 */
export function newYorkRange(cameraEcef, heightM) {
  const d = Math.hypot(cameraEcef[0] - NYC_ECEF[0], cameraEcef[1] - NYC_ECEF[1], cameraEcef[2] - NYC_ECEF[2])
  if (d < SHOW_WITHIN_M && heightM < SHOW_BELOW_M) {
    return 'show'
  }
  return d > FREE_BEYOND_M ? 'free' : 'keep'
}
