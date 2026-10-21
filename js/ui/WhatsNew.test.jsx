import {afterAll, beforeAll, describe, expect, it} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {SHOW_ALL_KEY, parseChangelog, readShowAll, tourCaption, visibleEntries, writeShowAll} from '../changelog.js'
import NewsTour from './NewsTour.jsx'
import WhatsNew, {renderText} from './WhatsNew.jsx'


const LINK = '#sun/earth@-38.1501,-99.3434,12.104919Mm;t=9781.4376jd;cq=0.1302,-0.0725,0.0095,0.9888;fov=45deg'

/**
 * @param {number} n
 * @param {object} [extra]
 * @returns {object} An entry as changelog.json has it
 */
function entry(n, extra = {}) {
  return {id: `2026-10-${String(n).padStart(2, '0')}-e${n}`, date: `2026-10-${String(n).padStart(2, '0')}`,
    headline: `Headline ${n}`, text: `Text of ${n}.`, links: [], epic: null, permalink: null, image: null, ...extra}
}

const ENTRIES = parseChangelog({entries: [
  entry(13, {permalink: LINK, text: 'Press `f` to follow.\n\nA second paragraph.',
    links: [{kind: 'pr', number: 249, url: 'https://github.com/celestiary/web/pull/249'},
      {kind: 'issue', number: 241, url: 'https://github.com/celestiary/web/issues/241'}]}),
  entry(12),
  entry(11, {permalink: '#galaxy:ngc2403', image: {src: 'images/home/earth.webp', alt: 'Earth at dusk'}}),
  ...Array.from({length: 12}, (_, i) => entry(10 - (i % 10))),
]})

const noop = () => {}
const celestiary = {openLink: noop, startNewsTour: noop, newsTourControl: noop}

const saved = {}
beforeAll(() => {
  saved.document = globalThis.document
  saved.window = globalThis.window
  globalThis.document = {baseURI: 'https://celestiary.org/'}
  globalThis.window = {location: {search: ''}}
})
afterAll(() => {
  globalThis.document = saved.document
  globalThis.window = saved.window
})


