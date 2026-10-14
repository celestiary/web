/**
 * The homepage (DESIGN.md "Homepage"; design/URLs.md "The bare URL"): what
 * the bare URL shows, with no fragment and no path.  The title, the
 * search and three scene cards over a slow tour of the live scene.  Any
 * link or path goes straight to its scene.
 */


import {decodeNewsToken} from './changelog'


/**
 * The key in the history entry's state that marks it as the homepage's:
 * Back to that entry shows the homepage again (Celestiary._onPopState),
 * and the first link written after leaving it is pushed rather than put
 * in its place (Celestiary._writeLink), so Back can return to it.
 */
export const HOME_HISTORY_KEY = 'celestiaryHome'


/**
 * Whether a location is the bare URL: no fragment (or an empty `#`), and
 * the site's root path (the base the page is served under, with or without
 * its trailing slash, or its index.html).  The query string doesn't count:
 * `?perf=1` and `?hdr=0` still show the homepage.  A link to the changelog
 * tour (`#;news:tour`, changelog.js `decodeNewsToken`) is the homepage's
 * too: it has no path or view, and opens the page on that tour.
 *
 * @param {{hash?: string, pathname?: string}} loc window.location, or like it
 * @param {string} [baseURI] document.baseURI: the site's root
 * @returns {boolean}
 */
export function isHomepage(loc, baseURI) {
  const hash = loc?.hash ?? ''
  if (hash !== '' && hash !== '#' && !decodeNewsToken(hash)) {
    return false
  }
  if (typeof loc?.pathname !== 'string') {
    return false
  }
  let base = '/'
  try {
    base = new URL(baseURI ?? '/', 'http://x').pathname
  } catch {
    base = '/'
  }
  return trimPath(loc.pathname) === trimPath(base)
}


/**
 * @param {string} path
 * @returns {string} Without a trailing index.html or slash
 */
function trimPath(path) {
  return path.replace(/index\.html$/, '').replace(/\/+$/, '')
}


/**
 * @param {?object} state history.state
 * @returns {boolean} Whether it is the homepage's entry
 */
export function isHomeEntry(state) {
  return Boolean(state?.[HOME_HISTORY_KEY])
}


/**
 * The scene cards under the search (ui/Homepage.jsx): tonight's sky
 * (Celestiary.openTonight), then a link each, opened in the app by its own
 * link restore (Celestiary.openLink); and a screenshot each.  The images
 * are public/images/home/<id>.webp, rendered by tools/home/cards.mjs; any
 * 600 × 375 WebP of the view can replace one.
 */
export const HOME_CARDS = Object.freeze([
  {
    // Not a link: the visitor's own sky (tonight.js, Celestiary.openTonight).
    id: 'tonight',
    title: 'Tonight\'s sky',
    text: 'The stars over you tonight, from where you are.',
    link: null,
  },
  {
    id: 'earth',
    title: 'Earth',
    text: 'Dusk reaches South America across the Pacific, a storm turning off Chile.',
    link: 'sun/earth@-38.1501,-99.3434,12.104919Mm;t=9781.4376jd;cq=0.1302,-0.0725,0.0095,0.9888;fov=45deg;s=alpoF',
  },
  {
    id: 'occultation',
    title: 'The Moon hides Jupiter',
    text: 'Jupiter and its moons slip behind the Moon\'s limb, seen from Ohio.',
    link: 'sun/jupiter@41.2054,-82.3901,169m;from=sun/earth;t=9774.891jd;cq=0.3372,-0.7003,-0.112,0.6191;fov=0.91deg;s=oL',
  },
  {
    id: 'gaia',
    title: 'Gaia\'s stars',
    text: 'A million stars from Gaia, and the Milky Way, from 3,200 light-years out.',
    link: 'sun/earth@43.3389,-9.9593,30373373.021376Tm;t=9779.5692jd;cq=-0.436,0.7975,0.0666,0.4116;fov=45deg;ev=1.33;s=alovTF',
  },
])


/**
 * @param {string} id A card's id
 * @returns {string} Its image, relative to the site's root
 */
export function cardImage(id) {
  return `images/home/${id}.webp`
}
