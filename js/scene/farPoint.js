import {AdditiveBlending, Color, LinearSRGBColorSpace} from 'three'
import {named} from '../utils.js'
import {point} from './shapes.js'


/**
 * The far point: the marker drawn for a planet or moon once it's too small
 * to draw as a mesh (Planet.newPlanet's planet LOD).  See DESIGN.md, "The
 * far point".
 */


/** Radii out to which a body is drawn as a mesh; a point beyond. */
export const POINT_AT_RADII = 500

/** A planet's point: white, this many px across (CSS px, not buffer px). */
export const PLANET_POINT_PX = 2

/**
 * A moon's point: the same size but dimmer, as many sit by their planet's
 * point.  A display value (see farPointColor), so it's the brightness the
 * pixel shows.
 */
export const MOON_POINT_PX = 2
export const MOON_POINT_LEVEL = 0.5


/**
 * @param {number} surfaceRadius The body's radius in metres
 * @returns {number} The camera distance past which the body is a point
 */
export function pointSwitchDistance(surfaceRadius) {
  return surfaceRadius * POINT_AT_RADII
}


/**
 * The point's colour as a display value: the pixel it puts in the frame,
 * whatever the working colour space.  The scene is drawn unencoded
 * (ThreeUI: outputColorSpace is linear), so a hex colour like 0x808080,
 * which three reads as sRGB and converts to linear, showed a moon's point
 * at 22%, not 50%: one dim pixel, lost among the stars.
 *
 * @param {number} level 0 to 1
 * @returns {Color}
 */
export function farPointColor(level) {
  return new Color().setRGB(level, level, level, LinearSRGBColorSpace)
}


/**
 * @param {boolean} isMoon
 * @returns {object} PointsMaterial parameters
 */
export function farPointOptions(isMoon) {
  return {
    color: farPointColor(isMoon ? MOON_POINT_LEVEL : 1),
    // three scales this by the renderer's pixel ratio, so it's CSS px: at
    // least one drawn pixel at any display density.
    size: isMoon ? MOON_POINT_PX : PLANET_POINT_PX,
    sizeAttenuation: false,
    blending: AdditiveBlending,
    transparent: true,
    // Hidden behind what's nearer, as a moon behind its planet: tested
    // against the depth of the opaque meshes, which three draws before the
    // transparent ones.  It writes none, so points don't hide one another
    // (and a point's own body has no mesh when it's drawn).
    depthTest: true,
    depthWrite: false,
    // A marker, not a lit surface: tone mapping at the target-keyed
    // exposure (~1e-17) made it black.
    toneMapped: false,
  }
}


/**
 * @param {boolean} isMoon
 * @returns {object} The Points: one vertex, at the body's centre
 */
export function newFarPoint(isMoon) {
  return named(point(farPointOptions(isMoon)), 'far point')
}
