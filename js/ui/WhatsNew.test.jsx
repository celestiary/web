import {afterAll, beforeAll, describe, expect, it} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parseChangelog, tourCaption} from '../changelog.js'
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
  globalThis.document = {baseURI: 'https://celestiary.github.io/web/'}
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
    expect(html).toContain('href="https://celestiary.github.io/web/#sun/earth@-38.1501')
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
