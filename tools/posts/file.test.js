import {field, lengthLine, mergeDrafts, parseDrafts, postId, renderDrafts, setField, textFor} from './file.mjs'


/**
 * @param {string} id
 * @param {object} [more] Fields to set on the post
 * @returns {object} A post, as draft.mjs makes them
 */
function post(id, more = {}) {
  return {
    title: `Post ${id}`,
    fields: [['ID', id], ['Status', 'draft'], ['Date', '2026-10-27'], ['Entry', `entry-${id}`], ['Image', 'none'], ['Notes', '']],
    text: `The text of ${id}.\n\nhttps://celestiary.org/`,
    overrides: {},
    extra: '',
    ...more,
  }
}

const SECTION = (...posts) => ({title: 'The schedule', intro: 'An introduction.', posts})


describe('the drafts file', () => {
  it('writes a post with its fields, its lengths and its text in a block', () => {
    const {text} = mergeDrafts(null, [SECTION(post('a'))])
    expect(text).toContain('## The schedule\n\nAn introduction.\n\n### Post a\n\n- ID: a\n- Status: draft\n')
    expect(text).toContain('- Length: X 39/280, Facebook 39/500 SHORT\n')
    expect(text).toContain('```text\nThe text of a.\n\nhttps://celestiary.org/\n```')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('reads back what it wrote, and writes that again the same', () => {
    const p = post('a', {overrides: {facebook: 'Longer for Facebook.'}})
    const {text} = mergeDrafts(null, [SECTION(p, post('b'))])
    const parsed = parseDrafts(text)
    expect(parsed.sections).toHaveLength(1)
    const [a, b] = parsed.sections[0].posts
    expect(postId(a)).toBe('a')
    expect(field(a, 'Status')).toBe('draft')
    expect(a.text).toBe(p.text)
    expect(a.overrides).toEqual({facebook: 'Longer for Facebook.'})
    expect(postId(b)).toBe('b')
    expect(renderDrafts(parsed)).toBe(text)
  })

  it('counts each platform from the text that goes to it', () => {
    const p = post('a', {overrides: {facebook: `${'m'.repeat(450)}`}})
    expect(textFor(p, 'x')).toBe(p.text)
    expect(textFor(p, 'facebook')).toHaveLength(450)
    expect(lengthLine(p)).toBe('X 39/280, Facebook 450/500')
    const over = post('b', {text: 'z'.repeat(300)})
    expect(lengthLine(over)).toBe('X 300/280 OVER, Facebook 300/500')
  })

  it('names a post by its id, else by its title', () => {
    expect(postId(post('abc'))).toBe('abc')
    expect(postId({title: 'No ID, Here!', fields: []})).toBe('no-id-here')
  })

  it('sets a field in the canonical place when it is not there', () => {
    const p = post('a')
    setField(p, 'Alt', 'A picture')
    expect(p.fields.map(([k]) => k)).toEqual(['ID', 'Status', 'Date', 'Entry', 'Image', 'Alt', 'Notes'])
    setField(p, 'Status', 'posted')
    expect(field(p, 'Status')).toBe('posted')
  })

  it('does not read a section heading or a field inside a text block as structure', () => {
    const markdown = '# Title\n\n## S\n\n### P\n\n- ID: p\n\n```text\n## not a section\n### not a post\n- Status: posted\n```\n'
    const {sections} = parseDrafts(markdown)
    expect(sections).toHaveLength(1)
    expect(sections[0].posts).toHaveLength(1)
    expect(field(sections[0].posts[0], 'Status')).toBe('')
    expect(sections[0].posts[0].text).toBe('## not a section\n### not a post\n- Status: posted')
  })
})


describe('merging new posts into the drafts file', () => {
  const first = () => mergeDrafts(null, [SECTION(post('a'), post('b'))]).text

  it('adds nothing, and changes nothing, on a second run', () => {
    const once = first()
    const again = mergeDrafts(once, [SECTION(post('a'), post('b'))])
    expect(again.text).toBe(once)
    expect(again.added).toEqual([])
    expect(again.kept).toBe(2)
  })

  it('keeps the maintainer\'s statuses, dates and text, and adds the posts that are new', () => {
    let text = first()
    text = text
        .replace('- Status: draft\n- Date: 2026-10-27\n- Entry: entry-a', '- Status: scheduled\n- Date: 2026-11-02\n- Entry: entry-a')
        .replace('The text of a.', 'My own words about a.')
    const merged = mergeDrafts(text, [SECTION(post('a'), post('b'), post('c'))])
    expect(merged.added).toEqual(['c'])
    expect(merged.kept).toBe(2)
    const [a, b, c] = parseDrafts(merged.text).sections[0].posts
    expect(field(a, 'Status')).toBe('scheduled')
    expect(field(a, 'Date')).toBe('2026-11-02')
    expect(a.text).toBe('My own words about a.\n\nhttps://celestiary.org/')
    expect(field(b, 'Status')).toBe('draft')
    expect(postId(c)).toBe('c')
    expect(field(c, 'Status')).toBe('draft')
  })

  it('adds a new post at the end of its section, not elsewhere', () => {
    const text = mergeDrafts(null, [
      SECTION(post('a')),
      {title: 'Later', intro: '', posts: [post('z')]},
    ]).text
    const merged = mergeDrafts(text, [SECTION(post('a'), post('b')), {title: 'Later', intro: '', posts: [post('z'), post('y')]}])
    const sections = parseDrafts(merged.text).sections
    expect(sections.map((s) => s.posts.map(postId))).toEqual([['a', 'b'], ['z', 'y']])
  })

  it('makes a section that is new, after the ones there', () => {
    const merged = mergeDrafts(first(), [SECTION(post('a')), {title: 'New section', intro: 'Why.', posts: [post('n')]}])
    const sections = parseDrafts(merged.text).sections
    expect(sections.map((s) => s.title)).toEqual(['The schedule', 'New section'])
    expect(sections[1].intro).toBe('Why.')
  })

  it('does not bring back a post the maintainer marked posted or skip, or the text they changed', () => {
    const text = first().replace('- Status: draft\n- Date: 2026-10-27\n- Entry: entry-b', '- Status: posted\n- Date: 2026-10-27\n- Entry: entry-b')
    const merged = mergeDrafts(text, [SECTION(post('a'), post('b'))])
    expect(field(parseDrafts(merged.text).sections[0].posts[1], 'Status')).toBe('posted')
    expect(merged.added).toEqual([])
  })

  it('keeps a post the maintainer wrote and the generator knows nothing of', () => {
    const text = `${first()}\n### Mine\n\n- ID: mine\n- Status: scheduled\n\n\`\`\`text\nA post of my own.\n\`\`\`\n`
    const merged = mergeDrafts(text, [SECTION(post('a'), post('b'))])
    const posts = parseDrafts(merged.text).sections[0].posts
    expect(posts.map(postId)).toEqual(['a', 'b', 'mine'])
    expect(posts[2].text).toBe('A post of my own.')
  })

  it('keeps a post that is gone from the generated ones', () => {
    const merged = mergeDrafts(first(), [SECTION(post('a'))])
    expect(parseDrafts(merged.text).sections[0].posts.map(postId)).toEqual(['a', 'b'])
  })

  it('keeps the preamble, a section\'s introduction, an override, fields it does not know and loose notes', () => {
    const edited = first()
        .replace('# Post drafts', '# Post drafts\n\nMy reminder: post at 9 am.')
        .replace('An introduction.', 'My own introduction.')
        .replace('- Notes:', '- Notes: check the image\n- Reviewer: Pablo')
        .replace('### Post b', '#### Facebook\n\n```text\nFacebook only.\n```\n\nA loose line of mine.\n\n### Post b')
    const merged = mergeDrafts(edited, [SECTION(post('a'), post('b'), post('c'))])
    expect(merged.text).toContain('My reminder: post at 9 am.')
    const {sections} = parseDrafts(merged.text)
    expect(sections[0].intro).toBe('My own introduction.')
    const a = sections[0].posts[0]
    expect(field(a, 'Notes')).toBe('check the image')
    expect(field(a, 'Reviewer')).toBe('Pablo')
    expect(a.overrides).toEqual({facebook: 'Facebook only.'})
    expect(a.extra).toBe('A loose line of mine.')
    // The text itself is as it was, so a second run still changes nothing.
    expect(mergeDrafts(merged.text, [SECTION(post('a'), post('b'), post('c'))]).text).toBe(merged.text)
  })

  it('works the lengths out again from an edited text', () => {
    const edited = first().replace('The text of a.', 'z'.repeat(300))
    expect(edited).toContain('Length: X 39/280')
    const merged = mergeDrafts(edited, [SECTION(post('a'), post('b'))])
    expect(merged.text).toContain('- Length: X 325/280 OVER, Facebook 325/500')
  })

  it('works on a file with CRLF line ends', () => {
    const crlf = first().replace(/\n/g, '\r\n')
    expect(mergeDrafts(crlf, [SECTION(post('a'), post('b'))]).text).toBe(first())
  })
})
