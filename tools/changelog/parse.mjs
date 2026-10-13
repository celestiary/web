/**
 * Reads CHANGELOG.md's entry format (tools/changelog/README.md) into data.
 *
 * The file is Markdown that a person reads, and this reads the same lines:
 *
 *   ## October 2026                         a month, newest first
 *   ### A headline                          an entry
 *   A sentence or two.                      its text
 *   - Date: 2026-10-13                      its fields, one bullet each
 *   - PR: [#242](https://github.com/celestiary/web/pull/242)
 *   - Issue: [#241](https://github.com/celestiary/web/issues/241)
 *   - Epic: [#118](https://github.com/celestiary/web/issues/118) Navigation
 *   - Permalink: [Open it](https://celestiary.github.io/web/#sun/earth@...)
 *   - Image: ![Earth at dusk](public/images/home/earth.webp)
 *   Behind the scenes: ...                  after the last entry, the month's housekeeping line
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const FIELD = /^- (Date|PR|Issue|Epic|Permalink|Image):\s*(.*)$/
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const NOTES_PREFIX = /^Behind the scenes:\s*/
const PUBLIC_PREFIX = /^public\//
const REPO = 'https://github.com/celestiary/web'
const MIN_PREFIX_LENGTH = 1
const SLUG_MAX = 48


/**
 * @param {string} headline
 * @returns {string} Lower-case words joined by hyphens, without accents or punctuation
 */
export function slugify(headline) {
  const slug = headline
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  if (slug.length <= SLUG_MAX) {
    return slug
  }
  const cut = slug.slice(0, SLUG_MAX)
  return cut.includes('-', 1) ? cut.replace(/-[^-]*$/, '') : cut
}


/**
 * @param {string} markdown One or more paragraphs of an entry's text
 * @returns {string} The same without links, code ticks and emphasis marks
 */
export function plainText(markdown) {
  return markdown
      .split(/\n\s*\n/)
      .map((p) => stripInline(p).replace(/\s*\n\s*/g, ' ').trim())
      .filter((p) => p !== '')
      .join('\n\n')
}


/**
 * @param {string} text
 * @returns {string} The text without links, images, code ticks and emphasis marks
 */
function stripInline(text) {
  return text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|[^\w*])\*(\S(?:[^*]*?\S)?)\*(?![\w*])/g, '$1$2')
      .replace(/(^|[^\w])_(\S(?:[^_]*?\S)?)_(?!\w)/g, '$1$2')
}


/**
 * @param {string} value A "PR" or "Issue" field: one or more `[#N](url)` links
 * @param {string} kind 'pr' or 'issue'
 * @param {string} where For messages
 * @returns {Array<{kind: string, number: number, url: string}>}
 */
function parseLinks(value, kind, where) {
  const found = [...value.matchAll(LINK)]
  if (found.length === 0) {
    throw new Error(`${where}: expected [#N](url) links, got "${value}"`)
  }
  const dir = kind === 'pr' ? 'pull' : 'issues'
  return found.map(([, label, url]) => {
    const m = /^#(\d+)$/.exec(label)
    if (!m || url !== `${REPO}/${dir}/${m[1]}`) {
      throw new Error(`${where}: "${label}" should link to ${REPO}/${dir}/<same number>, got ${url}`)
    }
    return {kind, number: Number(m[1]), url}
  })
}


/**
 * @param {string} value An "Epic" field: `[#N](url) Title`
 * @param {string} where For messages
 * @returns {{number: number, title: string, url: string}}
 */
function parseEpic(value, where) {
  const [link] = [...value.matchAll(LINK)]
  const m = link && /^#(\d+)$/.exec(link[1])
  if (!m || link[2] !== `${REPO}/issues/${m[1]}`) {
    throw new Error(`${where}: an Epic is [#N](${REPO}/issues/N) and its title, got "${value}"`)
  }
  const title = value.slice(link.index + link[0].length).trim()
  if (title === '') {
    throw new Error(`${where}: the Epic needs its title after the link`)
  }
  return {number: Number(m[1]), title, url: link[2]}
}


