import {PLATFORMS, findLinks, lint, measure, measureAll, xWeight} from './text.mjs'


const PERMALINK = 'https://celestiary.org/#sun/earth@43.3389,-9.9593,30373373.021376Tm;t=9779.5692jd;cq=-0.436,0.7975,0.0666,0.4116;fov=45deg;ev=1.33;s=alovTF'

describe('the platforms', () => {
  it('are X, 280, and Facebook, a paragraph or two of 300 to 500, in a table', () => {
    expect(Object.keys(PLATFORMS)).toEqual(['x', 'facebook'])
    expect(PLATFORMS.x.limit).toBe(280)
    expect(PLATFORMS.facebook.min).toBe(300)
    expect(PLATFORMS.facebook.limit).toBe(500)
    for (const [key, p] of Object.entries(PLATFORMS)) {
      expect(p.key).toBe(key)
      expect(['weighted', 'graphemes', 'characters']).toContain(p.count)
    }
  })
})

describe('findLinks', () => {
  it('finds a link, and leaves the full stop after it out', () => {
    const text = 'See https://celestiary.org/. Then more.'
    expect(findLinks(text).map((l) => l.url)).toEqual(['https://celestiary.org/'])
  })

  it('finds a permalink whole, its fragment and all', () => {
    expect(findLinks(`Look: ${PERMALINK}`).map((l) => l.url)).toEqual([PERMALINK])
  })

  it('finds a bare domain, which X links, and says so', () => {
    const [link] = findLinks('Open celestiary.org now')
    expect(link.url).toBe('celestiary.org')
    expect(link.bare).toBe(true)
  })

  it('does not take a file name, a decimal or an address for a link', () => {
    expect(findLinks('stars.dat holds 1.5 million, write to a@b.org')).toEqual([])
  })
})

describe('xWeight', () => {
  it('weighs Latin letters and common punctuation 1, and CJK and emoji 2', () => {
    expect(xWeight('a'.codePointAt(0))).toBe(1)
    expect(xWeight('\u2019'.codePointAt(0))).toBe(1)
    expect(xWeight('\u00e9'.codePointAt(0))).toBe(1)
    expect(xWeight('\u5929'.codePointAt(0))).toBe(2)
    expect(xWeight('\u{1F680}'.codePointAt(0))).toBe(2)
  })
})

describe('measure', () => {
  it('counts the characters of a plain text on every platform', () => {
    const text = 'A million stars.'
    expect(measure('x', text)).toBe(16)
    expect(measure('facebook', text)).toBe(16)
  })

  it('counts a link as 23 on X, whatever its length', () => {
    expect(measure('x', 'Look https://celestiary.org/')).toBe(5 + 23)
    expect(measure('x', `Look ${PERMALINK}`)).toBe(5 + 23)
  })

  it('counts a link on Facebook as 23 too, so the target is for the words round it', () => {
    expect(measure('facebook', `Look ${PERMALINK}`)).toBe(5 + 23)
  })

  it('counts a bare domain as a link on X only', () => {
    expect(measure('x', 'Open celestiary.org')).toBe(5 + 23)
    expect(measure('facebook', 'Open celestiary.org')).toBe('Open celestiary.org'.length)
  })

  it('counts several links, and the text between them', () => {
    const text = 'a https://a.example/x b https://b.example/y c'
    expect(measure('x', text)).toBe(2 + 23 + 3 + 23 + 2)
  })

  it('weighs an emoji and CJK 2 on X, and 1 a character on Facebook', () => {
    expect(measure('x', '\u5929\u6587')).toBe(4)
    expect(measure('x', '\u{1F680}')).toBe(2)
    expect(measure('facebook', '\u{1F680}')).toBe(1)
  })

  it('counts a newline as one character', () => {
    expect(measure('x', 'a\n\nb')).toBe(4)
  })

  it('names an unknown platform', () => {
    expect(() => measure('threads', 'hi')).toThrow(/Unknown platform/)
  })
})

describe('measureAll', () => {
  it('says each platform\'s count, limit and whether it is over', () => {
    const body = 'x'.repeat(280 - 2 - 23)
    const ok = measureAll(`${body}\n\n${PERMALINK}`)
    expect(ok.x).toEqual({count: 280, limit: 280, over: false, short: false})
    const over = measureAll(`${body}x\n\n${PERMALINK}`)
    expect(over.x).toEqual({count: 281, limit: 280, over: true, short: false})
  })

  it('says Facebook is short of its target, or over its limit', () => {
    expect(measureAll('y'.repeat(299)).facebook).toEqual({count: 299, limit: 500, over: false, short: true})
    expect(measureAll('y'.repeat(300)).facebook.short).toBe(false)
    expect(measureAll('y'.repeat(501)).facebook.over).toBe(true)
  })
})

describe('lint', () => {
  it('passes a plain post, and a link\'s fragment is not a hashtag', () => {
    expect(lint(`Gaia's stars. #astronomy\n\n${PERMALINK}`)).toEqual([])
  })

  it('allows two hashtags and not three', () => {
    expect(lint('Stars #astronomy #space')).toEqual([])
    expect(lint('Stars #astronomy #space #stars')).toEqual(['3 hashtags (at most 2)'])
  })

  it('flags an emoji, hype and an exclamation mark', () => {
    expect(lint('Stars \u{1F680}')).toEqual(['has an emoji'])
    expect(lint('An amazing view')).toEqual(['hype: "amazing"'])
    expect(lint('Look!')).toEqual(['an exclamation mark'])
  })
})
