/**
 * What each platform counts, and what a post may say (tools/posts/README.md).
 * Pure functions, tested in text.test.js.
 */

// The account the posts go out from on X.
export const X_HANDLE = '@celestiary_org'

/**
 * The platforms, in the order they are checked and written: a table, so a
 * platform is added with a row.
 *
 * - `limit`: the most a post may be (X's own; Facebook's is far higher, 63,206,
 *   so this is the length we write to).  `min`: a post shorter than this is
 *   noted, not refused.
 * - `count`: how it counts text: `weighted` (X: Latin and punctuation 1, CJK
 *   and emoji 2), `graphemes` (what a reader sees as one character) or
 *   `characters` (code points).
 * - `linkCost`: what a link counts as, whatever its length (X's t.co is 23); a
 *   number, or null to count it as written.  For Facebook it is a choice: a
 *   link's own length isn't prose, so the target is for the text around it.
 * - `bareLinks`: a bare domain (`celestiary.org`) is a link too.
 */
export const PLATFORMS = Object.freeze({
  x: Object.freeze({key: 'x', name: 'X', limit: 280, count: 'weighted', linkCost: 23, bareLinks: true}),
  facebook: Object.freeze({key: 'facebook', name: 'Facebook', limit: 500, min: 300, count: 'characters', linkCost: 23, bareLinks: false}),
})

// Top-level domains X turns into a link when typed bare ("celestiary.org").
const BARE_TLDS = 'org|com|net|io|dev|app|space|gov|edu|co|uk|info|ai'
const LINK_PATTERN = new RegExp(
    `https?://[^\\s]+|(?<![\\w@./:-])(?:[a-z0-9-]+\\.)+(?:${BARE_TLDS})\\b(?:[/?#][^\\s]*)?`, 'gi')
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/
const SEGMENTER = new Intl.Segmenter('en', {granularity: 'grapheme'})


/**
 * Where the links are in a text.  A trailing full stop, comma or bracket
 * isn't part of the link.
 *
 * @param {string} text
 * @returns {Array<{start: number, end: number, url: string, bare: boolean}>} In order;
 *   `bare` is a domain with no scheme, which X links and Facebook's count doesn't take for one
 */
export function findLinks(text) {
  const found = []
  for (const m of text.matchAll(LINK_PATTERN)) {
    const url = m[0].replace(TRAILING_PUNCTUATION, '')
    if (url.length > 0) {
      found.push({start: m.index, end: m.index + url.length, url, bare: !/^https?:\/\//i.test(url)})
    }
  }
  return found
}


/**
 * @param {number} cp A code point
 * @returns {number} What X weighs it at: 1 for the Latin, punctuation and
 *   general-punctuation ranges, 2 for the rest (CJK, emoji)
 */
export function xWeight(cp) {
  if ((cp >= 0 && cp <= 0x10FF) || (cp >= 0x2000 && cp <= 0x200D) ||
      (cp >= 0x2010 && cp <= 0x201F) || (cp >= 0x2032 && cp <= 0x2037)) {
    return 1
  }
  return 2
}


/**
 * @param {string} s
 * @param {string} how A `count` of the platforms' table
 * @returns {number}
 */
function countText(s, how) {
  if (how === 'weighted') {
    let total = 0
    for (const ch of s) {
      total += xWeight(ch.codePointAt(0))
    }
    return total
  }
  if (how === 'graphemes') {
    return [...SEGMENTER.segment(s)].length
  }
  return [...s].length
}


/**
 * How long a text is on a platform, links counted as it counts them.
 *
 * @param {string} platform A key of PLATFORMS
 * @param {string} text
 * @returns {number}
 */
export function measure(platform, text) {
  const p = PLATFORMS[platform]
  if (!p) {
    throw new Error(`Unknown platform ${platform}`)
  }
  let total = 0
  let at = 0
  for (const link of findLinks(text)) {
    if (link.bare && !p.bareLinks) {
      continue
    }
    total += countText(text.slice(at, link.start), p.count)
    at = link.end
    total += p.linkCost ?? countText(link.url, p.count)
  }
  return total + countText(text.slice(at), p.count)
}


/**
 * @param {string} text
 * @returns {object} By platform key, `{count, limit, over, short}`
 */
export function measureAll(text) {
  return Object.fromEntries(Object.values(PLATFORMS).map(({key, limit, min = 0}) => {
    const count = measure(key, text)
    return [key, {count, limit, over: count > limit, short: count < min}]
  }))
}


// Words a post for a general audience doesn't need.
const HYPE = [
  'amazing', 'incredible', 'stunning', 'breathtaking', 'awesome', 'mind-blowing', 'mind blowing',
  'epic', 'game-changing', 'game changer', 'revolutionary', 'insane', 'unbelievable', 'jaw-dropping',
  'must-see', 'must see', 'ultimate', 'next-level', 'next level', 'cutting-edge', 'groundbreaking',
  'supercharged', 'blazing', 'dive into', 'explore the cosmos', 'like never before', 'you won\'t believe',
]
const EMOJI = /\p{Extended_Pictographic}/u
// Links are blanked out first: a fragment's "#sun/earth@..." isn't a hashtag.
const HASHTAG = /(?<![\w&])#[A-Za-z]\w*/g
const MAX_HASHTAGS = 2


/**
 * What is wrong with a post's tone, apart from its length.
 *
 * @param {string} text
 * @returns {Array<string>} Problems, empty when it's fine
 */
export function lint(text) {
  const problems = []
  const prose = text.replace(LINK_PATTERN, ' ')
  const tags = prose.match(HASHTAG) ?? []
  if (tags.length > MAX_HASHTAGS) {
    problems.push(`${tags.length} hashtags (at most ${MAX_HASHTAGS})`)
  }
  if (EMOJI.test(text)) {
    problems.push('has an emoji')
  }
  const lower = prose.toLowerCase()
  for (const word of HYPE) {
    if (lower.includes(word)) {
      problems.push(`hype: "${word}"`)
    }
  }
  if (/!/.test(prose)) {
    problems.push('an exclamation mark')
  }
  return problems
}
