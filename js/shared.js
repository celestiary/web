import {
  Object3D,
  Vector3,
} from 'three'

import {named} from './utils.js'


// Geom
export const twoPi = Math.PI * 2.0
export const halfPi = Math.PI / 2.0
export const toDeg = 180.0 / Math.PI
export const toRad = Math.PI / 180.0

// Phys
// Celestia star data file measures star distances in lightyears
export const LIGHTYEAR_METER = 9.461e15

// Astro
// https://en.wikipedia.org/wiki/Astronomical_unit
export const ASTRO_UNIT_METER = 149.597870700e9

// Camera
export const INITIAL_FOV = 45
// largest coords for stars in Celestia dataset
export const STARS_RADIUS_METER = LIGHTYEAR_METER * 1e4
// This size is chosen to allow for the maximum object and distance size range
// in the scene.  The smallest object in the scene is Mars's moon Deimos, which
// is 6.2e3m, but going a bit smaller to allow zoom in on it as well.
export const SMALLEST_SIZE_METER = 6e5
export const SUN_RADIUS_METER = 6.957e8

// three.js Objects
export const targets = {
  origin: new Vector3,
  cur: null,
  obj: null,
  pos: new Vector3,
  track: null,
  follow: null,
}
// for invisible LOD.
export const FAR_OBJ = named(new Object3D, 'LODFarObj')

// Colors
export const labelTextColor = '#7fa0e0'
export const labelTextFont = 'medium arial'

// Deprecated: moving to real sizes
export const LENGTH_SCALE = 1e-5 // one scene unit per million meters
export const STARS_SCALE = LIGHTYEAR_METER
