import {formatTokenValue, parseTokenValue} from '../permalink.js'


// The Rubin app (ui/RubinApp.jsx, scene/rubin/Rubin.md): its ID in the
// widgets drawer and the permalink, its state and the `apps.rubin` token.

/** The app's ID in the widgets drawer (ui/apps.jsx) and the permalink. */
export const RUBIN_APP_ID = 'rubin'

// What the panel needs of scene/rubin/rubin.js before the feature is
// loaded, repeated here so the panel (in the first load) imports nothing
// of the feature (a dynamic import): a module both import would be split
// into a chunk of its own, one more request on the first load (AGENTS.md).
// rubin.test.js holds them equal.

/** The body the telescope follows. */
export const RUBIN_TARGET = 'ed138'
/** The site, degrees. */
export const RUBIN_SITE = Object.freeze({lat: -30.2446, lng: -70.7494})
/** The discovery images' span, UTC: the nights of March to July 2026. */
export const RUBIN_RUN_START_MS = Date.UTC(2026, 2, 1)
export const RUBIN_RUN_END_MS = Date.UTC(2026, 7, 1)
/** The telescope's lowest elevation, degrees. */
export const RUBIN_MIN_EL_DEG = 20

/** The night chosen for the observing run, by default: a May night. */
export const DEFAULT_NIGHT_MS = Date.UTC(2026, 4, 15)

/**
 * The app's state, as the widgets slice keeps it for the permalink: whether
 * the apparent path is drawn, the night the run's slider is on (ms at
 * 0h UTC), and whether the observatory's shell (the enclosure and dome)
 * is drawn.
 */
export const DEFAULT_RUBIN = Object.freeze({
  path: true,
  nightMs: DEFAULT_NIGHT_MS,
  shell: true,
})

const MS_PER_DAY = 86400e3


/**
 * The `apps.rubin` state token (design/URLs.md): what differs from
 * DEFAULT_RUBIN.
 *
 * @param {object} s A Rubin app state
 * @returns {string|null} The token's value, null if all defaults
 */
export function encodeRubinToken(s) {
  const d = DEFAULT_RUBIN
  const value = formatTokenValue([], {
    path: s.path === d.path ? null : (s.path ? 1 : 0),
    night: s.nightMs === d.nightMs ? null : Math.round(s.nightMs / MS_PER_DAY),
    shell: s.shell === d.shell ? null : (s.shell ? 1 : 0),
  })
  return value || null
}


/**
 * @param {string} [value] The `apps.rubin` token's value
 * @returns {object} A Rubin app state over DEFAULT_RUBIN; a bad value is its
 *   default
 */
export function decodeRubinToken(value) {
  const {named} = parseTokenValue(value)
  const d = DEFAULT_RUBIN
  const night = Number(named.night)
  return {
    path: named.path === '1' ? true : named.path === '0' ? false : d.path,
    nightMs: named.night && Number.isInteger(night) && night > 0 ? night * MS_PER_DAY : d.nightMs,
    shell: named.shell === '1' ? true : named.shell === '0' ? false : d.shell,
  }
}


/**
 * Ask the Rubin app to watch the night: open it (the drawer on it, the
 * app running) and set `watch` in its state, which the panel acts on once
 * the observatory is in (RubinApp.jsx), then clears.  The search's "Watch
 * 2026 ED138 from the Rubin Observatory" (appViews.js).
 * Not in the link: encodeRubinToken leaves it out.
 *
 * @param {object} store The zustand store (useStore)
 */
export function askRubinWatch(store) {
  const {dispatchWidgets} = store.getState()
  dispatchWidgets({type: 'openApp', id: RUBIN_APP_ID})
  const current = store.getState().widgets.appStates[RUBIN_APP_ID] ?? DEFAULT_RUBIN
  dispatchWidgets({type: 'appState', id: RUBIN_APP_ID, appState: {...current, watch: true}})
}
