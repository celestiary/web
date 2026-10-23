import {describe, expect, it} from 'bun:test'
import Measure from '@pablo-mayrgundter/measure.js'


// The real module, by a name the process-global mock of './ControlPanel'
// (Celestiary.test.js) doesn't take.
const realSpecifier = './ControlPanel.js?real'
const {default: ControlPanel, periodText, sci} = await import(realSpecifier)


/** Io's orbit, as its descriptor has it. */
const IO_ORBIT = {
  elements: 'JPL SSD', referencePlane: 'Laplace', referencePole: {ra: 268.1, dec: 64.5}, epoch: 2451545.0,
  semiMajorAxis: 421800000.0, eccentricity: 0.004, inclination: 0.0, longitudeOfAscendingNode: 0.0,
  argumentOfPericenter: 49.1, meanAnomaly: 330.9, period: 1.762732, periodOf: 'meanAnomaly',
  apsidalPeriod: -1.333, nodalPeriod: 0, siderealOrbitPeriod: 152853.509808,
}


/** @returns {object} a population as the panel reads it: two groups, three objects */
function fakePopulation() {
  const pop = {
    title: 'Orbiters',
    shown: {nasa: true, esa: false},
    labelBudget: 1,
    groups: () => [
      {key: 'nasa', label: 'NASA', color: '#ffffff', count: 2, shown: pop.shown.nasa},
      {key: 'esa', label: 'ESA', color: '#c8c8c8', count: 1, shown: pop.shown.esa},
    ],
    maxLabels: () => (pop.shown.nasa ? 2 : 0) + (pop.shown.esa ? 1 : 0),
  }
  return pop
}


/**
 * @param {object} [dataset]
 * @param {object} [props]
 * @param {object} [children] by selector
 * @returns {object} an element, as far as _wirePopulation uses one
 */
