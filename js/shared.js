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
export const ASTRO_UNIT_METER = 149597870700

// Camera
export const INITIAL_FOV = 45
// largest coords for stars in Celestia dataset
export const STARS_RADIUS_METER = LIGHTYEAR_METER * 1e4
// Outer radius of the procedural Milky Way (see scene/MilkyWay.js).  Camera
// far-plane is sized off this so the whole galaxy + a navigation buffer fits
// without clipping when zoomed out.
export const GALAXY_RADIUS_METER = LIGHTYEAR_METER * 5e4
// This size is chosen to allow for the maximum object and distance size range
// in the scene.  The smallest object in the scene is Mars's moon Deimos, which
// is 6.2e3m, but going a bit smaller to allow zoom in on it as well.
export const SMALLEST_SIZE_METER = 6e5
export const SUN_RADIUS_METER = 6.957e8

/**
 * Celestiary's Sun light (Star.js): a PointLight of this intensity, whose
 * light falls off as 1/d^SUN_LIGHT_DECAY (not the physical 2; tuned so the
 * outer planets aren't lost).  exposure.js calibrates against it.
 */
export const SUN_LUMINOUS_INTENSITY = 3.7e28
export const SUN_LIGHT_DECAY = 1.01

/**
 * How bright a sunlit surface facing the Sun shows, relative to its
 * texture's albedo, in celestiary (exposure.js) and in Cesium's layers
 * alike, so the two match across the swap.  At 1 the Moon and Mars read
 * dark; this is a display choice, like a camera's exposure bias.
 */
export const DISPLAY_GAIN = 1.5

// three.js Objects
export const targets = {
  origin: new Vector3,
  cur: null,
  obj: null,
  // A label's subject that isn't a body or a committed star: a place or an
  // asterism (Scene.targetLabel).  What 'c' faces and 'g' goes to, while set.
  label: null,
  pos: new Vector3,
  track: null,
  follow: null,
  tween: null,
  tweenNextFn: null, // factory called when tween completes; creates the follow-on tween
  landed: false, // true when camera is pinned to a body surface via Scene.land
}
// for invisible LOD.
export const FAR_OBJ = named(new Object3D, 'LODFarObj')

// Colors
export const labelTextColor = '#7fa0e0'
export const labelTextFont = 'medium arial'

/**
 * three.js layer drawn after the atmosphere pass, straight to the screen
 * and depth-tested against the scene's depth, which that pass writes:
 * bodies' name labels, which the atmosphere would otherwise haze over.
 */
export const OVERLAY_LAYER = 1


/**
 * Puts a display-valued overlay (labels, asterism and expansion lines,
 * grids, the pick marker) on the overlay layer, every node of it: drawn
 * after the atmosphere pass and the exposure meter's readback, as
 * display values, depth-tested against the scene's depth.  In the scene
 * pass, through sceneReferred, their fixed values fed the meter: with
 * labels and lines on, a star field's gain settled where their pixels
 * read as the frame's 2% highlight, and the faint stars went (HDR.md,
 * "Metered exposure").  Layers aren't inherited, so each node is set.
 *
 * @param {object} object A three Object3D
 * @returns {object} The same object
 */
export function overlay(object) {
  object.traverse((node) => node.layers.set(OVERLAY_LAYER))
  return object
}

/**
 * three.js layer for redrawing a body's surface, fading, over its Cesium
 * layer as that takes over (CesiumLayers crossfade).  The scene's lights
 * join it too.
 */
export const FADE_LAYER = 2

/**
 * three.js layer for Earth's cloud shell: drawn by ThreeUi after the Cesium
 * composite, so one shell covers both sides of the swap (Planet.md,
 * "Clouds").
 */
export const CLOUD_LAYER = 3

// Deprecated: moving to real sizes
export const LENGTH_SCALE = 1e-5 // one scene unit per million meters
export const STARS_SCALE = LIGHTYEAR_METER
