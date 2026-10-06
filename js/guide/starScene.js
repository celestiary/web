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


/** The fraction of the canvas's smaller dimension a framed star's disc fills. */
export const FRAME_FILL = 0.9


/**
 * The camera distance at which a star's disc spans `fill` of the canvas's
 * smaller dimension.  The disc's limb is the ray at its angular radius
 * a = asin(r / d), which meets the image plane at tan(a) in units where the
 * canvas's height is 2 tan(fov / 2); the width is `aspect` times that.
 *
 * @param {number} radius The star's radius
 * @param {number} fovDeg The camera's vertical field of view, degrees
 * @param {number} aspect The canvas's width over its height
 * @param {number} [fill]
 * @returns {number} The distance from the star's centre, same unit as radius
 */
export function frameDistance(radius, fovDeg, aspect, fill = FRAME_FILL) {
  const smaller = Math.min(aspect, 1)
  const tanAngularRadius = fill * smaller * Math.tan(fovDeg * Math.PI / 360)
  return radius / Math.sin(Math.atan(tanAngularRadius))
}


/**
 * Puts the camera on the star's axis at `frameDistance`, and keeps it framed
 * while the canvas is resized, until the camera is moved (zoomed) from there.
 * Call the returned `reframe` once a frame; it does nothing unless the
 * canvas or field of view changed.
 *
 * @param {object} ui ThreeUI
 * @param {object} star
 * @returns {Function} reframe
 */
export function frameStar(ui, star) {
  const cam = ui.camera
  const distance = () => frameDistance(star.props.radius.scalar, cam.fov, cam.aspect)
  let framed = {z: distance(), aspect: cam.aspect, fov: cam.fov}
  cam.position.z = framed.z
  return () => {
    if (cam.aspect === framed.aspect && cam.fov === framed.fov) {
      return
    }
    // Moved by the user since: leave it where they put it.
    const moved = cam.position.z !== framed.z
    framed = {z: distance(), aspect: cam.aspect, fov: cam.fov}
    if (!moved) {
      cam.position.z = framed.z
    }
  }
}
