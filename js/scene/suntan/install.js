import SuntanTrack from './SuntanTrack.js'
import {missionEvents} from './events.js'
import {buildMission} from './mission.js'
import {formatField, formatTemperature, readSensors} from './sensors.js'


// The Suntan feature in the scene (Suntan.md): the mission built and drawn
// about the Sun when the app first runs (Scene.getSuntan), gone when it
// stops.  Loaded with a dynamic import, so none of it is in the first load,
// and it imports nothing of the first load's but three: Scene hands in the
// functions (as rubin/install.js; rubin/rubin.js says why).

/**
 * @param {object} scene The Scene, with the Sun in it
 * @param {object} deps The first load's functions (Scene.getSuntan):
 *   planetsApprox (the planets' places the mission is built on),
 *   newWideLineStrip, newRings, newLabels, and OVERLAY_LAYER
 * @returns {{mission: object, events: Array<object>, readSensors: Function, formatField: Function,
 *   formatTemperature: Function, track: SuntanTrack, dispose: Function}}
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
  sun.add(track)
  return {
    mission,
    events: missionEvents(mission),
    readSensors,
    formatField,
    formatTemperature,
    track,
    dispose: () => track.dispose(),
  }
}
