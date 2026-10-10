/**
 * HEALPix in the NESTED scheme (Górski et al. 2005, ApJ 622, 759), for
 * tiling a point population on the sky (js/scene/Gaia.md, "Tiling").  The
 * sphere is cut into 12 base pixels of equal area, each split in four at
 * every order: order k has 12 × 4^k pixels, nside = 2^k.  NESTED numbers
 * a pixel's four children 4p..4p+3, so a tile's children are found by
 * arithmetic, and Gaia's source_id carries the source's order-12 pixel in
 * its top bits (source_id / 2^35).
 *
 * The arithmetic follows healpix_base.cc (HEALPix C++ 3.x): loc2pix for
 * ang2pix, xyf2loc for a pixel's centre and corners.  Orders up to 13 here
 * (nside 8192), as tiles never go deeper; the bit spreading is in plain
 * integers, exact to 2^53.
 *
 * Directions are (z, phi): z = cos(colatitude) = sin(latitude), phi the
 * longitude in radians, in whatever equatorial-like frame the caller uses
 * (the tiles use the catalogue's: the J2000 ecliptic, scene axes).
 */


/** The deepest order these functions handle. */
export const MAX_ORDER = 13

// The base pixels' ring and longitude indices (healpix_base.cc jrll, jpll).
const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7]
const HALF_PI = Math.PI / 2
const TWO_THIRDS = 2 / 3


/**
 * @param {number} order
 * @returns {number} Pixels at this order, 12 × 4^order
 */
export function npix(order) {
  return 12 * (4 ** order)
}


/**
 * Spread a number's bits to the even positions: 0b111 -> 0b10101.
 *
 * @param {number} v Under 2^MAX_ORDER
 * @returns {number}
 */
function spreadBits(v) {
  let out = 0
  let bit = 1
  for (let i = 0; v >= bit && i < MAX_ORDER + 1; i++) {
    if (v & bit) {
      out += 4 ** i
    }
    bit *= 2
  }
  return out
}


/**
 * Gather the even bits of a number: the inverse of spreadBits.
 *
 * @param {number} v
 * @returns {number}
 */
function compressBits(v) {
  let out = 0
  let rest = v
  for (let i = 0; rest > 0; i++) {
    if (rest % 2 === 1) {
      out += 2 ** i
    }
    rest = Math.floor(rest / 4)
  }
  return out
}


/**
 * @param {number} ix
 * @param {number} iy
 * @param {number} face Base pixel, 0-11
 * @param {number} order
 * @returns {number} The NESTED pixel
 */
export function xyf2nest(ix, iy, face, order) {
  return (face * (4 ** order)) + spreadBits(ix) + (2 * spreadBits(iy))
}


/**
 * @param {number} pix NESTED pixel
 * @param {number} order
 * @returns {{ix: number, iy: number, face: number}}
 */
export function nest2xyf(pix, order) {
  const npface = 4 ** order
  const face = Math.floor(pix / npface)
  const p = pix - (face * npface)
  return {ix: compressBits(p), iy: compressBits(Math.floor(p / 2)), face}
}


/**
 * The NESTED pixel holding a direction (healpix_base.cc loc2pix).
 *
 * @param {number} order 0..MAX_ORDER
 * @param {number} z sin(latitude), -1..1
 * @param {number} phi Longitude, radians
 * @returns {number}
 */
export function ang2pixNest(order, z, phi) {
  const nside = 2 ** order
  const za = Math.abs(z)
  let tt = (phi / HALF_PI) % 4
  if (tt < 0) {
    tt += 4
  }
  if (za <= TWO_THIRDS) {
    // Equatorial region.
    const temp1 = nside * (0.5 + tt)
    const temp2 = nside * (z * 0.75)
    const jp = Math.floor(temp1 - temp2)
    const jm = Math.floor(temp1 + temp2)
    const ifp = Math.floor(jp / nside)
    const ifm = Math.floor(jm / nside)
    let face
    if (ifp === ifm) {
      face = (ifp % 4) + 4
    } else if (ifp < ifm) {
      face = ifp % 4
    } else {
      face = (ifm % 4) + 8
    }
    const ix = jm & (nside - 1)
    const iy = nside - (jp & (nside - 1)) - 1
    return xyf2nest(ix, iy, face, order)
  }
  // Polar caps.
  const ntt = Math.min(3, Math.floor(tt))
  const tp = tt - ntt
  const tmp = nside * Math.sqrt(3 * (1 - za))
  const jp = Math.min(Math.floor(tp * tmp), nside - 1)
  const jm = Math.min(Math.floor((1 - tp) * tmp), nside - 1)
  return z >= 0 ?
    xyf2nest(nside - jm - 1, nside - jp - 1, ntt, order) :
    xyf2nest(jp, jm, ntt + 8, order)
}


