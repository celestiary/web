import {Matrix4, Vector3} from 'three'
import {onFarSide} from './labelPick.js'


// A label group's look by how near or prominent each of its labels is
// (DESIGN.md, label styles): within its group, a label's text runs from the
// group's smallest size to its largest, and its brightness from 0.7 of
// the brightest to the brightest, as its prominence runs from 0 to 1.  Between
// groups the ranges stack by how near the group's labels usually are:
// satellites' smallest above bodies', above stars', and a near body's at
// the top, over every satellite's.  Satellites are the first group to use
// it (population/Population.md, names by distance).


/**
 * @typedef {object} LabelStyle
 * @property {number} near where prominence is 1: a distance, m, or any
 *   measure that is smaller for the more prominent
 * @property {number} far where it is 0
 * @property {'fixed'|'view'} [range] `fixed` (the default): near and far as
 *   given; `view`: the nearest and farthest of the group's labels in view
 *   each frame (in the frustum, not behind their body), near and far as
 *   given standing in while none is
 * @property {[number, number]} size the text's height at prominence 0 and 1,
 *   px (the sheet's font units, in which 'medium' is 16)
 * @property {[number, number]} brightness at prominence 0 and 1 (the
 *   dimmest 0.7 of the brightest, the maintainer's choice on PR #299)
 * @property {'log'|'linear'} [interpolation] how the measure maps between
 *   near and far: by its logarithm (the default) or as it is
 * @property {number} [minSpan] a linear view range's least span, in the
 *   measure's units (a log one's far end is at least 1.1 times its near)
 */


/**
 * Earth's satellites: by their distance from the camera, from the nearest
 * of their names in view to the farthest (1,000 km to 50,000 km while none
 * is).
 */
export const SATELLITE_LABELS = {near: 1e6, far: 5e7, range: 'view', size: [11, 14], brightness: [0.7, 1]}


/**
 * Stars: by their apparent magnitude from the camera, from the brightest of
 * their names in view to the faintest, at least a magnitude apart
 * (magnitudes are a logarithm already, so linear); the naked eye's -1.5 to
 * 6.5 while none is.  The faintest groups' sizes (DESIGN.md, label styles).
 */
export const STAR_LABELS = {near: -1.5, far: 6.5, range: 'view', interpolation: 'linear', minSpan: 1,
  size: [9, 13], brightness: [0.7, 1]}


// The least ratio of far to near a log view range spans.
const MIN_SPREAD = 1.1


/**
 * @param {Array<number>} measures the labels' in view (their distances)
 * @param {LabelStyle} style
 * @returns {{near: number, far: number}} the range to map them by: the
 *   style's own for a fixed range or nothing in view; else the nearest and
 *   farthest, the far end at least a tenth farther than the near so a
 *   lone label or a tight cluster isn't stretched across the whole range
 */
export function viewRange(measures, style) {
  if (style.range !== 'view' || measures.length === 0) {
    return {near: style.near, far: style.far}
  }
  let near = Infinity
  let far = 0
  for (const m of measures) {
    near = Math.min(near, m)
    far = Math.max(far, m)
  }
  return {near, far: style.interpolation === 'linear' ? Math.max(far, near + (style.minSpan ?? 0)) :
    Math.max(far, near * MIN_SPREAD)}
}


/**
 * @param {number} x the label's measure (its distance from the camera)
 * @param {LabelStyle} style
 * @returns {number} its prominence, 1 at `near` or nearer, 0 at `far` or farther
 */
export function prominence(x, style) {
  // A logarithm's measure above 0; a linear one as it is (a magnitude can be
  // under 0: Sirius's -1.46).
  const log = style.interpolation !== 'linear'
  const f = log ? (v) => Math.log(Math.max(v, Number.MIN_VALUE)) : (v) => v
  const t = (f(style.far) - f(x)) / (f(style.far) - f(style.near))
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
}


/**
 * @param {number} p prominence, 0 to 1
 * @param {LabelStyle} style
 * @returns {{size: number, scale: number, brightness: number}} the text's
 *   height, px; that as a scale of the largest (SpriteSheet.setStyle); and
 *   its brightness
 */
export function labelLook(p, style) {
  const [s0, s1] = style.size
  const [b0, b1] = style.brightness
  const size = s0 + ((s1 - s0) * p)
  return {size, scale: size / s1, brightness: b0 + ((b1 - b0) * p)}
}


/**
 * @param {LabelStyle} style
 * @returns {string} the font a scalable sheet draws its text in: at its
 *   largest, made smaller per label
 */