/**
 * @param {string} value A "Permalink" field: `none`, `[text](url)` or a bare URL
 * @param {string} where For messages
 * @returns {{url: string, hash: string}|null} The link as written, and its fragment (`#sun/earth@...`),
 *   which the app opens whatever host it runs on
 */
function parsePermalink(value, where) {
  if (value === '' || value.toLowerCase() === 'none') {
    return null
  }
  const [link] = [...value.matchAll(LINK)]
  const url = link ? link[2] : value
  const at = url.indexOf('#')
  if (!/^https?:\/\//.test(url) || at < MIN_PREFIX_LENGTH || url.length === at + 1) {
    throw new Error(`${where}: a Permalink is "none" or a full URL with a #fragment, got "${value}"`)
  }
  return {url, hash: url.slice(at)}
}


/**
 * @param {string} value An "Image" field: `![alt](path)`, or empty
 * @param {string} where For messages
 * @returns {{src: string, alt: string}|null} src relative to the site's root (a leading `public/` is dropped)
 */
function parseImage(value, where) {
  if (value === '' || value.toLowerCase() === 'none') {
    return null
  }
  const m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(value)
  if (!m) {
    throw new Error(`${where}: an Image is ![alt](path), got "${value}"`)
  }
  return {src: m[2].replace(PUBLIC_PREFIX, ''), alt: m[1]}
}


/**
 * @param {string} heading A month heading's text, "October 2026"
 * @returns {string|null} "2026-10", or null if it isn't a month
 */
export function monthOfHeading(heading) {
  const m = /^([A-Z][a-z]+) (\d{4})$/.exec(heading.trim())
  const index = m ? MONTH_NAMES.indexOf(m[1]) : -1
  return index < 0 ? null : `${m[2]}-${String(index + 1).padStart(2, '0')}`
}


/**
 * @param {string} month "2026-10"
 * @returns {string} "October 2026"
 */
export function headingOfMonth(month) {
  const [year, mm] = month.split('-')
  return `${MONTH_NAMES[Number(mm) - 1]} ${year}`
}


/**
 * Parses the Markdown.  Anything that isn't in the format is an error with its
 * line number, since the file is edited by hand and the app reads it.
 *
 * @param {string} markdown CHANGELOG.md's text
 * @returns {{entries: Array<object>, notes: Array<{month: string, text: string}>}}
 *   Entries in file order (newest first); each {id, month, date, headline, text, markdown, links, epic, permalink, image}
 */
