import {Matrix4, Quaternion, Vector3} from 'three'
import {toRad} from '../shared.js'


// Tiny epsilon for the polar-degeneracy test.  At |cos(lat)| below this we
// treat ourselves as "at the pole" and pick an arbitrary tangent for North.
// 1e-9 in cos space ≈ 5.7e-8° latitude — far below any sensor's resolution.
const POLAR_EPS = 1e-9


/**
 * Build the East-North-Up triad at (lat, lng) in body-fixed coordinates.
 *
 * Body-fixed convention (matches js/coords.js):
 *   +Y = rotational axis (north pole)
 *   +X = prime meridian (lng = 0)
 *   East-positive longitude winds toward −Z
 *
 * ENU convention (chosen here):
 *   +X = East, +Y = North, +Z = Up
 *
 * At the geographic poles, "North" is undefined — we deterministically pick
 * the tangent direction that aligns with body-fixed +X projected onto the
 * local tangent plane, which keeps the math continuous near the pole and
 * gives a fixed reference for any sky map drawn there.
 *
 * @param {number} lat Latitude in degrees, [-90, 90]
 * @param {number} lng Longitude in degrees, east-positive
 * @returns {{east: Vector3, north: Vector3, up: Vector3}} unit vectors in body-fixed coords
 */
export function enuTriadAtLatLng(lat, lng) {
  const latRad = lat * toRad
  const lngRad = lng * toRad
  const cLat = Math.cos(latRad)
  const sLat = Math.sin(latRad)
  const cLng = Math.cos(lngRad)
  const sLng = Math.sin(lngRad)

  // Up = outward radial direction at (lat, lng).  Matches latLngAltToBodyFixed
  // for unit altitude — see coords.js.
  const up = new Vector3(cLat * cLng, sLat, -cLat * sLng)

  let north
  if (Math.abs(cLat) < POLAR_EPS) {
    // Polar degeneracy.  Pick a fixed tangent so q is continuous and
    // well-defined.  +X (prime meridian direction) is in the equatorial
    // plane, hence tangent to the surface at either pole.  At the north
    // pole we want "north" to point further along +Y... but we're at +Y,
    // so north has no meaning.  We use +X here as the canonical fallback
    // (the prime meridian's direction); flips sign at the south pole so
    // the triad stays right-handed.
    north = new Vector3(sLat >= 0 ? -1 : 1, 0, 0)
  } else {
    // North = poleAxis projected onto the tangent plane at `up`, normalized.
    //   N = (Ŷ − (Ŷ · up) up) / |…|
    // Ŷ · up = sLat.  Substituting:
    //   N = (-sLat·cLat·cLng, 1 − sLat², sLat·cLat·sLng) / cLat
    //     = (-sLat·cLng, cLat, sLat·sLng)
    north = new Vector3(-sLat * cLng, cLat, sLat * sLng)
  }

  // East = North × Up (right-handed: E × N = U → N × U = E).
  const east = new Vector3().crossVectors(north, up)
  return {east, north, up}
}


/**
 * Quaternion mapping ENU vectors at (lat, lng) into body-fixed coordinates.
 *
 * Composition rule: bodyFixedVec = q · enuVec.
 *
 * Together with the camera platform being parented to the *rotating* body
 * (see Scene.land), this completes the chain
 *
 *   device → ENU → body-fixed → inertial scene
 *
 * with the body-fixed → inertial step inherited automatically from the
 * scene graph (sidereal rotation lives on the body Object3D).
 *
 * @param {number} lat Latitude in degrees
 * @param {number} lng Longitude in degrees, east-positive
 * @returns {Quaternion}
 */
export function enuToBodyFixedQuat(lat, lng) {
  const {east, north, up} = enuTriadAtLatLng(lat, lng)
  // Build the rotation matrix whose columns are E, N, U.  Vectors in ENU
  // (e.g. (1,0,0) for "1 m east") right-multiply this matrix to land in
  // body-fixed coords.  Three.js Matrix4.makeBasis takes the three column
  // vectors directly, in xAxis/yAxis/zAxis order.
  const m = new Matrix4().makeBasis(east, north, up)
  return new Quaternion().setFromRotationMatrix(m)
}
