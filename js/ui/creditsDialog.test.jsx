import {afterEach, describe, expect, it} from 'bun:test'
import React from 'react'
import {readFileSync} from 'node:fs'
import {renderToStaticMarkup} from 'react-dom/server'
import {creditsDialog, tabKey} from './creditsDialog.js'
import {CREDITS_DIALOG_DEPS} from './CreditsFooter.jsx'
import {CREDITS_CATALOG, GIBS_ACKNOWLEDGEMENT, activeCredits, creditsContext, factsOf} from '../credits/catalog.js'
import {addCredit, clearCredits, hasCredit, removeCredit} from '../credits.js'
import {GIBS_CREDIT} from '../scene/gibs.js'


const {CreditsList, DialogTabs} = creditsDialog(CREDITS_DIALOG_DEPS)
const refs = CREDITS_DIALOG_DEPS.refs


describe('the credits dialog', () => {
  afterEach(() => clearCredits())

  it('lists every source the docs name, each with a name, http(s) links and whether the footer shows it', () => {
    const ids = CREDITS_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['cesium', 'ion-earth', 'ion-moon', 'ion-mars', 'gaia', 'nasa-gibs', 'osm', 'nyc-open-data',
      'stars', 'star-names', 'sparc', 'celestrak', 'dsn-now', 'jpl-periodic-orbits', 'vsop87', 'jpl-horizons',
      'iau-rotation', 'iau-gazetteer', 'blue-marble', 'black-marble', 'planetary-mosaics', 'noaa-swpc',
      'rubin-model', 'webb-model']) {
      expect(ids).toContain(id)
    }
    for (const e of CREDITS_CATALOG) {
      expect(e.name.length).toBeGreaterThan(0)
      expect(typeof e.footer).toBe('boolean')
      expect(e.attribution.length).toBeGreaterThan(0)
      for (const link of [...e.attribution, ...(e.licence ? [e.licence] : [])]) {
        expect(link.href).toMatch(/^https:\/\//)
      }
    }
    expect(CREDITS_CATALOG.filter((e) => e.footer).map((e) => e.id))
        .toEqual(['cesium', 'ion-earth', 'ion-moon', 'ion-mars', 'gaia', 'nasa-gibs', 'osm', 'nyc-open-data'])
    // GIBS's whole acknowledgement is here, the footer's short line there.
    const gibs = CREDITS_CATALOG.find((e) => e.id === 'nasa-gibs')
    expect(gibs.note).toBe(GIBS_ACKNOWLEDGEMENT)
    expect(GIBS_ACKNOWLEDGEMENT).toContain('We acknowledge the use of imagery provided by services from NASA\'s Global ' +
      'Imagery Browse Services (GIBS)')
    expect(gibs.attribution[0].href).toBe(GIBS_CREDIT.href)
  })

  it('lists as active the footer\'s credits, following the registry, and what the scene holds', () => {
    const ids = (c) => activeCredits(CREDITS_CATALOG, creditsContext(c, hasCredit, refs)).map((e) => e.id)
    expect(ids(null)).toEqual([])
    addCredit('gaia', {text: 'ESA/Gaia/DPAC'}, {persistence: 'timed'})
    addCredit('new-york', [{text: 'OSM'}], {persistence: 'timed'})
    expect(ids(null)).toEqual(['gaia', 'osm', 'nyc-open-data'])
    removeCredit('new-york')
    addCredit('nasa-gibs', GIBS_CREDIT, {persistence: 'timed'})
    expect(ids(null)).toEqual(['gaia', 'nasa-gibs'])
    // A scene: Earth with its layer active, the stars, satellites, VSOP87.
    const c = {
      ui: {layers: {active: [{name: 'earth'}], bodies: {earth: {}}}},
      scene: {objects: {earth: {}, sun: {}}, stars: {catalog: {hipByName: new Map([['Vega', 1]])}}, satellites: {},
        networks: {}},
      animation: {vsop: () => {}},
    }
    addCredit('cesium', {element: {}}, {order: 0, persistence: 'timed', keepsLogo: true})
    expect(ids(c)).toEqual(['cesium', 'ion-earth', 'gaia', 'nasa-gibs', 'stars', 'star-names', 'celestrak', 'vsop87',
      'iau-rotation', 'blue-marble', 'black-marble', 'noaa-swpc'])
  })

  it('draws each entry: its name as a title, its links and licence, its note, its facts, where it shows', () => {
    const ctx = creditsContext(null, () => false, refs)
    const html = renderToStaticMarkup(<CreditsList entries={CREDITS_CATALOG.filter((e) => e.id === 'gaia')} ctx={ctx}/>)
    expect(html).toContain('<h3 id="credit-gaia">ESA Gaia DR3</h3>')
    expect(html).toContain('<a href="https://www.cosmos.esa.int/gaia" target="_blank" rel="noopener noreferrer">ESA/Gaia/DPAC</a>')
    expect(html).toContain('href="https://creativecommons.org/licenses/by-sa/3.0/igo/" target="_blank" rel="noopener noreferrer" class="credits-licence">CC BY-SA 3.0 IGO</a>')
    expect(html).toContain('<dt>Observed</dt><dd>25 July 2014 to 28 May 2017 (34 months)</dd>')
    expect(html).toContain('<dt>Released</dt><dd>13 June 2022, as Gaia DR3</dd>')
    expect(html).toContain('In the footer while its data is drawn')
    const all = renderToStaticMarkup(<CreditsList entries={CREDITS_CATALOG} ctx={ctx}/>)
    expect(all.match(/<section /g)).toHaveLength(CREDITS_CATALOG.length)
    expect(all).toContain('Listed here only')
    expect(renderToStaticMarkup(<CreditsList entries={[]} ctx={ctx} empty='Nothing.'/>)).toContain('Nothing.')
  })

  it('has two tabs, Active and All, the selected one in the tab order, arrows and Home and End between them', () => {
    const tabs = [{id: 'active', label: 'Active (3)'}, {id: 'all', label: 'All (24)'}]
    const html = renderToStaticMarkup(<DialogTabs tabs={tabs} value='all' onChange={() => {}}/>)
    expect(html).toContain('role="tablist" aria-label="Credits"')
    expect(html).toMatch(/<button type="button" role="tab" id="credits-tab-active" aria-controls="credits-panel" aria-selected="false" tabindex="-1"[^>]*>Active \(3\)<\/button>/)
    expect(html).toMatch(/id="credits-tab-all" aria-controls="credits-panel" aria-selected="true" tabindex="0"/)
    expect([tabKey('ArrowRight', 0, 2), tabKey('ArrowRight', 1, 2), tabKey('ArrowLeft', 0, 2), tabKey('Home', 1, 2),
      tabKey('End', 0, 2), tabKey('Enter', 0, 2)]).toEqual([1, 0, 1, 0, 1, null])
  })

  it('takes what it shares with the first load from the footer, importing none of it itself', () => {
    const src = readFileSync(new URL('./creditsDialog.js', import.meta.url), 'utf8')
    expect(src.match(/^import .*$/gm)).toEqual(["import {CREDITS_CATALOG, activeCredits, creditsContext, factsOf} from '../credits/catalog.js'"])
    for (const f of ['../credits/catalog.js', '../credits/facts.js']) {
      const lib = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect((lib.match(/^import .* from '(.*)'$/gm) ?? []).every((line) => line.endsWith("'./facts.js'"))).toBe(true)
    }
    expect(refs.bodies.earth.detailFromLevel).toBe(5)
  })

  it('gives every entry\'s facts from no state at all, and a failing provider none', () => {
    const ctx = creditsContext(null, () => false, refs)
    for (const e of CREDITS_CATALOG) {
      expect(Array.isArray(factsOf(e, ctx))).toBe(true)
    }
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(factsOf({id: 'x', facts: () => {
        throw new Error('no')
      }}, ctx)).toEqual([])
    } finally {
      console.warn = warn
    }
  })
})
