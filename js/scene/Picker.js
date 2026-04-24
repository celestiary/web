import {Raycaster, Vector3} from 'three'


// Reused across calls to avoid per-frame allocations.
const _raycaster = new Raycaster
const _itemVec = new Vector3
const _mouseVec = new Vector3
const _rayOrigin = new Vector3

// Reject picks whose closest star is farther than this many screen pixels.
const MAX_PICK_PX = 100


/**
 * Find the star nearest to the mouse cursor and call pickCb with it.
 *
 * @param {object} ui
 * @param {MouseEvent} e
 * @param {object} tree  Spatial index built from stars.geom.coords
 * @param {object} stars Stars scene object (has .geom, .catalog)
 * @param {Function} pickCb Called with {star, x, y, z} in catalog coords
 */
export function queryPoints(ui, e, tree, stars, pickCb) {
  const el = ui.renderer.domElement
  const mouse = {
    x: ((e.clientX / el.clientWidth) * 2) - 1,
    y: ((e.clientY / el.clientHeight) * -2) + 1,
  }
  _raycaster.setFromCamera(mouse, ui.camera)
  const ray = _raycaster.ray

  // Stars are stored in catalog coordinates.  WorldGroup.position shifts the
  // entire star field in world space, so world_pos = catalog_pos + wg.position.
  // The ray origin comes from the camera's world position — subtract wg.position
  // to bring it into catalog space before querying the spatial index.
  _rayOrigin.copy(ray.origin)
  const wg = ui.scene.getObjectByName('WorldGroup')
  if (wg) {
    _rayOrigin.sub(wg.position)
  }

  const items = tree.intersectRay(_rayOrigin, ray.direction)
  if (items.length > 0) {
    mark(ui, items, mouse, stars, wg, pickCb)
  }
}


/**
 * @param {object} ui
 * @param {Array} items  Flat array of indices from tree.intersectRay; each
 *                       element is a flat index into stars.geom.coords (i.e.
 *                       a multiple of 3, one entry per matching star).
 * @param {{x,y}} mouse  NDC mouse position
 * @param {object} stars
 * @param {object|null} wg  WorldGroup (may be null)
 * @param {Function} pickCb
 */
function mark(ui, items, mouse, stars, wg, pickCb) {
  const coords = stars.geom.coords
  const el = ui.renderer.domElement
  const clientW = el.clientWidth
  const clientH = el.clientHeight
  const wgX = wg ? wg.position.x : 0
  const wgY = wg ? wg.position.y : 0
  const wgZ = wg ? wg.position.z : 0

  _mouseVec.set(mouse.x, mouse.y, 0)

  let minDist = Infinity
  let closestNdx = -1
  let minX = 0; let minY = 0; let minZ = 0

  // items is one flat index per matching star (not triplets) — step by 1.
  for (let i = 0; i < items.length; i++) {
    const ndx = items[i]
    const x = coords[ndx]; const y = coords[ndx + 1]; const z = coords[ndx + 2]
    // Project world-space position into NDC for screen-distance comparison.
    _itemVec.set(x + wgX, y + wgY, z + wgZ)
    _itemVec.project(ui.camera)
    // Compute screen distance in pixels (ignore z/depth).
    const pxDx = (_itemVec.x - mouse.x) * clientW / 2
    const pxDy = (_itemVec.y - mouse.y) * clientH / 2
    const dist = (pxDx * pxDx) + (pxDy * pxDy) // squared pixels — cheaper than sqrt
    if (dist < minDist) {
      minDist = dist
      closestNdx = ndx
      minX = x; minY = y; minZ = z
    }
  }

  if (closestNdx < 0 || minDist > MAX_PICK_PX * MAX_PICK_PX) {
    return
  }

  const hipId = stars.geom.idsByNdx[closestNdx / 3]
  const star = stars.catalog.starByHip.get(hipId)
  pickCb({star, x: minX, y: minY, z: minZ})
}
