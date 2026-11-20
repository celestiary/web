import {Quaternion, Vector3} from 'three'
import HipsLayer from './HipsLayer.js'
import {apply, frameMatrix, lonLatToVec} from './hips.js'
import {SURVEYS} from './surveys.js'


// The surveys' layers in the scene (Sky.md, "The control"): one layer per
// survey, shared by whoever wants it (the layers control's switches, a link's
// `?sky=`, the Rubin app's "Rubin's image"), hung from the stellar frame
// while anyone does, with the survey's credit in the footer while its tiles
// are drawn.  Lazily loaded: nothing of this is in the first load.

export {HipsLayer, SURVEYS}

/** The surveys the layers control lists, in its order: those with showpiece fields. */
export const CONTROL_SURVEYS = SURVEYS.filter((s) => Array.isArray(s.fields) && s.fields.length > 0)


/**
 * @param {string} key A manifest's `key` (`jwst-nircam`), any case
 * @returns {?object} The survey's manifest
 */
export function surveyByKey(key) {
  const wanted = String(key).toLowerCase()
  return SURVEYS.find((s) => s.key === wanted) ?? null
}


/**
 * A survey's credit line: its title, credit and licence (the licence left
 * out where the credit already names it).
 *
 * @param {object} survey
 * @returns {{text: string, href: string}}
 */
export function surveyCredit(survey) {
  const licence = survey.licence && !survey.credit.includes(survey.licence) ? ` (${survey.licence})` : ''
  return {text: `${survey.title}: ${survey.credit}${licence}`, href: survey.source}
}


/**
 * The scene's survey layers, made the first time anything asks.
 *
 * @param {object} scene Scene.js's: its `stellarFrame` and `ui`
 * @param {object} deps The first load's functions: `sceneReferred`,
 *   `addCredit`, `removeCredit`, and for tests `loadTexture`
 * @returns {{acquire: Function, release: Function, layer: Function, owners: Function, keys: Function}}
 */
export function skyLayers(scene, deps) {
  scene._skyLayers ??= newSkyLayers(scene, deps)
  return scene._skyLayers
}


/**
 * @param {object} scene
 * @param {object} deps
 * @returns {object} skyLayers'
 */
function newSkyLayers(scene, deps) {
  // key → {layer, owners: Set}
  const held = new Map
  const view = () => {
    const ui = scene.ui
    return {
      camera: ui.camera,
      fovDeg: ui.camera?.fov,
      aspect: ui.camera?.aspect,
      heightPx: ui.renderer?.domElement?.height || ui.height,
    }
  }
  return {
    /**
     * A survey's layer, made and hung if no one holds it yet.
     *
     * @param {string} key
     * @param {string} owner Who wants it: `control`, `link`, `rubin`
     * @returns {?HipsLayer} null for a key no survey has
     */
    acquire(key, owner) {
      const survey = surveyByKey(key)
      if (!survey) {
        return null
      }
      let h = held.get(survey.key)
      if (!h) {
        const creditId = `sky-${survey.key}`
        const credit = surveyCredit(survey)
        const layer = new HipsLayer({
          survey,
          view,
          sceneReferred: deps.sceneReferred,
          loadTexture: deps.loadTexture,
          onDrawn: (drawn) => {
            if (drawn) {
              deps.addCredit?.(creditId, credit, {persistence: 'timed'})
            } else {
              deps.removeCredit?.(creditId)
            }
          },
        })
        scene.stellarFrame.add(layer)
        h = {layer, owners: new Set}
        held.set(survey.key, h)
      }
      h.owners.add(owner)
      return h.layer
    },
    /**
     * Let go of a survey: its layer is freed once no one holds it.
     *
     * @param {string} key
     * @param {string} owner
     */
    release(key, owner) {
      const survey = surveyByKey(key)
      const h = survey && held.get(survey.key)
      if (!h) {
        return
      }
      h.owners.delete(owner)
      if (h.owners.size === 0) {
        h.layer.dispose()
        held.delete(survey.key)
      }
    },
    /**
     * @param {string} key
     * @returns {?HipsLayer} The survey's layer while anyone holds it
     */
    layer(key) {
      const survey = surveyByKey(key)
      return (survey && held.get(survey.key)?.layer) ?? null
    },
    /**
     * @param {string} key
     * @returns {Set<string>} Who holds it
     */
    owners(key) {
      const survey = surveyByKey(key)
      return new Set((survey && held.get(survey.key)?.owners) ?? [])
    },
    /** @returns {Array<string>} The surveys held */
    keys() {
      return [...held.keys()]
    },
  }
}


