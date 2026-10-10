/** @typedef {import('./SearchProvider.js').SearchEntry} SearchEntry */


/**
 * Go: travel to a search result.  The "Go to" button and Enter in the
 * search field.  Bodies route through the location hash (a link to the
 * body's path flies there), stars through `scene.goTo`, and places through
 * `scene.land`.  Each ends with the result as the target
 * (`Scene.setTarget`).
 *
 * @param {SearchEntry} entry
 * @param {object} celestiary
 */
export function goToEntry(entry, celestiary) {
  if (!entry || !celestiary) {
    return
  }
  if (entry.kind === 'star' && entry.payload && entry.payload.star) {
    celestiary.scene.goTo(entry.payload.star, entry.displayName)
    return
  }
  if (entry.payload?.galaxy) {
    celestiary.scene.goTo(entry.payload.galaxy, entry.displayName)
    return
  }
  if (entry.kind === 'place' && entry.payload) {
    const {body, lat, lng, alt} = entry.payload
    celestiary.scene.land(body, lat, lng, alt, {target: placeTarget(entry)})
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
 * Look at: target a search result and turn the camera in place to face it,
 * without moving: `Scene.setTarget` with its look tween, as the `c`/`0`-`9`
 * keys, so there's no goTo, rebase or reparent.  Travel afterwards is the
 * usual `g` or the Go button.
 *
 * @param {SearchEntry} entry
 * @param {object} celestiary
 */
export function lookAtEntry(entry, celestiary) {
  const target = entryTarget(entry, celestiary)
  if (target) {
    celestiary.scene.setTarget(target)
  }
}


/**
 * Pick a result in the dropdown: it's targeted, as a click on its label is
 * (`Scene.setTarget` without the look), so the breadcrumb and the link
 * show it, 'c' turns to face it and 'g' goes; the camera doesn't move.
 * The search bar stays open (SearchBar keeps it open for its own picks).
 *
 * @param {SearchEntry} entry
 * @param {object} celestiary
 */
export function targetEntry(entry, celestiary) {
  const target = entryTarget(entry, celestiary)
  if (target) {
    celestiary.scene.setTarget(target, {look: false})
  }
}


/**
 * @param {SearchEntry} entry
 * @param {object} celestiary
 * @returns {?(string|object)} The result as Scene.setTarget takes it: a
 *   body's name, or a star or place target; null if it can't be targeted
 *   (a body not in the scene yet)
 */
function entryTarget(entry, celestiary) {
  if (!entry || !celestiary) {
    return null
  }
  if (entry.kind === 'star' && entry.payload && entry.payload.star) {
    return {kind: 'star', star: entry.payload.star, name: entry.displayName}
  }
  if (entry.payload?.galaxy) {
    return {kind: 'galaxy', galaxy: entry.payload.galaxy, name: entry.displayName}
  }
  if (entry.kind === 'place' && entry.payload) {
    return placeTarget(entry)
  }
  const name = entry.payload && entry.payload.name
  if (!name || !celestiary.scene.objects[name]) {
    console.warn(`commitEntry: no scene object for ${entry.id}`)
    return null
  }
  return name
}


/**
 * @param {SearchEntry} entry A place
 * @returns {{kind: string, body: string, name: string, lat: number, lng: number, alt: number|undefined}}
 *   The place as a target, as its label has it (labelPick.js)
 */
function placeTarget(entry) {
  const {body, lat, lng, alt} = entry.payload
  return {kind: 'place', body, name: entry.displayName, lat, lng, alt}
}
