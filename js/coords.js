import {Quaternion, Vector3} from 'three'
import {toDeg, toRad} from './shared.js'


/**
 * Convert a camera world position to geographic coordinates relative to a
 * rotating planet body.
 *
 * The planet's world quaternion (which includes axial tilt and sidereal
 * rotation) defines the body-fixed frame: Y = rotation axis (north pole),
 * X/Z = equatorial plane.
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
  const lng = Math.atan2(rel.x, rel.z) * toDeg
  const alt = r - planetRadius
  return {lat, lng, alt}
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
  const r = planetRadius + alt
  const latRad = lat * toRad
  const lngRad = lng * toRad
  const bodyFixed = new Vector3(
      r * Math.cos(latRad) * Math.sin(lngRad),
      r * Math.sin(latRad),
      r * Math.cos(latRad) * Math.cos(lngRad),
  )
  // body-fixed → world-relative (relative to planet center)
  bodyFixed.applyQuaternion(planetWorldQuat)
  // world-relative → platform-local
  bodyFixed.applyQuaternion(new Quaternion().copy(platformWorldQuat).invert())
  return bodyFixed
}
