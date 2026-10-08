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
// A round outer radius of the Milky Way's disc (scene/galaxyModel.js holds
// the model).  Camera far-plane is sized off this so the whole galaxy + a
// navigation buffer fits when zoomed out; the galaxy itself is drawn at
// the far plane, whatever the distance.
export const GALAXY_RADIUS_METER = LIGHTYEAR_METER * 5e4
// This size is chosen to allow for the maximum object and distance size range
// in the scene.  The smallest object in the scene is Mars's moon Deimos, which
// is 6.2e3m, but going a bit smaller to allow zoom in on it as well.
export const SMALLEST_SIZE_METER = 6e5
export const SUN_RADIUS_METER = 6.957e8

/** The Sun's V-band illuminance at 1 AU, lux (V = −26.74; V = 0 is 2.54e-6 lux). */
export const SUN_ILLUMINANCE_LUX = 1.27e5

/**
 * Celestiary's Sun light (Star.js): a PointLight of this luminous
 * intensity, in candela, falling off as the inverse square of the distance
 * (SUN_LIGHT_DECAY), so a surface d metres out gets I / d² lux:
 * SUN_ILLUMINANCE_LUX at 1 AU.  three's light units are then photometric
 * (cd, lux, and cd/m² for what a surface reflects), and exposure.js keys
 * the exposure to them (exposureAt).
 *
 * The falloff was 1/d^1.01 at 3.7e28, from before the exposure followed
 * the target, "so the outer planets aren't lost".  The exposure keyed to
 * the target shows any body at its albedo whatever the falloff, and the
 * kludge put bodies at other distances wrong in the same frame (Jupiter
 * 2.4 stops bright against the Moon, Neptune 4.9; Planet.md, "Lighting
 * and exposure").  Keeping its irradiance at 1 AU with d² would take an
 * intensity of 3.7e28 × AU^0.99 = 4.3e39, past float32's 3.4e38: Inf as the
 * light's uniform.  In lux the intensity is 2.8e27, and a surface's
 * irradiance from Mercury (8.5e5) to Pluto's aphelion (52 lx) is far from
 * either end of float32; the shader's d² overflows only past 2^64 m
 * (1,950 ly), where length() of the light's vector already does.  Every
 * rendered value at 1 AU is what it was: the exposure there is π·DISPLAY_GAIN
 * over the irradiance, in whatever units (exposure.js).
 */
export const SUN_LUMINOUS_INTENSITY = SUN_ILLUMINANCE_LUX * ASTRO_UNIT_METER * ASTRO_UNIT_METER
export const SUN_LIGHT_DECAY = 2

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
  // The body the camera is at: its platform's parent (Scene.goTo, land).
  cur: null,
  // The targeted body, or the body a targeted place is on (Scene.setTarget,
  // the one writer of obj and label).
  obj: null,
  // The target when it isn't a body: a place, a star or an asterism.  What
  // 'c' faces, 'g' goes to and 't' tracks, while set.
  label: null,
  pos: new Vector3,
  // Whether 't' is on: the camera faces the target every frame.
  track: false,
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
