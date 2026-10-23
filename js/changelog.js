import {parseTokenValue} from './permalink'
import {validSocial} from './socialLinks.mjs'
import STAMP from './changelogStamp.json'


/**
 * The changelog in the app (DESIGN.md "What's new"): `public/data/changelog.json`
 * (built from CHANGELOG.md by `yarn changelog`; tools/changelog/README.md)
 * read for the homepage's What's new, its "new since your last visit"
 * marker, and the changelog tour's stops and captions.  Pure, so the
 * tests drive it without a DOM.
 */


/**
 * The JSON, a small file under public/data, so a plain relative URL
 * (DESIGN.md "Data policy"), resolved against the page's `<base href>`.
 */
export const CHANGELOG_URL = 'data/changelog.json'

/** The browser-storage key for the newest entry date the visitor has seen. */
export const LAST_SEEN_KEY = 'celestiary.whatsNew.lastSeen'

/** And for What's new's filter (JSON: `{featuredOnly, features, fixes}`). */
export const FILTER_KEY = 'celestiary.whatsNew.filter'

/**
 * The first filter's key: '1' meant "all updates", the featured only being
 * the default.  Read as the filter's `featuredOnly: false` if there is no
 * new one, and dropped when the new one is written.
 */
export const SHOW_ALL_KEY = 'celestiary.whatsNew.showAll'

/** What's new's filter by default: the featured updates, features and fixes. */
export const DEFAULT_FILTER = Object.freeze({featuredOnly: true, features: true, fixes: true})

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATE_LENGTH = 10
const URL_PATTERN = /^https?:\/\//
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December']
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))


/**
 * The entries of a changelog.json, checked and normalised, newest first.
 * An entry without a headline or a `YYYY-MM-DD` date is dropped, and so is
 * anything in it that isn't the shape the app reads (a link that isn't an
 * http(s) URL), so a bad file shows what it can rather than breaking the
 * page.
 *
 * @param {any} data The parsed JSON: `{entries: [...]}`
 * @returns {Array<{id: string, date: string, headline: string, text: string,
 *   links: Array<{kind: string, number: number, url: string}>,
 *   epic: ?{number: number, title: string, url: string},
 *   permalink: ?string, image: ?{src: string, alt: string}, featured: boolean, kind: string,
 *   social: ?{x?: string, facebook?: string}}>} `permalink`
 *   is the fragment without its '#' (a card's form: Celestiary.openLink);
 *   `featured` is the entries worth announcing, which What's new shows
 *   first; `kind` is 'fix' for a fix and 'feature' otherwise (independent of
 *   `featured`: a major fix can be featured); `social` is the URLs of the live posts about it, only those on
 *   X's and Facebook's own hosts over https (socialLinks.mjs)
 */
export function parseChangelog(data) {
  const list = Array.isArray(data?.entries) ? data.entries : []
  const entries = []
  for (const e of list) {
    if (typeof e?.headline !== 'string' || !e.headline || !DATE_PATTERN.test(e.date ?? '')) {
      continue
    }
    const links = (Array.isArray(e.links) ? e.links : [])
        .filter((l) => typeof l?.url === 'string' && URL_PATTERN.test(l.url) && Number.isFinite(l.number))
        .map((l) => ({kind: String(l.kind), number: l.number, url: l.url}))
    const epic = typeof e.epic?.url === 'string' && URL_PATTERN.test(e.epic.url) ?
      {number: e.epic.number, title: String(e.epic.title ?? ''), url: e.epic.url} : null
    const permalink = typeof e.permalink === 'string' && e.permalink.length > 1 && e.permalink.startsWith('#') ?
      e.permalink.slice(1) : null
    const image = typeof e.image?.src === 'string' && e.image.src ?
      {src: e.image.src, alt: String(e.image.alt ?? '')} : null
    entries.push({
      id: typeof e.id === 'string' && e.id ? e.id : `${e.date}-${e.headline}`,
      date: e.date,
      headline: e.headline,
      text: typeof e.text === 'string' ? e.text : '',
      links,
      epic,
      permalink,
      image,
      featured: e.featured === true,
      kind: e.kind === 'fix' ? 'fix' : 'feature',
      social: validSocial(e.social),
    })
  }
  // Newest first; the sort is stable, so a day's entries stay in the file's order.
  return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}


