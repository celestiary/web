// From a Gazetteer row to a place in js/scene/places.md's format, and the
// tiering of a body's places by what is physically on show.  Pure: no file
// or network access, so the tests run on small fixtures.

// Rows that are not names to read on a surface:
//  - "Satellite Feature": a crater named for a lettered neighbour's
//    designation (Tycho A), 7,000 of the Moon's;
//  - "Astronaut-named features": metre-scale features at Apollo sites;
//  - "Statio": the landing sites' own names (Statio Tranquillitatis), which
//    the curated landings (Apollo 11...) already mark.
export const EXCLUDED_TYPES = new Set(['Satellite Feature', 'Astronaut-named features', 'Statio'])

// Features whose "diameter" is a length, not a width: an extent along a
// line, so it counts for half of what an areal feature's does.
const LINEAR = new Set([
  'catena', 'dorsum', 'fossa', 'flexus', 'linea', 'rima', 'rupes', 'scopulus', 'serpens', 'sulcus', 'vallis', 'virga',
])
const LINEAR_WEIGHT = 0.5

// A feature with no diameter in the Gazetteer (point features, old
// albedo names): treated as this fraction of the body's diameter, tier 2.
const UNSIZED_FRACTION = 0.03

// Tier thresholds: a feature's size as a fraction of the body's diameter.
// At the zoom each tier shows (places.md, "Tier scheme & LOD") the disc is
// about 0.75, 1.0, 1.5 and 1.8 of the screen high, so on a 650 px screen a
// feature at the tier's threshold spans about 100, 50 and 25 px: wide enough
// to carry its own name at tier 0, and a mark on the ground below it.  Tier 3
// is everything smaller, under 30 px at its zoom.
export const TIER_FRACTIONS = [0.2, 0.08, 0.025]

// Tier 0 is a handful: at most this many features of the Gazetteer, however
// many pass the threshold, and at least this many (for a body whose
// features are all small beside it).
export const TIER0_MAX = 12
export const TIER0_MIN = 3

// The least the largest features' tiers come to: at least the largest 20 are
// in tiers 0-1, and the largest 80 in tiers 0-2.
export const TIER_MIN_COUNT = [20, 80]

const KIND_NAMES = {
  'albedo feature': 'albedo',
  'large ringed feature': 'ringed feature',
  'eruptive center': 'eruptive center',
}


/**
 * @param {string} type The Gazetteer's feature type ("Crater, craters")
 * @returns {string} A kind tag for places.md's `k` ("crater")
 */
export function kindOf(type) {
  const t = type.toLowerCase()
  return KIND_NAMES[t] ?? t.split(',')[0].trim()
}


/**
 * @param {number} lng Degrees, east-positive, any range
 * @returns {number} -180..+180
 */
export function wrapLng(lng) {
  const w = (((lng + 180) % 360) + 360) % 360
  return w - 180
}


/**
 * @param {number} x
 * @param {number} places
 * @returns {number} x to that many decimal places
 */
function round(x, places) {
  return Number(x.toFixed(places))
}


/**
 * @param {{[field: string]: string}} row A Gazetteer center-points row
 * @returns {?{n: string, lat: number, lng: number, k: string, d: number, arc: number}}
 *   The place (d is the diameter in km, 0 if the Gazetteer has none; arc
 *   is its bounding box's longer side in degrees, 0 for a point), or
 *   null for a row that isn't one to show
 */
export function placeOf(row) {
  const n = row.name?.trim()
  if (!n || EXCLUDED_TYPES.has(row.type)) {
    return null
  }
  const lat = Number(row.center_lat)
  const lon = Number(row.center_lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) {
    return null
  }
  const d = Number(row.diameter)
  return {
    n,
    // Planetocentric latitude; the longitude is east-positive, 0..360 in the
    // Gazetteer's files, -180..+180 in the catalogues.
    lat: round(lat, 4),
    lng: round(wrapLng(lon), 4),
    k: kindOf(row.type),
    d: Number.isFinite(d) && d > 0 ? d : 0,
    arc: extentDeg(row),
  }
}


/**
 * The longer side of a feature's bounding box on the ground, in degrees of
 * arc: what a feature with no diameter in the Gazetteer is sized by.
 *
 * @param {{[field: string]: string}} row
 * @returns {number} 0 for a point or a box that can't be read
 */
function extentDeg(row) {
  const dLat = Number(row.max_lat) - Number(row.min_lat)
  let dLon = Number(row.max_lon) - Number(row.min_lon)
  if (dLon > 180) {
    dLon = 360 - dLon
  }
  const cosLat = Math.cos((Number(row.center_lat) * Math.PI) / 180)
  const deg = Math.max(dLat, dLon * cosLat)
  return Number.isFinite(deg) && deg > 0 ? round(deg, 3) : 0
}


/**
 * @param {string} name
 * @returns {string} The name as curated entries and the Gazetteer may differ
 *   in it ("Gale Crater" and "Gale"): lower case, no diacritics, no trailing
 *   "crater"
 */
