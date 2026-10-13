import {changelogJson, checkOrder, headingOfMonth, monthOfHeading, parseChangelog, plainText, slugify} from './parse.mjs'


const PR = 'https://github.com/celestiary/web/pull'
const ISSUE = 'https://github.com/celestiary/web/issues'

const SAMPLE = `# Changelog

Anything before the first month is ignored.

## October 2026

### Earth at dusk, with **clouds**

The terminator crosses the Pacific. See \`s=\` and [the doc](https://example.com/doc).

A second paragraph.

- Date: 2026-10-13
- PR: [#242](${PR}/242), [#240](${PR}/240)
- Issue: [#241](${ISSUE}/241)
- Epic: [#118](${ISSUE}/118) Navigation, time and sharing
- Permalink: [Open it](https://celestiary.github.io/web/#sun/earth@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;s=a)
- Image: ![Earth at dusk](public/images/home/earth.webp)

### A plain one

One sentence.

- Date: 2026-10-02
- PR: [#200](${PR}/200)
- Permalink: none

Behind the scenes: dependency updates ([#124](${PR}/124)).

## September 2026

Behind the scenes: only housekeeping this month.

## August 2026

### Last one

Text.
- Date: 2026-08-01
- PR: [#1](${PR}/1)
`


describe('parseChangelog', () => {
  const {entries, notes} = parseChangelog(SAMPLE)

  it('reads the entries in file order', () => {
    expect(entries.map((e) => e.headline)).toEqual(['Earth at dusk, with **clouds**', 'A plain one', 'Last one'])
    expect(entries.map((e) => e.month)).toEqual(['2026-10', '2026-10', '2026-08'])
  })

  it('reads a full entry', () => {
    const [e] = entries
    expect(e.date).toBe('2026-10-13')
    expect(e.id).toBe('2026-10-13-earth-at-dusk-with-clouds')
    expect(e.text).toBe('The terminator crosses the Pacific. See s= and the doc.\n\nA second paragraph.')
    expect(e.links).toEqual([
      {kind: 'pr', number: 242, url: `${PR}/242`},
      {kind: 'pr', number: 240, url: `${PR}/240`},
      {kind: 'issue', number: 241, url: `${ISSUE}/241`},
    ])
    expect(e.epic).toEqual({number: 118, title: 'Navigation, time and sharing', url: `${ISSUE}/118`})
    expect(e.permalink).toBe('#sun/earth@1,2,3m;t=0jd;cq=0,0,0,1;fov=45deg;s=a')
    expect(e.image).toEqual({src: 'images/home/earth.webp', alt: 'Earth at dusk'})
  })

  it('reads an entry without an epic, a view or an image', () => {
    const e = entries[1]
    expect(e.epic).toBeNull()
    expect(e.permalink).toBeNull()
    expect(e.image).toBeNull()
  })

  it('takes the line after the last entry as the month\'s note, and a month with only a note', () => {
    expect(notes).toEqual([
      {month: '2026-10', text: 'dependency updates (#124).'},
      {month: '2026-09', text: 'only housekeeping this month.'},
    ])
  })

  it('takes fields right after the text, with no blank line', () => {
    expect(entries[2].text).toBe('Text.')
    expect(entries[2].links).toHaveLength(1)
  })

  it('ignores fenced blocks, such as the format shown in the file\'s header', () => {
    const fenced = '```markdown\n## May 2026\n### Not an entry\n- Date: nope\n```'
    const md = `# Changelog\n\n${fenced}\n\n## May 2026\n\n### Real\n\nText.\n\n- Date: 2026-05-01\n- PR: [#1](${PR}/1)\n`
    expect(parseChangelog(md).entries.map((e) => e.headline)).toEqual(['Real'])
  })

  it('keeps a path-only permalink\'s fragment', () => {
    const saturn = 'https://celestiary.github.io/web/#sun/saturn'
    const md = `## May 2026\n\n### Saturn\n\nRings.\n\n- Date: 2026-05-01\n- PR: [#1](${PR}/1)\n- Permalink: ${saturn}\n`
    const {entries: [e]} = parseChangelog(md)
    expect(e.permalink).toBe('#sun/saturn')
  })
})


