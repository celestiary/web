import {describe, expect, it} from 'bun:test'
import {
  AdditiveBlending,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  Mesh,
  NormalBlending,
  ShaderMaterial,
} from 'three'
import {FADE_MS, Fade, FadeDriver, ease, fadeMaterial, fadeObject, wrapFade} from './fade.js'
import {sceneReferred} from './hdr.js'


/**
 * @param {object} [opts] As Fade's
 * @returns {{fade: Fade, driver: FadeDriver, shows: Array<boolean>}}
 */
function driven(opts = {}) {
  const shows = []
  const driver = new FadeDriver()
  const fade = driver.add(new Fade({onShow: (s) => shows.push(s), ...opts}))
  return {fade, driver, shows}
}


describe('ease', () => {
  it('starts and ends at rest, and is symmetric', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.5)).toBe(0.5)
    expect(ease(0.25) + ease(0.75)).toBeCloseTo(1, 12)
    // Flat at the ends: a small step moves it much less than linearly.
    expect(ease(0.01)).toBeLessThan(0.001)
    expect(1 - ease(0.99)).toBeLessThan(0.001)
  })

  it('holds its input to 0..1, and only rises', () => {
    expect(ease(-1)).toBe(0)
    expect(ease(2)).toBe(1)
    let last = -1
    for (let t = 0; t <= 1; t += 0.05) {
      expect(ease(t)).toBeGreaterThanOrEqual(last)
      last = ease(t)
    }
  })
})


describe('Fade', () => {
  it('starts at its end state: on is shown at 1, off hidden at 0, still', () => {
    expect(new Fade({on: true}).opacity).toBe(1)
    expect(new Fade({on: true}).shown).toBe(true)
    expect(new Fade({on: false}).opacity).toBe(0)
    expect(new Fade({on: false}).shown).toBe(false)
    expect(new Fade().moving).toBe(false)
  })

  it('fades out over FADE_MS, eased, shown until it ends at 0', () => {
    const {fade, driver, shows} = driven({on: true})
    fade.set(false)
    expect(fade.shown).toBe(true)
    driver.tick(0)
    driver.tick(FADE_MS / 4)
    expect(fade.opacity).toBeCloseTo(ease(0.75), 12)
    expect(fade.shown).toBe(true)
    expect(shows).toEqual([])
    driver.tick(FADE_MS)
    expect(fade.opacity).toBe(0)
    expect(fade.shown).toBe(false)
    expect(shows).toEqual([false])
    expect(driver.moving).toBe(false)
  })

  it('fades in: shown from its start, at opacity 0, to 1', () => {
    const {fade, driver, shows} = driven({on: false})
    fade.set(true)
    // Drawn from the first frame of the fade, at nothing.
    expect(shows).toEqual([true])
    expect(fade.opacity).toBe(0)
    driver.tick(0)
    driver.tick(FADE_MS / 2)
    expect(fade.opacity).toBe(0.5)
    driver.tick(FADE_MS * 2)
    expect(fade.opacity).toBe(1)
    expect(driver.moving).toBe(false)
    expect(shows).toEqual([true])
  })

  it('turns back mid-fade from where it is, without hiding', () => {
    const {fade, driver, shows} = driven({on: true})
    fade.set(false)
    driver.tick(0)
    driver.tick(FADE_MS / 2)
    fade.set(true)
    driver.tick((FADE_MS / 2) + (FADE_MS / 4))
    expect(fade.opacity).toBeCloseTo(ease(0.75), 12)
    driver.tick(FADE_MS * 2)
    expect(fade.opacity).toBe(1)
    expect(shows).toEqual([])
  })

  it('a delayed fade in isn\'t shown until its delay is over', () => {
    const {fade, driver, shows} = driven({on: false})
    fade.set(true, {delay: 300})
    expect(fade.shown).toBe(false)
    driver.tick(0)
    driver.tick(200)
    expect(fade.shown).toBe(false)
    driver.tick(300)
    expect(shows).toEqual([true])
    expect(fade.opacity).toBe(0)
    driver.tick(300 + FADE_MS)
    expect(fade.opacity).toBe(1)
  })

  it('setting off while it waits cancels it: never shown', () => {
    const {fade, driver, shows} = driven({on: false})
    fade.set(true, {delay: 300})
    driver.tick(0)
    fade.set(false)
    driver.tick(1000)
    driver.tick(2000)
    expect(shows).toEqual([])
    expect(fade.shown).toBe(false)
    expect(driver.moving).toBe(false)
  })

  it('setting the state it\'s at or heading for changes nothing', () => {
    const {fade, driver, shows} = driven({on: true})
    fade.set(true)
    expect(driver.moving).toBe(false)
    expect(shows).toEqual([])
  })

  it('instant jumps there, and finish ends every fade', () => {
    const {fade, driver, shows} = driven({on: true})
    fade.set(false, {instant: true})
    expect(fade.opacity).toBe(0)
    expect(shows).toEqual([false])
    fade.set(true)
    driver.finish()
    expect(fade.opacity).toBe(1)
    expect(driver.moving).toBe(false)
  })

  it('the driver does nothing with nothing moving, and starts its clock afresh after', () => {
    const {fade, driver} = driven({on: true})
    expect(driver.tick(1000)).toBe(false)
    fade.set(false)
    // The first tick after a quiet spell is the start, not 1000 ms of fade.
    driver.tick(5000)
    expect(fade.opacity).toBe(1)
    driver.tick(5000 + (FADE_MS / 2))
    expect(fade.opacity).toBe(0.5)
  })

  it('gives the materials of its nodes, built before or during the fade, its opacity', () => {
    const group = new Group()
    const a = new Mesh(new BufferGeometry(), new ShaderMaterial({transparent: true}))
    group.add(a)
    const {fade, driver} = driven({on: true, nodes: () => [group]})
    fade.set(false)
    expect(a.material.userData.fade).toBe(fade.uniform)
    const b = new Mesh(new BufferGeometry(), new ShaderMaterial({transparent: true}))
    group.add(b)
    driver.tick(0)
    expect(b.material.userData.fade).toBe(fade.uniform)
  })
})


