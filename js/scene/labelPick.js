import {Matrix4, Vector3} from 'three'


// A finger's slack around a label's text, in px either side.
export const LABEL_SLOP_PX = 8


/**
 * Labels on screen, for picking one with a click or tap (Scene.onClick,
 * Scene.onDblClick).
 *
 * A label is a square point sprite centred on its position, its side the
 * longer of its text's width and height, and its text drawn along the top
 * (SpriteSheet.js).  A label sheet that can be picked carries, in its
 * sprites' userData.labelTargets, what each of its labels is of, by label
 * index: {kind: 'body', name} (Planet.js), {kind: 'star', star, name}
 * (Stars.js), {kind: 'place', body, name, lat, lng, alt} (Places.js) and
 * {kind: 'asterism', name, position} (Asterisms.js).
 *
 * A sheet of surface labels (Places) also carries userData.labelBody, the
 * body they're on: the shader discards the labels on its far side, so
 * they're not boxes either.
 *
 * @param {object} root The scene graph to look in
 * @param {object} camera
 * @param {{left: number, top: number, width: number, height: number}} rect
 *   The canvas on screen (getBoundingClientRect), in CSS px
 * @param {number} [pixelRatio] Device px per CSS px; sprite sizes are device px
 * @param {object} [opts]
 * @param {boolean} [opts.hidden] Include the labels the declutter has hidden
 *   (`sheet.shown[i] === 0`), which the declutter itself needs and a pick
 *   doesn't (a hidden label is not on screen to hit)
 * @param {Function} [opts.only] Take only the sheets for which this gives
 *   true, given the sheet's Points
 * @param {number} [opts.margin] Leave out labels more than this many px
 *   off the canvas (the declutter's; a pick takes all)
 * @param {boolean} [opts.fresh] The world matrices are this frame's (after a
 *   render), so don't update them: the declutter's
 * @returns {Array<{left: number, top: number, width: number, height: number,
 *   depth: number, target: object, sheet: object, index: number,
 *   rank: number}>} Each shown label's text box on screen, CSS px, and depth
 *   (NDC z); with its sheet, its index in it and its rank
 *   (`userData.labelRank`, for the declutter: higher is more important, 0
 *   for a sheet with none)
 */
export function labelBoxes(root, camera, rect, pixelRatio = 1, opts = {}) {
  const boxes = []
  const mvp = new Matrix4()
  const inv = new Matrix4()
  const centre = new Vector3()
  const eye = new Vector3()
  const margin = opts.margin ?? Infinity
  // The camera's position once, and (when the world matrices are this
  // frame's) no walk up each sheet's parents to make them so.
  const fresh = opts.fresh === true
  const camWorld = new Vector3().setFromMatrixPosition(camera.matrixWorld)
  // Only what's shown: the label LODs hide their levels out of range.
  root.traverseVisible((obj) => {
    const sheet = obj.userData?.sheet
    const targets = obj.userData?.labelTargets
    if (!sheet || !targets || (opts.only && !opts.only(obj))) {
      return
    }
    const ranks = obj.userData.labelRank
    const shown = sheet.shown
    if (!fresh) {
      obj.updateWorldMatrix(true, false)
    }
    // A label's position to clip space in one matrix, as the sprites' shader
    // does it, and the camera and the body's centre in the sheet's own frame,
    // for the far-side test: no vector built per label.
    const m = mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(obj.matrixWorld).elements
    const body = obj.userData.labelBody
    if (body) {
      if (!fresh) {
        body.updateWorldMatrix(true, false)
      }
      inv.copy(obj.matrixWorld).invert()
      centre.setFromMatrixPosition(body.matrixWorld).applyMatrix4(inv)
      eye.copy(camWorld).applyMatrix4(inv)
    }
    const {positions, sizes, textSizes} = sheet
    const low = sheet._posLow
    for (let i = 0; i < sheet.labelCount; i++) {
      if (!targets[i] || (!opts.hidden && shown?.[i] === 0)) {
        continue
      }
      let x = positions[3 * i]
      let y = positions[(3 * i) + 1]
      let z = positions[(3 * i) + 2]
      if (low) {
        x += low[3 * i]
        y += low[(3 * i) + 1]
        z += low[(3 * i) + 2]
      }
      if (body && onFarSide(x, y, z, centre, eye)) {
        continue
      }
      const w = (m[3] * x) + (m[7] * y) + (m[11] * z) + m[15]
      const nx = ((m[0] * x) + (m[4] * y) + (m[8] * z) + m[12]) / w
      const ny = ((m[1] * x) + (m[5] * y) + (m[9] * z) + m[13]) / w
      const nz = ((m[2] * x) + (m[6] * y) + (m[10] * z) + m[14]) / w
      if (!(w > 0) || !(nz > -1 && nz < 1) || !Number.isFinite(nx) || !Number.isFinite(ny)) {
        continue // behind the camera, or past near or far
      }
      const cx = rect.left + (((nx + 1) / 2) * rect.width)
      const cy = rect.top + (((1 - ny) / 2) * rect.height)
      const side = sizes[2 * i] / pixelRatio
      const width = textSizes[2 * i] / pixelRatio
      const height = textSizes[(2 * i) + 1] / pixelRatio
      const left = cx - (side / 2)
      const top = cy - (side / 2)
      if (left + width < rect.left - margin || left > rect.left + rect.width + margin ||
          top + height < rect.top - margin || top > rect.top + rect.height + margin) {
        continue // well off the canvas, when the caller says it doesn't want them
      }
      boxes.push({left, top, width, height, depth: nz, target: targets[i], sheet, index: i, rank: ranks?.[i] ?? 0})
    }
  })
  return boxes
}


/**
 * @param {number} x A point on a body's surface, in the frame of the centre and eye
 * @param {number} y
 * @param {number} z
 * @param {Vector3} centre The body's centre
 * @param {Vector3} eye The camera
 * @returns {boolean} Whether the point is on the side of the body away from
 *   the camera (the surface normal there against the way to the camera, as
 *   the label shader tests it)
 */
function onFarSide(x, y, z, centre, eye) {
  const nx = x - centre.x
  const ny = y - centre.y
  const nz = z - centre.z
  return ((nx * (eye.x - x)) + (ny * (eye.y - y)) + (nz * (eye.z - z))) < 0
}


/**
 * The label at a point on screen: of the boxes it falls in, give or take
 * the slop, the one whose centre is nearest, then the nearest the camera.
 *
 * @param {number} x CSS px, as a pointer event's clientX
 * @param {number} y
 * @param {Array<object>} boxes As labelBoxes gives
 * @param {number} [slop] px around each box
 * @returns {object|null} The box's target, or null if none
 */
export function hitLabel(x, y, boxes, slop = LABEL_SLOP_PX) {
  let best = null
  let bestDist = Infinity
  for (const b of boxes) {
    if (x < b.left - slop || x > b.left + b.width + slop ||
        y < b.top - slop || y > b.top + b.height + slop) {
      continue
    }
    const dx = x - (b.left + (b.width / 2))
    const dy = y - (b.top + (b.height / 2))
    const dist = (dx * dx) + (dy * dy)
    if (dist < bestDist || (dist === bestDist && b.depth < best.depth)) {
      best = b
      bestDist = dist
    }
  }
  return best ? best.target : null
}