function fakeElt(dataset = {}, props = {}, children = {}) {
  const listeners = {}
  const classes = new Set
  return {
    dataset, ...props, textContent: '',
    classList: {
      contains: (c) => classes.has(c), has: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    setAttribute() {/* aria */},
    addEventListener: (type, fn) => {
      listeners[type] = fn
    },
    fire(type) {
      listeners[type]?.({key: '', preventDefault() {/* none */}})
    },
    querySelector: (sel) => children[sel] ?? null,
  }
}


describe('ControlPanel', () => {
  it('lists an orbit\'s six elements of the date, each tagged for the scene', () => {
    const panel = new ControlPanel(null, null)
    panel.orbitHooks = {elements: () => new Set(['i', 'peri'])}
    const html = panel.orbitListHtml({name: 'io', orbit: IO_ORBIT})
    const keys = [...html.matchAll(/data-element="(\w+)"/g)].map((m) => m[1])
    expect(keys).toEqual(['semiMajorAxis', 'eccentricity', 'inclination', 'longitudeOfAscendingNode',
      'argumentOfPericenter', 'meanAnomaly'])
    // The codes the link and the scene keep; those on are marked, as
    // switches.
    expect([...html.matchAll(/data-code="(\w+)"/g)].map((m) => m[1])).toEqual(['a', 'e', 'i', 'node', 'peri', 'at'])
    expect([...html.matchAll(/orbit-element on" data-element="(\w+)"/g)].map((m) => m[1]))
        .toEqual(['inclination', 'argumentOfPericenter'])
    expect(html).toContain('role="switch" aria-checked="true"')
    expect(html).toContain('<dl class="info-rows is-compact orbit-elements">')
    expect(html).toContain('421,800 km')
    expect(html).toContain('49.100°')
    expect(html).toContain('the Laplace plane')
    // The rest of the block follows as rows, in words; the listed fields
    // aren't repeated.
    expect(html).toContain('<dt>Apsidal period</dt>')
    expect(html).not.toContain('<dt>Mean anomaly</dt>')
    expect(html).not.toContain('<dt>Semi major axis</dt>')
    // The lead first, then the period, then the elements; the true anomaly
    // beside the mean.
    const lead = html.indexOf('class="orbit-kind"')
    const period = html.indexOf('<dt>Orbit period (sidereal)</dt><dd>1d 18h 27m 33s</dd>')
    expect(lead).toBeGreaterThanOrEqual(0)
    expect(period).toBeGreaterThan(lead)
    expect(period).toBeLessThan(html.indexOf('data-element='))
    expect(html).toContain('true anomaly <span class="orbit-true">')
    // A link to the guide's orbit page, on this orbit, with the same lit.
    expect(html).toMatch(/<a class="orbit-guide" href="guide\/orbit#orbit:body=io,a=421800000,[^"]*lit=i\+peri">/)
  })

  it('keeps the head\'s distance at the date as time runs, the orbit list shut', () => {
    // The osculating semi-major axis follows the date: a panel built hours of
    // sim time earlier showed its opening date's, and a link of the view
    // another (#293).
    const panel = new ControlPanel(null, null)
    let a = 384400e3
    panel.orbitHooks = {elementsOf: () => ({a, e: 0.05, i: 5, node: 0, peri: 0, meanAnomaly: 0})}
    const fact = {textContent: '384,400 km from Earth'}
    panel.containerElt = {querySelector: (sel) => (sel === '.info-fact' ? fact : null)}
    panel._orbit = {body: {name: 'moon', parent: 'earth', orbit: {}}, list: {isConnected: true, open: false}, ranMs: 0}
    a = 386463e3
    panel.frame(1000)
    expect(fact.textContent).toBe('386,463 km from Earth')
    // A few times a second, not every frame.
    a = 385866e3
    panel.frame(1100)
    expect(fact.textContent).toBe('386,463 km from Earth')
    panel.frame(1300)
    expect(fact.textContent).toBe('385,866 km from Earth')
  })

  it('shows a body as a head, its key rows, and sections that open on request', () => {
    const panel = new ControlPanel(null, null)
    panel.spaceHook = () => null
    const html = panel.bodyPanelHtml({
      type: 'moon', name: 'io', parent: 'jupiter', radius: Measure.parse('1.821E6 m').convertToUnit(),
      mass: Measure.parse('8.94E25 g').convertToUnit(), density: 3.57, siderealRotationPeriod: 152928.0,
      axialInclination: 1.0, albedo: 0.61, has_locations: true, texture_longitude: 180, orbit: IO_ORBIT,
      system: [], location: {coord: {ra: 1.0, dec: 1.0, dist: 0.0}},
    }, 'sun/jupiter/io')
    // The head: the name, its kind, and how far out it orbits.
    expect(html).toContain('<h2 class="info-name">Io</h2>')
    expect(html).toContain('<span class="info-badge">Moon</span>')
    expect(html).toContain('<span class="info-fact">421,800 km from Jupiter</span>')
    // The summary, before any section: radius, day, its orbit's period.
    const summary = html.slice(0, html.indexOf('<details'))
    expect(summary).toContain('<dt>Radius</dt><dd>1,821<span class="info-unit">km</span></dd>')
    expect(summary).toContain('<dt>Day</dt><dd>42h 29m</dd>')
    expect(summary).toContain('<dt>Orbit period</dt><dd>42h 28m</dd>')
    expect(summary).not.toContain('Mass')
    // The sections, all shut, named for the link's `info:` token; no moons,
    // no system section.
    const sections = [...html.matchAll(/<details class="info-section" data-prop="(\w+)" data-default-open="(\w+)"/g)]
    expect(sections.map((m) => m[1])).toEqual(['orbit', 'physical', 'more'])
    expect(sections.every((m) => m[2] === 'false')).toBe(true)
    expect(html).toContain('<dt>Mass</dt><dd>8.9400 × 10²²<span class="info-unit">kg</span></dd>')
    expect(html).toContain('<dt>Density</dt><dd>3.57<span class="info-unit">g/cm³</span></dd>')
    // What's left goes in More data, in words and on one line; the
    // renderer's fields don't show.
    expect(html).toContain('<dt>Location</dt><dd>coord ra 1, dec 1, dist 0</dd>')
    expect(html).not.toContain('texture')
    expect(html).not.toContain('Has locations')
  })

  it('opens a star\'s planets, and links each', () => {
    const panel = new ControlPanel(null, null)
    const html = panel.bodyPanelHtml({type: 'star', name: 'sun', spectralType: '4', system: ['mercury', 'venus']}, 'sun')
    expect(html).toContain('<span class="info-badge">Star</span>')
    expect(html).toContain('<dt>Planets</dt><dd>2</dd>')
    expect(html).toContain('<details class="info-section" data-prop="system" data-default-open="true" open>')
    expect(html).toContain('<a class="info-chip" href="#sun/venus">Venus</a>')
  })

  it('lists the space around a body, and why it can\'t hold a synchronous orbit', () => {
    const panel = new ControlPanel(null, null)
    expect(panel.spaceAround('earth')).toEqual({html: '', peek: ''})
    const facts = {name: 'Earth–Moon', secondary: 'Moon', hill: 57.9e6, l1: 58.1e6, l2: 64.5e6,
      sync: {radius: 88.5e6, why: 'beyondHill'}}
    panel.spaceHook = (name) => (name === 'moon' ? facts : null)
    const {html, peek} = panel.spaceAround('moon')
    expect(peek).toBe('Hill sphere, Lagrange points')
    expect(html).toContain('<dt>Hill sphere</dt><dd>57,900 km</dd>')
    expect(html).toContain('Where Moon\'s gravity rules.')
    expect(html).toContain('<dt>Earth–Moon L1</dt><dd>58,100 km<span class="info-unit">toward the Earth</span>')
    expect(html).toContain('<dt>Earth–Moon L2</dt><dd>64,500 km<span class="info-unit">beyond</span>')
    expect(html).toContain('none: at 88,500 km it would be past the Hill sphere, where the Earth\'s pull')
    panel.spaceHook = () => ({...facts, name: 'Sun–Earth', secondary: 'Earth', syncName: 'geostationary orbit',
      sync: {radius: 42164e3, why: null}})
    expect(panel.spaceAround('earth').html).toContain('42,164 km from the centre (geostationary orbit)')
  })

  it('lists a body\'s orbital regimes under the space around it, with or without a pair', () => {
    const panel = new ControlPanel(null, null)
    const regimes = ['low Earth orbit (LEO): 160 km to 2,000 km up', 'GPS: 6 planes at 55°, 20,200 km up',
      'sun-synchronous, 700 km, dawn–dusk, inclined 98.2°']
    panel.spaceHook = () => ({name: 'Sun–Earth', secondary: 'Earth', hill: 1.5e9, l1: 1.5e9, l2: 1.5e9,
      sync: {radius: 42164e3, why: null}, regimes})
    let {html, peek} = panel.spaceAround('earth')
    expect(peek).toBe('Hill sphere, Lagrange points, regimes')
    expect(html.indexOf('<div class="info-subhead">Orbital regimes</div>')).toBeGreaterThan(html.indexOf('Hill sphere'))
    expect(html).toContain('<dt>Low Earth orbit (LEO)</dt><dd>160 km to 2,000 km up</dd>')
    expect(html).toContain('<dt>GPS</dt><dd>6 planes at 55°, 20,200 km up</dd>')
    expect(html).toContain('<dt>Sun-synchronous</dt><dd>700 km, dawn–dusk, inclined 98.2°</dd>')
    // Regimes alone (Scene.spaceAround for a body with no pair).
    panel.spaceHook = () => ({regimes});
    ({html, peek} = panel.spaceAround('mars'))
    expect(peek).toBe('regimes')
    expect(html).not.toContain('Hill sphere')
    expect(html).toContain('<dt>GPS</dt>')
  })

  it('keeps the sections as the user leaves them, for the link, against their defaults', () => {
    const panel = new ControlPanel(null, null)
    let changes = 0
    panel.onUiChange = () => changes++
    const section = (prop, open, defaultOpen) => ({target: {tagName: 'DETAILS', open, dataset: {prop, defaultOpen}}})
    panel._onToggle(section('orbit', true, 'false'))
    panel._onToggle(section('system', false, 'true'))
    expect([...panel.uiState.open]).toEqual(['orbit'])
    expect([...panel.uiState.shut]).toEqual(['system'])
    expect(changes).toBe(2)
    // The toggles the panel's own restore makes change nothing, and say
    // nothing.
    panel._onToggle(section('orbit', true, 'false'))
    expect(changes).toBe(2)
    // Back to its default, it leaves the link.
    panel._onToggle(section('orbit', false, 'false'))
    expect(panel.uiState.open.size).toBe(0)
    expect(changes).toBe(3)
  })

  it('gives the summary\'s periods to a glance\'s precision', () => {
    expect(periodText(86163.084)).toBe('23h 56m')
    expect(periodText(31558150)).toBe('365.26 days')
    expect(periodText(5199500000)).toBe('164.8 years')
    expect(periodText(1800)).toBe('30m')
  })

  it('lists the three-body families at the body\'s pairs, as switches', () => {
    const panel = new ControlPanel(null, null)
    expect(panel.periodicHtml('earth')).toBe('')
    panel.periodicHooks = {
      pairs: () => [{body: 'moon', name: 'Earth–Moon', families: [{code: 'dro', name: 'DRO', on: true},
        {code: 'nrho', name: '9:2 NRHO', on: false}]}],
      frame: () => 'inertial',
      manifolds: () => true,
    }
    const html = panel.periodicHtml('earth')
    expect(html).toContain('<div class="info-subhead">Three-body orbits</div>')
    expect(html).toContain('<dt>Earth–Moon</dt><dd class="info-switches">')
    expect(html).toContain('<dt>Drawn</dt>')
    expect(html).toContain('class="periodic-family on" data-body="moon" data-code="dro"')
    expect(html).toContain('class="periodic-family" data-body="moon" data-code="nrho"')
    expect(html).toContain('class="periodic-frame on" data-frame="inertial"')
    expect(html).toContain('class="periodic-manifolds on"')
    // In the Space around section, after the pair's rows.
    panel.spaceHook = () => ({name: 'Earth–Moon', secondary: 'Moon', hill: 6e7, l1: 6e7, l2: 6e7, sync: null})
    const space = panel.spaceAround('earth')
    expect(space.peek).toBe('Hill sphere, Lagrange points, three-body orbits')
    expect(space.html.indexOf('Three-body orbits')).toBeGreaterThan(space.html.indexOf('Hill sphere'))
  })

  it('gives a body with a population a section: its groups as switches, and a names slider', () => {
    const panel = new ControlPanel(null, null)
    expect(panel.populationSectionHtml('earth')).toBe('')
    const pop = fakePopulation()
    panel.populationHooks = {of: (body) => (body === 'mars' ? pop : null)}
    expect(panel.populationSectionHtml('earth')).toBe('')
    const html = panel.populationSectionHtml('mars')
    // Named for the link's `info:` token, as the other sections are.
    expect(html).toContain('data-prop="population"')
    expect(html).toContain('Orbiters')
    expect(html).toContain('3 in 2 groups')
    expect(html).toContain('class="population-group on" data-body="mars" data-key="nasa"')
    expect(html).toContain('class="population-group" data-body="mars" data-key="esa"')
    expect(html).toContain('style="background: #ffffff"')
    expect(html).toContain('<input type="range" min="0" max="2" step="1" value="1"')
  })

  it('switches a group and moves the names slider through the hooks', () => {
    const pop = fakePopulation()
    const calls = []
    const panel = new ControlPanel(null, null)
    panel.populationHooks = {
      of: () => pop,
      setGroup: (body, key, on) => {
        calls.push(['group', body, key, on])
        pop.shown[key] = on
      },
      setLabels: (body, n) => {
        calls.push(['labels', body, n])
        pop.labelBudget = n
      },
    }
    const chip = fakeElt({body: 'mars', key: 'esa'})
    const input = fakeElt({}, {value: '1', max: '2'})
    const value = fakeElt()
    const slider = fakeElt({body: 'mars'}, {}, {input, '.population-labels-value': value})
    panel.containerElt = {
      querySelectorAll: (sel) => (sel === '.population-group' ? [chip] : []),
      querySelector: (sel) => (sel === '.population-labels' ? slider : null),
    }
    panel._wirePopulation()
    chip.fire('click')
    expect(calls).toEqual([['group', 'mars', 'esa', true]])
    expect(chip.classList.has('on')).toBe(true)
    // The slider's reach follows the groups shown.
    expect(input.max).toBe('3')
    input.value = '3'
    input.fire('input')
    expect(calls.at(-1)).toEqual(['labels', 'mars', 3])
    expect(value.textContent).toBe('3')
  })

  it('lists the craft that can be flown about the body, with a flown one\'s facts', () => {
    const panel = new ControlPanel(null, null)
    expect(panel.craftHtml('earth')).toBe('')
    panel.craftHooks = {list: () => [{code: 'tli', name: 'transfer to the Moon', on: true, text: 'leaves 2026-10-23'}]}
    const html = panel.craftHtml('earth')
    expect(html).toContain('class="craft-flight on" data-code="tli"')
    expect(html).toContain('<div class="info-subhead">Craft</div>')
    expect(html).toContain('<dt>transfer to the Moon</dt>')
    expect(html).toContain('<span class="craft-facts">leaves 2026-10-23</span>')
  })

  it('writes masses in scientific notation', () => {
    expect(sci(5.97219e24)).toBe('5.9722 × 10²⁴')
    expect(sci(1.4762e15)).toBe('1.4762 × 10¹⁵')
  })
})
