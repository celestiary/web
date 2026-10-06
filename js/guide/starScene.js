import StarFromApp from '../scene/Star.js'


/**
 * Draws a catalogue star on the guide's canvas, as the only object of the
 * scene (the guide's Star page).
 *
 * ThreeUI meters a resolved star's disc from its scene manager's objects,
 * by their props' `type` (`_luminousDiscs`, HDR.md "Physical stars").  The
 * guide has no scene manager, so without one the disc is never metered and
 * the Sun shader's radiance, which assumes the metered exposure, saturates
 * to a white blob (#165).  This gives the UI one holding just the star.
 *
 * @param {object} ui ThreeUI
 * @param {object} catalog StarsCatalog
 * @param {number} hipId
 * @param {string} name Shown name: the key in the scene manager's objects.
 * @param {object} [curStar] The star on show, removed first.
 * @param {Function} [setStar] Called with the new star.
 * @returns {StarFromApp} star
 */
export function addStarToScene(ui, catalog, hipId, name, curStar, setStar) {
  if (curStar) {
    ui.scene.remove(curStar)
  }
  const starProps = catalog.starByHip.get(hipId)
  starProps.x = starProps.y = starProps.z = 0
  // The catalogue's props are shared, so showing a star again must not
  // wrap its radius again.
  if (typeof starProps.radius !== 'object') {
    starProps.radius = {scalar: starProps.radius}
  }
  starProps.type = 'star'
  starProps.name = name
  const objects = {}
  const star = new StarFromApp(starProps, objects, ui)
  ui.sceneManager = {objects}
  ui.scene.add(star)
  setStar?.(star)
  return star
}
