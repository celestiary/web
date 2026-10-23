import {describe, expect, it} from 'bun:test'


// The real module, by a name the process-global mock of './ControlPanel'
// (Celestiary.test.js) doesn't take.
const realSpecifier = './ControlPanel.js?real'
const {default: ControlPanel, sci} = await import(realSpecifier)


describe('ControlPanel', () => {
  it('lists an orbit\'s six elements of the date, each tagged for the scene', () => {
    const panel = new ControlPanel(null, null)
    panel.orbitHooks = {elements: () => new Set(['i', 'peri'])}
    const html = panel.orbitListHtml({
      name: 'io',
      orbit: {
        elements: 'JPL SSD', referencePlane: 'Laplace', referencePole: {ra: 268.1, dec: 64.5}, epoch: 2451545.0,
        semiMajorAxis: 421800000.0, eccentricity: 0.004, inclination: 0.0, longitudeOfAscendingNode: 0.0,
        argumentOfPericenter: 49.1, meanAnomaly: 330.9, period: 1.762732, periodOf: 'meanAnomaly',
        apsidalPeriod: -1.333, nodalPeriod: 0, siderealOrbitPeriod: 152853.509808,
      },
    }, 'sun/jupiter')
    const keys = [...html.matchAll(/data-element="(\w+)"/g)].map((m) => m[1])
    expect(keys).toEqual(['semiMajorAxis', 'eccentricity', 'inclination', 'longitudeOfAscendingNode',
      'argumentOfPericenter', 'meanAnomaly'])
    // The codes the link and the scene keep; those on are marked.  The list
    // is named for the link's `info:` token, which opens it.
    expect([...html.matchAll(/data-code="(\w+)"/g)].map((m) => m[1])).toEqual(['a', 'e', 'i', 'node', 'peri', 'at'])
    expect([...html.matchAll(/orbit-element on" data-element="(\w+)"/g)].map((m) => m[1]))
        .toEqual(['inclination', 'argumentOfPericenter'])
    expect(html).toContain('<ul class="collapsed orbit-elements" data-prop="orbit"')
    expect(html).toContain('421,800 km')
    expect(html).toContain('49.100°')
    expect(html).toContain('the Laplace plane')
    // The rest of the block follows; the listed fields aren't repeated.
    expect(html).toContain('apsidalPeriod')
    expect(html).not.toContain('<li>meanAnomaly:')
    // The lead first, then the period, as the user asked; the true anomaly
    // beside the mean.
    const lead = html.indexOf('class="orbit-lead"')
    const period = html.indexOf('orbit period (sidereal): 1d 18h 27m 33s')
    expect(lead).toBeGreaterThan(0)
    expect(period).toBeGreaterThan(lead)
    expect(period).toBeLessThan(html.indexOf('data-element='))
    expect(html).toContain('true anomaly: <span class="orbit-true">')
    expect(html).not.toContain('<li>siderealOrbitPeriod:')
    expect(html).not.toContain('<li>semiMajorAxis:')
    // A link to the guide's orbit page, on this orbit, with the same lit.
    expect(html).toMatch(/<a class="orbit-guide" href="guide\/orbit#orbit:body=io,a=421800000,[^"]*lit=i\+peri">/)
  })

  it('lists the space around a body, and why it can\'t hold a synchronous orbit', () => {
    const panel = new ControlPanel(null, null)
    expect(panel.spaceListHtml('earth')).toBe('')
    const facts = {name: 'Earth–Moon', secondary: 'Moon', hill: 57.9e6, l1: 58.1e6, l2: 64.5e6,
      sync: {radius: 88.5e6, why: 'beyondHill'}}
    panel.spaceHook = (name) => (name === 'moon' ? facts : null)
    const html = panel.spaceListHtml('moon')
    expect(html).toContain('data-prop="space"')
    expect(html).toContain('Hill sphere: 57,900 km')
    expect(html).toContain('Earth–Moon L1: 58,100 km toward the Earth; L2: 64,500 km beyond')
    expect(html).toContain('none: at 88,500 km it would be past the Hill sphere, where the Earth\'s pull')
    panel.spaceHook = () => ({...facts, name: 'Sun–Earth', secondary: 'Earth', syncName: 'geostationary orbit',
      sync: {radius: 42164e3, why: null}})
    expect(panel.spaceListHtml('earth')).toContain('synchronous orbit: 42,164 km from the centre (geostationary orbit)')
  })

  it('writes masses in scientific notation', () => {
    expect(sci(5.97219e24)).toBe('5.9722 × 10²⁴')
    expect(sci(1.4762e15)).toBe('1.4762 × 10¹⁵')
  })
})
