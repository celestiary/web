// NASA's Deep Space Network (Networks.md, "DSN"): its complexes from DSN
// Now's configuration (public/data/dsn.json, tools/networks/fetch.mjs), and
// what each dish is doing from DSN Now's live feed: its target, where it
// points (azimuth and elevation), its signals up and down, and the range.
// Pure, no dependencies: the feed is a flat XML document, read here with a
// tag-and-attribute scan, so the tests run it in bun without a DOM.


/** DSN Now's live feed: CORS `*`, rewritten about every 5 s. */
export const DSN_NOW_URL = 'https://eyes.nasa.gov/dsn/data/dsn.xml'
/** The bundled configuration: complexes, dishes, spacecraft names. */
export const DSN_CONFIG_URL = 'data/networks/dsn.json'
/** The feed's own cadence, ms: never asked for more often. */
export const POLL_MS = 5000
const C_KM_S = 299792.458
const DEG = Math.PI / 180
const TAG = /<(station|dish|upSignal|downSignal|target)\b([^>]*?)\/?>/g
const ATTR = /([A-Za-z_][\w-]*)="([^"]*)"/g


/**
 * @param {string} s a tag's attributes
 * @returns {object} name → value, the XML entities for quotes, ampersands
 *   and angle brackets decoded
 */
function attrs(s) {
  const out = {}
  for (const [, k, v] of s.matchAll(ATTR)) {
    out[k] = v.replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
  }
  return out
}


/**
 * @param {string} v
 * @returns {?number} the number, or null for an empty or negative one
 *   (the feed's "not known": `-1`, `""`)
 */
function known(v) {
  const x = Number(v)
  return v !== '' && v !== undefined && Number.isFinite(x) && x >= 0 ? x : null
}


/**
 * DSN Now's feed, read.
 *
 * @param {string} xml dsn.xml
 * @returns {{stations: Array<object>, dishes: Array<object>}} each station
 *   `{name, friendlyName, timeMs}`; each dish `{name, station, azimuth,
 *   elevation, activity, up, down, targets}`, its signals
 *   `{active, spacecraft, band, dataRate, power}` and targets
 *   `{name, id, uplegKm, downlegKm, rtltSec}` (null where not known)
 */
export function parseDsnXml(xml) {
  const stations = []
  const dishes = []
  let station = null
  let dish = null
  for (const [, tag, body] of String(xml).matchAll(TAG)) {
    const a = attrs(body)
    switch (tag) {
      case 'station':
        station = {name: a.name, friendlyName: a.friendlyName, timeMs: Number(a.timeUTC)}
        stations.push(station)
        break
      case 'dish':
        dish = {
          name: a.name, station: station?.name ?? null, azimuth: Number(a.azimuthAngle),
          elevation: Number(a.elevationAngle), activity: a.activity ?? '', up: [], down: [], targets: [],
        }
        dishes.push(dish)
        break
      case 'upSignal':
      case 'downSignal':
        dish?.[tag === 'upSignal' ? 'up' : 'down'].push({
          active: a.active === 'true', spacecraft: a.spacecraft ?? '', band: a.band ?? '',
          dataRate: known(a.dataRate), power: Number(a.power),
        })
        break
      case 'target':
        dish?.targets.push({
          name: a.name, id: Number(a.id), uplegKm: known(a.uplegRange), downlegKm: known(a.downlegRange),
          rtltSec: known(a.rtlt),
        })
        break
      default:
        break
    }
  }
  return {stations, dishes}
}


/**
 * @param {object} target parseDsnXml's
 * @returns {?number} its range, km: the downleg's or upleg's, or half the
 *   round-trip light time's; null if the feed gives none
 */
export function rangeKm(target) {
  const r = target.downlegKm ?? target.uplegKm
  if (r !== null && r > 0) {
    return r
  }
  return target.rtltSec > 0 ? target.rtltSec * C_KM_S / 2 : null
}


/**
 * The links in a feed: one a dish and spacecraft with a signal up or down.
 *
 * @param {{dishes: Array<object>, stations: Array<object>}} feed parseDsnXml's
 * @param {object} config public/data/dsn.json
 * @returns {Array<object>} `{dish, site, spacecraft, name, azimuth,
 *   elevation, up, down, rangeKm, timeMs}`: `name` from the configuration's
 *   friendly names, `up` and `down` whether each is active
 */
export function dsnLinks(feed, config) {
  const siteOf = new Map((config.sites ?? []).flatMap((s) => s.dishes.map((d) => [d.name, s])))
  const timeOf = new Map(feed.stations.map((s) => [s.name, s.timeMs]))
  const out = []
  for (const dish of feed.dishes) {
    const site = siteOf.get(dish.name) ?? (config.sites ?? []).find((s) => s.name === dish.station)
    if (!site || !Number.isFinite(dish.azimuth) || !Number.isFinite(dish.elevation)) {
      continue
    }
    for (const target of dish.targets) {
      const sc = target.name
      const up = dish.up.some((s) => s.active && s.spacecraft === sc)
      const down = dish.down.some((s) => s.active && s.spacecraft === sc)
      if (!up && !down) {
        continue
      }
      out.push({
        dish: dish.name, site: site.name, spacecraft: sc, name: spacecraftName(sc, config),
        azimuth: dish.azimuth, elevation: dish.elevation, up, down, rangeKm: rangeKm(target),
        timeMs: timeOf.get(dish.station) ?? NaN,
      })
    }
  }
  return out
}


/**
 * @param {string} code the feed's (e.g. 'VGR1')
 * @param {object} config
 * @returns {string} DSN Now's friendly name for it ('Voyager 1'), or the code
 */
export function spacecraftName(code, config) {
  return config.spacecraft?.[String(code).toLowerCase()] ?? code
}


/**
 * East, north and up at a point on a sphere, in the body-fixed frame
 * coords.js latLngAltToBodyFixed uses (+Y the pole, +X longitude 0, east
 * toward −Z), and a pointing (azimuth from north through east, elevation)
 * as a direction there.
 *
 * @param {number} latDeg
 * @param {number} lngDeg east-positive
 * @param {number} azDeg
 * @param {number} elDeg
 * @param {{set: Function}} out
 * @returns {object} out, a unit vector
 */
export function topocentricDirection(latDeg, lngDeg, azDeg, elDeg, out) {
  const p = latDeg * DEG
  const l = lngDeg * DEG
  const az = azDeg * DEG
  const el = elDeg * DEG
  const [sp, cp, sl, cl] = [Math.sin(p), Math.cos(p), Math.sin(l), Math.cos(l)]
  // up (cp cl, sp, −cp sl), east (−sl, 0, −cl), north (−sp cl, cp, sp sl)
  const e = Math.cos(el) * Math.sin(az)
  const n = Math.cos(el) * Math.cos(az)
  const u = Math.sin(el)
  return out.set((u * cp * cl) - (e * sl) - (n * sp * cl), (u * sp) + (n * cp), (-u * cp * sl) - (e * cl) + (n * sp * sl))
}


/**
 * A body-fixed vector turned to Earth's equator frame (planetTilt's) at a
 * date, as Animation spins Earth: about +Y by GMST.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} gmst radians
 * @param {{set: Function}} out
 * @returns {object} out
 */
export function bodyFixedToEquator(x, y, z, gmst, out) {
  const c = Math.cos(gmst)
  const s = Math.sin(gmst)
  // three's rotation about Y: x' = x c + z s, z' = −x s + z c.
  return out.set((x * c) + (z * s), y, (-x * s) + (z * c))
}
