import {PLATFORMS, measureAll} from './text.mjs'


/**
 * The drafts file, posts/drafts.md (tools/posts/README.md): parsing it,
 * writing it, and merging new posts into what the maintainer has edited.
 *
 * ```
 * # Post drafts
 * (a preamble, kept as it is)
 *
 * ## A section
 * (an introduction, kept as it is)
 *
 * ### A post's title
 *
 * - ID: unique-id
 * - Status: draft
 * - X: https://x.com/celestiary_org/status/...
 * - Facebook: https://www.facebook.com/...
 * - Date: 2026-10-27
 * - Entry: the changelog entry's id
 * - Image: path
 * - Alt: the image's description
 * - Render: the command that makes the image
 * - Notes: anything
 * - Length: X 251/280, Facebook 412/500
 *
 * ```text
 * the post, link and all
 * ```
 *
 * #### Facebook
 *
 * ```text
 * an override of the text, for one platform
 * ```
 * ```
 *
 * Only `Length` is the script's: it is worked out again on every run.
 * Everything else is the maintainer's once it is in the file.
 */

export const STATUSES = Object.freeze(['draft', 'scheduled', 'posted', 'skip'])
export const FIELD_ORDER = Object.freeze(['ID', 'Status', 'X', 'Facebook', 'Date', 'Entry', 'Image', 'Alt', 'Render', 'Notes'])
const LENGTH = 'Length'
const FENCE = '```'
const BULLET = /^- ([A-Za-z][A-Za-z ]*): ?(.*)$/
const PLATFORM_HEADING = new RegExp(`^#### (${Object.values(PLATFORMS).map((p) => p.name).join('|')})\\b`, 'i')

export const DEFAULT_PREAMBLE = `# Post drafts

Drafts of social posts from CHANGELOG.md's entries, and the first campaign,
for X (@celestiary_org) and Facebook.  Nothing here is posted for you: you
publish each one by hand (tools/posts/README.md).

- **Edit freely.** \`yarn posts\` never changes a post that is in this file,
  only adds new ones and works out each \`Length\` again.
- **Mark each post's \`Status\`:** \`draft\`, \`scheduled\`, \`posted\` or \`skip\`.
  \`Date\` is a suggestion.  When a post is \`posted\`, paste its URLs into
  \`X\` and \`Facebook\` and run \`yarn changelog\`: What's new then links its
  entry to them.
- **The text** is the post as you'd paste it, link included, and is for X:
  at most 280, a link counting 23.  The \`#### Facebook\` block under it is
  Facebook's: a short paragraph or two, 300 to 500 characters, link in the
  text.  A heading for another platform in the table (\`PLATFORMS\` in
  tools/posts/text.mjs) works the same way.
- **Images:** attach \`Image\` on both.  Facebook can't unfurl a link's own
  picture yet: every page has the same tags, whatever follows the \`#\`.  If
  \`Render\` is there and the file isn't, run that command first (after
  \`yarn build\`), on a machine with a GPU.  Look at the result and check its
  \`Alt\`, which was written from the link, not the render.`


/**
 * @typedef {object} Post
 * @property {string} title
 * @property {Array<[string, string]>} fields In the file's order, `Length` not among them
 * @property {string} text The shared text
 * @property {object} overrides Text by platform key, where it differs
 * @property {string} extra Anything else the maintainer wrote in the post, kept
 */

/**
 * @typedef {object} Section
 * @property {string} title
 * @property {string} intro
 * @property {Array<Post>} posts
 */


/**
 * @param {Post} post
 * @param {string} key A field's name
 * @returns {string} Its value, or ''
 */
export function field(post, key) {
  const found = post.fields.find(([k]) => k.toLowerCase() === key.toLowerCase())
  return found ? found[1] : ''
}


/**
 * @param {Post} post
 * @param {string} key
 * @param {string} value Set in place, or added in the canonical order's place
 */
export function setField(post, key, value) {
  const at = post.fields.findIndex(([k]) => k.toLowerCase() === key.toLowerCase())
  if (at >= 0) {
    post.fields[at][1] = value
    return
  }
  const rank = FIELD_ORDER.indexOf(key)
  let insertAt = post.fields.length
  if (rank >= 0) {
    // After the last known field that comes before it.
    insertAt = 0
    post.fields.forEach(([k], i) => {
      const r = FIELD_ORDER.indexOf(k)
      if (r >= 0 && r < rank) {
        insertAt = i + 1
      }
    })
  }
  post.fields.splice(insertAt, 0, [key, value])
}


/**
 * @param {Post} post
 * @returns {string} The post's id, from its field or its title
 */
export function postId(post) {
  return field(post, 'ID') || post.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}


/**
 * @param {Post} post
 * @param {string} platform a key of PLATFORMS
 * @returns {string} The text that goes out on it
 */
export function textFor(post, platform) {
  return post.overrides[platform] ?? post.text
}


/**
 * @param {Post} post
 * @returns {object} by platform, each `{count, limit, over, short}`, for the text each gets
 */
export function lengths(post) {
  const result = {}
  for (const key of Object.keys(PLATFORMS)) {
    result[key] = measureAll(textFor(post, key))[key]
  }
  return result
}


