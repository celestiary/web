import {describe, expect, it} from 'bun:test'
import {ShaderChunk} from 'three'
import {
  GROUND_LIGHT_GLSL, GROUND_LIGHT_ROWS, GROUND_LIGHT_W, MU_S_MIN, groundLightFor, groundLightShaderMod, monthsAlbedo,
  newGroundLightUniforms, setGroundLight, updateGroundLight,
} from './groundLight.js'


describe('the ground-light table', () => {
  it('is a body\'s while its tables last, and off without', () => {
    const atmos = {}
    const texture = {}
    const u = newGroundLightUniforms()
    updateGroundLight(u, atmos)
    expect(u.uGroundLightOn.value).toBe(0)
    setGroundLight(atmos, texture)
    expect(groundLightFor(atmos)).toBe(texture)
    updateGroundLight(u, atmos)
    expect([u.tGroundLight.value, u.uGroundLightOn.value]).toEqual([texture, 1])
    setGroundLight(atmos, null)
    updateGroundLight(u, atmos)
    expect([u.tGroundLight.value, u.uGroundLightOn.value]).toEqual([null, 0])
    expect(groundLightFor(undefined)).toBe(null)
  })

  it('looks up texel centres the precompute writes: the Sun from MU_S_MIN to 1, the heights in each half', () => {
    // groundLightUv, mirrored: column i holds mu = MU_S_MIN + (1 − MU_S_MIN)·i / (W − 1).
    const x = (mu) => ((Math.min(Math.max((mu - MU_S_MIN) / (1 - MU_S_MIN), 0), 1) * (GROUND_LIGHT_W - 1)) + 0.5) / GROUND_LIGHT_W
    expect(x(MU_S_MIN) * GROUND_LIGHT_W).toBeCloseTo(0.5, 9)
    expect(x(1) * GROUND_LIGHT_W).toBeCloseTo(GROUND_LIGHT_W - 0.5, 9)
    expect(GROUND_LIGHT_GLSL).toContain(`${(GROUND_LIGHT_W - 1).toFixed(1)} + 0.5`)
    expect(GROUND_LIGHT_GLSL).toContain(`/ ${(2 * GROUND_LIGHT_ROWS).toFixed(1)}`)
  })

  it('takes one of twelve months, or the one value', () => {
    const months = Array.from({length: 12}, (_, i) => [i, i, i])
    expect(monthsAlbedo(months, 11)).toEqual([10, 10, 10])
    expect(monthsAlbedo([0.1, 0.2, 0.3], 5)).toEqual([0.1, 0.2, 0.3])
    expect(monthsAlbedo(0.15, 5)).toBe(0.15)
  })
})


describe('the planet material\'s mod', () => {
  it('dims three\'s point light by the table and adds the sky\'s irradiance as diffuse light', () => {
    const u = newGroundLightUniforms()
    const shader = {uniforms: {}, fragmentShader: '#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>'}
    groundLightShaderMod(u, ShaderChunk.lights_fragment_begin)(shader)
    expect(shader.uniforms.tGroundLight).toBe(u.tGroundLight)
    expect(shader.fragmentShader).toContain('directLight.color *= groundSunT(0.0, gMu);')
    expect(shader.fragmentShader).toContain('irradiance += groundSkyE;')
    expect(shader.fragmentShader).not.toContain('#include <lights_fragment_begin>')
  })

  it('fails loudly if three\'s chunk no longer has the point light\'s call', () => {
    expect(() => groundLightShaderMod(newGroundLightUniforms(), 'void main() {}')).toThrow()
  })
})
