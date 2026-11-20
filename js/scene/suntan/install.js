import SuntanTrack, {SUNTAN_CRAFT} from './SuntanTrack.js'
import {prepareCraftModels} from './craftModel.js'
import {missionEvents} from './events.js'
import {buildMission} from './mission.js'
import {formatField, formatTemperature, readSensors} from './sensors.js'


// The Suntan feature in the scene (Suntan.md): the mission built and drawn
// about the Sun when the app first runs (Scene.getSuntan), gone when it
// stops.  Loaded with a dynamic import, so none of it is in the first load,
// and it imports nothing of the first load's but three: Scene hands in the
// functions (as rubin/install.js; rubin/rubin.js says why).

/** The flight system's model, under the site's data (models.md). */
export const SUNTAN_MODEL_PATH = 'large/models/suntan/suntan.glb'

/**
 * @param {object} scene The Scene, with the Sun in it
 * @param {object} deps The first load's functions (Scene.getSuntan):
 *   planetsApprox (the planets' places the mission is built on),
 *   newWideLineStrip, newRings, newLabels, OVERLAY_LAYER, loadModel
 *   (the flight system's model, put on the craft once it's in), and
 *   bodyLine.js's BodyLine and MAX_FINE_STEPS (the legs' lines through the
 *   craft, SuntanTrack.js)
 * @returns {{mission: object, events: Array<object>, readSensors: Function, formatField: Function,
 *   formatTemperature: Function, track: SuntanTrack, craft: object, nodeOf: Function, dispose: Function}}
 */
export function installSuntan(scene, deps) {
  const sun = scene.objects['sun.orbitPosition']
  if (!sun) {
    throw new Error('installSuntan: the Sun must be in the scene')
  }
  // planetsApprox rather than the scene's VSOP87C: the same mission whether
  // or not the series has loaded, and the one the tests and the report
  // build.  Its Venus is within a few arcminutes of VSOP87C's (DESIGN.md,
  // "Before the ephemeris loads"), invisible at the scale of the paths.
  const mission = buildMission(deps.planetsApprox)
  const track = new SuntanTrack(mission, deps, deps.OVERLAY_LAYER)
  sun.add(track, ...Object.values(track.nodes))
  // The flight system's model (design/suntan/cad/, exported by Bldrs Share),
  // fetched with the app, not the page; until it's in, the craft are their
  // marks alone.
  let disposed = false
  deps.loadModel?.(SUNTAN_MODEL_PATH).then((model) => {
    if (!disposed) {
      track.attachModels(prepareCraftModels(model))
    }
  }).catch((err) => console.warn('Suntan: the craft\'s model didn\'t load:', err))
  return {
    mission,
    events: missionEvents(mission),
    readSensors,
    formatField,
    formatTemperature,
    track,
    craft: SUNTAN_CRAFT,
    /**
     * @param {string} id 'relay' or 'lander'
     * @returns {?object} its node, while the mission has it in flight
     */
    nodeOf: (id) => (track.nodes[id]?.inFlight ? track.nodes[id] : null),
    dispose: () => {
      disposed = true
      track.dispose()
    },
  }
}