describe('the What\'s new panel', () => {
  let html
  beforeAll(() => {
    html = renderToStaticMarkup(
        <WhatsNew celestiary={celestiary} entries={ENTRIES} fresh={new Set([ENTRIES[0].id, ENTRIES[1].id])} onClose={noop}/>)
  })

  it('is a labelled dialog with the latest entries: headline, date and text', () => {
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby="news-title"')
    expect(html).toContain('What&#x27;s new')
    expect(html).toContain('Headline 13')
    expect(html).toContain('13 October 2026')
    expect(html).toMatch(/<time date[tT]ime="2026-10-13">13 October 2026<\/time>/)
    expect(html).toContain('A second paragraph.')
    // Code spans are code.
    expect(html).toContain('Press <code>f</code> to follow.')
  })

  it('tags the entries that are new since the last visit, and only those', () => {
    expect(html.match(/class="news-new"/g)?.length).toBe(2)
    expect(html).toContain('news-entry news-entry-new')
  })

  it('offers to fly only where there is a view, and the tour from there', () => {
    // Entries 13 and 11 have one; 12 doesn't.
    expect(html).toContain('data-testid="news-fly-0"')
    expect(html).not.toContain('data-testid="news-fly-1"')
    expect(html).toContain('data-testid="news-fly-2"')
    expect(html).toContain('data-testid="news-from-0"')
    expect(html).not.toContain('data-testid="news-from-1"')
    // The fly link is the entry's link as a URL: a middle click opens it in a tab.
    expect(html).toContain('href="https://celestiary.org/#sun/earth@-38.1501')
    expect(html).toContain('data-testid="news-play"')
  })

  it('links the PRs and issues, in a new tab, and shows an entry\'s image', () => {
    expect(html).toContain('href="https://github.com/celestiary/web/pull/249"')
    expect(html).toMatch(/PR #(<!-- -->)?249/)
    expect(html).toMatch(/Issue #(<!-- -->)?241/)
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('<img class="news-image" src="images/home/earth.webp" alt="Earth at dusk"')
  })

  it('shows the first entries and offers the earlier ones', () => {
    expect(html.match(/data-testid="news-entry-\d+"/g)?.length).toBe(8)
    expect(html).toContain('Show earlier (7 more)')
  })

  it('has no tour to play when no entry has a view', () => {
    const none = renderToStaticMarkup(
        <WhatsNew celestiary={celestiary} entries={[entry(13), entry(12)]} fresh={new Set()} onClose={noop}/>)
    expect(none).not.toContain('news-play')
    expect(none).not.toContain('news-fly')
    expect(none).not.toContain('news-more')
    expect(none).toContain('Headline 12')
  })

  it('splits paragraphs and code', () => {
    const markup = renderToStaticMarkup(<div>{renderText('One `a` two.\n\nThree.')}</div>)
    expect(markup).toBe('<div><p>One <code>a</code> two.</p><p>Three.</p></div>')
  })
})


describe('the changelog tour\'s caption and controls', () => {
  const stop = ENTRIES[0]
  const tour = (phase, paused = false) => ({index: 0, count: 3, phase, paused, entry: stop, caption: tourCaption(stop)})

  it('shows the date, headline and sentence once the camera is there', () => {
    const html = renderToStaticMarkup(<NewsTour celestiary={celestiary} tour={tour('holding')}/>)
    expect(html).toContain('news-tour-showing')
    expect(html).toContain('13 October 2026')
    expect(html).toContain('<h2 class="news-caption-headline">Headline 13</h2>')
    expect(html).toContain('Press f to follow.')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('>1 / 3<')
  })

  it('has previous, pause, next and stop, labelled', () => {
    const html = renderToStaticMarkup(<NewsTour celestiary={celestiary} tour={tour('flying')}/>)
    expect(html).not.toContain('news-tour-showing')
    expect(html).not.toContain('news-caption-headline')
    for (const label of ['Previous', 'Pause', 'Next', 'Stop the tour']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(renderToStaticMarkup(<NewsTour celestiary={celestiary} tour={tour('holding', true)}/>))
        .toContain('aria-label="Play"')
  })
})


describe('the What\'s new panel\'s filter and posts', () => {
  const X = 'https://x.com/celestiary_org/status/1849'
  const FB = 'https://www.facebook.com/celestiary/posts/77'
  const MIXED = parseChangelog({entries: [
    entry(13, {featured: true, social: {x: X, facebook: FB}}),
    entry(12),
    entry(11, {featured: true, social: {facebook: FB}}),
    entry(10, {featured: true}),
    entry(9),
  ]})
  const storage = (value) => ({getItem: (k) => (k === SHOW_ALL_KEY ? value : null), setItem: noop, removeItem: noop})
  const render = (entries, st) => renderToStaticMarkup(
      <WhatsNew celestiary={celestiary} entries={entries} fresh={new Set()} onClose={noop} storage={st}/>)

  it('opens on the featured entries only, with the opt-in to show the rest', () => {
    const html = render(MIXED, storage(null))
    expect(html.match(/data-testid="news-entry-\d+"/g)?.length).toBe(3)
    expect(html).toContain('Headline 13')
    expect(html).not.toContain('Headline 12')
    expect(html).not.toContain('Headline 9')
    expect(html).toContain('Featured updates')
    expect(html).toContain('data-testid="news-filter-toggle"')
    expect(html).toContain('Show all updates (2 more)')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="Featured updates"')
  })

  it('shows every entry once the choice is stored, with the way back, and marks the featured ones', () => {
    const html = render(MIXED, storage('1'))
    expect(html.match(/data-testid="news-entry-\d+"/g)?.length).toBe(5)
    expect(html).toContain('Headline 12')
    expect(html).toContain('Show featured only')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('All updates, including lesser features and fixes')
    expect(html.match(/class="news-featured"/g)?.length).toBe(3)
  })

  it('toggles by writing the choice that the next opening reads, and survives storage that throws', () => {
    const data = {}
    const st = {getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v }, removeItem: (k) => { delete data[k] }}
    expect(readShowAll(st)).toBe(false)
    writeShowAll(!readShowAll(st), st)
    expect(render(MIXED, st)).toContain('Headline 12')
    writeShowAll(!readShowAll(st), st)
    expect(render(MIXED, st)).not.toContain('Headline 12')
    const boom = () => {
      throw new Error('SecurityError')
    }
    const html = render(MIXED, {getItem: boom, setItem: boom, removeItem: boom})
    expect(html).not.toContain('Headline 12')
    expect(visibleEntries(MIXED, false)).toHaveLength(3)
  })

  it('has no filter where nothing is featured, or everything is', () => {
    expect(render(ENTRIES, storage(null))).not.toContain('news-filter')
    expect(render(MIXED.filter((e) => e.featured), storage(null))).not.toContain('news-filter')
  })

  it('links a featured entry to its posts with an icon each, in a new tab, labelled', () => {
    const html = render(MIXED, storage(null))
    expect(html).toContain(`href="${X}"`)
    expect(html).toContain(`href="${FB}"`)
    expect(html).toContain('aria-label="on X"')
    expect(html).toContain('aria-label="on Facebook"')
    expect(html.match(/target="_blank" rel="noopener" aria-label="on (X|Facebook)"/g)).toHaveLength(3)
    // Entry 13 has both, entry 11 only Facebook, entry 10 none.
    expect(html).toContain('data-testid="news-social-x-0"')
    expect(html).toContain('data-testid="news-social-facebook-0"')
    expect(html).not.toContain('data-testid="news-social-x-1"')
    expect(html).toContain('data-testid="news-social-facebook-1"')
    expect(html).not.toContain('data-testid="news-social-2"')
  })

  it('draws the marks as monochrome inline SVG, hidden from readers (the link carries the name)', () => {
    const html = render(MIXED, storage(null))
    const svgs = html.match(/<svg[^>]*>/g).filter((s) => s.includes('width="16"'))
    expect(svgs).toHaveLength(3)
    for (const svg of svgs) {
      expect(svg).toContain('fill="currentColor"')
      expect(svg).toContain('aria-hidden="true"')
    }
  })

  it('shows no link to a post whose URL isn\'t on X or Facebook over https', () => {
    const bad = parseChangelog({entries: [entry(13, {featured: true, social: {x: 'https://evil.example/a', facebook: 'http://facebook.com/a'}}), entry(12)]})
    const html = render(bad, storage(null))
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('news-social')
  })
})