/**
 * Fetch and parse the changelog.
 *
 * @param {Function} [fetchFn] fetch, or like it
 * @param {string} [url]
 * @returns {Promise<Array<object>>} The entries (parseChangelog); rejects if
 *   the file can't be fetched or isn't JSON
 */
export async function loadChangelog(fetchFn = (...args) => globalThis.fetch(...args), url = CHANGELOG_URL) {
  const rsp = await fetchFn(url)
  if (!rsp?.ok) {
    throw new Error(`changelog: ${rsp?.status ?? 'no response'}`)
  }
  return parseChangelog(await rsp.json())
}


/**
 * @returns {?Storage} The browser's local storage, or null where there is
 *   none: the accessor itself throws in a private window or with site data
 *   blocked
 */
export function localStorageOrNull() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}


/**
 * @param {?Storage} [storage]
 * @returns {?string} The newest entry date the visitor has seen
 *   (`YYYY-MM-DD`), or null: none stored, a bad value, or storage that
 *   throws
 */
export function readLastSeen(storage = localStorageOrNull()) {
  try {
    const value = storage?.getItem(LAST_SEEN_KEY)
    return DATE_PATTERN.test(value ?? '') ? value : null
  } catch {
    return null
  }
}


/**
 * @param {string} date `YYYY-MM-DD`
 * @param {?Storage} [storage]
 * @returns {boolean} Whether it was stored
 */
export function writeLastSeen(date, storage = localStorageOrNull()) {
  try {
    if (!storage || !DATE_PATTERN.test(date ?? '')) {
      return false
    }
    storage.setItem(LAST_SEEN_KEY, date)
    return true
  } catch {
    return false
  }
}


/**
 * What is new to this visitor, on the homepage.  The first time (nothing
 * stored) nothing is new: they haven't seen the older entries to be told
 * about the newer, so the newest date is stored as where they are.  After
 * that, the entries dated after the one they last saw.  With storage that
 * throws, nothing is ever new: the page works without the marker.
 *
 * @param {Array<{date: string}>} entries Newest first (parseChangelog)
 * @param {?Storage} [storage]
 * @returns {{since: ?string, fresh: Array<object>}} The date they last saw
 *   (null on a first visit or with no storage), and the entries after it
 */
export function checkNew(entries, storage = localStorageOrNull()) {
  const latest = entries[0]?.date
  if (!latest) {
    return {since: null, fresh: []}
  }
  const since = readLastSeen(storage)
  if (since === null) {
    writeLastSeen(latest, storage)
    return {since: null, fresh: []}
  }
  return {since, fresh: entries.filter((e) => e.date > since)}
}


/**
 * The changelog's dates without the changelog (#258): `js/changelogStamp.json`,
 * built with changelog.json by `yarn changelog` and carried in the app's
 * bundle, so What's new's marker needs no fetch.  An entry a date, as many as
 * the changelog has that day, for checkNew and markSeen.
 *
 * @param {{dates: Array<[string, number]>, featured?: Array<[string, number]>}} [stamp]
 * @param {string} [key] 'dates' for every entry, 'featured' for the featured
 *   ones (the "new" marker counts those; a stamp without them has none)
 * @returns {Array<{date: string}>} Newest first
 */
