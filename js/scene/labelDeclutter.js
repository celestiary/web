import {labelBoxes} from './labelPick.js'


// Space kept between two labels' text, px: two that would touch are one too
// many.
export const GAP_PX = 3

// A label whose box is farther than this off the canvas takes no part: it
// can't touch what is on it, and is judged again when it comes into view.
const OFF_CANVAS_PX = 120

// The grid the overlap test files boxes in, px a side: about a label's width,
// so a box meets few others.
const CELL_PX = 96


/**
 * How much a label matters when two touch (`userData.labelRank` of its
 * sheet, by label index; higher wins).  One scale for every kind of label
 * that takes part, so a place never hides a body's name:
 * - a body: 1000 + log10 of its radius in metres, so the larger body wins
 *   (Jupiter over Ganymede, over Io), 1003 for a 1 km moon to 1011 for the
 *   Sun;
 * - a place: 4 - its tier + its place in the tier, which the catalogue
 *   orders largest first (below 1000, whatever a body's size).
 * The target's label is above all of these, by `isTargetLabel`.
 */
export const BODY_RANK = 1000


/**
 * @param {number} radiusM A body's radius
 * @returns {number} The rank of its name
 */
export function bodyRank(radiusM) {
  return BODY_RANK + Math.log10(Math.max(radiusM, 1))
}


/**
 * @param {number} tier 0 (the most prominent) to 3
 * @param {number} index The place's position in its tier, 0 the largest
 * @param {number} count How many places the tier has
 * @returns {number} The rank of its name: 1..4, below any body's
 */
export function placeRank(tier, index, count) {
  return (4 - tier) + (0.99 * (1 - (index / Math.max(count, 1))))
}


/**
 * @param {object} target A label's target (labelPick.js)
 * @param {{obj: ?object, label: ?object}} current The scene's target
 *   (`Shared.targets`): `obj` the targeted body, or a targeted place's body;
 *   `label` the target when it isn't a body
 * @returns {boolean} Whether the label is of the target
 */
export function isTargetLabel(target, current) {
  if (target.kind === 'body') {
    return !current.label && current.obj?.props?.name === target.name
  }
  if (target.kind === 'place') {
    const l = current.label
    return l?.kind === 'place' && l.body === target.body && l.name === target.name
  }
  return false
}


/**
 * @param {{left: number, top: number, width: number, height: number}} a
 * @param {{left: number, top: number, width: number, height: number}} b
 * @param {number} [gap] px
 * @returns {boolean} Whether the boxes touch, or are within `gap` of it
 */
export function boxesTouch(a, b, gap = GAP_PX) {
  return a.left < b.left + b.width + gap && b.left < a.left + a.width + gap &&
      a.top < b.top + b.height + gap && b.top < a.top + a.height + gap
}


/**
 * Which labels are drawn: each in turn, most important first, if it touches
 * none already drawn.  A greedy pass over a grid, so the cost goes as the
 * number of labels, not its square.
 *
 * @param {Array<{left: number, top: number, width: number, height: number}>} boxes
 *   Most important first
 * @param {number} [gap] px
 * @returns {Uint8Array} 1 where the box is drawn, by index in `boxes`
 */
export function declutter(boxes, gap = GAP_PX) {
  const shown = new Uint8Array(boxes.length)
  const grid = new Map
  const reach = gap / 2
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    // The cells the box, grown by the gap, falls in.
    const x0 = Math.floor((b.left - reach) / CELL_PX)
    const x1 = Math.floor((b.left + b.width + reach) / CELL_PX)
    const y0 = Math.floor((b.top - reach) / CELL_PX)
    const y1 = Math.floor((b.top + b.height + reach) / CELL_PX)
    let clear = true
    for (let cy = y0; clear && cy <= y1; cy++) {
      for (let cx = x0; clear && cx <= x1; cx++) {
        const cell = grid.get(cellKey(cx, cy))
        if (!cell) {
          continue
        }
        for (const j of cell) {
          if (boxesTouch(b, boxes[j], gap)) {
            clear = false
            break
          }
        }
      }
    }
    if (!clear) {
      continue
    }
    shown[i] = 1
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = cellKey(cx, cy)
        const cell = grid.get(key)
        if (cell) {
          cell.push(i)
        } else {
          grid.set(key, [i])
        }
      }
    }
  }
  return shown
}


/** @returns {number} A key for a cell of the grid, cells being a few hundred a side at most */
function cellKey(cx, cy) {
  return ((cy + 32768) * 65536) + cx + 32768
}


/**
 * Hide the labels that would touch a more important one, and show those
 * that no longer do.  Run once a frame, after the scene has been drawn (so
 * the world matrices are this frame's) and before the overlay pass that
 * draws the labels.  Only the sheets that opt in take part
 * (`userData.declutter`: the bodies' names and the places', whose labels
 * are many and move with the camera); others are drawn as they are, and
 * neither hide nor are hidden.
 *
 * Order, most important first: the target's label; then by rank
 * (`userData.labelRank`: the larger body, the larger feature); then the
 * nearer the camera.  Nothing changes for labels that touch none.
 *
 * @param {object} root The scene graph
 * @param {object} camera
 * @param {{left: number, top: number, width: number, height: number}} rect
 *   The canvas, CSS px (only its size matters)
 * @param {object} [opts]
 * @param {number} [opts.pixelRatio]
 * @param {{obj: ?object, label: ?object}} [opts.current] The scene's target
 * @param {number} [opts.gap]
 * @returns {{labels: number, hidden: number, changed: number}} How many took
 *   part, how many of those are hidden, and how many changed since last time
 */
export function declutterLabels(root, camera, rect, {pixelRatio = 1, current = {}, gap = GAP_PX} = {}) {
  const boxes = labelBoxes(root, camera, rect, pixelRatio,
      {hidden: true, only: (obj) => obj.userData.declutter, margin: OFF_CANVAS_PX, fresh: true})
  for (const b of boxes) {
    b.first = isTargetLabel(b.target, current)
  }
  boxes.sort(byImportance)
  const shown = declutter(boxes, gap)
  let hidden = 0
  let changed = 0
  for (let i = 0; i < boxes.length; i++) {
    hidden += 1 - shown[i]
    if (boxes[i].sheet.setShown?.(boxes[i].index, shown[i] === 1)) {
      changed++
    }
  }
  return {labels: boxes.length, hidden, changed}
}


/**
 * @param {{first: boolean, rank: number, depth: number}} a
 * @param {{first: boolean, rank: number, depth: number}} b
 * @returns {number} For sort: the more important first
 */
export function byImportance(a, b) {
  if (a.first !== b.first) {
    return a.first ? -1 : 1
  }
  return (b.rank - a.rank) || (a.depth - b.depth)
}


/**
 * Undo the declutter: every label of the sheets that take part is drawn
 * (the perf overlay's switch for the pass, to compare).
 *
 * @param {object} root The scene graph
 */
export function showAllLabels(root) {
  root.traverse((obj) => {
    const sheet = obj.userData?.declutter && obj.userData.sheet
    for (let i = 0; sheet && i < sheet.labelCount; i++) {
      sheet.setShown(i, true)
    }
  })
}
