/** @typedef {import('./SearchProvider.js').SearchEntry} SearchEntry */


/**
 * Go: travel to a search result.  The "Go to" button and
 * Enter in the search field.  Bodies route through the location hash (the
 * single source of truth for planet permalinks), stars through
 * `scene.goTo`, and places through `scene.land`.
 *
 * @param {SearchEntry} entry
 * @param {object} celestiary
 */
export function goToEntry(entry, celestiary) {
  if (!entry || !celestiary) {
    return
  }
  if (entry.kind === 'star' && entry.payload && entry.payload.star) {
    celestiary.scene.goTo(entry.payload.star)
    celestiary.useStore.getState().setCommittedStar(starCommit(entry))
    return
  }
  if (entry.kind === 'place' && entry.payload) {
    const {body, lat, lng, alt} = entry.payload
    celestiary.scene.land(body, lat, lng, alt)
    return
  }
  const name = entry.payload && entry.payload.name
  if (!name) {
    return
  }
  const path = celestiary.loader.pathByName[name]
  if (path) {
    window.location.hash = path
  }
}


/**
 * Look at: select a search result as the target and turn the camera in
 * place to face it, without moving.  The same rotation-only look tween as
 * `Scene.setTarget` (the 0-9 and `u` keys), so there's no goTo, rebase or
 * reparent.  Bodies use `setTarget`, which also syncs the breadcrumb;
 * stars and places have no scene object, so use `lookAtStar` and
 * `lookAtPlace` (same tween, aimed at the point).  Travel afterwards is
 * the usual `g` or the Go button.
 *
 * @param {SearchEntry} entry
 * @param {object} celestiary
 */
export function lookAtEntry(entry, celestiary) {
  if (!entry || !celestiary) {
    return
  }
  const {scene} = celestiary
  if (entry.kind === 'star' && entry.payload && entry.payload.star) {
    scene.lookAtStar(entry.payload.star)
    celestiary.useStore.getState().setCommittedStar(starCommit(entry))
    return
  }
  if (entry.kind === 'place' && entry.payload) {
    const {body, lat, lng, alt} = entry.payload
    scene.lookAtPlace(body, lat, lng, alt)
    // The point stays the target, for 'g' (lookAtPlace targets the body).
    scene.targetLabel(placeLabel(entry), {path: false})
    return
  }
  const name = entry.payload && entry.payload.name
  if (!name || !scene.objects[name]) {
    console.warn(`lookAtEntry: no scene object for ${entry.id}`)
    return
  }
  scene.setTarget(name)
}


/**
 * Pick a result in the dropdown: a place is targeted, as a click on its
 * label does, so 'c' turns to face it and 'g' lands at it; the camera
 * doesn't move.  The breadcrumb stays: moving it closes the search bar.
 * Other kinds are previewed only, until Go or Look at.
 *
 * @param {SearchEntry} entry
 * @param {object} celestiary
 */
export function targetEntry(entry, celestiary) {
  if (entry && entry.kind === 'place' && entry.payload && celestiary) {
    celestiary.scene.targetLabel(placeLabel(entry), {path: false})
  }
}


/**
 * @param {SearchEntry} entry A place
 * @returns {{kind: string, body: string, name: string, lat: number, lng: number, alt: number|undefined}}
 *   The place as a label target (labelPick.js), which Scene.targetLabel takes
 */
function placeLabel(entry) {
  const {body, lat, lng, alt} = entry.payload
  return {kind: 'place', body, name: entry.displayName, lat, lng, alt}
}


/**
 * @param {SearchEntry} entry
 * @returns {{hipId: number, displayName: string, star: object}}
 */
function starCommit(entry) {
  return {
    hipId: entry.payload.hipId,
    displayName: entry.displayName,
    star: entry.payload.star,
  }
}
