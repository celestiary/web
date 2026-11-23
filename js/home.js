/**
 * The homepage (DESIGN.md "Homepage"; design/URLs.md "The bare URL"): what
 * the bare URL shows, with no fragment and no path.  The title, the
 * search and four scene cards over a slow tour of the live scene.  Any
 * link or path goes straight to its scene.
 */


import {decodeNewsToken} from './changelog.js'


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
 * 600 × 375 WebP of the view can replace one.  Earth's link is at the time
 * it's opened (`t=now`), so its image is one moment of it.
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
    // At the moment it's opened (`t=now`, permalink.js TIME_NOW): over the
    // same ground whatever the hour, its `cq` the body's; no asterisms and
    // no labels (stars', bodies', galaxies'), nor orbits.
    id: 'earth',
    title: 'Earth',
    text: 'The Pacific and South America as they are this minute, under the latest day\'s clouds.',
    link: 'sun/earth@-38.1501,-99.3434,12.104919Mm;t=now;cq=0.3284,-0.0652,-0.0081,0.9423;fov=45deg;s=alpoGF',
  },
  {
    // The Sun's activity view (`layers:sun=euv`; js/scene/Sun.md), a little
    // before a coronal mass ejection lifts off, the clock at 64 times: the
    // eruption plays as the card opens.  Its image is four moments of it
    // (tools/home/cards.mjs).
    id: 'eruption',
    title: 'The Sun erupts',
    text: 'A coronal mass ejection lifts off the Sun, as a space observatory\'s cameras show it.',
    link: 'sun@-50.7478,-141.4986,23.604464Gm;t=8873.409722jd;cq=0.376,-0.4341,0.206,0.7923;fov=5.5deg;s=alpoGxF;' +
      'time:rate=64;layers:sun=euv',
  },
  {
    id: 'gaia',
    title: 'Gaia\'s stars',
    text: 'A million stars from Gaia, and the Milky Way, from 3,200 light-years out.',
    // The Sun's the target, and the frame: zoomed out, the camera goes
    // round the Sun, not an Earth too small to see.
    link: 'sun@27.7228,47.4569,30373373.135557Tm;t=9779.5692jd;cq=-0.436,0.7975,0.0666,0.4116;fov=45deg;ev=1.33;s=alovTF',
  },
])


/**
 * @param {string} id A card's id
 * @returns {string} Its image, relative to the site's root
 */
export function cardImage(id) {
  return `images/home/${id}.webp`
}
