/**
 * Which body's atmosphere the atmosphere pass draws, and whether it can draw
 * it from where the camera is.  The pass draws one body's air (ThreeUI
 * _updateAtmUniforms).  See composition.md, "Which body's air".
 */


/**
 * How near a body the camera must be, in atmosphere radii, for its
 * atmosphere to take the pass over from the last one drawn (typical orbit
 * distances).
 */
export const ATMOSPHERE_NEAR_RADII = 20

/**
 * How far from a body, in its radii, the pass can still draw its air.  The
 * pass intersects each ray with the body's spheres in float32 (`rsi`), as
 * b² − c: both are ~D² at a distance D, so the discriminant carries an
 * error of ~D²·2⁻²³, against the body's R² over its disc.  At D = 2,900 R
 * the error is the disc's whole discriminant, and from ~700 R rays near the
 * limb land on the ground, the air or nothing at random (the test replays
 * it: 2% of a disc's rays wrong at 700 R, 3% at 1,000, 32% at 12,500).
 * Jupiter from Earth (12,500 radii) drew as speckle, a third of its
 * pixels black (#192).  At 500 radii, where the mesh gives way to the far
 * point at 45° (farPoint.js POINT_AT_RADII), a body is 0.23° across, 3 px
 * at 45° over 640 px.  Past it a narrow field still shows the disc large
 * (Jupiter from Earth at 0.5° is 60 px), without its own air, whose limb
 * is then a fraction of a pixel (300 km at 5.9 AU is 0.07″).
 */
export const ATMOSPHERE_MAX_RADII = 500


/**
 * @param {object} body A planet or moon node, with props
 * @returns {number} Its atmosphere's outer radius, metres
 */
export function atmosphereRadius(body) {
  return body.props.radius.scalar + body.props.atmosphere.height.scalar
}


/**
 * The body whose atmosphere the pass draws:
 *
 * - The body the camera is at (zoom.js homeBody), when it has air and the
 *   camera is near it: from Earth's ground the sky is Earth's, whatever is
 *   targeted.  A permalink that targets Jupiter from Earth
 *   (`#sun/jupiter@lat,lng,alt;from=sun/earth`) had no last body, so it
 *   took Jupiter's, from 5.9 AU: no sky, and Jupiter in speckle (#192).
 * - Else the target, when it has air and the camera is near it, or no body
 *   has been drawn yet.
 * - Else the last one drawn (the Sun targeted after a planet).
 *
 * @param {object} p
 * @param {object|null} p.home The body the camera is at
 * @param {object|null} p.target The targeted body
 * @param {object|null} p.last The body whose atmosphere was drawn last
 * @param {function(object): number} p.distanceTo The camera's distance to a
 *   body's centre, metres
 * @returns {object|null}
 */
export function atmosphereBody({home, target, last, distanceTo}) {
  const hasAir = (b) => Boolean(b?.props?.atmosphere && b.props.radius)
  const near = (b) => hasAir(b) && distanceTo(b) < atmosphereRadius(b) * ATMOSPHERE_NEAR_RADII
  if (near(home)) {
    return home
  }
  if (hasAir(target) && (!last || near(target))) {
    return target
  }
  return last ?? null
}


/**
 * @param {number} distance The camera's distance to the body's centre, metres
 * @param {number} radius The body's radius, metres
 * @returns {boolean} Whether the pass can draw the body's air from there
 *   (ATMOSPHERE_MAX_RADII)
 */
export function atmosphereResolvable(distance, radius) {
  return distance <= radius * ATMOSPHERE_MAX_RADII
}