/**
 * A point of a base pixel's face, x and y in [0, 1] across it, to a
 * direction (healpix_base.cc xyf2loc).
 *
 * @param {number} x
 * @param {number} y
 * @param {number} face
 * @returns {{z: number, phi: number}}
 */
export function xyf2loc(x, y, face) {
  const jr = JRLL[face] - x - y
  let nr
  let z
  if (jr < 1) {
    nr = jr
    z = 1 - (nr * nr / 3)
  } else if (jr > 3) {
    nr = 4 - jr
    z = (nr * nr / 3) - 1
  } else {
    nr = 1
    z = (2 - jr) * TWO_THIRDS
  }
  let tmp = (JPLL[face] * nr) + x - y
  if (tmp < 0) {
    tmp += 8
  }
  if (tmp >= 8) {
    tmp -= 8
  }
  const phi = nr < 1e-15 ? 0 : (0.5 * HALF_PI * tmp) / nr
  return {z, phi}
}


/**
 * A point of a pixel, (dx, dy) in [0, 1] across it: (0.5, 0.5) is its
 * centre, the four corners its vertices.
 *
 * @param {number} order
 * @param {number} pix NESTED
 * @param {number} [dx]
 * @param {number} [dy]
 * @returns {{z: number, phi: number}}
 */
export function pix2loc(order, pix, dx = 0.5, dy = 0.5) {
  const nside = 2 ** order
  const {ix, iy, face} = nest2xyf(pix, order)
  return xyf2loc((ix + dx) / nside, (iy + dy) / nside, face)
}


/**
 * @param {number} z
 * @param {number} phi
 * @param {Array<number>} [out]
 * @returns {Array<number>} The unit vector, x toward phi = 0 on the
 *   equator, z the pole
 */
export function locToVec(z, phi, out = [0, 0, 0]) {
  const s = Math.sqrt(Math.max(0, 1 - (z * z)))
  out[0] = s * Math.cos(phi)
  out[1] = s * Math.sin(phi)
  out[2] = z
  return out
}


/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {{z: number, phi: number}} The direction of a vector (any length)
 */
export function vecToLoc(x, y, z) {
  const r = Math.hypot(x, y, z)
  return {z: r > 0 ? z / r : 1, phi: Math.atan2(y, x)}
}


/**
 * A cone round a pixel that holds all of it: its centre, and the largest
 * angle from there to its boundary, sampled along the edges (a HEALPix
 * edge isn't a great circle, so the corners alone can miss a bulge) and
 * padded by a small margin.
 *
 * @param {number} order
 * @param {number} pix
 * @returns {{centre: Array<number>, radius: number}} radius in radians
 */
export function pixelCone(order, pix) {
  const c = pix2loc(order, pix)
  const centre = locToVec(c.z, c.phi)
  const SAMPLES = 8
  let maxAngle = 0
  const v = [0, 0, 0]
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    for (const [dx, dy] of [[t, 0], [t, 1], [0, t], [1, t]]) {
      const p = pix2loc(order, pix, dx, dy)
      locToVec(p.z, p.phi, v)
      const dot = (v[0] * centre[0]) + (v[1] * centre[1]) + (v[2] * centre[2])
      maxAngle = Math.max(maxAngle, Math.acos(Math.min(1, Math.max(-1, dot))))
    }
  }
  return {centre, radius: (maxAngle * 1.02) + 1e-9}
}


/**
 * The pixel at a coarser order that holds a pixel.
 *
 * @param {number} pix NESTED at `order`
 * @param {number} order
 * @param {number} parentOrder <= order
 * @returns {number}
 */
export function parentPixel(pix, order, parentOrder) {
  return Math.floor(pix / (4 ** (order - parentOrder)))
}
