import HipsLayer from './HipsLayer.js'
import {SURVEYS} from './surveys.js'


// A survey's layer in the scene by its key (Sky.md, "Surveys"), for the
// `?sky=` parameter (Scene.showSky) until the surveys have a control of
// their own: the layer under the stellar frame, the survey's credit in the
// footer while its tiles are drawn.

/**
 * @param {string} key A manifest's `key` (`jwst-nircam`), any case
 * @returns {?object} The survey's manifest
 */
export function surveyByKey(key) {
  const wanted = String(key).toLowerCase()
  return SURVEYS.find((s) => s.key === wanted) ?? null
}


/**
 * @param {object} scene Scene.js's
 * @param {string} key
 * @param {object} deps The first load's functions: `sceneReferred`,
 *   `addCredit`, `removeCredit`, and for tests `loadTexture`
 * @returns {?HipsLayer} null for a key no survey has
 */
export function showSurvey(scene, key, deps) {
  const survey = surveyByKey(key)
  if (!survey) {
    return null
  }
  const creditId = `sky-${survey.key}`
  const credit = {text: `${survey.title}: ${survey.credit} (${survey.licence})`, href: survey.source}
  const layer = new HipsLayer({
    survey,
    view: () => {
      const ui = scene.ui
      return {
        camera: ui.camera,
        fovDeg: ui.camera?.fov,
        aspect: ui.camera?.aspect,
        heightPx: ui.renderer?.domElement?.height || ui.height,
      }
    },
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
  return layer
}
