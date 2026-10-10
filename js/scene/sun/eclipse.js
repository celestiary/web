/**
 * How much of a star's disc a camera sees past the bodies in front of it
 * (js/scene/Sun.md, "Eclipses"): its light, weighted by its limb
 * darkening, over the light of the whole disc.  It scales what the disc's
 * light does at the eye: the glare (glare.js), the sky's light from that
 * star (the atmosphere pass), and the meter's reading of the disc.
 */


// Rings across the disc: enough for a smooth light curve through a
// partial phase (the coverage of a ring is exact; the rings sample the
// limb darkening).
export const ECLIPSE_RINGS = 64


/**
 * The part of a ring's circumference inside a circle.
 *
 * @param {number} r the ring's radius
 * @param {number} d the circle's centre's distance from the ring's
 * @param {number} radius the circle's
 * @returns {number} 0 to 1
 */
export function ringCovered(r, d, radius) {
  if (d + r <= radius) {
    return 1
  }
  if (d >= r + radius || r >= d + radius) {
    return 0
  }
  const c = ((r * r) + (d * d) - (radius * radius)) / (2 * r * d)
  return Math.acos(Math.min(Math.max(c, -1), 1)) / Math.PI
}


/**
 * The visible share of a limb-darkened disc's light.
 *
 * @param {number} discRadius its angular radius, radians
 * @param {Array<{separation: number, radius: number}>} occluders their
 *     angular distance from the disc's centre and their angular radius,
 *     radians; overlapping occluders are combined as independent
 * @param {function(number): number} [limb] I(μ)/I(1); uniform by default
 * @returns {number} 0 to 1
 */
export function visibleFraction(discRadius, occluders, limb = () => 1) {
  const near = occluders.filter((o) => o.separation < discRadius + o.radius)
  if (near.length === 0) {
    return 1
  }
  let total = 0
  let seen = 0
  for (let k = 0; k < ECLIPSE_RINGS; k++) {
    const r = (k + 0.5) / ECLIPSE_RINGS
    const mu = Math.sqrt(Math.max(1 - (r * r), 0))
    const w = limb(mu) * r
    let open = 1
    for (const o of near) {
      open *= 1 - ringCovered(r, o.separation / discRadius, o.radius / discRadius)
    }
    total += w
    seen += w * open
  }
  return total > 0 ? seen / total : 1
}


/**
 * An occluder's separation and angular radius as seen from a point.
 *
 * @param {Array<number>} eye
 * @param {Array<number>} sunDir unit, from the eye to the disc's centre
 * @param {Array<number>} centre the occluder's
 * @param {number} radius the occluder's, in the same units as the positions
 * @returns {{separation: number, radius: number, distance: number}|null}
 *     null when it's behind the eye or the eye is inside it
 */
export function occluderSeen(eye, sunDir, centre, radius) {
  const v = [centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]]
  const distance = Math.hypot(...v)
  if (!(distance > radius)) {
    return null
  }
  const along = ((v[0] * sunDir[0]) + (v[1] * sunDir[1]) + (v[2] * sunDir[2])) / distance
  if (along <= 0) {
    return null
  }
  // The angle from the disc's centre, by atan2 of the cross and dot: exact
  // at the small angles an eclipse is made of.
  const cx = (v[1] * sunDir[2]) - (v[2] * sunDir[1])
  const cy = (v[2] * sunDir[0]) - (v[0] * sunDir[2])
  const cz = (v[0] * sunDir[1]) - (v[1] * sunDir[0])
  const separation = Math.atan2(Math.hypot(cx, cy, cz) / distance, along)
  return {separation, radius: Math.asin(radius / distance), distance}
}


// Under this visible share the disc is eclipsed: the meter doesn't take
// it as a luminous disc (ThreeUI._luminousDiscs).
export const ECLIPSED_DISC = 1e-3
// The sky in totality over the sky uneclipsed: the air in the umbra is lit
// only by light scattered in from the sunlit air outside it.  Shaw et
// al.'s radiative-transfer simulations (Applied Optics 65(9), C66, 2026)
// find the zenith at the umbra's centre about four orders of magnitude
// under daylight; Birriel et al. (JAAVSO, 2026) measured 12.99-13.27
// mag/arcsec² at the zenith in totality (Oxford, Ohio; Wickliffe,
// Kentucky), brighter than nautical twilight.  The model's day zenith over
// Dallas that day is 1.0e4 cd/m² (2.6 mag/arcsec²), and 1e-4 of it read
// 12.55 mag/arcsec²; 6e-5 puts it at the measured 13.1.  A first cut,
// uniform over the sky: the horizon's sunset glow all round, where the air
// beyond the shadow is lit, is a follow-up (Sun.md).
export const TOTALITY_SKY = 6e-5


/**
 * The sky's light in an eclipse, over its light uneclipsed: what the air
 * sees of the Sun, from the camera, past every body but the air's own
 * (its own shadow is the atmosphere pass's), plus what is scattered in
 * from outside the shadow.  1 out of the air, where the shadow on it is a
 * patch the pass can't draw yet.
 *
 * @param {object} sun The Sun's Star, with its layers
 * @param {object} body The body whose air the pass draws
 * @param {boolean} inAir Whether the camera is in that air
 * @returns {number}
 */
export function eclipsedSky(sun, body, inAir) {
  if (!inAir || !sun?.sunLayers) {
    return 1
  }
  const f = sun.sunLayers.visibleFractionExcept(body)
  return f + (TOTALITY_SKY * (1 - f))
}