export function matchKey(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/\s+crater$/, '').replace(/[^a-z0-9]+/g, ' ').trim()
}


/**
 * A feature's size as a fraction of its body's diameter, for ranking.
 *
 * @param {{k: string, d: number, arc: number}} place
 * @param {number} bodyDiameterKm
 * @returns {number}
 */
export function sizeFraction(place, bodyDiameterKm) {
  // A body's circumference is 360 degrees of arc.
  const km = place.d > 0 ? place.d : (place.arc / 360) * Math.PI * bodyDiameterKm
  if (!(km > 0)) {
    return UNSIZED_FRACTION
  }
  const w = LINEAR.has(place.k) ? LINEAR_WEIGHT : 1
  return (w * km) / bodyDiameterKm
}


/**
 * Tiers a body's places, and merges the curated entries in.
 *
 * Curated entries (hand-picked: landers, poles, the famous craters) are
 * kept.  One that names a Gazetteer feature takes the Gazetteer's position
 * and kind (the Gazetteer supersedes it) and keeps its own tier if that is
 * the lower, so Tycho stays at tier 0 though it is under a tenth of the
 * Moon.  The rest (missions, poles) are kept as they are.
 *
 * @param {Array<{n: string, lat: number, lng: number, k: string, d: number}>} features
 *   From placeOf
 * @param {number} bodyDiameterKm
 * @param {Array<{n: string, t?: number, lat: number, lng: number, a?: number, k?: string}>} [curated]
 * @returns {Array<{n: string, t: number, lat: number, lng: number, a?: number, k: string}>}
 *   Ordered by tier, then by size, largest first
 */
export function tierPlaces(features, bodyDiameterKm, curated = []) {
  // One place to a name: of a repeated name (a crater and its namesake
  // ridge) the largest.
  const byKey = new Map
  for (const f of features) {
    const key = matchKey(f.n)
    const had = byKey.get(key)
    if (!had || f.d > had.d) {
      byKey.set(key, f)
    }
  }
  const ranked = [...byKey.values()].map((f) => ({...f, e: sizeFraction(f, bodyDiameterKm)}))
      .sort((a, b) => (b.e - a.e) || a.n.localeCompare(b.n))

  const curatedByKey = new Map(curated.map((c) => [matchKey(c.n), c]))
  const gazetteerKeys = new Set(ranked.map((f) => matchKey(f.n)))

  // Tier 0 of the Gazetteer's: those the curation puts there, then the
  // largest, to the cap (and past it for the curated ones).
  const tier0 = new Set(ranked.filter((f) => curatedByKey.get(matchKey(f.n))?.t === 0))
  for (const f of ranked) { // largest first
    if (tier0.size >= TIER0_MAX || (f.e < TIER_FRACTIONS[0] && tier0.size >= TIER0_MIN)) {
      break
    }
    tier0.add(f)
  }

  const out = []
  ranked.forEach((f, rank) => {
    let t
    if (tier0.has(f)) {
      t = 0
    } else if (f.e >= TIER_FRACTIONS[1]) {
      t = 1
    } else if (f.e >= TIER_FRACTIONS[2]) {
      t = 2
    } else {
      t = 3
    }
    // A body whose features are all small beside it (Callisto's craters)
    // still has the first few at each tier.
    t = Math.min(t, rank < TIER_MIN_COUNT[0] ? 1 : (rank < TIER_MIN_COUNT[1] ? 2 : 3))
    const c = curatedByKey.get(matchKey(f.n))
    if (c && (c.t ?? 0) < t) {
      t = c.t ?? 0
    }
    const place = {n: f.n, t, lat: f.lat, lng: f.lng, k: f.k}
    if (c?.a !== undefined) {
      place.a = c.a
    }
    out.push(place)
  })
  // The curated entries the Gazetteer doesn't have, as they were.
  const kept = []
  for (const c of curated) {
    // (An entry with no position only promotes a Gazetteer name.)
    if (c.lat !== undefined && !gazetteerKeys.has(matchKey(c.n))) {
      kept.push({...c, t: c.t ?? 0, lng: round(wrapLng(c.lng), 4)})
    }
  }
  // Tier first, then the curated (marks people look for) before the rest.
  return [...kept, ...out].map((p, i) => ({p, i})).sort((a, b) => (a.p.t - b.p.t) || (a.i - b.i)).map(({p}) => p)
}


/**
 * @param {string} radius A descriptor's radius ("3.3895E6 m")
 * @returns {number} Metres
 */
export function parseRadiusM(radius) {
  const m = /^\s*([0-9.]+(?:[eE][-+]?[0-9]+)?)\s*(km|m)?\s*$/.exec(radius)
  if (!m) {
    throw new Error(`can't read the radius ${JSON.stringify(radius)}`)
  }
  return Number(m[1]) * (m[2] === 'km' ? 1000 : 1)
}
