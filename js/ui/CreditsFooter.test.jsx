import {describe, expect, it} from 'bun:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CreditsView, affordance, isOpen} from './CreditsFooter.jsx'
import {NEW_YORK_CREDITS} from '../scene/cesium/newYork.js'


describe('the credits footer', () => {
  const entry = (id, items, extra = {}) => ({id, items, element: null, order: 10, seq: 1, persistence: 'timed', phase: 'in',
    ...extra})

  it('isn\'t laid out with nothing to credit', () => {
    const html = renderToStaticMarkup(<CreditsView entries={[]}/>)
    expect(html).toContain('id="credits-footer"')
    expect(html).toContain('class="credits-footer empty"')
  })

  it('draws each credit, its links in a new tab, one line between them', () => {
    const html = renderToStaticMarkup(<CreditsView entries={[
      entry('cesium', [], {element: {}}),
      entry('new-york', NEW_YORK_CREDITS),
    ]}/>)
    expect(html).toContain('class="credits-footer"')
    expect(html).toContain('data-credit="cesium"><span class="credits-slot"></span>')
    expect(html).toContain(
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">' +
        '© OpenStreetMap contributors (ODbL)</a>')
    expect(html).toContain('<a href="https://opendata.cityofnewyork.us/" target="_blank" rel="noopener noreferrer">NYC Open Data</a>')
    // Between the two entries and between New York's two items.
    expect(html.match(/credits-sep/g)).toHaveLength(2)
  })

  it('draws the credits in the line and fading, not those out; the Credits button at the end', () => {
    const entries = [
      entry('cesium', [], {element: {}, persistence: 'while-shown'}),
      entry('new-york', NEW_YORK_CREDITS, {phase: 'out'}),
      entry('gaia', [{text: 'ESA/Gaia/DPAC'}], {phase: 'fading'}),
    ]
    const html = renderToStaticMarkup(<CreditsView entries={entries}/>)
    expect(html).not.toContain('OpenStreetMap')
    expect(html).toContain('<span class="credits-entry fading" data-credit="gaia">')
    expect(html).toContain('<span class="credits-entry" data-credit="cesium">')
    expect(html).toMatch(/<button type="button" class="credits-more" aria-expanded="false"[^>]*>Credits<\/button><\/div>/)
    expect(html.match(/credits-sep/g)).toHaveLength(1)
  })

  it('with the Credits button open, shows every applicable credit, none fading', () => {
    const entries = [
      entry('new-york', NEW_YORK_CREDITS, {phase: 'out'}),
      entry('gaia', [{text: 'ESA/Gaia/DPAC'}], {phase: 'fading'}),
      entry('nasa-gibs', [{text: 'GIBS'}], {phase: 'out'}),
    ]
    const html = renderToStaticMarkup(<CreditsView entries={entries} open/>)
    expect(html).toContain('class="credits-footer open"')
    expect(html).toContain('© OpenStreetMap contributors (ODbL)')
    expect(html).toContain('<span class="credits-entry" data-credit="gaia">')
    expect(html).toContain('data-credit="nasa-gibs"')
    expect(html).not.toContain('fading')
    expect(html).toContain('aria-expanded="true"')
  })

  it('keeps the Credits button when every credit is out, and none at all with nothing applicable', () => {
    const out = renderToStaticMarkup(<CreditsView entries={[entry('gaia', [{text: 'ESA/Gaia/DPAC'}], {phase: 'out'})]}/>)
    expect(out).not.toContain('ESA/Gaia/DPAC')
    expect(out).toContain('class="credits-footer"')
    expect(out).toContain('>Credits</button>')
    expect(renderToStaticMarkup(<CreditsView entries={[]}/>)).not.toContain('<button')
  })

  it('opens the Credits button on a hover or a keyboard focus while it lasts, or a tap until the next', () => {
    const closed = {hover: false, focus: false, pinned: false}
    expect(isOpen(closed)).toBe(false)
    const hovered = affordance(closed, 'enter')
    expect(isOpen(hovered)).toBe(true)
    expect(isOpen(affordance(hovered, 'leave'))).toBe(false)
    const focused = affordance(closed, 'focus')
    expect(isOpen(focused)).toBe(true)
    expect(isOpen(affordance(focused, 'blur'))).toBe(false)
    // A tap pins it; the pointer leaving doesn't close it; a tap or a tap
    // elsewhere does.
    const tapped = affordance(closed, 'tap')
    expect(isOpen(tapped)).toBe(true)
    expect(isOpen(affordance(tapped, 'leave'))).toBe(true)
    expect(isOpen(affordance(tapped, 'tap'))).toBe(false)
    expect(isOpen(affordance(tapped, 'away'))).toBe(false)
    // Hovered, a click pins it, and a second closes it though it's hovered.
    const pinned = affordance(hovered, 'tap')
    expect(isOpen(affordance(pinned, 'leave'))).toBe(true)
    expect(isOpen(affordance(pinned, 'tap'))).toBe(false)
  })

  it('fades on the motion tokens, and not at all with reduced motion', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    expect(css).toContain('animation: credits-in var(--fade-ms) var(--fade-ease);')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}#credits-footer \.credits-entry \{\n {4}animation: none;\n {4}transition: none;/)
  })
})
