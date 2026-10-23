import {describe, expect, it} from 'bun:test'
import Measure from '@pablo-mayrgundter/measure.js'
import {fieldRowsHtml, kindOf, labelOf, panelHtml, rowHtml, sectionHtml, systemHtml, valueOf} from './infoPanel.js'


const duration = (s) => `${s}s`
const sci = (x) => `${x}`


describe('infoPanel', () => {
  it('says a field in words, sentence case', () => {
    expect(labelOf('equatorialGravity')).toBe('Surface gravity')
    expect(labelOf('siderealRotationPeriod')).toBe('Day (sidereal)')
    expect(labelOf('zenithMag')).toBe('Zenith magnitude')
    expect(labelOf('rayleigh_unit')).toBe('Rayleigh unit')
    expect(labelOf('clouds')).toBe('Clouds')
  })

  it('gives a value its unit, apart, and lengths in km', () => {
    expect(valueOf('density', 5.515, duration, sci)).toEqual({value: '5.515', unit: 'g/cm³'})
    expect(valueOf('axialInclination', 23.45, duration, sci)).toEqual({value: '23.45°'})
    expect(valueOf('siderealRotationPeriod', 86163, duration, sci)).toEqual({value: '86163s'})
    expect(valueOf('height', Measure.parse('8e4 m').convertToUnit(), duration, sci)).toEqual({value: '80', unit: 'km'})
    expect(valueOf('outerRadius', Measure.parse('140210e3 m').convertToUnit(), duration, sci))
        .toEqual({value: '140,210', unit: 'km'})
    expect(valueOf('location', {ra: 1}, duration, sci)).toBeNull()
  })

  it('lists an object\'s fields as rows, nested ones on a line, the renderer\'s left out', () => {
    const html = fieldRowsHtml({
      height: Measure.parse('8e4 m').convertToUnit(), rayleigh: [5.8e-6, 1.35e-5],
      airglow: {zenithMag: 22.4, height: Measure.parse('9e4 m').convertToUnit()}, texture_dir: 'earth/', name: 'x',
    }, duration, sci)
    expect(html).toContain('<dt>Height</dt><dd>80<span class="info-unit">km</span></dd>')
    expect(html).toContain('<dt>Rayleigh</dt><dd>0.0000058, 0.0000135</dd>')
    expect(html).toContain('<dt>Airglow</dt><dd>zenith magnitude 22.4, height 90 km</dd>')
    expect(html).not.toContain('texture')
    expect(html).not.toContain('<dt>Name</dt>')
  })

  it('escapes what comes from data', () => {
    expect(rowHtml('a<b', 'x & "y"')).toBe('<div class="info-row"><dt>a&lt;b</dt><dd>x &amp; &quot;y&quot;</dd></div>\n')
    expect(panelHtml({name: '<i>'}, '')).toContain('<h2 class="info-name">&lt;i&gt;</h2>')
  })

  it('leaves out a section with nothing in it, and names one for the link', () => {
    expect(sectionHtml('rings', 'Rings', '', '')).toBe('')
    const html = sectionHtml('orbit', 'Orbit', '6 elements', '<p>x</p>')
    expect(html).toContain('<details class="info-section" data-prop="orbit" data-default-open="false">')
    expect(html).toContain('<span class="info-peek">6 elements</span>')
  })

  it('names the kinds, and links a system\'s bodies', () => {
    expect(kindOf('planet', 'earth')).toBe('Planet')
    expect(kindOf('planet', 'pluto')).toBe('Dwarf planet')
    expect(systemHtml([], 'sun')).toBe('')
    expect(systemHtml(['moon'], 'sun/earth')).toBe('<ul class="info-chips"><li><a class="info-chip" ' +
      'href="#sun/earth/moon">Moon</a></li></ul>\n')
  })
})