export function stampEntries(stamp = STAMP, key = 'dates') {
  const out = []
  for (const [date, count] of Array.isArray(stamp?.[key]) ? stamp[key] : []) {
    if (DATE_PATTERN.test(date ?? '') && Number.isInteger(count)) {
      for (let i = 0; i < count; i++) {
        out.push({date})
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}


/**
 * How many entries the "new" marker counts: the featured ones after the date
 * the visitor last saw.  The marker is for what's worth a look, which is what
 * What's new opens on; the lesser updates are there when asked for.
 *
 * @param {Array<{date: string}>} featured The featured entries' dates (stampEntries(stamp, 'featured'))
 * @param {?string} since checkNew's `since`: null on a first visit
 * @returns {number}
 */
export function unseenCount(featured, since) {
  return since ? featured.filter((e) => e.date > since).length : 0
}


/**
 * The ids of the entries new to the visitor, once the changelog is in:
 * those dated after the date they had last seen (checkNew's `since`).
 *
 * @param {Array<{id: string, date: string}>} entries
 * @param {?string} since
 * @returns {Set<string>}
 */
export function freshIds(entries, since) {
  return new Set(since ? entries.filter((e) => e.date > since).map((e) => e.id) : [])
}


/**
 * The visitor has seen the entries (the What's new panel is open): the
 * marker goes.
 *
 * @param {Array<{date: string}>} entries Newest first
 * @param {?Storage} [storage]
 * @returns {boolean} Whether it was stored
 */
export function markSeen(entries, storage = localStorageOrNull()) {
  const latest = entries[0]?.date
  return latest ? writeLastSeen(latest, storage) : false
}


/**
 * @param {any} value A stored filter, parsed
 * @returns {{featuredOnly: boolean, features: boolean, fixes: boolean}} It, with
 *   what isn't a boolean as the default's, and never with neither kind
 *   selected (the list would be empty with nothing to say why)
 */
export function normalizeFilter(value) {
  const pick = (key) => (typeof value?.[key] === 'boolean' ? value[key] : DEFAULT_FILTER[key])
  const filter = {featuredOnly: pick('featuredOnly'), features: pick('features'), fixes: pick('fixes')}
  if (!filter.features && !filter.fixes) {
    filter.features = true
    filter.fixes = true
  }
  return filter
}


/**
 * @param {?Storage} [storage]
 * @returns {{featuredOnly: boolean, features: boolean, fixes: boolean}} The
 *   visitor's filter: the default with nothing stored, a bad value or storage
 *   that throws; from the earlier key ("all updates") if that is all there is
 */
export function readFilter(storage = localStorageOrNull()) {
  try {
    const stored = storage?.getItem(FILTER_KEY)
    if (stored) {
      return normalizeFilter(JSON.parse(stored))
    }
    return storage?.getItem(SHOW_ALL_KEY) === '1' ? {...DEFAULT_FILTER, featuredOnly: false} : {...DEFAULT_FILTER}
  } catch {
    return {...DEFAULT_FILTER}
  }
}


/**
 * @param {{featuredOnly: boolean, features: boolean, fixes: boolean}} filter
 * @param {?Storage} [storage]
 * @returns {boolean} Whether it was stored
 */
export function writeFilter(filter, storage = localStorageOrNull()) {
  try {
    if (!storage) {
      return false
    }
    storage.setItem(FILTER_KEY, JSON.stringify(normalizeFilter(filter)))
    // The earlier key is superseded.
    storage.removeItem(SHOW_ALL_KEY)
    return true
  } catch {
    return false
  }
}


/**
 * One press of the filter's controls.  "Featured only" flips.  A kind flips,
 * except that the last one selected can't be turned off: pressing it
 * selects the other kind instead (like a radio), so the list is never empty
 * for want of a kind.
 *
 * @param {{featuredOnly: boolean, features: boolean, fixes: boolean}} filter
 * @param {string} control 'featuredOnly', 'features' or 'fixes'
 * @returns {{featuredOnly: boolean, features: boolean, fixes: boolean}} The new filter
 */
export function toggleFilter(filter, control) {
  if (control === 'featuredOnly') {
    return {...filter, featuredOnly: !filter.featuredOnly}
  }
  const other = control === 'features' ? 'fixes' : 'features'
  if (control !== 'features' && control !== 'fixes') {
    return {...filter}
  }
  if (filter[control] && !filter[other]) {
    return {...filter, [control]: false, [other]: true}
  }
  return {...filter, [control]: !filter[control]}
}


/**
 * What What's new lists: the entries that pass the filter: featured if
 * "featured only" is on, and of a kind that is selected.  A changelog with no
 * featured entry at all isn't narrowed by "featured only" (a file without the
 * tag shows everything rather than nothing).
 *
 * @param {Array<{featured: boolean, kind: string}>} entries
 * @param {?{featuredOnly: boolean, features: boolean, fixes: boolean}} filter null: all of them
 * @returns {Array<object>}
 */
export function visibleEntries(entries, filter) {
  if (!filter) {
    return entries
  }
  const featuredOnly = filter.featuredOnly && entries.some((e) => e.featured)
  return entries.filter((e) => (!featuredOnly || e.featured) && (e.kind === 'fix' ? filter.fixes : filter.features))
}


/**
 * The changelog tour's stops: the entries that have a permalink, newest
 * first, from a chosen entry on (toward the older ones).  The tour follows
 * What's new's filter (visibleEntries).
 *
 * @param {Array<object>} entries Newest first (parseChangelog)
 * @param {object} [opts]
 * @param {?string} [opts.from] An entry's id, or a date (`YYYY-MM-DD`): the
 *   newest entry on or before it.  An id that isn't there falls back on the
 *   date it begins with, so a link to an entry survives its headline being
 *   reworded; anything else starts at the newest.
 * @param {number} [opts.count] At most this many stops
 * @param {?object} [opts.filter] What's new's filter (visibleEntries); null: every entry with a view
 * @returns {Array<object>}
 */
export function tourStops(allEntries, {from = null, count = Infinity, filter = null} = {}) {
  const entries = visibleEntries(allEntries, filter)
  let start = 0
  if (from) {
    const byId = entries.findIndex((e) => e.id === from)
    const date = from.slice(0, DATE_LENGTH)
    if (byId !== -1) {
      start = byId
    } else if (DATE_PATTERN.test(date)) {
      const byDate = entries.findIndex((e) => e.date <= date)
      start = byDate === -1 ? entries.length : byDate
    }
  }
  const stops = entries.slice(start).filter((e) => e.permalink)
  return Number.isFinite(count) && count >= 0 ? stops.slice(0, Math.floor(count)) : stops
}


/** The longest a caption's sentence runs, characters, before it is cut at a word. */
export const CAPTION_MAX_CHARS = 220
// A first sentence shorter than this is joined by the next, if it fits.
const CAPTION_SHORT_CHARS = 70


/**
 * An entry's caption for the changelog tour: its headline, and a sentence
 * or two of its text: the first sentence, with the next if the first is
 * short, cut at a word if it still runs long.  Markdown's backticks are
 * dropped.
 *
 * @param {{headline: string, text: string}} entry
 * @returns {{headline: string, sentence: string}}
 */
export function tourCaption(entry) {
  const headline = entry.headline.replace(/`/g, '')
  const paragraph = (entry.text ?? '').split(/\n\s*\n/)[0].replace(/`/g, '').replace(/\s+/g, ' ').trim()
  // Split where a sentence ends and another starts; not at a decimal point
  // or an abbreviation's dot before a lower-case word.
  const sentences = paragraph.replace(/([.!?])\s+(?=[A-Z"'(])/g, '$1\u0001').split('\u0001').filter(Boolean)
  let sentence = sentences[0] ?? ''
  if (sentence.length < CAPTION_SHORT_CHARS && sentences[1] &&
      sentence.length + 1 + sentences[1].length <= CAPTION_MAX_CHARS) {
    sentence = `${sentence} ${sentences[1]}`
  }
  if (sentence.length > CAPTION_MAX_CHARS) {
    const cut = sentence.slice(0, CAPTION_MAX_CHARS - 1)
    sentence = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).replace(/[\s,;:.]+$/, '')}…`
  }
  return {headline, sentence}
}


/** A caption stays at least this long, ms, and at most MAX. */
export const HOLD_MIN_MS = 6000
export const HOLD_MAX_MS = 14000
// And this long to read, besides a settling beat, per character.
const HOLD_BASE_MS = 3000
const HOLD_PER_CHAR_MS = 45


/**
 * How long a stop is held once the camera is there: time to read its
 * caption at an easy pace, ms.
 *
 * @param {{headline: string, sentence: string}} caption (tourCaption)
 * @returns {number}
 */
export function holdMs(caption) {
  const chars = caption.headline.length + caption.sentence.length
  return Math.min(Math.max(HOLD_BASE_MS + (HOLD_PER_CHAR_MS * chars), HOLD_MIN_MS), HOLD_MAX_MS)
}


/**
 * @param {string} date `YYYY-MM-DD`
 * @param {boolean} [short] "13 Oct 2026" rather than "13 October 2026"
 * @returns {string} The date in words (not locale-dependent: the entries
 *   are dated in UTC days); the input if it isn't a date
 */
export function formatEntryDate(date, short = false) {
  if (!DATE_PATTERN.test(date ?? '')) {
    return String(date ?? '')
  }
  const [year, month, day] = date.split('-').map(Number)
  const name = (short ? MONTHS_SHORT : MONTHS)[month - 1]
  return name ? `${day} ${name} ${year}` : date
}


// The state token (design/URLs.md "News tour token"): `news:tour`, with
// optional `from=<entry id or date>` and `n=<stops>`, in a fragment that
// starts with `;` (no path, no view): `#;news:tour,from=2026-10-10,n=3`.
const NEWS_LABEL = 'news'
const TOKEN_SEP = ';'


/**
 * The changelog tour a fragment asks for.  A fragment is a tour link when it
 * has no path or view (it starts with `;`) and carries `news:tour`.  One
 * that has the HUD off (`s=` with `v`) is not: the quiet-load rule, that a
 * link which turns everything off shows nothing of the app's own.
 *
 * @param {string} fragment The hash, with or without its '#'
 * @returns {?{from: ?string, count: number}} null if it isn't one
 */
export function decodeNewsToken(fragment) {
  const raw = (fragment ?? '').replace(/^#/, '')
  if (!raw.startsWith(TOKEN_SEP)) {
    return null
  }
  let token = null
  for (const pair of raw.split(TOKEN_SEP)) {
    const colon = pair.indexOf(':')
    const eq = pair.indexOf('=')
    if (colon !== -1 && (eq === -1 || colon < eq) && pair.slice(0, colon) === NEWS_LABEL) {
      token = pair.slice(colon + 1)
    } else if (pair.startsWith('s=') && pair.includes('v')) {
      return null
    }
  }
  if (token === null) {
    return null
  }
  const {flags, named} = parseTokenValue(token)
  if (!flags.includes('tour')) {
    return null
  }
  const count = Math.floor(Number(named.n))
  return {
    from: /^[A-Za-z0-9._-]+$/.test(named.from ?? '') ? named.from : null,
    count: Number.isFinite(count) && count > 0 ? count : Infinity,
  }
}


/**
 * @param {object} [opts]
 * @param {?string} [opts.from] An entry's id or a date
 * @param {number} [opts.count] Stops; all if not finite
 * @returns {string} The tour's fragment, without its '#'
 */
export function encodeNewsToken({from = null, count = Infinity} = {}) {
  const parts = ['tour']
  if (from) {
    parts.push(`from=${from}`)
  }
  if (Number.isFinite(count) && count > 0) {
    parts.push(`n=${Math.floor(count)}`)
  }
  return `${TOKEN_SEP}${NEWS_LABEL}:${parts.join(',')}`
}
