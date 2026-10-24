import {Matrix4} from 'three'


// Celestiary's frames to ECEF, for layer mode (design/LayerMode.md, "The
// contract"): the host's view is in ECEF metres of date (+X Greenwich on
// the equator, +Z the north pole), and celestiary hangs satellites and
// networks in Earth's equator frame of date (+Y the pole, +X the equinox;
// satellites/sgp4.js temeToEquator), which Animation turns Earth in by
// GMST.  So a point there is at body = Ry(−GMST) · equator in Earth's
// body-fixed frame (coords.js: +Y the pole, +X longitude 0, east toward
// −Z), and at ECEF = (bx, −bz, by).


/**
 * The equator frame of date to ECEF, at GMST g.
 *
 * @param {number} g GMST, radians
 * @param {Matrix4} [out]
 * @returns {Matrix4} out
 */
export function equatorToEcef(g, out = new Matrix4) {
  const c = Math.cos(g)
  const s = Math.sin(g)
  // Row-major: ECEF x = c·X − s·Z, y = −s·X − c·Z, z = Y.
  return out.set(
      c, 0, -s, 0,
      -s, 0, -c, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
  )
}


/**
 * A body-fixed point (coords.js latLngAltToBodyFixed's frame) in ECEF.
 *
 * @param {{x: number, y: number, z: number}} b
 * @returns {Array<number>} [x, y, z]
 */
export function bodyFixedToEcef(b) {
  return [b.x, -b.z, b.y]
}
