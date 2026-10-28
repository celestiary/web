/**
 * The credits footer's registry (ui/CreditsFooter.jsx; design/UI.md "The
 * credits footer"): every attribution on screen, in one line along the
 * bottom.  Any layer adds its own while its data is drawn and takes it away
 * after: `addCredit(id, credit)`, `removeCredit(id)`.  Pure, no DOM: the
 * footer subscribes and draws.
 *
 * A credit is one item or a list of them:
 * - `{text, href?}`: text, a link if `href` is http(s) (anything else is
 *   dropped: cesium-guest/credits.js sanitizeCredits);
 * - `{element}`: a DOM element the footer mounts as it is, for a library that
 *   manages its own credits (Cesium's CreditDisplay writes into its
 *   `creditContainer`: CesiumLayers' `#cesium-credits`).
 *
 * `order` sorts the entries, lowest first (Cesium's 0, celestiary's own
 * DEFAULT_ORDER), then by when they were added.
 */
import {sanitizeCredits} from './cesium-guest/credits.js'


/** Where an entry goes without an order of its own: after Cesium's. */
export const DEFAULT_ORDER = 10


const entries = new Map()
const listeners = new Set()
let snapshot = []
let added = 0


/**
 * Add a credit, or replace the one with this id.
 *
 * @param {string} id
 * @param {object|Array<object>} credit `{text, href?}`, a list of them, or `{element}`
 * @param {object} [opts]
 * @param {number} [opts.order] Lower first; DEFAULT_ORDER by default
 */
export function addCredit(id, credit, {order = DEFAULT_ORDER} = {}) {
  const element = Array.isArray(credit) ? null : credit?.element ?? null
  const items = element ? [] : sanitizeCredits(Array.isArray(credit) ? credit : [credit])
  if (!element && items.length === 0) {
    removeCredit(id)
    return
  }
  const old = entries.get(id)
  if (old && old.element === element && old.order === order && sameItems(old.items, items)) {
    return
  }
  entries.set(id, {id, items, element, order, seq: old?.seq ?? ++added})
  changed()
}


/**
 * @param {string} id
 */
export function removeCredit(id) {
  if (entries.delete(id)) {
    changed()
  }
}


/**
 * @param {string} id
 * @returns {boolean}
 */
export function hasCredit(id) {
  return entries.has(id)
}


/**
 * The credits in their order.  The same array until they change, for
 * React's useSyncExternalStore.
 *
 * @returns {Array<{id: string, items: Array<object>, element: ?object, order: number}>}
 */
export function getCredits() {
  return snapshot
}


/**
 * @param {function(): void} listener Called after each change
 * @returns {function(): void} Unsubscribes
 */
export function subscribeCredits(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}


/** Remove every credit (tests). */
export function clearCredits() {
  if (entries.size > 0) {
    entries.clear()
    changed()
  }
}


/** */
function changed() {
  snapshot = [...entries.values()].sort((a, b) => (a.order - b.order) || (a.seq - b.seq))
  for (const listener of [...listeners]) {
    listener()
  }
}


/**
 * @param {Array<object>} a
 * @param {Array<object>} b
 * @returns {boolean}
 */
function sameItems(a, b) {
  return a.length === b.length && a.every((x, i) => x.text === b[i].text && x.href === b[i].href && x.img === b[i].img)
}
