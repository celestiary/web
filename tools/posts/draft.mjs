import {PLATFORMS, measure} from './text.mjs'


/**
 * Posts from changelog entries (tools/posts/README.md): the link, the image
 * and, for an entry no one has written a post for, a plain one made of its
 * headline and its first sentences.
 */

export const SITE = 'https://celestiary.org/'
export const IMAGES_DIR = 'posts/images'
// Tuesday, Thursday and Saturday.
const SLOT_DAYS = [2, 4, 6]


/**
 * @param {{permalink: ?string}} entry A changelog entry, as in public/data/changelog.json
 * @returns {string} Where a post about it points: its scene, else the site
 */
export function entryLink(entry) {
  return entry.permalink ? `${SITE}${entry.permalink}` : SITE
}


/**
 * @param {string} id A post's id, which names its image
 * @param {string} permalink A fragment, with its `#`
 * @returns {string} The command that renders the view as posts/images/<id>.png: needs a build in
 *   docs/ (`yarn build`) and a real GPU
 */
export function renderCommand(id, permalink) {
  const fragment = permalink.replace(/^#/, '')
  if (/['\s]/.test(fragment)) {
    throw new Error(`A permalink can't go in the render command's quotes: ${permalink}`)
  }
  return `node tools/home/cards.mjs --gpu --id ${id} --hash '${fragment}' --png ${IMAGES_DIR}`
}


/**
 * @param {string} text An entry's plain text
 * @returns {Array<string>} Its sentences, without the one about the link and without code quotes
 */
export function sentences(text) {
  return text
      .replace(/`/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .filter((s) => s !== '' && !/^The link\b/.test(s))
}


/**
 * @param {string} headline
 * @returns {string} The headline as a sentence: no code quotes, ending in a full stop
 */
function lead(headline) {
  const plain = headline.replace(/`/g, '').trim()
  return /[.!?:]$/.test(plain) ? plain : `${plain}.`
}


/**
 * The plain post for an entry: its headline, as many of its sentences as fit
 * on the platform with the link, and the link.
 *
 * @param {object} entry
 * @param {string} [platform] A key of PLATFORMS
 * @returns {string}
 */
export function plainPostText(entry, platform = 'x') {
  const link = entryLink(entry)
  const head = lead(entry.headline)
  const picked = []
  for (const s of sentences(entry.text)) {
    const next = [...picked, s].join(' ')
    if (measure(platform, `${head}\n\n${next}\n\n${link}`) > PLATFORMS[platform].limit) {
      break
    }
    picked.push(s)
  }
  return [head, picked.join(' '), link].filter((part) => part !== '').join('\n\n')
}


/**
 * @param {string} date A day, `YYYY-MM-DD`
 * @returns {string} The next Tuesday, Thursday or Saturday after it
 */
export function nextSlot(date) {
  const d = new Date(`${date}T00:00:00Z`)
  do {
    d.setUTCDate(d.getUTCDate() + 1)
  } while (!SLOT_DAYS.includes(d.getUTCDay()))
  return d.toISOString().slice(0, 10)
}


/**
 * Build a post.
 *
 * @param {object} args
 * @param {string} args.id
 * @param {string} args.title
 * @param {string} args.text
 * @param {?object} args.entry The changelog entry it is about, if one
 * @param {string} [args.date]
 * @param {string} [args.image] A path in the repo, else the entry's image, else one to render
 * @param {string} [args.alt] The image's description, else the entry's
 * @param {?string} [args.permalink] The view the image shows, when it isn't the entry's
 * @param {string} [args.notes]
 * @param {object} [args.overrides] Text by platform key, where it differs from `text`
 * @returns {object} A post (file.mjs)
 */
export function makePost({id, title, text, entry = null, date = '', image, alt, permalink, notes = '', overrides = {}}) {
  const fields = [['ID', id], ['Status', 'draft'], ['X', ''], ['Facebook', ''], ['Date', date]]
  if (entry) {
    fields.push(['Entry', entry.id])
  }
  const view = permalink ?? entry?.permalink ?? null
  const entryImage = entry?.image ? `public/${entry.image.src}` : null
  if (image ?? entryImage) {
    fields.push(['Image', image ?? entryImage])
    fields.push(['Alt', alt ?? entry?.image?.alt ?? ''])
  } else if (view) {
    fields.push(['Image', `${IMAGES_DIR}/${id}.png`])
    fields.push(['Alt', alt ?? ''])
    fields.push(['Render', renderCommand(id, view)])
  } else {
    fields.push(['Image', 'none'])
  }
  fields.push(['Notes', notes])
  return {title, fields, text, overrides: {...overrides}, extra: ''}
}


/**
 * The plain posts for the entries that are worth one and have none: the
 * featured ones (CHANGELOG.md's `- Featured: yes`, which is what marks an
 * entry as worth a post), dated after `since`.
 *
 * @param {Array<object>} entries Changelog entries, newest first
 * @param {object} args
 * @param {string} args.since Only entries dated after this ('' for all)
 * @param {Set<string>} args.skip Entry ids that have a post already (campaign or file)
 * @param {string} args.after The last date a post is already scheduled on, for the first new one's
 * @returns {Array<object>} Posts, oldest entry first, each on the next free day
 */
export function plainPosts(entries, {since, skip, after}) {
  const posts = []
  let date = after
  const wanted = entries
      .filter((e) => e.featured && e.date > since && !skip.has(e.id))
      .reverse()
  for (const entry of wanted) {
    date = nextSlot(date)
    posts.push(makePost({
      id: entry.id, title: entry.headline.replace(/`/g, ''), text: plainPostText(entry), entry, date,
      overrides: {facebook: plainPostText(entry, 'facebook')},
    }))
  }
  return posts
}
