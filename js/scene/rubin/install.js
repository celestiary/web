import {Vector3} from 'three'
import ApparentPath from './ApparentPath.js'
import PixelMarker from './PixelMarker.js'
import RubinImage from './RubinImage.js'
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
 *   telescope), PixelMarker's (`sceneReferred`), and `ASTRO_UNIT_METER`;
 *   the image's (`dataUrl`, `addCredit`, `removeCredit`, and `fetchJson`
 *   or the global fetch)
 * @returns {{observatory: RubinObservatory, path: ApparentPath, pixel: PixelMarker, image: object,
 *   dispose: Function}}
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
  const image = newImageSwitch(scene, deps)
  return {
    observatory,
    path,
    pixel,
    image,
    dispose() {
      observatory.dispose()
      path.dispose()
      pixel.dispose()
      image.dispose()
    },
  }
}


/** The imagery's manifest (Rubin.md, "The imagery"), fetched when the image is first wanted. */
export const IMAGE_MANIFEST_PATH = 'data/rubin/noirlab2626d.json'
export const IMAGE_CREDIT_ID = 'rubin-image'


/**
 * The image's switch (RubinApp's "Rubin's image"): its manifest fetched and
 * its layer built the first time it's on, hung from the stellar frame, and
 * its credit in the footer while it's drawn.
 *
 * @param {object} scene
 * @param {object} deps
 * @returns {{enabled: boolean, layer: ?RubinImage, ready: ?Promise, dispose: Function}}
 */
export function newImageSwitch(scene, deps) {
  const fetchJson = deps.fetchJson ?? ((url) => fetch(url).then((r) => {
    if (!r.ok) {
      throw new Error(`${url}: ${r.status}`)
    }
    return r.json()
  }))
  let on = false
  let disposed = false
  const credit = (m) => ({text: `Rubin's image: ${m.credit} (${m.licence}); ${m.creditNote}`, href: m.source})
  const sw = {
    layer: null,
    ready: null,
    get enabled() {
      return on
    },
    set enabled(value) {
      on = value === true
      if (on && !sw.ready) {
        sw.ready = fetchJson(IMAGE_MANIFEST_PATH).then((manifest) => {
          if (disposed) {
            return
          }
          sw.layer = new RubinImage({
            manifest,
            resolve: deps.dataUrl ?? ((p) => p),
            sceneReferred: deps.sceneReferred,
            view: () => {
              const ui = scene.ui
              return {
                camera: ui.camera,
                fovDeg: ui.camera?.fov,
                aspect: ui.camera?.aspect,
                heightPx: ui.renderer?.domElement?.height || ui.height,
              }
            },
          })
          scene.stellarFrame.add(sw.layer)
          sw.apply()
        }).catch((err) => {
          console.warn('Rubin image:', err.message)
        })
      }
      sw.apply()
    },
    apply() {
      if (!sw.layer) {
        return
      }
      sw.layer.visible = on
      if (on) {
        deps.addCredit?.(IMAGE_CREDIT_ID, credit(sw.layer.manifest), {persistence: 'timed'})
      } else {
        deps.removeCredit?.(IMAGE_CREDIT_ID)
      }
    },
    dispose() {
      disposed = true
      deps.removeCredit?.(IMAGE_CREDIT_ID)
      sw.layer?.dispose()
      sw.layer = null
    },
  }
  return sw
}
