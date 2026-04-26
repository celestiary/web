// Object3D imported only for the JSDoc type below; project lint config
// permits type-only imports.
import {Object3D, Raycaster, Vector3} from 'three'
import {latLngAltToBodyFixed} from '../coords.js'


// Reused across calls to avoid per-frame allocations.
const _raycaster = new Raycaster
const _itemVec = new Vector3
const _mouseVec = new Vector3
const _rayOrigin = new Vector3

// Reject picks whose closest hit is farther than this many screen pixels.
export const MAX_PICK_PX = 100


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


// Reusable temps for queryPlaces.
const _placeLocal = new Vector3()
const _placeWorld = new Vector3()
const _bodyCenter = new Vector3()
const _viewDir = new Vector3()
const _normal = new Vector3()


/**
 * Find the place entry nearest the mouse cursor on a given body and call
 * pickCb with it.  O(N) projection-loop — N is small (10s..few-thousand)
 * and avoids transforming the ray into the body's rotated/tilted frame.
 *
 * Back-hemisphere places are filtered via the surface-normal vs view-dir
 * dot product, so picking can't accidentally land on a Tycho behind the
 * Moon when the user clicks the visible Plato.
 *
 * @param {object} ui  ThreeUI; uses .renderer, .camera
 * @param {{clientX:number, clientY:number}} e  Pointer event
 * @param {Object3D} body  Rotating planet Object3D (scene.objects[name]); needs
 *   .matrixWorld and .props.radius.scalar
 * @param {Array<{n,t?,lat,lng,a?,k?}>} entries  Catalog entries
 * @param {Function} pickCb  Called with the matched entry, or never if no hit
 */
export function queryPlaces(ui, e, body, entries, pickCb) {
  if (!entries || entries.length === 0) {
    return
  }
  const radius = body.props?.radius?.scalar
  if (!radius) {
    return
  }
  const el = ui.renderer.domElement
  const mouseNdcX = ((e.clientX / el.clientWidth) * 2) - 1
  const mouseNdcY = ((e.clientY / el.clientHeight) * -2) + 1

  body.updateMatrixWorld()
  body.getWorldPosition(_bodyCenter)
  ui.camera.getWorldPosition(_viewDir) // reused as cam world pos below

  let minDist = Infinity
  let bestEntry = null

  for (const entry of entries) {
    _placeLocal.copy(latLngAltToBodyFixed(entry.lat, entry.lng, entry.a ?? 0, radius))
    _placeWorld.copy(_placeLocal).applyMatrix4(body.matrixWorld)

    // Cull back hemisphere: outward normal at the place vs camera-to-place
    // direction.  positive dot ⇒ camera looks AT the surface from outside.
    _normal.copy(_placeWorld).sub(_bodyCenter).normalize()
    const camToPlace = _placeWorld.clone().sub(_viewDir).normalize() // _viewDir holds cam world pos
    if (_normal.dot(camToPlace) > 0) {
      continue
    }

    // Project to NDC; reject behind the camera.
    const proj = _placeWorld.clone().project(ui.camera)
    if (proj.z < -1 || proj.z > 1) {
      continue
    }

    const pxDx = ((proj.x - mouseNdcX) * el.clientWidth) / 2
    const pxDy = ((proj.y - mouseNdcY) * el.clientHeight) / 2
    const dist = (pxDx * pxDx) + (pxDy * pxDy)
    if (dist < minDist) {
      minDist = dist
      bestEntry = entry
    }
  }

  if (!bestEntry || minDist > MAX_PICK_PX * MAX_PICK_PX) {
    return
  }
  pickCb(bestEntry)
}
