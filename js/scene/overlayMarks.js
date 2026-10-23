import {Quaternion, Vector2, Vector3} from 'three'
import SpriteSheet from './SpriteSheet.js'


// Helpers the marks of orbital space share (LagrangeMarks, RegimeMarks):
// unit outlines, labels, screen sizes and spheres' outlines as seen.


/** The vertices of a unit circle (unitCircle), and so of every ring. */
export const RING_POINTS = 129
const noRaycast = () => undefined
const Y_AXIS = new Vector3(0, 1, 0)
const tmpQ = new Quaternion
const tmpV = new Vector3
const tmpCam = new Vector3
const tmpRes = new Vector2


/**
 * @param {number} color
 * @returns {string} as a canvas takes it
 */
export function cssColor(color) {
  return `#${color.toString(16).padStart(6, '0')}`
}


/**
 * A unit circle in the XZ plane, from +X toward -Z (prograde).
 *
 * @returns {Float32Array}
 */
export function unitCircle() {
  return unitEllipse(0)
}


/**
 * An ellipse in units of its semi-major axis, a focus at the origin, the
 * pericentre on +X, in the XZ plane, from +X toward -Z, as Planet.newOrbit
 * and the orbit diagram draw orbits.
 *
 * @param {number} e eccentricity
 * @returns {Float32Array}
 */
export function unitEllipse(e) {
  const out = new Float32Array(RING_POINTS * 3)
  const b = Math.sqrt(1 - (e * e))
  for (let k = 0; k < RING_POINTS; k++) {
    const E = 2 * Math.PI * k / (RING_POINTS - 1)
    out[3 * k] = Math.cos(E) - e
    out[(3 * k) + 2] = -b * Math.sin(E)
  }
  return out
}


/**
 * @param {Array<{text: string, color: number, at: ?Array<number>}>} entries
 * @returns {{sheet: SpriteSheet, sprites: object}} the sheet, and its
 *     sprites, never culled or picked
 */
export function newLabels(entries) {
  const sheet = new SpriteSheet(entries.length, entries.map((l) => l.text))
  for (const l of entries) {
    sheet.add(...(l.at ?? [0, 0, 0]), l.text, cssColor(l.color))
  }
  const sprites = sheet.compile()
  sprites.frustumCulled = false
  sprites.raycast = noRaycast
  return {sheet, sprites}
}


/**
 * @param {object} renderer
 * @param {object} camera a perspective camera
 * @param {Vector3} at a world position
 * @returns {number} how many pixels a metre across at `at` spans
 */
export function pixelsPerMetre(renderer, camera, at) {
  const target = renderer.getRenderTarget()
  const height = target ? target.height / renderer.getPixelRatio() : renderer.getSize(tmpRes).y
  const dist = camera.getWorldPosition(tmpCam).distanceTo(at)
  return height / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(dist, 1))
}


/**
 * Where a sphere's outline is, seen from an eye: the circle where the lines
 * of sight graze it.  It is nearer the eye than the centre, by R²/d, and
 * smaller than the sphere, R √(1 − R²/d²); a circle of radius R at the
 * centre would stand out past the true outline up close.
 *
 * @param {number} radius R
 * @param {number} dist d, the eye's distance from the centre
 * @returns {?{offset: number, radius: number}} null from inside
 */
export function silhouette(radius, dist) {
  if (!(dist > radius)) {
    return null
  }
  const k = radius / dist
  return {offset: radius * k, radius: radius * Math.sqrt(1 - (k * k))}
}


/**
 * Lay a unit circle in its XZ plane (a child of `anchor`, which is at the
 * sphere's centre and not scaled) on a sphere's outline as the camera sees
 * it.  Called from the circle's onBeforeRender, so it doesn't hide the
 * circle (a hidden node isn't drawn, and so isn't asked again): from
 * inside, the caller draws it transparent.
 *
 * @param {object} circle the circle's node
 * @param {object} anchor its parent, at the sphere's centre
 * @param {number} radius the sphere's
 * @param {object} camera
 * @returns {?object} silhouette(), or null from inside
 */
export function faceOutline(circle, anchor, radius, camera) {
  const centre = anchor.getWorldPosition(tmpV)
  const toEye = camera.getWorldPosition(tmpCam).sub(centre)
  const s = silhouette(radius, toEye.length())
  if (!s) {
    return null
  }
  // The eye's direction in the anchor's frame.
  toEye.normalize().applyQuaternion(anchor.getWorldQuaternion(tmpQ).invert())
  circle.quaternion.setFromUnitVectors(Y_AXIS, toEye)
  circle.position.copy(toEye).multiplyScalar(s.offset)
  circle.scale.setScalar(s.radius)
  // The renderer takes the model-view matrix after onBeforeRender.
  circle.updateMatrixWorld(true)
  return s
}
