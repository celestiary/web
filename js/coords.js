import {Quaternion, Vector3} from 'three'
import {toDeg, toRad} from './shared.js'


/**
 * Convert a camera world position to geographic coordinates relative to a
 * rotating planet body.
 *
 * The planet's world quaternion (which includes axial tilt and sidereal
 * rotation) defines the body-fixed frame: Y = rotation axis (north pole),
 * +X = lng=0 prime meridian (matches the equirectangular texture's u=0.5
 * convention via Three.js SphereGeometry), east-positive longitude winds
 * toward −Z.
 *
 * @param {Vector3} camWorldPos Camera world position
 * @param {Vector3} planetWorldPos Planet center world position
 * @param {Quaternion} planetWorldQuat Planet world quaternion (includes sidereal rotation)
 * @param {number} planetRadius Planet radius in meters
 * @returns {{lat: number, lng: number, alt: number}}
 */
export function worldToLatLngAlt(camWorldPos, planetWorldPos, planetWorldQuat, planetRadius) {
  const rel = camWorldPos.clone().sub(planetWorldPos)
  rel.applyQuaternion(new Quaternion().copy(planetWorldQuat).invert())
  const r = rel.length()
  const lat = Math.asin(Math.max(-1, Math.min(1, rel.y / r))) * toDeg
  // Inverse of latLngAltToBodyFixed: x = cos(lat)·cos(lng), −z = cos(lat)·sin(lng)
  // ⇒ lng = atan2(−z, x).
  const lng = Math.atan2(-rel.z, rel.x) * toDeg
  const alt = r - planetRadius
  return {lat, lng, alt}
}


/**
 * Convert geographic coordinates to a body-fixed XYZ vector — no orientation
 * applied.  Used when positions will live in a scene-graph subtree that
 * already inherits the body's axial tilt + sidereal rotation (e.g. children
 * of the rotating Planet Object3D).
 *
 * Frame: Y = north pole; +X = prime meridian (lng=0); east-positive longitude
 * winds toward −Z.  This matches Three.js's default SphereGeometry UV
 * mapping for equirectangular textures (u=0.5 → +X), so labels placed via
 * this function line up with the body's surface texture.
 *
 * @param {number} lat Latitude in degrees
 * @param {number} lng Longitude in degrees, east-positive
 * @param {number} alt Altitude above surface in meters
 * @param {number} planetRadius Planet radius in meters
 * @returns {Vector3}
 */
export function latLngAltToBodyFixed(lat, lng, alt, planetRadius) {
  const r = planetRadius + alt
  const latRad = lat * toRad
  const lngRad = lng * toRad
  return new Vector3(
      r * Math.cos(latRad) * Math.cos(lngRad),
      r * Math.sin(latRad),
      -r * Math.cos(latRad) * Math.sin(lngRad),
  )
}


/**
 * Convert geographic coordinates back to camera position in platform-local
 * space.
 *
 * The camera platform is parented to the planet's orbitPosition (at world
 * position ≈ planet center) with no translation offset.  Platform-local
 * camera position = R_platform⁻¹ · R_sidereal · bodyFixed.
 *
 * @param {number} lat Latitude in degrees
 * @param {number} lng Longitude in degrees
 * @param {number} alt Altitude above surface in meters
 * @param {number} planetRadius Planet radius in meters
 * @param {Quaternion} planetWorldQuat Planet world quaternion (includes sidereal rotation)
 * @param {Quaternion} platformWorldQuat Camera platform world quaternion
 * @returns {Vector3} Camera position in platform-local space
 */
export function latLngAltToLocal(lat, lng, alt, planetRadius, planetWorldQuat, platformWorldQuat) {
  const v = latLngAltToBodyFixed(lat, lng, alt, planetRadius)
  // body-fixed → world-relative (relative to planet center)
  v.applyQuaternion(planetWorldQuat)
  // world-relative → platform-local
  v.applyQuaternion(new Quaternion().copy(platformWorldQuat).invert())
  return v
}
