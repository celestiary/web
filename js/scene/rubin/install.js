import {Vector3} from 'three'
import ApparentPath from './ApparentPath.js'
import PixelMarker from './PixelMarker.js'
import RubinObservatory from './RubinObservatory.js'
import {TARGET} from './rubin.js'


// The Rubin feature in the scene (Rubin.md): the observatory on Earth and
// 2026 ED138's apparent path on the sky, built when the app first runs
// (Scene.getRubin), gone when it stops.  Loaded with a dynamic import, so
// none of it is in the first load, and it imports nothing of the first
// load's but three (rubin.js says why): Scene hands in the functions.

/**
 * @param {object} scene The Scene, with Earth and the body in it
 * @param {object} deps The first load's functions (Scene.getRubin):
 *   ApparentPath's and RubinObservatory's (with `loadModel`, for the
 *   telescope), PixelMarker's (`sceneReferred`), and `ASTRO_UNIT_METER`
 * @returns {{observatory: RubinObservatory, path: ApparentPath, pixel: PixelMarker, dispose: Function}}
 */
export function installRubin(scene, deps) {
  const earth = scene.objects.earth
  const orbitPosition = scene.objects['earth.orbitPosition']
  const body = scene.objects[`${TARGET}.orbitPosition`]
  if (!earth || !orbitPosition || !body?.elements) {
    throw new Error('installRubin: Earth and 2026 ED138 must be in the scene')
  }
  const observatory = new RubinObservatory({
    earth,
    deps,
    body: () => scene.objects[TARGET] ?? null,
    groundHeight: (lat, lng) => scene.ui.layers?.groundHeightAt?.(earth, lat, lng) ?? null,
    // The target-keyed exposure, without the meter's gain: the glow is in
    // exposure units at it, and the gain lifts it at night as it lifts the
    // stars.  (The renderer's toneMappingExposure has the gain in it.)
    exposure: () => scene.ui._exposureGoal ?? 1,
  })
  const path = new ApparentPath({
    elements: body.elements,
    deps,
    // VSOP87C's Earth (or its stand-in), AU in the ecliptic of date, to
    // scene axes and metres.
    earthAt: (jd) => {
      const e = scene.vsopAt(jd).earth
      return new Vector3(e.x, e.z, -e.y).multiplyScalar(deps.ASTRO_UNIT_METER)
    },
  })
  orbitPosition.add(path)
  // Rubin's pixel at the body's place: a child of its orbitPosition, which
  // Animation moves, so it follows the body; off until the panel's switch.
  const pixel = new PixelMarker({
    deps,
    view: () => {
      const ui = scene.ui
      return {
        instrument: ui.instrument,
        fovDeg: ui.camera.fov,
        heightPx: ui.renderer?.domElement?.height || ui.height,
      }
    },
  })
  body.add(pixel)
  return {
    observatory,
    path,
    pixel,
    dispose() {
      observatory.dispose()
      path.dispose()
      pixel.dispose()
    },
  }
}