/**
 * @param {Post} post
 * @returns {string} The `Length` field's value: `X 251/280, Facebook 412/500`, `OVER` past a limit, `SHORT` under a target
 */
export function lengthLine(post) {
  const all = lengths(post)
  return Object.values(PLATFORMS)
      .map(({key, name}) => `${name} ${all[key].count}/${all[key].limit}${all[key].over ? ' OVER' : ''}${all[key].short ? ' SHORT' : ''}`)
      .join(', ')
}


/**
 * @param {string} markdown The drafts file
 * @returns {{preamble: string, sections: Array<Section>}}
 */
export function parseDrafts(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const preamble = []
  const sections = []
  let section = null
  let post = null
  let platform = null
  let fence = null
  let block = []

  const closeFence = () => {
    const text = block.join('\n')
    if (platform) {
      post.overrides[platform] = text
    } else if (post.text === '') {
      post.text = text
    } else {
      post.extra += `${FENCE}${fence}\n${text}\n${FENCE}\n`
    }
    fence = null
    block = []
  }

  for (const line of lines) {
    if (fence !== null) {
      if (line.startsWith(FENCE)) {
        closeFence()
      } else {
        block.push(line)
      }
      continue
    }
    if (line.startsWith('## ')) {
      section = {title: line.slice(3).trim(), intro: '', posts: []}
      sections.push(section)
      post = null
      platform = null
    } else if (line.startsWith('### ') && section) {
      post = {title: line.slice(4).trim(), fields: [], text: '', overrides: {}, extra: ''}
      section.posts.push(post)
      platform = null
    } else if (!section) {
      preamble.push(line)
    } else if (!post) {
      section.intro += `${line}\n`
    } else if (line.startsWith(FENCE)) {
      fence = line.slice(FENCE.length).trim()
    } else if (PLATFORM_HEADING.test(line)) {
      platform = line.match(PLATFORM_HEADING)[1].toLowerCase()
    } else if (BULLET.test(line) && !platform) {
      const [, key, value] = line.match(BULLET)
      if (key !== LENGTH) {
        post.fields.push([key, value.trim()])
      }
    } else if (line.trim() !== '') {
      post.extra += `${line}\n`
    }
  }
  if (fence !== null) {
    closeFence()
  }
  for (const s of sections) {
    s.intro = s.intro.trim()
  }
  for (const s of sections) {
    for (const p of s.posts) {
      p.extra = p.extra.trim()
    }
  }
  return {preamble: preamble.join('\n').trim(), sections}
}


/**
 * @param {Post} post
 * @returns {string} The post's Markdown
 */
export function renderPost(post) {
  const out = [`### ${post.title}`, '']
  for (const [k, v] of post.fields) {
    out.push(`- ${k}: ${v}`.trimEnd())
  }
  out.push(`- ${LENGTH}: ${lengthLine(post)}`, '', `${FENCE}text`, post.text, FENCE)
  for (const {key, name} of Object.values(PLATFORMS)) {
    if (post.overrides[key] !== undefined) {
      out.push('', `#### ${name}`, '', `${FENCE}text`, post.overrides[key], FENCE)
    }
  }
  if (post.extra) {
    out.push('', post.extra)
  }
  return out.join('\n')
}


/**
 * @param {{preamble: string, sections: Array<Section>}} drafts
 * @returns {string} The file's text, ending in one newline
 */
export function renderDrafts({preamble, sections}) {
  const blocks = [preamble || DEFAULT_PREAMBLE]
  for (const s of sections) {
    blocks.push(`## ${s.title}`)
    if (s.intro) {
      blocks.push(s.intro)
    }
    for (const p of s.posts) {
      blocks.push(renderPost(p))
    }
  }
  return `${blocks.join('\n\n')}\n`
}


/**
 * Add posts the file doesn't have, and leave every one it has as it is.
 * A post is the same post by its `ID`.  A post the file has and `generated`
 * doesn't (an entry gone, a post the maintainer wrote) stays.  A new post
 * goes at the end of the section of its name, or in a new section at the
 * end.
 *
 * @param {?string} existing The drafts file's text, or null for none yet
 * @param {Array<{title: string, intro: string, posts: Array<Post>}>} generated
 * @returns {{text: string, added: Array<string>, kept: number}} The new file, the ids added, how many were there
 */
export function mergeDrafts(existing, generated) {
  const drafts = existing === null ? {preamble: '', sections: []} : parseDrafts(existing)
  const have = new Set(drafts.sections.flatMap((s) => s.posts.map(postId)))
  const added = []
  for (const g of generated) {
    let section = drafts.sections.find((s) => s.title === g.title)
    for (const post of g.posts) {
      const id = postId(post)
      if (have.has(id)) {
        continue
      }
      if (!section) {
        section = {title: g.title, intro: g.intro, posts: []}
        drafts.sections.push(section)
      }
      section.posts.push(post)
      have.add(id)
      added.push(id)
    }
  }
  const kept = have.size - added.length
  return {text: renderDrafts(drafts), added, kept}
}
