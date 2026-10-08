import {AdditiveBlending, Color, LOD, LinearSRGBColorSpace, Matrix4} from 'three'
import {INITIAL_FOV, toRad} from '../shared.js'
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
 * How much nearer a body looks than it is, at the camera's field of view:
 * the ratio of its tangent half-angle to the one at INITIAL_FOV, which
 * the distances here were tuned at (45° over 640 px).  A body at distance d
 * is as big on screen as one at `d * fovScale(camera)` at 45°, so narrowing
 * the FOV (the zoom: it moves nothing) brings the mesh in at a greater
 * distance, and widening it, a lesser.  1 at INITIAL_FOV.
 *
 * @param {{fov: number}} camera
 * @returns {number}
 */
export function fovScale(camera) {
  return Math.tan(camera.fov * toRad / 2) / Math.tan(INITIAL_FOV * toRad / 2)
}


/** The canvas height the distances here were tuned at, in px. */
export const REFERENCE_HEIGHT_PX = 640

const drawing = {heightPx: REFERENCE_HEIGHT_PX, pixelRatio: 1}


/**
 * The drawing buffer the scene renders to, for meshReach.  ThreeUI sets it
 * on every resize.
 *
 * @param {number} heightPx The buffer's height, in its own px
 * @param {number} pixelRatio Buffer px per CSS px
 */
export function setDrawingBuffer(heightPx, pixelRatio) {
  drawing.heightPx = heightPx > 0 ? heightPx : REFERENCE_HEIGHT_PX
  drawing.pixelRatio = pixelRatio > 0 ? pixelRatio : 1
}


/**
 * How much farther than POINT_AT_RADII (scaled by fovScale) a body stays a
 * mesh on this canvas: out to where its disc is the far point's size
 * (PLANET_POINT_PX CSS px), so the point only stands in once the disc is
 * smaller than it.  500 radii is a disc 3.1 px across at 45° over 640 px,
 * and 4.2 px over 879 (8.5 over 1,758, a Retina screen's buffer if the
 * renderer drew at its pixel ratio): over 879, Jupiter from Earth, 4 px
 * across, turned into a 2 px white square as the field widened past 1.9°
 * (#192).  Now it's a disc down to 2 px (smallDisc.js draws it smooth).
 * Never under 1: a small
 * canvas keeps the old range, which CesiumLayers.meshRange shares (beyond
 * it, the body's own mesh draws, Cesium's layer off).
 *
 * @returns {number} At least 1
 */
export function meshReach() {
  const diameterAt500 = (2 / POINT_AT_RADII) / (2 * Math.tan(INITIAL_FOV * toRad / 2)) * drawing.heightPx
  return Math.max(1, diameterAt500 / (PLANET_POINT_PX * drawing.pixelRatio))
}


/**
 * three's LOD picks a level by distance / camera.zoom, which ignores the
 * FOV, so a body zoomed on by narrowing the FOV stayed a point however big
 * it drew.  This one picks by apparent size: the distance is scaled by
 * `fovScale`, as if zoomed by 1/scale.  LOD.update reads only the camera's
 * matrixWorld and zoom, so it's handed those with the zoom divided by the
 * scale.  With `drawnSize` (the planet LOD), the distances are scaled by
 * meshReach too, to the canvas's own pixels.
 */
export class FovLOD extends LOD {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.drawnSize] Scale by meshReach too
   */
  constructor({drawnSize = false} = {}) {
    super()
    this.drawnSize = drawnSize
  }


  /** @param {object} camera */
  update(camera) {
    if (this.levels.length > 1) {
      _cam.matrixWorld = camera.matrixWorld
      _cam.zoom = camera.zoom / fovScale(camera) * (this.drawnSize ? meshReach() : 1)
      super.update(_cam)
    }
  }
}

const _cam = {matrixWorld: new Matrix4(), zoom: 1}


/**
 * @param {number} surfaceRadius The body's radius in metres
 * @returns {number} The camera distance past which the body is a point, at
 *   INITIAL_FOV (see fovScale)
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
    // exposure (~4e-5, a sunlit white's lux over its own) made it black.
    toneMapped: false,
  }
}


/**
 * @param {boolean} isMoon
 * @returns {object} The Points: one vertex, at the body's centre
 */
export function newFarPoint(isMoon) {
  // Through point(): where a display-referred material is wrapped for the
  // HDR pipeline (hdr.js sceneReferred), so the marker's colour comes out
  // of the final tone map unchanged.
  return named(point(farPointOptions(isMoon)), 'far point')
}
