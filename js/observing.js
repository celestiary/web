/**
 * The observing theme (design/UI.md, "The observing (red) theme"): for using
 * the app outdoors at night, as through a red torch.  Every pixel's light
 * goes to the red channel by its luminance, the scene's included, so the
 * screen sends out nothing the eye's rods see and its dark adaptation keeps.
 * The page does it with two layers over everything (public/index.html,
 * `#observing-grey` and `#observing-red`, shown by `data-theme="observing"`
 * on <html>): the first greys what's behind it (`backdrop-filter:
 * grayscale(1)`), the second multiplies that by pure red.
 *
 * It's the link's `R` (permalink.js SETTINGS_DEFAULTS), or this device's
 * last choice (localStorage, OBSERVING_KEY), decided before the first paint
 * by the page's `observing` script; a link that doesn't ask for it never
 * turns it off.
 */


/** The device's choice in localStorage; public/index.html reads it too. */
export const OBSERVING_KEY = 'celestiary-observing'

/** The Sun's altitude under which it's dark enough to offer it: civil dusk, degrees. */
export const DARK_SUN_DEG = -6


/**
 * @param {?object} root <html>
 * @returns {boolean} Whether the page's first script turned it on
 */
export function observingAtLoad(root = globalThis.document?.documentElement) {
  return root?.dataset?.theme === 'observing'
}


/**
 * @param {?object} root <html>
 * @param {boolean} on
 */
export function setObservingTheme(root, on) {
  if (!root?.dataset) {
    return
  }
  if (on) {
    root.dataset.theme = 'observing'
  } else {
    delete root.dataset.theme
  }
}


/**
 * Keep the device's choice, for its next visit.  Storage can throw (a
 * private window, blocked site data): then it's for this page only.
 *
 * @param {?object} storage localStorage
 * @param {boolean} on
 */
export function storeObserving(storage, on) {
  try {
    if (on) {
      storage?.setItem(OBSERVING_KEY, '1')
    } else {
      storage?.removeItem(OBSERVING_KEY)
    }
  } catch {
    // This page only.
  }
}


/**
 * Whether entering AR should offer the theme: on Earth after dark, once a
 * page, when it isn't on already.
 *
 * @param {object} state
 * @param {boolean} state.observing
 * @param {boolean} state.offered Already offered on this page
 * @param {?string} state.body The body AR stands on
 * @param {number} state.sunAltitudeDeg At the observer, now
 * @returns {boolean}
 */
export function shouldOfferObserving({observing, offered, body, sunAltitudeDeg}) {
  return !observing && !offered && body === 'earth' && sunAltitudeDeg < DARK_SUN_DEG
}
