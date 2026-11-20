import {Quaternion, Vector3} from 'three'
import HipsLayer from '../sky/HipsLayer.js'
import {footprintCells} from '../sky/footprint.js'
import {angle, apply, frameMatrix, lonLatToVec, mocFromCells} from '../sky/hips.js'
import {RUBIN_FIRST_LOOK, RUBIN_VIRGO, surveyCovers} from '../sky/surveys.js'
import ApparentPath from './ApparentPath.js'
import PixelMarker from './PixelMarker.js'
import RubinImage from './RubinImage.js'
import RubinObservatory from './RubinObservatory.js'
import SurveyCadence, {sceneToRaDec} from './SurveyCadence.js'
import {TARGET} from './rubin.js'


// The sky layer and its surveys, for checks from the console and a later
// control (Sky.md): `(await c.scene.loadRubin()).HipsLayer`.
export {HipsLayer}
export {SURVEYS} from '../sky/surveys.js'


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
 * @returns {{observatory: RubinObservatory, path: ApparentPath, pixel: PixelMarker, cadence: SurveyCadence, image: object,
 *   dispose: Function}}
 */
export function installRubin(scene, deps) {
  const earth = scene.objects.earth
  const orbitPosition = scene.objects['earth.orbitPosition']
  const body = scene.objects[`${TARGET}.orbitPosition`]
  if (!earth || !orbitPosition || !body?.elements) {
    throw new Error('installRubin: Earth and 2026 ED138 must be in the scene')
  }
  let cadence = null
  const observatory = new RubinObservatory({
    cadence: (ms) => cadence?.pointing(ms) ?? null,
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
    // Sampled again when VSOP87C arrives (the stand-in's Earth is up to
    // 20,000 km off: the ring was 0.33″ from the body, #340).
    approximate: () => scene.vsopReady ? !scene.vsopReady() : false,
    earthAt: (jd) => {
      const e = scene.vsopAt(jd).earth
      return new Vector3(e.x, e.z, -e.y).multiplyScalar(deps.ASTRO_UNIT_METER)
    },
  })
  orbitPosition.add(path)
  let image = null
  // The survey's cadence (Rubin.md, "Cadence"): off until the panel's
  // switch; the object's place from the path's own ephemeris, and whether a
  // field holds Rubin's public imagery.
  cadence = new SurveyCadence({
    deps,
    targetAt: (jd) => sceneToRaDec(path.positionJ2000(jd)),
    imagery: (raDeg, decDeg, radiusDeg) => imageryLine(raDeg, decDeg, radiusDeg, image?.layer?.manifest ?? null),
  })
  orbitPosition.add(cadence)
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
  image = newImageSwitch(scene, deps, {onManifest: () => cadence.resetImagery()})
  return {
    observatory,
    path,
    pixel,
    cadence,
    image,
    dispose() {
      cadence.dispose()
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
/** Rubin's First Look on the sky (js/scene/sky/Sky.md), with the image. */
export const FIRST_LOOK_CREDIT_ID = 'rubin-first-look'
export const VIRGO_CREDIT_ID = 'rubin-virgo'
/** The field of view that frames one of Rubin's fields: its camera's, degrees. */
const RUBIN_FIELD_DEG = 3.5
/** The First Look's images that aren't the Virgo field, which Rubin's own tiles draw. */
const REST = RUBIN_FIRST_LOOK.footprints.filter((f) => f.image !== 'noirlab2521a')
/**
 * CDS's First Look less the Virgo field (Sky.md, "Surveys"): Rubin's own
 * tiles draw that one, wider, and two layers over one field would draw
 * turn about.  Its coverage is the manifest's, for the images left
 * (tools/hips/coverage.mjs's order and pad).
 */
export const FIRST_LOOK_REST = {
  ...RUBIN_FIRST_LOOK,
  footprints: REST,
  coverage: mocFromCells(8, new Set(REST.flatMap((f) => [...footprintCells(8, f, 0.05)]))),
}


/**
 * The cadence readout's line for a field that holds Rubin's public imagery:
 * the First Look's coverage (its MOC), or the discovery image's footprint
 * once its manifest is in.
 *
 * @param {number} raDeg The field's centre
 * @param {number} decDeg
 * @param {number} radiusDeg The field's radius
 * @param {?object} composite The discovery image's manifest, if fetched
 * @returns {?string}
 */
export function imageryLine(raDeg, decDeg, radiusDeg, composite) {
  if (surveyCovers(RUBIN_VIRGO, raDeg, decDeg, radiusDeg)) {
    return `Rubin's image covers this field: First Look, ${RUBIN_VIRGO.name}`
  }
  if (surveyCovers(FIRST_LOOK_REST, raDeg, decDeg, radiusDeg)) {
    // Which of its images: the nearer centre.
    const v = lonLatToVec(raDeg, decDeg)
    const near = FIRST_LOOK_REST.footprints.reduce((a, b) =>
      (angle(lonLatToVec(a.raDeg, a.decDeg), v) <= angle(lonLatToVec(b.raDeg, b.decDeg), v) ? a : b))
    return `Rubin's image covers this field: First Look, ${near.name}`
  }
  if (composite?.wcs) {
    const {crval, width, height, scaleArcsec} = composite.wcs
    const halfDiagonalDeg = Math.hypot(width, height) / 2 * scaleArcsec / 3600
    if (angle(lonLatToVec(crval[0], crval[1]), lonLatToVec(raDeg, decDeg)) * 180 / Math.PI <=
        radiusDeg + halfDiagonalDeg) {
      return 'Rubin\'s image covers this field: the discovery image'
    }
  }
  return null
}


/**
 * The image's switch (RubinApp's "Rubin's image"): the discovery image's
 * manifest fetched and its layer built the first time it's on, and Rubin's
 * First Look as a HiPS layer (js/scene/sky/), both hung from the stellar
 * frame; the discovery image's credit in the footer while it's on, the
 * First Look's while its tiles are drawn.
 *
 * @param {object} scene
 * @param {object} deps
 * @param {object} [opts]
 * @param {Function} [opts.onManifest] When the discovery image's manifest is in
 * @param {Function} [deps.fetchOk] Whether a URL answers (CDS's `properties`); the global fetch otherwise
 * @returns {{enabled: boolean, layer: ?RubinImage, firstLook: ?HipsLayer, virgo: ?HipsLayer, ready: ?Promise,
 *   fields: Function, dispose: Function}}
 */
export function newImageSwitch(scene, deps, {onManifest = null} = {}) {
  const fetchJson = deps.fetchJson ?? ((url) => fetch(url).then((r) => {
    if (!r.ok) {
      throw new Error(`${url}: ${r.status}`)
    }
    return r.json()
  }))
  let on = false
  let disposed = false
  const credit = (m) => ({text: `Rubin's image: ${m.credit} (${m.licence}); ${m.creditNote}`, href: m.source})
  const firstLookCredit = {
    text: `Rubin's First Look: ${RUBIN_FIRST_LOOK.credit} (HiPS ${RUBIN_FIRST_LOOK.licence})`,
    href: RUBIN_FIRST_LOOK.source,
  }
  const virgoCredit = {text: `${RUBIN_VIRGO.title}: ${RUBIN_VIRGO.credit}`, href: RUBIN_VIRGO.source}
  const hips = (survey, id, c) => new HipsLayer({
    survey,
    view,
    sceneReferred: deps.sceneReferred,
    loadTexture: deps.loadTexture,
    onDrawn: (drawn) => {
      if (drawn && on) {
        deps.addCredit?.(id, c, {persistence: 'timed'})
      } else {
        deps.removeCredit?.(id)
      }
    },
  })
  const view = () => {
    const ui = scene.ui
    return {
      camera: ui.camera,
      fovDeg: ui.camera?.fov,
      aspect: ui.camera?.aspect,
      heightPx: ui.renderer?.domElement?.height || ui.height,
    }
  }
  // Whether CDS serves its First Look now (its `properties` asked once,
  // when the switch first goes on): null until known.  Its tiles answered
  // 404 for weeks when this went in, and a field with nothing to show
  // isn't offered.
  let cdsUp = null
  // Asked of the network only where the manifest is: a caller that hands in
  // its own fetchJson (the tests) hands in fetchOk too, or isn't asked.
  const fetchOk = deps.fetchOk ?? (deps.fetchJson ? () => Promise.resolve(false) :
    (url) => fetch(url).then((r) => r.ok, () => false))
  // A J2000 place's direction in the world now: through the stars' frame.
  const direction = (raDeg, decDeg) => new Vector3(...apply(frameMatrix('equatorial'), lonLatToVec(raDeg, decDeg)))
      .applyQuaternion(scene.stellarFrame.getWorldQuaternion(new Quaternion))
  const sw = {
    layer: null,
    firstLook: null,
    virgo: null,
    ready: null,
    /**
     * The fields Rubin's public imagery holds that can be shown now, for the
     * panel's buttons: the discovery image's once its manifest is in, the
     * First Look's Virgo field, and its Trifid and Lagoon while CDS serves.
     *
     * @returns {Array<{key: string, label: string, fovDeg: number, direction: () => Vector3}>}
     *   Each with the field of view that frames it and its direction in the world now
     */
    fields() {
      const out = []
      const add = (key, label, raDeg, decDeg, fovDeg) =>
        out.push({key, label, fovDeg, direction: () => direction(raDeg, decDeg)})
      if (sw.layer) {
        add('discovery', 'Discovery field', ...sw.layer.manifest.wcs.crval, 2)
      }
      add('virgo', 'Virgo Cluster', RUBIN_VIRGO.raDeg, RUBIN_VIRGO.decDeg, RUBIN_FIELD_DEG)
      if (cdsUp) {
        const [f] = FIRST_LOOK_REST.footprints
        add('trifid', 'Trifid and Lagoon', f.raDeg, f.decDeg, RUBIN_FIELD_DEG)
      }
      return out
    },
    get enabled() {
      return on
    },
    set enabled(value) {
      on = value === true
      if (on && !sw.ready) {
        sw.firstLook = hips(FIRST_LOOK_REST, FIRST_LOOK_CREDIT_ID, firstLookCredit)
        sw.virgo = hips(RUBIN_VIRGO, VIRGO_CREDIT_ID, virgoCredit)
        scene.stellarFrame.add(sw.firstLook, sw.virgo)
        fetchOk(`${RUBIN_FIRST_LOOK.serviceUrls[0]}/properties`).then((ok) => {
          cdsUp = ok
        })
        sw.ready = fetchJson(IMAGE_MANIFEST_PATH).then((manifest) => {
          if (disposed) {
            return
          }
          sw.layer = new RubinImage({
            manifest,
            resolve: deps.dataUrl ?? ((p) => p),
            sceneReferred: deps.sceneReferred,
            view,
          })
          scene.stellarFrame.add(sw.layer)
          onManifest?.()
          sw.apply()
        }).catch((err) => {
          console.warn('Rubin image:', err.message)
        })
      }
      sw.apply()
    },
    apply() {
      for (const layer of [sw.firstLook, sw.virgo]) {
        if (layer) {
          layer.visible = on
          if (!on) {
            layer.setDrawn(false)
          }
        }
      }
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
      deps.removeCredit?.(FIRST_LOOK_CREDIT_ID)
      deps.removeCredit?.(VIRGO_CREDIT_ID)
      sw.layer?.dispose()
      sw.layer = null
      sw.firstLook?.dispose()
      sw.firstLook = null
      sw.virgo?.dispose()
      sw.virgo = null
    },
  }
  return sw
}
