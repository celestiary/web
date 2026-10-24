// Iridium NEXT's network (Networks.md, "Iridium"): which satellites are in
// service, their six planes, and the links between them at an instant.
// Pure, no dependencies, so the test drives it with made-up constellations.
//
// The model, kept simple:
//  - In service: the mean motion within IN_SERVICE_REV_DAY of the median.
//    The spares sit lower, so they go round faster, and are left unlinked.
//  - Planes: the in-service satellites' right ascensions of the ascending
//    node, clustered where they're more than PLANE_GAP_DEG apart.  Numbered
//    east from the widest gap between planes, the seam: the planes either
//    side of it (1 and 6) pass each other going opposite ways.
//  - In plane: each satellite links to the ones ahead and behind, by
//    argument of latitude.
//  - Across planes: each satellite links to the nearest in each
//    neighbouring plane, never across the seam, and not while either end is
//    poleward of CROSS_PLANE_MAX_LAT_DEG, where the planes converge and
//    cross and Iridium switches its cross-plane links off.
//  - Any link must clear the atmosphere (LINK_CLEARANCE_M): a plane with a
//    gap (a satellite missing) has no link across it.


/** Mean motion this near the median is in service, rev/day. */
export const IN_SERVICE_REV_DAY = 0.005
/** Nodes this far apart are different planes, degrees (the planes are ~31.6° apart). */
export const PLANE_GAP_DEG = 10
/**
 * Poleward of this latitude, degrees, there are no cross-plane links.  A
 * model value: Iridium doesn't publish its own.
 */
export const CROSS_PLANE_MAX_LAT_DEG = 60
/** A link's lowest point must be this far above Earth's equatorial radius, m. */
export const LINK_CLEARANCE_M = 100e3
const EARTH_RADIUS_M = 6378137
const DEG = Math.PI / 180


/**
 * @param {Array<{meanMotion: number}>} records
 * @returns {Array<boolean>} whether each is in service
 */
export function inService(records) {
  const sorted = records.map((r) => r.meanMotion).sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  return records.map((r) => Math.abs(r.meanMotion - median) < IN_SERVICE_REV_DAY)
}


/**
 * Cluster by node into planes, numbered east from the seam.
 *
 * @param {Array<number>} raanDeg each satellite's node, degrees
 * @param {Array<boolean>} [use] which to include (default all)
 * @returns {Array<Array<number>>} each plane's satellite indices; plane 0
 *   is just east of the widest gap (the seam), the last just west of it
 */
export function clusterPlanes(raanDeg, use = raanDeg.map(() => true)) {
  const idx = raanDeg.map((_, i) => i).filter((i) => use[i])
  if (!idx.length) {
    return []
  }
  const norm = (a) => ((a % 360) + 360) % 360
  idx.sort((a, b) => norm(raanDeg[a]) - norm(raanDeg[b]))
  // The widest gap, going round: the cut, and the seam if it's between planes.
  let cut = 0
  let widest = -1
  for (let k = 0; k < idx.length; k++) {
    const next = idx[(k + 1) % idx.length]
    const gap = norm(raanDeg[next] - raanDeg[idx[k]])
    if (gap > widest) {
      widest = gap
      cut = (k + 1) % idx.length
    }
  }
  const planes = []
  let plane = []
  for (let m = 0; m < idx.length; m++) {
    const i = idx[(cut + m) % idx.length]
    if (plane.length && norm(raanDeg[i] - raanDeg[plane[plane.length - 1]]) > PLANE_GAP_DEG) {
      planes.push(plane)
      plane = []
    }
    plane.push(i)
  }
  planes.push(plane)
  return planes
}


/**
 * @param {Array<number>|Float64Array} r position, xyz from j, +Y the pole
 * @param {Array<number>|Float64Array} v velocity (or any vector along it), xyz from j
 * @param {number} j
 * @returns {number} argument of latitude, radians in [0, 2π): the angle
 *   from the ascending node along the orbit
 */
