import {Vector3} from 'three'


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
 * @returns {Array<{left: number, top: number, width: number, height: number,
 *   depth: number, target: object}>} Each shown label's text box on screen,
 *   CSS px, and depth (NDC z)
 */
export function labelBoxes(root, camera, rect, pixelRatio = 1) {
  const boxes = []
  const v = new Vector3()
  const centre = new Vector3()
  const eye = new Vector3()
  // Only what's shown: the label LODs hide their levels out of range.
  root.traverseVisible((obj) => {
    const sheet = obj.userData?.sheet
    const targets = obj.userData?.labelTargets
    if (!sheet || !targets) {
      return
    }
    obj.updateWorldMatrix(true, false)
    const body = obj.userData.labelBody
    if (body) {
      body.getWorldPosition(centre)
      camera.getWorldPosition(eye)
    }
    const {positions, sizes, textSizes} = sheet
    const low = sheet._posLow
    for (let i = 0; i < sheet.labelCount; i++) {
      if (!targets[i]) {
        continue
      }
      v.set(positions[3 * i], positions[(3 * i) + 1], positions[(3 * i) + 2])
      if (low) {
        v.x += low[3 * i]
        v.y += low[(3 * i) + 1]
        v.z += low[(3 * i) + 2]
      }
      v.applyMatrix4(obj.matrixWorld)
      if (body && onFarSide(v, centre, eye)) {
        continue
      }
      v.project(camera)
      if (!(v.z > -1 && v.z < 1) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
        continue // behind the camera, or past near or far
      }
      const cx = rect.left + (((v.x + 1) / 2) * rect.width)
      const cy = rect.top + (((1 - v.y) / 2) * rect.height)
      const side = sizes[2 * i] / pixelRatio
      boxes.push({
        left: cx - (side / 2),
        top: cy - (side / 2),
        width: textSizes[2 * i] / pixelRatio,
        height: textSizes[(2 * i) + 1] / pixelRatio,
        depth: v.z,
        target: targets[i],
      })
    }
  })
  return boxes
}


/**
 * @param {Vector3} point A point on a body's surface, world space
 * @param {Vector3} centre The body's centre
 * @param {Vector3} eye The camera
 * @returns {boolean} Whether the point is on the side of the body away from
 *   the camera (the surface normal there against the way to the camera, as
 *   the label shader tests it)
 */
function onFarSide(point, centre, eye) {
  const nx = point.x - centre.x
  const ny = point.y - centre.y
  const nz = point.z - centre.z
  return ((nx * (eye.x - point.x)) + (ny * (eye.y - point.y)) + (nz * (eye.z - point.z))) < 0
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