export function labelFont(style) {
  return `${style.size[1]}px arial`
}


/**
 * Bodies: by how large they look, their distance over their radius, from the
 * largest-looking name in view to the smallest (3 to 100,000 radii while none
 * is).  The highest most of any group: a near body's name is the largest.
 */
export const BODY_LABELS = {near: 3, far: 1e5, range: 'view', size: [10, 18], brightness: [0.7, 1]}


/**
 * Places: by their distance from the camera, from the nearest name in view
 * to the farthest (1 km to 10,000 km while none is).
 */
export const PLACE_LABELS = {near: 1e3, far: 1e7, range: 'view', size: [10, 14], brightness: [0.7, 1]}


// What a group's view range moves toward this frame's, of the way.
const RANGE_EASE = 0.25
// Each styled group's range, eased frame to frame, by its style.
const ranges = new WeakMap()
const tmpMvp = new Matrix4()
const tmpInv = new Matrix4()
const tmpPos = new Vector3()
const tmpCam = new Vector3()
const tmpEye = new Vector3()
const tmpCentre = new Vector3()


/**
 * Style the label sheets that ask for it, each group together (bodies'
 * names, places'): run once a frame before the declutter, so it sees each
 * label at its size.  A sheet asks with `userData.labelStyle` (its group's
 * LabelStyle, shared by the group's sheets) and `userData.labelMeasure(i,
 * camWorld, worldPos)` (a label's measure: a body's distance over its
 * radius, a place's distance); `userData.labelRankOf(p)`, if it has one,
 * sets the label's rank from its prominence.  A group's view range is over
 * its labels in view (in front of the camera, within the canvas, not on the
 * far side of their body), eased a quarter of the way each frame.
 *
 * @param {object} root The scene graph
 * @param {object} camera
 */
export function styleLabels(root, camera) {
  const groups = new Map()
  camera.getWorldPosition(tmpCam)
  const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  root.traverseVisible((obj) => {
    const style = obj.userData?.labelStyle
    const sheet = obj.userData?.sheet
    const measure = obj.userData?.labelMeasure
    if (!style || !sheet?.setStyle || !measure) {
      return
    }
    tmpMvp.multiplyMatrices(vp, obj.matrixWorld)
    const body = obj.userData.labelBody
    if (body) {
      tmpInv.copy(obj.matrixWorld).invert()
      tmpCentre.setFromMatrixPosition(body.matrixWorld).applyMatrix4(tmpInv)
      tmpEye.copy(tmpCam).applyMatrix4(tmpInv)
    }
    let g = groups.get(style)
    if (!g) {
      g = {labels: [], inView: []}
      groups.set(style, g)
    }
    for (let i = 0; i < sheet.labelCount; i++) {
      const p = tmpPos.fromArray(sheet.positions, 3 * i)
      const farSide = body && onFarSide(p.x, p.y, p.z, tmpCentre, tmpEye)
      // To clip space, as the sprites' shader does, before the measure moves p.
      const e = tmpMvp.elements
      const w = (e[3] * p.x) + (e[7] * p.y) + (e[11] * p.z) + e[15]
      const nx = ((e[0] * p.x) + (e[4] * p.y) + (e[8] * p.z) + e[12]) / w
      const ny = ((e[1] * p.x) + (e[5] * p.y) + (e[9] * p.z) + e[13]) / w
      const m = measure(i, tmpCam, p.applyMatrix4(obj.matrixWorld))
      g.labels.push({obj, sheet, i, m})
      if (!farSide && w > 0 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1) {
        g.inView.push(m)
      }
    }
  })
  for (const [style, g] of groups) {
    const goal = viewRange(g.inView, style)
    const was = ranges.get(style)
    const range = was && g.inView.length > 0 ? {
      near: was.near + ((goal.near - was.near) * RANGE_EASE),
      far: was.far + ((goal.far - was.far) * RANGE_EASE),
    } : (g.inView.length > 0 ? goal : (was ?? goal))
    ranges.set(style, range)
    const mapped = {...style, ...range}
    for (const {obj, sheet, i, m} of g.labels) {
      const p = prominence(m, mapped)
      const {scale, brightness} = labelLook(p, style)
      sheet.setStyle(i, scale, brightness)
      const rankOf = obj.userData.labelRankOf
      if (rankOf && obj.userData.labelRank) {
        obj.userData.labelRank[i] = rankOf(p)
      }
    }
  }
}


/**
 * Forget the groups' eased ranges (tests).
 *
 * @param {LabelStyle} style
 */
export function resetRange(style) {
  ranges.delete(style)
}
