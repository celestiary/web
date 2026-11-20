/**
 * The Suntan mission's named moments, for the app panel's jump and step
 * controls (js/ui/SuntanPanel.jsx).  Pure: derived from a built mission.
 */
import {R_SUN} from './kepler.js'


/**
 * @param {object} mission From buildMission
 * @returns {Array<{id: string, name: string, t: number}>} Events in time order; t in Unix seconds
 */
export function missionEvents(mission) {
  const families = mission.orbits.families
  const perihelion = (orbit) => `${(orbit.periapsis / R_SUN).toFixed(2)} Rs`
  const events = [
    {id: 'launch', name: 'Launch', t: mission.tStart},
    ...mission.flybys.map((flyby) => ({id: `venus${flyby.n}`, name: `Venus flyby ${flyby.n}`, t: flyby.t})),
    {id: 'perihelionFirst', name: `First perihelion, ${perihelion(families[0])}`, t: families[0].tPeri},
    {
      id: 'perihelionClosest',
      name: `First perihelion at ${perihelion(families[families.length - 1])}`,
      t: families[families.length - 1].tPeri,
    },
    ...mission.burns.map((burn) => ({id: burn.id, name: burn.name, t: burn.t})),
    {id: 'arrival', name: 'Lander reaches the photosphere', t: mission.tArrive},
  ]
  return events.sort((a, b) => a.t - b.t)
}


/**
 * @param {Array<object>} events From missionEvents
 * @param {number} t Unix seconds
 * @param {number} [margin] Seconds; an event this recently passed still counts as
 *   the current one, so stepping back while time runs leaves it rather than re-entering it
 * @returns {object|undefined} The last event before t
 */
export function previousEvent(events, t, margin = 1) {
  return events.filter((event) => event.t < t - margin).pop()
}


/**
 * @param {Array<object>} events From missionEvents
 * @param {number} t Unix seconds
 * @param {number} [margin] Seconds
 * @returns {object|undefined} The first event after t
 */
export function nextEvent(events, t, margin = 1) {
  return events.find((event) => event.t > t + margin)
}


/**
 * @param {Array<object>} events From missionEvents
 * @param {number} t Unix seconds
 * @returns {object|undefined} The most recent event at or before t
 */
export function currentEvent(events, t) {
  return events.filter((event) => event.t <= t).pop()
}
