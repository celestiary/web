import {formatTokenValue, parseTokenValue} from '../permalink.js'


// The Suntan app (ui/SuntanApp.jsx, scene/suntan/Suntan.md): its ID in the
// widgets drawer and the permalink, its state and the `apps.suntan` token.
// The panel is in the first load and the mission isn't (Scene.getSuntan),
// so what the panel needs before the mission is in lives here.

/** The app's ID in the widgets drawer (ui/apps.jsx) and the permalink. */
export const SUNTAN_APP_ID = 'suntan'

/**
 * The app's state, as the widgets slice keeps it for the permalink: which
 * craft's sensors the panel reads, and whether the trajectory is drawn.
 */
export const DEFAULT_SUNTAN = Object.freeze({
  vehicle: 'relay',
  paths: true,
})

/** The craft the panel can read. */
export const SUNTAN_VEHICLES = Object.freeze(['relay', 'lander'])

const DAY_S = 86400
const HOUR_S = 3600

/**
 * The panel's speeds, as Time's rate (a power of two of real time): from
 * the lander's last hour, minutes a second, to the seven-year approach,
 * weeks a second.
 */
export const SUNTAN_RATES = Object.freeze([2 ** 6, 2 ** 12, 2 ** 16, 2 ** 19, 2 ** 22])


/**
 * The `apps.suntan` state token (design/URLs.md): what differs from
 * DEFAULT_SUNTAN.
 *
 * @param {object} s A Suntan app state
 * @returns {string|null} The token's value, null if all defaults
 */
export function encodeSuntanToken(s) {
  const d = DEFAULT_SUNTAN
  const value = formatTokenValue([], {
    vehicle: s.vehicle === d.vehicle || !SUNTAN_VEHICLES.includes(s.vehicle) ? null : s.vehicle,
    paths: (s.paths !== false) === d.paths ? null : (s.paths === false ? 0 : 1),
  })
  return value || null
}


/**
 * @param {string} [value] The `apps.suntan` token's value
 * @returns {object} A Suntan app state over DEFAULT_SUNTAN; a bad value is
 *   its default
 */
export function decodeSuntanToken(value) {
  const {named} = parseTokenValue(value)
  const d = DEFAULT_SUNTAN
  return {
    vehicle: SUNTAN_VEHICLES.includes(named.vehicle) ? named.vehicle : d.vehicle,
    paths: named.paths === '0' ? false : named.paths === '1' ? true : d.paths,
  }
}


/**
 * @param {number} rate Time's rate, simulated seconds a second
 * @returns {string} What it means, e.g. '18 h/s'; negative is backwards
 */
export function rateLabel(rate) {
  const sign = rate < 0 ? '−' : ''
  const r = Math.abs(rate)
  if (r >= DAY_S) {
    return `${sign}${Math.round(r / DAY_S)} d/s`
  }
  if (r >= HOUR_S) {
    return `${sign}${Math.round(r / HOUR_S)} h/s`
  }
  return r >= 60 ? `${sign}${Math.round(r / 60)} min/s` : `${sign}${r}×`
}


/**
 * @param {number} wattsPerSquareMetre
 * @returns {string}
 */
export function formatSunlight(wattsPerSquareMetre) {
  return wattsPerSquareMetre >= 1e6 ?
    `${(wattsPerSquareMetre / 1e6).toFixed(1)} MW/m²` : `${(wattsPerSquareMetre / 1e3).toFixed(0)} kW/m²`
}


/**
 * Open the Suntan app: the drawer on it, the app running, which builds the
 * mission.  The search's "Suntan: fly a concept mission to the Sun"
 * (appViews.js), there from the first load, so the app can be looked up
 * from the homepage.
 *
 * @param {Function} store The zustand store (useStore)
 */
export function askSuntan(store) {
  store.getState().dispatchWidgets({type: 'openApp', id: SUNTAN_APP_ID})
}
