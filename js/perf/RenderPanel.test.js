import {describe, expect, it} from 'bun:test'
import {TONE_MAP_GLSL, TONE_MAP_IDS, installToneMaps} from '../scene/toneMaps.js'
import {DEFAULT_TONE_MAP_GLSL} from '../scene/atmos/Atmosphere.js'
import {OUTPUT_COLOR_SPACES, TONE_MAPS, cameraRows, capabilityRows, colorSpaceName, infoSections, toneMappingName} from './RenderPanel.js'


describe('RenderPanel', () => {
  it('offers every tone map the shader has, and only those', () => {
    expect(TONE_MAPS.map((t) => t.key).sort()).toEqual(Object.keys(TONE_MAP_IDS).sort())
    expect(TONE_MAPS[0].key).toBe('neutral')
    expect(TONE_MAP_IDS.neutral).toBe(0)
  })

  it('has a shader branch for each id', () => {
    const max = Math.max(...Object.values(TONE_MAP_IDS))
    for (let id = 1; id < max; id++) {
      expect(TONE_MAP_GLSL).toContain(`uToneMap < ${id + 0.5}`)
    }
  })

  it('installs the operators into the pass once', () => {
    const line = DEFAULT_TONE_MAP_GLSL
    const material = {uniforms: {}, fragmentShader: `a\n${line}\nb`, needsUpdate: false}
    installToneMaps(material, line)
    expect(material.fragmentShader).toBe(`a\n${TONE_MAP_GLSL}\nb`)
    expect(material.uniforms.uToneMap.value).toBe(0)
    expect(material.needsUpdate).toBe(true)
    material.needsUpdate = false
    installToneMaps(material, line)
    expect(material.needsUpdate).toBe(false)
    expect(() => installToneMaps({uniforms: {}, fragmentShader: 'x'}, line)).toThrow()
  })

  it('offers three\'s two output colour spaces, the app\'s sRGB first', () => {
    expect(OUTPUT_COLOR_SPACES.map((o) => o.value)).toEqual(['srgb', 'srgb-linear'])
    expect(OUTPUT_COLOR_SPACES.map((o) => colorSpaceName(o.value))).toEqual(['SRGBColorSpace', 'LinearSRGBColorSpace'])
  })

  it('names three\'s constants', () => {
    expect(colorSpaceName('srgb')).toBe('SRGBColorSpace')
    expect(colorSpaceName('srgb-linear')).toBe('LinearSRGBColorSpace')
    expect(toneMappingName(5)).toBe('CustomToneMapping')
    expect(toneMappingName(7)).toBe('NeutralToneMapping')
  })

  it('lists every capability, calling the getters it can', () => {
    const rows = capabilityRows({
      isWebGL2: true, maxTextureSize: 16384, precision: 'highp',
      getMaxAnisotropy: () => 16, getMaxPrecision: (p) => p, textureFormatReadable: () => true,
    })
    expect(rows).toEqual([
      ['isWebGL2', 'true'], ['maxTextureSize', '16384'], ['precision', 'highp'],
      ['maxAnisotropy', '16'], ['maxPrecision (highp asked)', 'highp'],
    ])
  })

  it('builds the info sections: the output only (the frame\'s are the perf overlay\'s)', () => {
    const renderer = {
      info: {memory: {geometries: 12, textures: 34}},
      outputColorSpace: 'srgb-linear', toneMapping: 5, toneMappingExposure: 0.5,
    }
    const sections = infoSections({renderer, hdr: true, toneMap: 'agx'})
    expect(sections.map((s) => s.title)).toEqual(['Output'])
    const value = (title, name) => sections.find((s) => s.title.startsWith(title)).rows.find((r) => r[0] === name)[1]
    expect(value('Output', 'outputColorSpace')).toBe('LinearSRGBColorSpace')
    expect(value('Output', 'final tone map')).toBe('AgX')
    expect(value('Output', 'scene pass toneMapping')).toBe('CustomToneMapping')
  })

  it('reads the observer, the exposure and the glare', () => {
    const ui = {
      instrument: {name: 'a camera', psf: {glareModel: 1}}, _appInstrument: null,
      renderer: {toneMappingExposure: 0.25}, _exposureGoal: 0.5, _meterGain: 0.5, _meterGainGoal: 0.4,
      _renderedGain: 0.5, exposureCompensation: () => -1,
    }
    const sun = {enabled: {glare: true}, glare: {visible: true}, glareGain: 1}
    const row = (rows, name) => rows.find((r) => r[0] === name)[1]
    let rows = cameraRows(ui, sun)
    expect(row(rows, 'instrument')).toBe('a camera')
    expect(row(rows, 'exposure')).toBe('0.2500')
    expect(row(rows, 'metered gain')).toBe('0.5000 (goal 0.4000)')
    expect(row(rows, 'EV')).toBe('-1')
    expect(row(rows, 'glare model')).toContain('camera')
    expect(row(rows, 'glare')).toBe('on, drawn')
    rows = cameraRows({...ui, instrument: {name: 'Rubin', psf: {}}, _appInstrument: {}, exposureCompensation: () => 0},
        {...sun, glareGain: 2})
    expect(row(rows, 'instrument')).toBe('Rubin (an app\'s)')
    expect(row(rows, 'EV')).toBe('0 (auto)')
    expect(row(rows, 'glare model')).toContain('eye')
    expect(row(rows, 'glare')).toBe('on, drawn, x2 (diagnostic)')
    expect(row(cameraRows(ui, null), 'glare')).toBe('no Sun')
  })
})
