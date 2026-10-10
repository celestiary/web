import {Matrix4, Vector3} from 'three'
import {toRad} from '../shared.js'


// IAU galactic frame definition (J2000):
//   Galactic North Pole (NGP):  α = 192.85948°,  δ = +27.12825°
//   Galactic Center (l=0,b=0):  α = 266.40499°,  δ = -28.93617°
//   Earth's obliquity at J2000: 23.4392811°
//
// The Celestia binary stars.dat catalog stores positions in a frame that is
// equivalent to right-handed ecliptic J2000 with axes remapped:
//   scene X = ecliptic X (vernal equinox)
//   scene Y = ecliptic Z (north ecliptic pole)
//   scene Z = -ecliptic Y (so the frame stays right-handed in three.js)
// Verified empirically against Sirius (β≈-39.61°, λ≈104.08°) reproducing
// catalog (x,y,z) = (-1.613, -5.483, -6.428) ly.
//
// Therefore: a unit vector at ecliptic (lon=λ, lat=β) sits in the scene frame
// at (cos β cos λ, sin β, -cos β sin λ).
const NGP_RA_DEG = 192.85948
const NGP_DEC_DEG = 27.12825
const GC_RA_DEG = 266.40499
const GC_DEC_DEG = -28.93617
const OBLIQUITY_DEG = 23.4392811


/**
 * Convert an equatorial J2000 (RA, Dec) direction into a scene-frame unit
 * vector.  The scene frame matches the Celestia stars.dat convention used by
 * StarsCatalog (X=vernal equinox, Y=north ecliptic pole, Z=-ecliptic-Y).
 *
 * Pipeline:
 *   1. (RA, Dec) → equatorial Cartesian (X=VE, Y=90° RA, Z=NCP)
 *   2. Rotate around X by -ε (Earth's obliquity) → right-handed ecliptic
 *      (X=VE, Y=90° ecl-lon, Z=NEP)
 *   3. Remap axes to scene frame: (X, Z, -Y)
 *
 * @param {number} raDeg right ascension in degrees
 * @param {number} decDeg declination in degrees
 * @returns {Vector3} scene-frame unit vector
 */
export function equatorialToSceneUnit(raDeg, decDeg) {
  const ra = raDeg * toRad
  const dec = decDeg * toRad
  const eps = OBLIQUITY_DEG * toRad
  // Step 1: equatorial Cartesian
  const xq = Math.cos(dec) * Math.cos(ra)
  const yq = Math.cos(dec) * Math.sin(ra)
  const zq = Math.sin(dec)
  // Step 2: rotate -ε around X to get right-handed ecliptic
  const cE = Math.cos(eps)
  const sE = Math.sin(eps)
  const xe = xq
  const ye = (yq * cE) + (zq * sE)
  const ze = (-yq * sE) + (zq * cE)
  // Step 3: scene-frame axis remap
  return new Vector3(xe, ze, -ye)
}


/**
 * An equatorial J2000 vector (X the vernal equinox, Z the north celestial
 * pole) in the scene frame, by equatorialToSceneUnit's turn: about X by -ε
 * to the ecliptic, then the axes remapped.
 *
 * @param {Array<number>} v [x, y, z], equatorial
 * @returns {Array<number>} [x, y, z], scene
 */
export function equatorialVectorToScene([x, y, z]) {
  const eps = OBLIQUITY_DEG * toRad
  const cE = Math.cos(eps)
  const sE = Math.sin(eps)
  return [x, (-y * sE) + (z * cE), -((y * cE) + (z * sE))]
}


/**
 * The sky's directions at a point, in the scene frame: toward it (from the
 * Sun), and north and east on the sky there (north toward the celestial
 * pole, east toward growing RA), the frame a position angle is measured in
 * (from north through east).
 *
 * @param {number} raDeg
 * @param {number} decDeg
 * @returns {{toward: Array<number>, north: Array<number>, east: Array<number>}} Unit vectors, scene frame
 */
export function skyBasis(raDeg, decDeg) {
  const ra = raDeg * toRad
  const dec = decDeg * toRad
  return {
    toward: equatorialVectorToScene([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]),
    north: equatorialVectorToScene([-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)]),
    east: equatorialVectorToScene([-Math.sin(ra), Math.cos(ra), 0]),
  }
}


/**
 * Build the rotation matrix that maps galaxy-local frame F into scene frame:
 *   F's +X axis = direction from the Sun toward the galactic center (l=0)
 *   F's +Y axis = north galactic pole
 *   F's +Z axis = right-handed completion, X × Y, which is l=270° in the
 *     galactic plane (not l=90°: with Y the pole, l=90° is Y × X)
 *
 * Constructed from the IAU NGP and GC sky positions converted into the scene
 * frame via {@link equatorialToSceneUnit}, then orthonormalized so the basis
 * is exactly orthogonal even though the published NGP and GC directions
 * aren't perfectly perpendicular.
 *
 * Used by galaxyModel.js to orient the Milky Way: its transpose takes the
 * catalogue frame into F (and the galactocentric frame G, F shifted by the
 * Sun's position), so the disc's plane is the galactic plane and the
 * centre is in Sagittarius.
 *
 * @returns {Matrix4} pure rotation, ready to assign to Object3D.matrix or
 *     decompose into a quaternion via setFromRotationMatrix.
 */
export function galacticToSceneMatrix() {
  // F's +X = Sun → GC, F's +Y = NGP (in scene frame).
  const fX = equatorialToSceneUnit(GC_RA_DEG, GC_DEC_DEG).normalize()
  const fY = equatorialToSceneUnit(NGP_RA_DEG, NGP_DEC_DEG).normalize()
  // Re-orthogonalize so F is exactly orthonormal: derive +Z from X×Y, then
  // rebuild +X from Y×Z.  The NGP and GC directions disagree from
  // perpendicular by ~0.02° (publication precision), and a non-orthogonal
  // basis matrix is no longer a rotation.
  const fZ = new Vector3().crossVectors(fX, fY).normalize()
  const fXOrtho = new Vector3().crossVectors(fY, fZ).normalize()
  return new Matrix4().makeBasis(fXOrtho, fY, fZ)
}


// Sun's distance from the galactic center (Sgr A*) — IAU 2015 working value
// is ~26.0 kly (8.0 kpc); the canonical "26 kly" is a fine round number for
// procedural use.
export const SUN_GALACTIC_RADIUS_LY = 26000
