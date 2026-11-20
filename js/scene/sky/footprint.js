import {pixelCone} from '../points/healpix.js'
import {cellsInDisc, lonLatToVec} from './hips.js'


// An image's rectangle on the sky, from the metadata a press image carries
// (AVM: its centre, its field of view, and the position angle of its up),
// and the HEALPix cells it touches: how Rubin's First Look coverage was
// built while CDS's MocServer answered no MOC (Sky.md, "Coverage").  Pure.

const toRad = Math.PI / 180


/**
 * The rectangle's frame: its centre, and its right and up on the sky.  Up
 * is at position angle upPaDeg (east of north); right is up turned 90°
 * toward the west, as on an image shown with east to the left of north.
 *
 * @param {{raDeg: number, decDeg: number, upPaDeg: number}} f
 * @returns {{c: Array<number>, r: Array<number>, u: Array<number>}} Unit vectors, equatorial
 */
export function footprintFrame(f) {
  const ra = f.raDeg * toRad
  const dec = f.decDeg * toRad
  const c = lonLatToVec(f.raDeg, f.decDeg)
  const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)]
  const east = [-Math.sin(ra), Math.cos(ra), 0]
  const pa = f.upPaDeg * toRad
  const u = [0, 1, 2].map((i) => (north[i] * Math.cos(pa)) + (east[i] * Math.sin(pa)))
  // Right: up turned toward the west, PA − 90°.
  const r = [0, 1, 2].map((i) => (north[i] * Math.cos(pa - (Math.PI / 2))) + (east[i] * Math.sin(pa - (Math.PI / 2))))
  return {c, r, u}
}


/**
 * A direction's angular distance outside the rectangle, by its gnomonic
 * place on the rectangle's tangent plane; 0 inside.
 *
 * @param {object} f A footprint: raDeg, decDeg, widthDeg, heightDeg, upPaDeg
 * @param {Array<number>} v Unit, equatorial
 * @param {object} [frame] footprintFrame's, if already made
 * @returns {number} Radians (Infinity for the far hemisphere)
 */
export function outsideFootprint(f, v, frame = footprintFrame(f)) {
  const {c, r, u} = frame
  const w = (v[0] * c[0]) + (v[1] * c[1]) + (v[2] * c[2])
  if (w <= 0) {
    return Infinity
  }
  const x = ((v[0] * r[0]) + (v[1] * r[1]) + (v[2] * r[2])) / w
  const y = ((v[0] * u[0]) + (v[1] * u[1]) + (v[2] * u[2])) / w
  const dx = Math.max(0, Math.abs(x) - (f.widthDeg / 2 * toRad))
  const dy = Math.max(0, Math.abs(y) - (f.heightDeg / 2 * toRad))
  return Math.hypot(dx, dy)
}


/**
 * The cells at an order that touch the rectangle, padded.
 *
 * @param {number} order
 * @param {object} f A footprint
 * @param {number} [padDeg]
 * @returns {Array<number>} NESTED
 */
export function footprintCells(order, f, padDeg = 0) {
  const frame = footprintFrame(f)
  const halfDiagonal = Math.hypot(f.widthDeg, f.heightDeg) / 2 * toRad
  const out = []
  for (const pix of cellsInDisc(order, frame.c, halfDiagonal + (padDeg * toRad), {limit: 1e6})) {
    const cone = pixelCone(order, pix)
    if (outsideFootprint(f, cone.centre, frame) <= cone.radius + (padDeg * toRad)) {
      out.push(pix)
    }
  }
  return out
}
