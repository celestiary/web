/**
 * The credits footer's registry (ui/CreditsFooter.jsx; design/UI.md "The
 * credits footer"): every attribution on screen, in one line along the
 * bottom.  Any layer adds its own while its data is drawn and takes it away
 * after: `addCredit(id, credit, opts)`, `removeCredit(id)`, or
 * `setCreditSource` for a credit more than one layer can bring (NASA GIBS:
 * the clouds and Cesium's night lights).  Pure, no DOM: the footer
 * subscribes and draws.
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
 *
 * **On arrival, then fading** (`persistence`, per source: the policy table
 * in CESIUM.md "Credits"):
 * - `'while-shown'` (the default, so a credit nobody has checked stays):
 *   in the line the whole time its data is drawn.  Cesium's (ion's logo,
 *   Bing's), whose terms want them on screen while their data is.
 * - `'timed'`: in the line for CREDIT_SHOW_MS from when its data comes into
 *   the scene, then out over CREDIT_FADE_MS; each credit on its own clock,
 *   so another's arrival doesn't touch it.  One that leaves and comes back
 *   starts again.  Out, it's still applicable: the footer's *Credits*
 *   button shows every applicable credit (CreditsFooter).
 * - `asProminent` (with `'timed'`): held in while any `'while-shown'` credit
 *   is (CC BY-SA's "at least as prominent as the credits for the other
 *   contributors", Gaia's), its window starting when that hold ends.
 * - `keepsLogo` (with `'timed'`): after its window it goes `'compact'`, not
 *   out: Cesium's, whose ion logo stays (ion's terms) while its text and
 *   its Data attribution link go (index.css `.credits-entry.compact`).
 *
 * A credit's window runs only while the chrome is shown (setCreditsChrome,
 * from Celestiary._setNav): one that arrives on the homepage, or whose
 * window the chrome's hiding cut short, shows its whole window when the
 * chrome comes back, if its data is still in.  Each entry carries its
 * `phase`: `'in'`, `'fading'` (CREDIT_FADE_MS, none with reduced motion:
 * setCreditsMotion), then `'out'`, or `'compact'` for one that keeps its
 * logo.
 */
import {sanitizeCredits} from './cesium-guest/credits.js'


/** Where an entry goes without an order of its own: after Cesium's. */
export const DEFAULT_ORDER = 10

/** How long a timed credit stays in the line after its data arrives, ms. */
export const CREDIT_SHOW_MS = 8000

/** Its fade out, ms: the chrome's (index.css --fade-ms). */
export const CREDIT_FADE_MS = 400


const DEFAULT_CLOCK = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
}

const entries = new Map()
const sources = new Map()
const listeners = new Set()
let snapshot = []
let added = 0
let clock = DEFAULT_CLOCK
let timer = null
// The chrome starts hidden (public/index.html's html.chrome-hidden) until
// the first load's reveal shows it.
let chromeShown = false
let fadeMs = CREDIT_FADE_MS


/**
 * Add a credit, or replace the one with this id (keeping its place and its
 * window).
 *
 * @param {string} id
 * @param {object|Array<object>} credit `{text, href?}`, a list of them, or `{element}`
 * @param {object} [opts]
 * @param {number} [opts.order] Lower first; DEFAULT_ORDER by default
 * @param {string} [opts.persistence] 'while-shown' (default) or 'timed'
 * @param {boolean} [opts.asProminent] Timed, but held in while a
 *   'while-shown' credit is in
 * @param {boolean} [opts.keepsLogo] Timed, then compact rather than out
 */
export function addCredit(id, credit, {order = DEFAULT_ORDER, persistence = 'while-shown', asProminent = false,
  keepsLogo = false} = {}) {
  const element = Array.isArray(credit) ? null : credit?.element ?? null
  const items = element ? [] : sanitizeCredits(Array.isArray(credit) ? credit : [credit])
  if (!element && items.length === 0) {
    removeCredit(id)
    return
  }
  const timed = persistence === 'timed'
  const old = entries.get(id)
  if (old && old.element === element && old.order === order && old.timed === timed &&
      old.asProminent === (timed && asProminent) && old.keepsLogo === (timed && keepsLogo) &&
      sameItems(old.items, items)) {
    return
  }
  entries.set(id, {
    id, items, element, order, timed, asProminent: timed && asProminent, keepsLogo: timed && keepsLogo,
    seq: old?.seq ?? ++added,
    // When its window began: null until it runs (the chrome hidden, held).
    start: old ? old.start : null,
  })
  changed()
}


/**
 * @param {string} id
 */
export function removeCredit(id) {
  sources.delete(id)
  if (entries.delete(id)) {
    changed()
  }
}


/**
 * A credit that several layers can bring (NASA GIBS's: Earth's clouds and
 * Cesium's night lights): in while any of its sources holds it, so one
 * handing over to the other doesn't start its window again.
 *
 * @param {string} id
 * @param {string} source Which layer
 * @param {boolean} on Whether that layer's data is drawn
 * @param {object|Array<object>} credit As addCredit's
 * @param {object} [opts] As addCredit's
 */
