// The Earth breathing app (ui/apps.jsx, ui/breathingApp.js; design/URLs.md,
// the time token's day steps): its ID in the widgets drawer and the
// permalink, the view it opens on, its speeds, and its ways in and out.  In
// the first load, small; the panel is a chunk of its own, loaded on open.

/** The app's ID in the widgets drawer (ui/apps.jsx) and the permalink. */
export const BREATHING_APP_ID = 'breathing'

/**
 * The view the app opens on (a fragment, without its '#'): Earth from 7 Mm
 * over 50° N 69.9° E (Kazakhstan's steppe, Siberia's snow and the Himalaya
 * in view), at solar noon on 8 January 2026, the clock stepping a day at a
 * time at 32 days a second (a year in 11 s; a speed of the panel's), the camera turning with Earth (`Y`); the
 * overlays as the user has them.  The same view every time: a year from midwinter, not the
 * camera's place (the time panel's toggle steps from wherever the camera
 * is).
 */
export const BREATHING_VIEW = 'sun/earth@50,69.8893,7Mm;t=9504.810753jd;cq=-0.5614,0.2476,0.1411,0.7769;' +
  'fov=45deg;s=FY;time:step=1d,rate=32'

/** The panel's speeds, days a second: Time's steps while stepping by days. */
export const BREATHING_SPEEDS = Object.freeze([1, 4, 8, 16, 32, 64])

const DAY_S = 86400


/**
 * The `apps.breathing` state token: the app keeps none of its own, the
 * clock (`time:`) and the view are the link's already.
 *
 * @returns {null}
 */
export function encodeBreathingToken() {
  return null
}


/** @returns {object} The app's state: none */
export function decodeBreathingToken() {
  return {}
}


/**
 * Open the app on its view: the drawer on the app, and a flight to
 * BREATHING_VIEW, whose arrival starts the day steps (the link's `time:`).
 * The tray's tile and the search's "Earth breathing" (appViews.js).
 *
 * @param {object} celestiary
 */
export function startBreathing(celestiary) {
  celestiary.ui.useStore.getState().dispatchWidgets({type: 'openApp', id: BREATHING_APP_ID})
  celestiary.openLink(BREATHING_VIEW)
}


/**
 * Stop the app (ui/apps.jsx `stop`): the clock back to running at real
 * time, continuously, and the camera, which the app's view turns with Earth
 * (`Y`), back to the height's choice.  Paused stays paused.
 *
 * @param {object} celestiary
 */
export function stopBreathing(celestiary) {
  celestiary.time.setStepDays(0)
  celestiary.time.setRate(1)
  const mode = celestiary.scene?.cameraMode?.()
  if (mode?.mode === 'turning' && !mode.auto) {
    celestiary.scene.setCameraMode('auto')
  }
}


/**
 * @param {number} timeScale Time's, while stepping by days
 * @returns {number} Days a second
 */
export function daysPerSecond(timeScale) {
  return timeScale / DAY_S
}