describe('parseChangelog errors', () => {
  /**
   * @param {string} body An entry's lines after the heading, in October 2026
   * @returns {string} A file
   */
  function file(body) {
    return `## October 2026\n\n### Headline\n\nText.\n\n${body}\n`
  }
  const good = `- Date: 2026-10-01\n- PR: [#1](${PR}/1)`

  it('accepts the minimal entry', () => {
    expect(parseChangelog(file(good)).entries).toHaveLength(1)
  })

  it('needs a Date and a PR', () => {
    expect(() => parseChangelog(file(`- PR: [#1](${PR}/1)`))).toThrow('missing "- Date:"')
    expect(() => parseChangelog(file('- Date: 2026-10-01'))).toThrow('missing "- PR:"')
  })

  it('needs the date in the month\'s heading', () => {
    expect(() => parseChangelog(file(`- Date: 2026-09-30\n- PR: [#1](${PR}/1)`))).toThrow('should be YYYY-MM-DD in 2026-10')
    expect(() => parseChangelog(file(`- Date: yesterday\n- PR: [#1](${PR}/1)`))).toThrow('Date "yesterday"')
  })

  it('needs full links that agree with their number', () => {
    expect(() => parseChangelog(file(`- Date: 2026-10-01\n- PR: [#1](/pull/1)`))).toThrow('should link to')
    expect(() => parseChangelog(file(`- Date: 2026-10-01\n- PR: [#2](${PR}/1)`))).toThrow('should link to')
    expect(() => parseChangelog(file(`- Date: 2026-10-01\n- PR: #1`))).toThrow('expected [#N](url) links')
    expect(() => parseChangelog(file(`${good}\n- Issue: [#2](${PR}/2)`))).toThrow('should link to')
  })

  it('needs an epic title, and a real permalink or none', () => {
    expect(() => parseChangelog(file(`${good}\n- Epic: [#118](${ISSUE}/118)`))).toThrow('needs its title')
    expect(() => parseChangelog(file(`${good}\n- Permalink: sun/earth`))).toThrow('Permalink')
    expect(() => parseChangelog(file(`${good}\n- Permalink: https://celestiary.github.io/web/`))).toThrow('Permalink')
    expect(() => parseChangelog(file(`${good}\n- Image: earth.webp`))).toThrow('Image')
  })

  it('rejects unknown fields and fields after the note', () => {
    expect(() => parseChangelog(file(`${good}\n- Color: red`))).toThrow('unknown field')
  })

  it('rejects an entry with no text, strays outside an entry and bad headings', () => {
    expect(() => parseChangelog(`## October 2026\n\n### Empty\n\n${good}\n`)).toThrow('no text')
    expect(() => parseChangelog(`${file(good)}\nA stray paragraph.\n`)).toThrow('Behind the scenes')
    expect(() => parseChangelog('## Octember 2026\n')).toThrow('not a month')
    expect(() => parseChangelog('### Early\n')).toThrow('before any month')
    expect(() => parseChangelog(`## October 2026\n\n#### Deep\n`)).toThrow('deeper than ###')
  })
})


describe('checkOrder and changelogJson', () => {
  it('wants newest first and unique ids', () => {
    const a = {id: 'a', date: '2026-10-02', headline: 'A'}
    const b = {id: 'b', date: '2026-10-01', headline: 'B'}
    expect(checkOrder([a, b])).toEqual([])
    expect(checkOrder([b, a])[0]).toContain('newest first')
    expect(checkOrder([a, {...b, id: 'a'}])[0]).toContain('duplicate')
  })

  it('makes the app\'s JSON: what the Markdown says, without the Markdown-only fields', () => {
    const json = changelogJson(SAMPLE)
    expect(json.entries).toHaveLength(3)
    expect(Object.keys(json.entries[0]).sort()).toEqual(['date', 'epic', 'headline', 'id', 'image', 'links', 'permalink', 'text'])
    expect(json.entries[0].links[0]).toEqual({kind: 'pr', number: 242, url: `${PR}/242`})
  })

  it('refuses a file out of order', () => {
    const entry = (name, day, n) => `### ${name}\n\nx.\n\n- Date: 2026-10-${day}\n- PR: [#${n}](${PR}/${n})\n`
    const swapped = `## October 2026\n\n${entry('Old', '01', 1)}\n${entry('New', '05', 2)}`
    expect(() => changelogJson(swapped)).toThrow('newest first')
  })
})


describe('helpers', () => {
  it('slugifies headlines', () => {
    expect(slugify('Gaia\'s million stars (G < 10.8)')).toBe('gaia-s-million-stars-g-10-8')
    expect(slugify('Café, déjà vu')).toBe('cafe-deja-vu')
    expect(slugify('word '.repeat(30)).length).toBeLessThanOrEqual(48)
  })

  it('maps months to headings and back', () => {
    expect(monthOfHeading('October 2026')).toBe('2026-10')
    expect(monthOfHeading('January 2021')).toBe('2021-01')
    expect(monthOfHeading('2026-10')).toBeNull()
    expect(headingOfMonth('2026-03')).toBe('March 2026')
  })

  it('strips Markdown to plain text', () => {
    const marked = 'A **bold** and _slanted_ `code` [link](https://x.y) ![img](a.png)\nwrapped'
    expect(plainText(marked)).toBe('A bold and slanted code link img wrapped')
    expect(plainText('One.\n\nTwo.')).toBe('One.\n\nTwo.')
  })
})


describe('plainText keeps what is not emphasis', () => {
  it('leaves snake_case names and a lone asterisk', () => {
    expect(plainText('the cesium_ion token and a*b, c_d')).toBe('the cesium_ion token and a*b, c_d')
    expect(plainText('*italic* and _also_')).toBe('italic and also')
  })
})