/**
 * A J2000 place's direction in the world now: through the stars' frame,
 * which precesses it to the date.
 *
 * @param {object} scene Its `stellarFrame`
 * @param {number} raDeg
 * @param {number} decDeg
 * @returns {Vector3}
 */
export function skyDirection(scene, raDeg, decDeg) {
  return new Vector3(...apply(frameMatrix('equatorial'), lonLatToVec(raDeg, decDeg)))
      .applyQuaternion(scene.stellarFrame.getWorldQuaternion(new Quaternion))
}


/**
 * Turn the view to a field on the sky (a survey's showpiece, one of
 * Rubin's imaged fields), at the field of view that frames it; out of a
 * seat's ride and off tracking, which would both turn it back.  The layers
 * control's sky section and the Rubin panel both use it.
 *
 * @param {object} scene Scene.js's
 * @param {object} ui ThreeUi
 * @param {{label: string, fovDeg: number, direction: () => Vector3}} field
 *   Its direction in the world now (surveyFields, skyDirection)
 * @param {{Shared: object, newCameraLookTween: Function}} deps The first
 *   load's, handed in: the camera's targets and its look tween
 * @returns {string} A note for the panel: landed, a field under the horizon
 *   is behind the ground, so say so; '' otherwise
 */
export function turnToSkyField(scene, ui, field, {Shared, newCameraLookTween}) {
  if (scene.seatAim) {
    scene.leaveSeat()
  }
  scene.setTracking(false)
  const camera = ui.camera
  const dir = field.direction()
  const at = camera.getWorldPosition(new Vector3)
  const body = Shared.targets.landed && Shared.targets.cur
  const up = body && at.clone().sub(body.getWorldPosition(new Vector3))
  // Any distance out will do: the field is at infinity.
  Shared.targets.tween = newCameraLookTween(camera, at.clone().add(dir.clone().multiplyScalar(1e4)))
  ui.setFov(field.fovDeg)
  return up && dir.dot(up) < 0 ? `${field.label} is below the horizon here now.` : ''
}


/**
 * A survey's showpiece fields, for the control's buttons (turnToSkyField).
 *
 * @param {object} scene
 * @param {object} survey A manifest with `fields`
 * @returns {Array<{key: string, label: string, fovDeg: number, direction: () => Vector3}>}
 */
export function surveyFields(scene, survey) {
  return (survey.fields ?? []).map(({key, label, raDeg, decDeg, fovDeg}) =>
    ({key, label, fovDeg, direction: () => skyDirection(scene, raDeg, decDeg)}))
}


/**
 * What the layers control's sky section shows (ui/SkyImagery.jsx): each
 * survey's switch, and its fields while it's on.
 *
 * @param {Array<string>} skyOn The store's
 * @param {Array<object>} [surveys] The control's manifests
 * @returns {Array<{key: string, survey: object, title: string, about: string, on: boolean, fields: Array<object>}>}
 */
export function skyRows(skyOn, surveys = CONTROL_SURVEYS) {
  return surveys.map((s) => ({
    key: s.key,
    survey: s,
    title: s.title,
    about: s.about,
    on: skyOn.includes(s.key),
    fields: skyOn.includes(s.key) ? s.fields : [],
  }))
}


/**
 * Hold the surveys the layers control has on, and let go of the rest it
 * held (Scene.setSkySurveys).
 *
 * @param {object} scene
 * @param {Array<string>} keys
 * @param {object} deps As skyLayers'
 * @returns {Array<string>} The keys held for the control now (a key no
 *   survey has is skipped)
 */
export function followControl(scene, keys, deps) {
  const layers = skyLayers(scene, deps)
  const wanted = new Set(keys)
  for (const key of layers.keys()) {
    if (!wanted.has(key)) {
      layers.release(key, 'control')
    }
  }
  for (const key of wanted) {
    layers.acquire(key, 'control')
  }
  return layers.keys().filter((k) => layers.owners(k).has('control'))
}


/**
 * A survey's layer by its key, held for a link's `?sky=` (Scene.showSky).
 *
 * @param {object} scene Scene.js's
 * @param {string} key
 * @param {object} deps As skyLayers'
 * @returns {?HipsLayer} null for a key no survey has
 */
export function showSurvey(scene, key, deps) {
  return skyLayers(scene, deps).acquire(key, 'link')
}