export function parseChangelog(markdown) {
  const entries = []
  const notes = []
  let month = null
  let entry = null
  let fields = null
  let afterFields = false
  let paragraph = []

  const flushParagraph = (lineNo) => {
    if (paragraph.length === 0) {
      return
    }
    const text = paragraph.join('\n')
    paragraph = []
    if (entry && !fields) {
      entry.paragraphs.push(text)
    } else if (month && (!entry || afterFields)) {
      if (!NOTES_PREFIX.test(text)) {
        throw new Error(`line ${lineNo}: in ${month}, text outside an entry must start "Behind the scenes:", got "${text.slice(0, 40)}"`)
      }
      notes.push({month, text: plainText(text.replace(NOTES_PREFIX, ''))})
    }
  }

  const finishEntry = () => {
    if (!entry) {
      return
    }
    const where = `entry "${entry.headline}" (line ${entry.line})`
    for (const needed of ['Date', 'PR']) {
      if (!entry.fields.some((f) => f.name === needed)) {
        throw new Error(`${where}: missing "- ${needed}:"`)
      }
    }
    const dated = entry.fields.find((f) => f.name === 'Date').value
    const d = DATE.exec(dated)
    if (!d || `${d[1]}-${d[2]}` !== entry.month) {
      throw new Error(`${where}: Date "${dated}" should be YYYY-MM-DD in ${entry.month}`)
    }
    const links = []
    let epic = null
    let permalink = null
    let image = null
    for (const {name, value} of entry.fields) {
      if (name === 'PR') {
        links.push(...parseLinks(value, 'pr', where))
      } else if (name === 'Issue') {
        links.push(...parseLinks(value, 'issue', where))
      } else if (name === 'Epic') {
        epic = parseEpic(value, where)
      } else if (name === 'Permalink') {
        permalink = parsePermalink(value, where)
      } else if (name === 'Image') {
        image = parseImage(value, where)
      }
    }
    if (entry.paragraphs.length === 0) {
      throw new Error(`${where}: no text`)
    }
    const markdownText = entry.paragraphs.join('\n\n')
    entries.push({
      id: `${dated}-${slugify(entry.headline)}`,
      month: entry.month,
      date: dated,
      headline: entry.headline,
      text: plainText(markdownText),
      markdown: markdownText,
      links: [...links.filter((l) => l.kind === 'pr'), ...links.filter((l) => l.kind === 'issue')],
      epic,
      permalink: permalink && permalink.hash,
      permalinkUrl: permalink && permalink.url,
      image,
    })
    entry = null
    fields = null
    afterFields = false
  }

  const lines = markdown.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    // The file's own header shows the format in a fenced block.
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (heading) {
      flushParagraph(lineNo)
      const [, hashes, text] = heading
      if (hashes.length === 2) {
        finishEntry()
        month = monthOfHeading(text)
        if (!month) {
          throw new Error(`line ${lineNo}: "## ${text}" is not a month like "October 2026"`)
        }
      } else if (hashes.length === 3) {
        finishEntry()
        if (!month) {
          throw new Error(`line ${lineNo}: entry "${text}" is before any month heading`)
        }
        entry = {headline: text, month, line: lineNo, paragraphs: [], fields: []}
        fields = null
        afterFields = false
      } else if (hashes.length > 3) {
        throw new Error(`line ${lineNo}: headings deeper than ### are not part of the format`)
      } else if (month) {
        throw new Error(`line ${lineNo}: a # heading inside the months`)
      }
      continue
    }
    if (!month) {
      continue
    }
    if (line.trim() === '') {
      flushParagraph(lineNo)
      continue
    }
    if (line.startsWith('<!--')) {
      continue
    }
    if (entry && /^- /.test(line)) {
      flushParagraph(lineNo)
      const f = FIELD.exec(line)
      if (!f) {
        throw new Error(`line ${lineNo}: unknown field "${line}" (Date, PR, Issue, Epic, Permalink, Image)`)
      }
      if (afterFields) {
        throw new Error(`line ${lineNo}: fields after the entry's text and fields ended`)
      }
      fields = fields || []
      entry.fields.push({name: f[1], value: f[2].trim()})
      continue
    }
    if (entry && fields) {
      // The first line after the fields is not a field: the entry is done.
      afterFields = true
    }
    paragraph.push(line)
  }
  flushParagraph(lines.length)
  finishEntry()
  return {entries, notes}
}


/**
 * @param {Array<object>} entries From parseChangelog, in file order
 * @returns {Array<string>} Problems with the order: months and entries run newest first, ids are unique
 */
export function checkOrder(entries) {
  const problems = []
  const ids = new Set()
  entries.forEach((e, i) => {
    if (ids.has(e.id)) {
      problems.push(`duplicate entry "${e.id}"`)
    }
    ids.add(e.id)
    const prev = entries[i - 1]
    if (prev && prev.date < e.date) {
      problems.push(`"${e.headline}" (${e.date}) is after "${prev.headline}" (${prev.date}): newest first`)
    }
  })
  return problems
}


/**
 * @param {string} markdown CHANGELOG.md's text
 * @returns {{entries: Array<object>}} What `public/data/changelog.json` holds
 *   (entries newest first; the Markdown-only fields left out)
 */
export function changelogJson(markdown) {
  const {entries} = parseChangelog(markdown)
  const problems = checkOrder(entries)
  if (problems.length > 0) {
    throw new Error(problems.join('\n'))
  }
  return {
    entries: entries.map(({id, date, headline, text, links, epic, permalink, image}) => ({
      id, date, headline, text, links, epic, permalink, image,
    })),
  }
}
