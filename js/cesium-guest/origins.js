// Which celestiary may embed the Cesium guest page (design/CesiumGuest.md):
// the guest takes messages only from an allowed origin, posts only to the
// host's, and fetches celestiary's data only from one.  The host finds the
// guest's origin on its own list (CESIUM_GUEST_ORIGINS, below).  Pure.

import {isAllowedOrigin} from '../layer/origins.js'


/* global __CESIUM_GUEST_HOSTS__, __CESIUM_GUEST_ORIGINS__ */
/**
 * The hosts that may embed the guest: celestiary's production site and
 * local development.  A build adds more with CESIUM_GUEST_HOSTS
 * (comma-separated; esbuild/common.js), never at run time.
 */
export const CESIUM_GUEST_HOSTS = [
  'https://celestiary.org',
  'https://celestiary.github.io',
  'http://localhost:*',
  'http://127.0.0.1:*',
  ...listFrom(typeof __CESIUM_GUEST_HOSTS__ === 'string' ? __CESIUM_GUEST_HOSTS__ : ''),
]


/**
 * Where celestiary may load the guest from: its own site on another site's
 * domain (pablo-mayrgundter/cesium-portal's Pages: each *.github.io is a
 * site of its own, so the guest runs in a process of its own;
 * .github/workflows/cesium-guest.yml deploys it there), celestiary's own
 * site (its build serves the guest page too, so a PR preview can load its
 * own: the same origin, so the same process, but the same wire), and local
 * development.  A build adds more with CESIUM_GUEST_ORIGINS.
 */
export const CESIUM_GUEST_ORIGINS = [
  'https://pablo-mayrgundter.github.io',
  'https://celestiary.org',
  'http://localhost:*',
  'http://127.0.0.1:*',
  ...listFrom(typeof __CESIUM_GUEST_ORIGINS__ === 'string' ? __CESIUM_GUEST_ORIGINS__ : ''),
]


/**
 * The guest's page for `?cesiumGuest=<url>`, if its origin is allowed.
 *
 * @param {?string} asked The URL given, or none
 * @param {Array<string>} [allowed]
 * @returns {?URL} The page, or null for none or one not allowed
 */
export function guestPage(asked, allowed = CESIUM_GUEST_ORIGINS) {
  if (!asked) {
    return null
  }
  let url
  try {
    url = new URL(asked)
  } catch {
    return null
  }
  if (!isAllowedOrigin(url.origin, allowed)) {
    return null
  }
  return url.pathname.endsWith('/') ? new URL('cesium-guest.html', url) : url
}


/**
 * The base the guest fetches celestiary's data from (`?data=`), if it is on
 * an allowed host.
 *
 * @param {?string} asked
 * @param {Array<string>} [allowed]
 * @returns {?string}
 */
export function dataBase(asked, allowed = CESIUM_GUEST_HOSTS) {
  if (!asked) {
    return null
  }
  try {
    return isAllowedOrigin(new URL(asked).origin, allowed) ? asked : null
  } catch {
    return null
  }
}


/**
 * @param {string} list Comma-separated
 * @returns {Array<string>}
 */
function listFrom(list) {
  return list.split(',').map((o) => o.trim()).filter(Boolean)
}


/**
 * The guest page celestiary loads with `?cesium=iframe` and no
 * `cesiumGuest`: main's, deployed to cesium-portal's root.  A PR's is under
 * `pr-preview/pr-<n>/` there.
 */
export const DEFAULT_GUEST_PAGE = 'https://pablo-mayrgundter.github.io/cesium-portal/cesium-guest.html'


/**
 * Whether the page asks for Cesium in a page of its own, and which: `?cesium=iframe`, and
 * `?cesiumGuest=<url>` for another copy (a local server, a preview), if allowed.
 *
 * @param {string} search location.search
 * @returns {?URL} The guest page, or null for Cesium on this page
 */
export function guestOptions(search) {
  const params = new URLSearchParams(search ?? '')
  if (params.get('cesium') !== 'iframe') {
    return null
  }
  const asked = params.get('cesiumGuest')
  const page = guestPage(asked)
  if (asked && !page) {
    console.warn(`[cesium layer] ignoring cesiumGuest=${asked}: not an allowed origin (js/cesium-guest/origins.js)`)
  }
  return page ?? new URL(DEFAULT_GUEST_PAGE)
}
