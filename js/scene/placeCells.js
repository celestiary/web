import {latLngAltToBodyFixed} from '../coords.js'


// A cell of the sphere is this many degrees of latitude and of longitude.
export const CELL_DEG = 30


/**
 * The places of a tier too many to keep as sheets all at once (the smallest
 * features of a body: a thousand or more) are grouped by where they are, so
 * only the sheets of the ground the camera can see are built and drawn:
 * from a height the surface labels it can see (a cap of the sphere, the
 * horizon's: `capAngle`) are a tenth of the body's or fewer.
 *
 * @param {Array<{lat: number, lng: number}>} entries The tier, in its order
 * @param {number} [cellDeg]
 * @returns {Array<{x: number, y: number, z: number, radius: number,
 *   items: Array<{e: object, rank: number}>}>} The cells that have places,
 *   each with a unit vector to the middle of its places (body-fixed, as the
 *   labels' positions are), the angle from it to the farthest of them
 *   (radians), and its places with each one's place in the tier
 */
export function groupByCell(entries, cellDeg = CELL_DEG) {
  const cells = new Map
  entries.forEach((e, rank) => {
    const row = Math.min(Math.floor((e.lat + 90) / cellDeg), Math.ceil(180 / cellDeg) - 1)
    const col = Math.floor((((e.lng + 180) % 360) + 360) % 360 / cellDeg)
    const key = (row * 1000) + col
    if (!cells.has(key)) {
      cells.set(key, [])
    }
    cells.get(key).push({e, rank})
  })
  return [...cells.values()].map((items) => {
    const sum = {x: 0, y: 0, z: 0}
    const units = items.map(({e}) => latLngAltToBodyFixed(e.lat, e.lng, 0, 1))
    for (const u of units) {
      sum.x += u.x
      sum.y += u.y
      sum.z += u.z
    }
    const len = Math.hypot(sum.x, sum.y, sum.z)
    // Places spread over a whole ring around a pole have no mean: use any
    // of them, the radius then covers the rest.
    const c = len > 1e-6 ? {x: sum.x / len, y: sum.y / len, z: sum.z / len} : {x: units[0].x, y: units[0].y, z: units[0].z}
    let radius = 0
    for (const u of units) {
      radius = Math.max(radius, Math.acos(Math.min(1, Math.max(-1, (u.x * c.x) + (u.y * c.y) + (u.z * c.z)))))
    }
    return {...c, radius, items}
  })
}


/**
 * @param {number} cameraDist The camera's distance from the body's centre
 * @param {number} radius The body's
 * @returns {number} The angle (radians) from the camera's nadir to the
 *   horizon: a surface label farther than this from it is on the far side
 *   (the labels' shader discards it), and no sheet of it need be drawn
 */
export function horizonAngle(cameraDist, radius) {
  return Math.acos(Math.min(1, radius / Math.max(cameraDist, radius)))
}


/**
 * @param {{x: number, y: number, z: number, radius: number}} cell
 * @param {{x: number, y: number, z: number}} dir A unit vector from the
 *   body's centre to the camera, body-fixed
 * @param {number} capAngle From horizonAngle
 * @returns {boolean} Whether any place of the cell can be on the near side
 */
export function cellInView(cell, dir, capAngle) {
  const dot = (cell.x * dir.x) + (cell.y * dir.y) + (cell.z * dir.z)
  return Math.acos(Math.min(1, Math.max(-1, dot))) <= capAngle + cell.radius
}