describe('fadeMaterial', () => {
  /**
   * @param {object} material
   * @returns {string} Its fragment shader as compiled
   */
  function compiled(material) {
    const shader = {
      uniforms: material.uniforms ?? {},
      vertexShader: 'void main() {}',
      fragmentShader: material.fragmentShader ?? 'void main() { gl_FragColor = vec4(1.0); }',
    }
    material.onBeforeCompile(shader, null)
    return shader
  }

  it('scales alpha under an alpha blend, and the uniform is the fade\'s', () => {
    const uniform = {value: 0.5}
    const m = new ShaderMaterial({transparent: true, blending: NormalBlending,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }'})
    expect(fadeMaterial(m, uniform)).toBe(true)
    const shader = compiled(m)
    expect(shader.uniforms.uFade).toBe(uniform)
    expect(shader.fragmentShader).toContain('void fadedMain()')
    expect(shader.fragmentShader).toContain('gl_FragColor.a *= uFade;')
    expect(m.customProgramCacheKey()).toMatch(/^fade:true:/)
  })

  it('additive blending scales by alpha too; a one-one blend scales the colour', () => {
    const add = new ShaderMaterial({transparent: true, blending: AdditiveBlending})
    fadeMaterial(add, {value: 1})
    expect(compiled(add).fragmentShader).toContain('gl_FragColor.a *= uFade;')
    const pre = new ShaderMaterial({transparent: true, premultipliedAlpha: true})
    fadeMaterial(pre, {value: 1})
    expect(compiled(pre).fragmentShader).toContain('gl_FragColor *= uFade;')
  })

  it('composes with sceneReferred: the conversion runs first, the fade after it', () => {
    const m = sceneReferred(new ShaderMaterial({transparent: true, toneMapped: false,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }'}))
    fadeMaterial(m, {value: 1})
    const fs = compiled(m).fragmentShader
    expect(fs.indexOf('displayReferredMain();')).toBeGreaterThan(-1)
    // Inside fadedMain (the sceneReferred main, renamed), then the fade.
    expect(fs.indexOf('void fadedMain()')).toBeLessThan(fs.indexOf('gl_FragColor.a *= uFade;'))
    expect(m.customProgramCacheKey()).toMatch(/^fade:true:sceneReferred:/)
  })

  it('wraps a material once, with its first fade', () => {
    const m = new LineBasicMaterial({transparent: true})
    const first = {value: 1}
    expect(fadeMaterial(m, first)).toBe(true)
    expect(fadeMaterial(m, {value: 0})).toBe(false)
    expect(m.userData.fade).toBe(first)
  })

  it('fadeObject wraps every material in a subtree, arrays too, and counts the new ones', () => {
    const root = new Group()
    root.add(new Mesh(new BufferGeometry(), new ShaderMaterial()))
    root.add(new Mesh(new BufferGeometry(), [new ShaderMaterial(), new ShaderMaterial()]))
    root.add(new Group())
    expect(fadeObject(root, {value: 1})).toBe(3)
    expect(fadeObject(root, {value: 1})).toBe(0)
  })

  it('leaves a shader with no main as it is', () => {
    expect(wrapFade('float f() { return 1.0; }', true)).toBe('float f() { return 1.0; }')
  })
})
