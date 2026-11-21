import {describe, expect, it} from 'bun:test'
import {TONE_MAP_GLSL, TONE_MAP_IDS, installToneMaps} from '../scene/toneMaps.js'
import {DEFAULT_TONE_MAP_GLSL} from '../scene/atmos/Atmosphere.js'
import {OUTPUT_COLOR_SPACES, TONE_MAPS, capabilityRows, colorSpaceName, infoSections, toneMappingName} from './RenderPanel.js'


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

  it('offers three\'s two output colour spaces, linear first', () => {
    expect(OUTPUT_COLOR_SPACES.map((o) => o.value)).toEqual(['srgb-linear', 'srgb'])
    expect(OUTPUT_COLOR_SPACES.map((o) => colorSpaceName(o.value))).toEqual(['LinearSRGBColorSpace', 'SRGBColorSpace'])
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

  it('builds the info sections', () => {
    const renderer = {
      info: {memory: {geometries: 12, textures: 34}},
      outputColorSpace: 'srgb-linear', toneMapping: 5, toneMappingExposure: 0.5,
    }
    const sections = infoSections({
      renderer, render: {calls: 5, triangles: 600, points: 7, lines: 8},
      fps: 60, intervalMs: 16.667, cpuMs: 3.2, hdr: true, toneMap: 'agx',
    })
    const value = (title, name) => sections.find((s) => s.title.startsWith(title)).rows.find((r) => r[0] === name)[1]
    expect(value('Frame', 'FPS')).toBe('60.0')
    expect(value('Frame', 'frame time')).toBe('16.67 ms')
    expect(value('Memory', 'textures')).toBe('34')
    expect(value('Render', 'triangles')).toBe('600')
    expect(value('Output', 'outputColorSpace')).toBe('LinearSRGBColorSpace')
    expect(value('Output', 'final tone map')).toBe('AgX')
    expect(value('Output', 'scene pass toneMapping')).toBe('CustomToneMapping')
  })
})
