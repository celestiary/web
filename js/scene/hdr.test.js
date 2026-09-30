import {describe, expect, it} from 'bun:test'
import {
  AdditiveBlending,
  CustomBlending,
  LineBasicMaterial,
  NoBlending,
  NormalBlending,
  OneFactor,
  ShaderChunk,
  ShaderMaterial,
  SrcAlphaFactor,
} from 'three'
import {
  MAX_DISPLAY,
  NEUTRAL_GLSL,
  NEUTRAL_INVERSE_GLSL,
  alphaScaled,
  installExposureOnlyToneMapping,
  neutral,
  neutralInverse,
  sceneReferred,
  sceneReferredUniform,
  wrapMain,
} from './hdr.js'


const close = (a, b, eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)))


describe('neutral', () => {
  it('maps mid greys down by the toe offset, 0.04', () => {
    close(neutral([0.5, 0.5, 0.5]), [0.46, 0.46, 0.46])
  })

  it('crushes dark greys quadratically in the toe', () => {
    // 6.25 x²: 0.05 → 0.015625
    close(neutral([0.05, 0.05, 0.05]), [0.015625, 0.015625, 0.015625])
  })

  it('compresses highlights toward 1', () => {
    const [v] = neutral([3, 3, 3])
    expect(v).toBeGreaterThan(0.97)
    expect(v).toBeLessThan(1)
  })

  it('is continuous at the toe and the shoulder', () => {
    close(neutral([0.08 - 1e-9, 0.08, 0.08]), neutral([0.08, 0.08, 0.08]), 1e-6)
    const at = 0.76 + 0.04
    close(neutral([at - 1e-9, at - 1e-9, at - 1e-9]), neutral([at, at, at]), 1e-6)
  })
})


describe('neutralInverse', () => {
  it('inverts neutral across colours, dark to bright', () => {
    const values = [0, 0.003, 0.02, 0.07, 0.1, 0.3, 0.6, 0.9, 1.2, 2, 5]
    for (const r of values) {
      for (const g of values) {
        for (const b of [0.01, 0.2, 1.5]) {
          const rgb = [r, g, b]
          if (Math.max(...neutral(rgb)) > MAX_DISPLAY) {
            continue
          }
          close(neutralInverse(neutral(rgb)), rgb, 1e-6)
        }
      }
    }
  })

  it('is a right inverse on display values', () => {
    for (const y of [[0.01, 0.02, 0.03], [0.2, 0.5, 0.9], [0.9, 0.3, 0.1], [0.5, 0.5, 0.5]]) {
      close(neutral(neutralInverse(y)), y, 1e-6)
    }
  })

  it('clamps display values of 1, so saturated stays saturated', () => {
    const [v] = neutralInverse([1, 1, 1])
    expect(Number.isFinite(v)).toBe(true)
    expect(neutral([v, v, v])[0]).toBeCloseTo(MAX_DISPLAY, 6)
  })
})


describe('GLSL', () => {
  it('declares the functions the passes call', () => {
    expect(NEUTRAL_GLSL).toContain('vec3 neutralToneMap(vec3 color)')
    expect(NEUTRAL_INVERSE_GLSL).toContain('vec3 neutralInverse(vec3 y)')
  })

  it('wraps main to convert gl_FragColor', () => {
    const src = 'uniform vec3 c;\nvoid main() {\n  gl_FragColor = vec4(c, 1.0);\n}\n'
    const out = wrapMain(src, false)
    expect(out).toContain('void displayReferredMain()')
    expect(out).toContain('displayReferredMain();')
    expect(out).toContain('uniform float uSceneReferred;')
    expect(out.match(/void main\(\)/g).length).toBe(1)
    expect(out).not.toContain('/ a;')
    expect(wrapMain(src, true)).toContain('/ a;')
  })

  it('leaves a shader with no main alone', () => {
    expect(wrapMain('float f() { return 1.0; }', true)).toBe('float f() { return 1.0; }')
  })
})


describe('sceneReferred', () => {
  it('scales by alpha only where the blend does', () => {
    expect(alphaScaled(new ShaderMaterial({blending: AdditiveBlending}))).toBe(true)
    expect(alphaScaled(new ShaderMaterial({blending: NormalBlending, transparent: true}))).toBe(true)
    expect(alphaScaled(new ShaderMaterial({blending: NormalBlending, transparent: false}))).toBe(false)
    expect(alphaScaled(new ShaderMaterial({blending: NoBlending}))).toBe(false)
    expect(alphaScaled(new ShaderMaterial({blending: CustomBlending, blendSrc: SrcAlphaFactor}))).toBe(true)
    expect(alphaScaled(new ShaderMaterial({blending: CustomBlending, blendSrc: OneFactor}))).toBe(false)
    expect(alphaScaled(new ShaderMaterial({blending: AdditiveBlending, premultipliedAlpha: true}))).toBe(false)
  })

  it('wraps the shader at compile time, sharing one switch, after the material\'s own hook', () => {
    const m = new LineBasicMaterial({toneMapped: false})
    const calls = []
    m.onBeforeCompile = (shader) => calls.push(shader.fragmentShader)
    sceneReferred(m)
    const shader = {uniforms: {}, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }'}
    m.onBeforeCompile(shader, null)
    expect(calls.length).toBe(1)
    expect(shader.uniforms.uSceneReferred).toBe(sceneReferredUniform)
    expect(shader.fragmentShader).toContain('displayReferredMain')
    expect(m.customProgramCacheKey()).toContain('sceneReferred:false')
  })
})


describe('installExposureOnlyToneMapping', () => {
  it('makes CustomToneMapping multiply by exposure, once', () => {
    installExposureOnlyToneMapping()
    installExposureOnlyToneMapping()
    const chunk = ShaderChunk.tonemapping_pars_fragment
    expect(chunk).toContain('vec3 CustomToneMapping( vec3 color ) { return toneMappingExposure * color; }')
    expect(chunk.match(/CustomToneMapping\( vec3 color \)/g).length).toBe(1)
  })
})
