import {describe, expect, it} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CreditsView} from './CreditsFooter.jsx'
import {NEW_YORK_CREDITS} from '../scene/cesium/newYork.js'


describe('the credits footer', () => {
  const entry = (id, items, extra = {}) => ({id, items, element: null, order: 10, seq: 1, ...extra})

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
})