export function setCreditSource(id, source, on, credit, opts) {
  let held = sources.get(id)
  if (on) {
    if (!held) {
      held = new Set()
      sources.set(id, held)
    }
    if (!held.has(source)) {
      held.add(source)
      addCredit(id, credit, opts)
      // addCredit with nothing to show removes the entry, and its sources.
      if (!entries.has(id)) {
        sources.delete(id)
      }
    }
  } else if (held?.delete(source) && held.size === 0) {
    removeCredit(id)
  }
}


/**
 * A layer's credit following, frame by frame, whether its data is drawn:
 * `apply(true)` the first frame it is, `apply(false)` once it hasn't been
 * for `graceFrames`, so a frame that skips it, or a count that flickers at
 * a threshold, doesn't start the credit's window again.
 *
 * @param {function(boolean): void} apply Adds or removes the credit
 * @param {number} [graceFrames]
 * @returns {function(boolean): void} Called each frame with whether it's drawn
 */
export function followCredit(apply, graceFrames = CREDIT_GRACE_FRAMES) {
  let credited = false
  let undrawn = Infinity
  return (drawn) => {
    undrawn = drawn ? 0 : undrawn + 1
    const on = undrawn < graceFrames
    if (on !== credited) {
      credited = on
      apply(on)
    }
  }
}


/** followCredit's frames without the data before its credit goes. */
export const CREDIT_GRACE_FRAMES = 30


/**
 * @param {string} id
 * @returns {boolean}
 */
export function hasCredit(id) {
  return entries.has(id)
}


/**
 * The credits in their order, each with its phase.  The same array until
 * they change, for React's useSyncExternalStore.
 *
 * @returns {Array<{id: string, items: Array<object>, element: ?object, order: number, seq: number,
 *   persistence: string, keepsLogo: boolean, phase: string}>}
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


/**
 * Whether the chrome is shown (Celestiary._setNav): the credits' windows
 * run only then.
 *
 * @param {boolean} shown
 */
export function setCreditsChrome(shown) {
  if (shown === chromeShown) {
    return
  }
  chromeShown = shown
  changed()
}


/**
 * @param {object} opts
 * @param {boolean} opts.reduced prefers-reduced-motion: no fade, just in and out
 */
export function setCreditsMotion({reduced}) {
  const ms = reduced ? 0 : CREDIT_FADE_MS
  if (ms !== fadeMs) {
    fadeMs = ms
    changed()
  }
}


/**
 * For tests: a clock run by hand.
 *
 * @param {?{now: Function, setTimeout: Function, clearTimeout: Function}} c null for the real one
 */
export function setCreditsClock(c) {
  clock.clearTimeout(timer)
  timer = null
  clock = c ?? DEFAULT_CLOCK
}


/** Remove every credit, and the chrome and motion back to the start's (tests). */
export function clearCredits() {
  clock.clearTimeout(timer)
  timer = null
  chromeShown = false
  fadeMs = CREDIT_FADE_MS
  sources.clear()
  if (entries.size > 0 || snapshot.length > 0) {
    entries.clear()
    changed()
  }
}


/** Each entry's phase now, and a timer for the next change of one. */
function changed() {
  snapshot = phases()
  notify()
}


/** */
function notify() {
  for (const listener of [...listeners]) {
    listener()
  }
}


/**
 * @returns {Array<object>} The snapshot, its phases as of now; schedules the
 *   next phase change
 */
function phases() {
  const now = clock.now()
  const held = [...entries.values()].some((e) => !e.timed)
  let next = Infinity
  const out = []
  for (const e of [...entries.values()].sort((a, b) => (a.order - b.order) || (a.seq - b.seq))) {
    let phase = 'in'
    if (e.timed) {
      const window = CREDIT_SHOW_MS + fadeMs
      if (e.asProminent && held) {
        // Its window starts again when the hold ends.
        e.start = null
      } else if (!chromeShown) {
        // Unseen: a window not yet over starts again at the reveal.
        if (e.start !== null && now - e.start < window) {
          e.start = null
        }
        phase = e.start === null ? 'in' : seenThrough(e)
      } else {
        e.start ??= now
        const t = now - e.start
        if (t < CREDIT_SHOW_MS) {
          next = Math.min(next, e.start + CREDIT_SHOW_MS)
        } else if (t < window) {
          phase = 'fading'
          next = Math.min(next, e.start + window)
        } else {
          phase = seenThrough(e)
        }
      }
    }
    out.push({
      id: e.id, items: e.items, element: e.element, order: e.order, seq: e.seq,
      persistence: e.timed ? 'timed' : 'while-shown', keepsLogo: e.keepsLogo, phase,
    })
  }
  clock.clearTimeout(timer)
  timer = null
  if (next < Infinity) {
    timer = clock.setTimeout(tick, Math.max(0, next - now))
    timer?.unref?.()
  }
  return out
}


/**
 * @param {object} e
 * @returns {string} A timed credit's phase once its window is over
 */
function seenThrough(e) {
  return e.keepsLogo ? 'compact' : 'out'
}


/** A timer's: the phases again, and the listeners told if any changed. */
function tick() {
  timer = null
  const before = snapshot
  const after = phases()
  if (after.length !== before.length || after.some((e, i) => e.phase !== before[i].phase)) {
    snapshot = after
    notify()
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
