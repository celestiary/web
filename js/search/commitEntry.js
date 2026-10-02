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
