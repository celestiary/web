import {describe, expect, it} from 'bun:test'
import {Mesh, Object3D, PerspectiveCamera, ShaderLib, SphereGeometry, Vector4} from 'three'
import {
  DISC_MARGIN_PX,
  SMALL_DISC_MAX_PX,
  newSmallDiscUniforms,
  smallDiscParams,
  smallDiscShaderMod,
  updateSmallDisc,
} from './smallDisc.js'


const JUPITER_R = 6.9911e7
// Jupiter from Bay Village, Ohio, on 2026-10-06 (#192).
const JUPITER_D = 8.76e11
const projScale = (fovDeg) => 1 / Math.tan(fovDeg * Math.PI / 360)


describe('smallDiscParams', () => {
  it('draws Jupiter from Earth at the user\'s field as a small disc, 9 px across', () => {
    const p = smallDiscParams({radius: JUPITER_R, distance: JUPITER_D, projScale: projScale(0.91), heightPx: 879})
    expect(p.on).toBe(true)
    expect(p.radiusPx).toBeCloseTo(4.42, 2)
    // Grown by the margin, twice over for off the axis.
    expect(p.inflate).toBeCloseTo(1 + (2 * DISC_MARGIN_PX / p.radiusPx), 9)
  })

  it('leaves a big disc to the mesh', () => {
    const p = smallDiscParams({radius: JUPITER_R, distance: JUPITER_D, projScale: projScale(0.05), heightPx: 879})
    expect(p.radiusPx).toBeGreaterThan(SMALL_DISC_MAX_PX)
    expect(p.on).toBe(false)
    expect(p.inflate).toBe(1)
  })

  it('leaves a near body to the mesh, however small the field makes it', () => {
    const p = smallDiscParams({radius: JUPITER_R, distance: JUPITER_R * 10, projScale: projScale(170), heightPx: 100})
    expect(p.on).toBe(false)
    expect(p.inflate).toBe(1)
  })

  it('grows a sub-pixel disc by a bounded factor', () => {
    const p = smallDiscParams({radius: JUPITER_R, distance: JUPITER_D * 100, projScale: projScale(45), heightPx: 879})
    expect(p.on).toBe(true)
    expect(p.inflate).toBeLessThanOrEqual(1 + (2 * DISC_MARGIN_PX / 0.25))
  })
})


describe('updateSmallDisc', () => {
  it('puts the centre in view space, and the view-to-body turn', () => {
    const camera = new PerspectiveCamera(0.91, 1469 / 879, 100, 1e21)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    const parent = new Object3D()
    parent.position.set(0, 0, -JUPITER_D)
    parent.rotation.y = 0.7
    const surface = new Mesh(new SphereGeometry(1, 8, 4))
    parent.add(surface)
    parent.updateMatrixWorld()
    const renderer = {getCurrentViewport: (v) => v.copy(new Vector4(0, 0, 1469, 879))}
    const u = newSmallDiscUniforms()
    updateSmallDisc(u, renderer, camera, surface, JUPITER_R)
    expect(u.uDiscOn.value).toBe(1)
    expect(u.uDiscCentre.value.z).toBeCloseTo(-JUPITER_D, -2)
    expect(u.uDiscRadius.value).toBe(JUPITER_R)
    // The body's turn, undone: view +x is body (cos, 0, sin) of 0.7 rad.
    const e = u.uViewToBody.value.elements
    expect(e[0]).toBeCloseTo(Math.cos(0.7), 6)
    expect(e[2]).toBeCloseTo(Math.sin(0.7), 6)
  })
})


describe('smallDiscShaderMod', () => {
  it('patches every include it relies on in three\'s physical material', () => {
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    }
    const u = newSmallDiscUniforms()
    smallDiscShaderMod(u)(shader)
    expect(shader.uniforms.uDiscOn).toBe(u.uDiscOn)
    expect(shader.vertexShader).toContain('transformed *= uDiscInflate;')
    expect(shader.vertexShader).toContain('uniform float uDiscInflate;')
    expect(shader.fragmentShader).toContain('uniform mat3 uViewToBody;')
    expect(shader.fragmentShader).toContain('textureGrad(map, discUv')
    expect(shader.fragmentShader).toContain('normal = discNormal;')
    expect(shader.fragmentShader).toContain('gl_FragColor.rgb *= discCov;\n#include <tonemapping_fragment>')
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>')
  })
})