export function argumentOfLatitude(r, v, j = 0) {
  const [rx, ry, rz] = [r[j], r[j + 1], r[j + 2]]
  const [vx, vy, vz] = [v[j], v[j + 1], v[j + 2]]
  // h = r × v; the node is along Ŷ × h.
  const hx = (ry * vz) - (rz * vy)
  const hy = (rz * vx) - (rx * vz)
  const hz = (rx * vy) - (ry * vx)
  const nx = hz
  const nz = -hx
  // ĥ × n̂, the in-plane axis 90° on from the node, along the motion.
  const mx = (hy * nz)
  const my = (hz * nx) - (hx * nz)
  const mz = -(hy * nx)
  const u = Math.atan2(((rx * mx) + (ry * my) + (rz * mz)) / Math.hypot(mx, my, mz),
      ((rx * nx) + (rz * nz)) / Math.hypot(nx, nz))
  return u < 0 ? u + (2 * Math.PI) : u
}


/**
 * @param {Array<number>|Float64Array} p xyz from j, +Y the pole
 * @param {number} j
 * @returns {number} geocentric latitude, degrees
 */
export function latitudeOf(p, j = 0) {
  return Math.asin(p[j + 1] / Math.hypot(p[j], p[j + 1], p[j + 2])) / DEG
}


/**
 * @param {Array<number>|Float64Array} p positions, xyz each
 * @param {number} a index
 * @param {number} b index
 * @returns {boolean} whether the line between them clears the atmosphere
 */
export function clearsEarth(p, a, b) {
  const [ax, ay, az] = [p[3 * a], p[(3 * a) + 1], p[(3 * a) + 2]]
  const dx = p[3 * b] - ax
  const dy = p[(3 * b) + 1] - ay
  const dz = p[(3 * b) + 2] - az
  const dd = (dx * dx) + (dy * dy) + (dz * dz)
  const t = dd > 0 ? Math.min(1, Math.max(0, -((ax * dx) + (ay * dy) + (az * dz)) / dd)) : 0
  return Math.hypot(ax + (t * dx), ay + (t * dy), az + (t * dz)) > EARTH_RADIUS_M + LINK_CLEARANCE_M
}


/**
 * The links at an instant.
 *
 * @param {Array<number>|Float64Array} pos each satellite's position, xyz, metres, +Y the pole
 * @param {Array<number>|Float64Array} vel each one's velocity (or v / ω), xyz
 * @param {Array<Array<number>>} planes clusterPlanes'
 * @param {Array<boolean>|Uint8Array} [drawn] which have a position now (default all)
 * @returns {{inPlane: Array<[number, number, number]>, crossPlane: Array<[number, number]>}}
 *   pairs of satellite indices, each once; an in-plane pair carries its plane
 */
export function iridiumLinks(pos, vel, planes, drawn = null) {
  const has = (i) => !drawn || Boolean(drawn[i])
  const inPlane = []
  const crossPlane = []
  const live = planes.map((plane) => plane.filter(has))
  live.forEach((plane, k) => {
    const order = plane.map((i) => [argumentOfLatitude(pos, vel, 3 * i), i]).sort((a, b) => a[0] - b[0])
    // Round the ring: a plane of two has one link, of one none.
    const links = order.length > 2 ? order.length : order.length - 1
    for (let m = 0; m < links; m++) {
      const a = order[m][1]
      const b = order[(m + 1) % order.length][1]
      if (clearsEarth(pos, a, b)) {
        inPlane.push([a, b, k])
      }
    }
  })
  const seen = new Set
  const nearestIn = (i, plane) => {
    let best = -1
    let bestD = Infinity
    for (const j of plane) {
      const d = Math.hypot(pos[3 * j] - pos[3 * i], pos[(3 * j) + 1] - pos[(3 * i) + 1], pos[(3 * j) + 2] - pos[(3 * i) + 2])
      if (d < bestD) {
        bestD = d
        best = j
      }
    }
    return best
  }
  const polar = (i) => Math.abs(latitudeOf(pos, 3 * i)) > CROSS_PLANE_MAX_LAT_DEG
  live.forEach((plane, k) => {
    // Neighbours k - 1 and k + 1; none round the seam (first and last).
    for (const m of [k - 1, k + 1]) {
      if (m < 0 || m >= live.length || !live[m].length) {
        continue
      }
      for (const i of plane) {
        if (polar(i)) {
          continue
        }
        const j = nearestIn(i, live[m])
        const key = i < j ? `${i}-${j}` : `${j}-${i}`
        if (j < 0 || polar(j) || seen.has(key) || !clearsEarth(pos, i, j)) {
          continue
        }
        seen.add(key)
        crossPlane.push(i < j ? [i, j] : [j, i])
      }
    }
  })
  return {inPlane, crossPlane}
}
