import {AdditiveBlending, Color, LOD, LinearSRGBColorSpace, Matrix4} from 'three'
import {DISPLAY_GAIN, INITIAL_FOV, toRad} from '../shared.js'
import {named} from '../utils.js'
import {neutral} from './hdr.js'
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


/**
 * Over this many times the distance at which the mesh takes over, the
 * point is the marker; nearer, its light goes over to the disc's (the
 * hand-off, farPointLevel).
 */
export const POINT_HANDOFF_RANGE = 4


/**
 * A Lambert sphere's light at a phase angle over its light at full phase:
 * (sin α + (π − α) cos α) / π.
 *
 * @param {number} phaseAngle Radians, Sun-body-camera
 * @returns {number} 1 at full, 0 at new
 */
export function lambertPhase(phaseAngle) {
  const a = Math.min(Math.max(phaseAngle, 0), Math.PI)
  return (Math.sin(a) + ((Math.PI - a) * Math.cos(a))) / Math.PI
}


/**
 * A sunlit body's mean value over its disc, in exposure units: its colour
 * map's mean stored value lit as a Lambert sphere (2/3 of the subsolar
 * value at full phase, times lambertPhase), at the exposure the frame
 * renders with over the body's own keyed one.
 *
 * @param {number} storedLuma Its colour map's mean, luma, times texture_gain
 * @param {number} exposureOverKeyed toneMappingExposure over exposureAt the
 *   body's distance from the Sun
 * @param {number} phaseAngle Radians
 * @returns {number}
 */
export function discMeanValue(storedLuma, exposureOverKeyed, phaseAngle) {
  return storedLuma * DISPLAY_GAIN * exposureOverKeyed * (2 / 3) * lambertPhase(phaseAngle)
}


/**
 * The light a disc a few pixels across shows, summed over its pixels in
 * display values: its core, the pixels it covers, at the tone map of its
 * mean value, and its rim, the pixels it partly covers, at the tone map
 * of their share of it (smallDisc.js scales a pixel's value by its
 * coverage before the tone map, whose toe darkens a dim pixel more).
 *
 * @param {number} radiusPx The disc's, in buffer px
 * @param {number} value Its mean value, exposure units (discMeanValue)
 * @returns {number} Display value × px
 */
export function discFlux(radiusPx, value) {
  if (!(radiusPx > 0) || !(value > 0)) {
    return 0
  }
  const area = Math.PI * radiusPx * radiusPx
  const core = Math.PI * (Math.max(radiusPx - 0.5, 0) ** 2)
  const ring = (Math.PI * ((radiusPx + 0.5) ** 2)) - core
  const coverage = (area - core) / ring
  const n = (v) => neutral([v, v, v])[0]
  return (core * n(value)) + (ring * n(coverage * value))
}


/**
 * The far point's display level: the marker's (1 for a planet,
 * MOON_POINT_LEVEL for a moon) while the body is far, and the light the
 * disc would show, spread over the point's pixels, where the mesh takes
 * over, blended between over POINT_HANDOFF_RANGE of distance.  So at the
 * hand-off the point and the disc carry the same light, and a body
 * approached doesn't dim from a white marker to its disc (Mars at its
 * arrival exposure: 3.75 to 0.5, 7 times, before this; DESIGN.md, "The
 * far point").  The disc's light is its own at this distance,
 * not the hand-off's, so farther in the blend it falls as the disc's
 * would.
 *
 * @param {object} p
 * @param {number} p.marker The marker's level
 * @param {number} p.radiusPx The disc's radius were it drawn, buffer px
 * @param {number} p.value discMeanValue
 * @param {number} p.ratio The distance over the mesh's reach (1 at the
 *   hand-off, more while the point is drawn)
 * @param {number} p.pointPx The point's size, buffer px
 * @returns {number} 0 to the marker's level, or to 1
 */
export function farPointLevel({marker, radiusPx, value, ratio, pointPx}) {
  const disc = Math.min(discFlux(radiusPx, value) / Math.max(pointPx * pointPx, 1), 1)
  const t = Math.min(Math.max(Math.log(Math.max(ratio, 1)) / Math.log(POINT_HANDOFF_RANGE), 0), 1)
  const w = t * t * (3 - (2 * t))
  return disc + ((marker - disc) * w)
}


/**
 * @param {number} distance The camera's from the body, metres
 * @param {number} radius The body's, metres
 * @param {{fov: number}} camera
 * @returns {number} The distance over the one at which the planet LOD
 *   (FovLOD, drawnSize) hands the point over to the mesh: 1 there
 */
export function handoffRatio(distance, radius, camera) {
  return distance * fovScale(camera) / (pointSwitchDistance(radius) * meshReach())
}
