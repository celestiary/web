import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CreditsView, affordance, isOpen, loadCreditsDialog} from './CreditsFooter.jsx'
import {NEW_YORK_CREDITS} from '../scene/cesium/newYork.js'
import {GIBS_CREDIT} from '../scene/gibs.js'


describe('the credits footer', () => {
  const entry = (id, items, extra = {}) => ({id, items, element: null, order: 10, seq: 1, persistence: 'timed',
    keepsLogo: false, phase: 'in', ...extra})

  it('isn\'t laid out with nothing to credit, and has no icon then', () => {
    const html = renderToStaticMarkup(<CreditsView entries={[]}/>)
    expect(html).toContain('id="credits-footer"')
    expect(html).toContain('class="credits-footer empty"')
    expect(html).not.toContain('<button')
  })

  it('draws each credit, its links in a new tab, one line between them', () => {
    const html = renderToStaticMarkup(<CreditsView entries={[
      entry('cesium', [], {element: {}, keepsLogo: true}),
      entry('new-york', NEW_YORK_CREDITS),
    ]}/>)
    expect(html).toContain('class="credits-footer"')
    expect(html).toContain('<span class="credits-entry keeps-logo" data-credit="cesium"><span class="credits-slot"></span>')
    expect(html).toContain(
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">' +
        '© OpenStreetMap contributors (ODbL)</a>')
    expect(html).toContain('<a href="https://opendata.cityofnewyork.us/" target="_blank" rel="noopener noreferrer">NYC Open Data</a>')
    // Between the two entries and between New York's two items.
    expect(html.match(/credits-sep/g)).toHaveLength(2)
  })

  it('ends the line with Material\'s info icon, labelled Credits, which opens the dialog', () => {
    const html = renderToStaticMarkup(<CreditsView entries={[entry('gaia', [{text: 'ESA/Gaia/DPAC'}])]}/>)
    expect(html).toContain('<button type="button" class="credits-more" aria-label="Credits" title="Credits" ' +
      'aria-haspopup="dialog">')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="InfoOutlinedIcon"[^>]*>.*<\/svg><\/button><\/div>/)
    expect(html).not.toContain('>Credits</button>')
  })

  it('draws the credits in the line and fading, not those out, and Cesium\'s compact after its window', () => {
    const entries = [
      entry('cesium', [], {element: {}, keepsLogo: true, phase: 'compact'}),
      entry('new-york', NEW_YORK_CREDITS, {phase: 'out'}),
      entry('gaia', [{text: 'ESA/Gaia/DPAC'}], {phase: 'fading'}),
    ]
    const html = renderToStaticMarkup(<CreditsView entries={entries}/>)
    expect(html).not.toContain('OpenStreetMap')
    expect(html).toContain('<span class="credits-entry fading" data-credit="gaia">')
    expect(html).toContain('<span class="credits-entry keeps-logo compact" data-credit="cesium">')
    expect(html.match(/credits-sep/g)).toHaveLength(1)
  })

  it('hovered or focused, shows every applicable credit whole, none fading or compact', () => {
    const entries = [
      entry('cesium', [], {element: {}, keepsLogo: true, phase: 'compact'}),
      entry('new-york', NEW_YORK_CREDITS, {phase: 'out'}),
      entry('gaia', [{text: 'ESA/Gaia/DPAC'}], {phase: 'fading'}),
      entry('nasa-gibs', [GIBS_CREDIT], {phase: 'out'}),
    ]
    const html = renderToStaticMarkup(<CreditsView entries={entries} open/>)
    expect(html).toContain('class="credits-footer open"')
    expect(html).toContain('© OpenStreetMap contributors (ODbL)')
    expect(html).toContain('<span class="credits-entry" data-credit="gaia">')
    expect(html).toContain('<span class="credits-entry keeps-logo" data-credit="cesium">')
    expect(html).toContain('>Imagery: NASA GIBS / ESDIS</a>')
    expect(html).not.toContain('fading')
    expect(html).not.toContain('compact')
  })

  it('shows GIBS\'s credit short, linked to GIBS\'s page (the whole acknowledgement is in the dialog)', () => {
    expect(GIBS_CREDIT).toEqual({text: 'Imagery: NASA GIBS / ESDIS', href: 'https://earthdata.nasa.gov/gibs'})
  })

  it('opens the line on a mouse\'s hover or a keyboard focus while it lasts', () => {
    const closed = {hover: false, focus: false}
    expect(isOpen(closed)).toBe(false)
    const hovered = affordance(closed, 'enter')
    expect(isOpen(hovered)).toBe(true)
    expect(isOpen(affordance(hovered, 'leave'))).toBe(false)
    const focused = affordance(closed, 'focus')
    expect(isOpen(focused)).toBe(true)
    expect(isOpen(affordance(focused, 'blur'))).toBe(false)
    expect(affordance(closed, 'none')).toBe(closed)
  })

  it('loads the dialog lazily: a dynamic import, not in the footer\'s own imports', async () => {
    const src = readFileSync(new URL('./CreditsFooter.jsx', import.meta.url), 'utf8')
    expect(src).not.toMatch(/^import .*creditsDialog/m)
    expect(src).not.toMatch(/^import .*credits\/(catalog|facts)/m)
    expect(src).toContain('import(\'./creditsDialog.js\')')
    const m = await loadCreditsDialog()
    expect(typeof m.default).toBe('function')
    expect(m.default.name).toBe('CreditsDialog')
  })

  it('fades on the motion tokens, and not at all with reduced motion', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    expect(css).toContain('animation: credits-in var(--fade-ms) var(--fade-ease);')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}#credits-footer \.credits-entry \{\n {4}animation: none;\n {4}transition: none;/)
  })

  it('compacts Cesium\'s credits to the ion logo, but never while Bing\'s logo is in them', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const rule = '#credits-footer .credits-entry.compact:not(:has(img[title="Bing Imagery"])) .cesium-credit-textContainer'
    expect(css).toContain(rule)
    expect(css).toContain('#credits-footer .credits-entry.compact:not(:has(img[title="Bing Imagery"])) .cesium-credit-expand-link')
    // Nothing hides the logo's container.
    expect(css).not.toMatch(/compact[^{]*cesium-credit-logoContainer/)
  })
})
