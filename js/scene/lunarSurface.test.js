import {describe, expect, it} from 'bun:test'
import {Mesh, Object3D, PerspectiveCamera, ShaderLib, Vector3} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {highlightReflectance, irradianceAt} from './exposure.js'
import {lunarHighlight} from './lunarPhotometry.js'
import {
  LAMBERT_DIRECT_GLSL,
  lunarSurfaceShaderMod,
  newLunarSurfaceUniforms,
  updateLunarSurface,
} from './lunarSurface.js'


describe('the Moon mesh\'s shader', () => {
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  }
  const uniforms = newLunarSurfaceUniforms()
  lunarSurfaceShaderMod(uniforms)(shader)

  it('replaces Lambert\'s direct diffuse with the photometric function, and adds earthshine', () => {
    const src = shader.fragmentShader
    expect(src).not.toContain('#include <lights_physical_pars_fragment>')
    expect(src).not.toContain(LAMBERT_DIRECT_GLSL)
    expect(src).toContain('float lunarReflectance(')
    expect(src).toContain('directLight.color * BRDF_Lambert( material.diffuseColor ) *')
    expect(src).toContain('reflectedLight.directDiffuse += uEarthshine * BRDF_Lambert')
    // After the lights, where geometryNormal and geometryViewDir are in scope.
    expect(src.indexOf('uEarthshine * BRDF_Lambert')).toBeGreaterThan(src.indexOf('#include <lights_fragment_end>'))
    expect(shader.uniforms.uEarthshine).toBe(uniforms.uEarthshine)
    expect(shader.uniforms.uEarthDir).toBe(uniforms.uEarthDir)
  })
})


describe('the Moon mesh\'s earthshine', () => {
  // The Sun at the origin, Earth 1 AU out along +x, the Moon 384,400 km
  // from it, 52.5° from the Sun's direction (#192's crescent: Earth seen
  // from the Moon at 52.5°).
  const sun = new Vector3(0, 0, 0)
  const earth = new Vector3(ASTRO_UNIT_METER, 0, 0)
  const a = 52.5 * Math.PI / 180
  const d = 3.844e8
  const moonPos = earth.clone().add(new Vector3(-Math.cos(a), Math.sin(a), 0).multiplyScalar(d))
  const surface = new Mesh()
  const holder = new Object3D()
  holder.position.copy(moonPos)
  holder.add(surface)
  holder.updateMatrixWorld(true)
  const camera = new PerspectiveCamera()
  camera.updateMatrixWorld(true)

  it('is Earth\'s geometric albedo × phase × (R⊕/d)² of the Sun\'s irradiance there, toward Earth', () => {
    const u = newLunarSurfaceUniforms()
    updateLunarSurface(u, surface, camera, sun, earth)
    const fraction = u.uEarthshine.value / irradianceAt(moonPos.length())
    expect(fraction).toBeCloseTo(6.9e-5, 6)
    const toEarth = earth.clone().sub(moonPos).normalize()
    expect(u.uEarthDir.value.dot(toEarth)).toBeCloseTo(1, 9)
  })

  it('is off without Earth', () => {
    const u = newLunarSurfaceUniforms()
    u.uEarthshine.value = 1
    updateLunarSurface(u, surface, camera, sun, null)
    expect(u.uEarthshine.value).toBe(0)
  })
})


describe('the meter\'s highlight for the Moon', () => {
  it('is Lambert\'s estimate for every other body, and the Moon\'s own at its phase for the Moon', () => {
    expect(highlightReflectance(0.3)).toBeCloseTo(0.75, 9)
    expect(highlightReflectance(0.12)).toBeCloseTo(0.3, 9)
    expect(highlightReflectance(0.12, 0)).toBeCloseTo(0.3, 9)
    const crescent = lunarHighlight(127.5 * Math.PI / 180)
    expect(highlightReflectance(0.12, crescent)).toBeCloseTo(crescent, 12)
    expect(highlightReflectance(0.12, 2)).toBe(1)
  })
})
