import {SRGBColorSpace} from 'three'
import MonthMaps, {LIGHTER_MIN, monthMapShaderMod} from './monthMaps.js'


const settle = () => new Promise((resolve) => setTimeout(resolve, 0))


const setup = (deferred = () => false) => {
  const asked = []
  const pending = new Map()
  const load = (month) => {
    asked.push(month)
    return new Promise((resolve, reject) => pending.set(month, {resolve, reject}))
  }
  const maps = new MonthMaps(load, SRGBColorSpace, deferred)
  const arrive = async (month) => {
    pending.get(month).resolve({month})
    await settle()
  }
  return {maps, asked, arrive}
}


describe('MonthMaps', () => {
  it('fetches the heavier month at once, the lighter once the scene is shown', async () => {
    let held = true
    const {maps, asked, arrive} = setup(() => held)
    const blend = {a: 7, b: 8, w: 0.3}
    maps.step(blend, 0)
    expect(asked).toEqual([7])
    await arrive(7)
    maps.step(blend, 0.016)
    expect(maps.map.image).toEqual({month: 7})
    expect(maps.uniforms.uMonthMix.value).toBe(0)
    held = false
    maps.step(blend, 0.016)
    expect(asked).toEqual([7, 8])
    expect(maps.map.colorSpace).toBe(SRGBColorSpace)
    expect(maps.uniforms.uMonthMap.value.colorSpace).toBe(SRGBColorSpace)
  })

  it('doesn\'t fetch a lighter month too light to show', () => {
    const {maps, asked} = setup()
    maps.step({a: 7, b: 8, w: LIGHTER_MIN / 2}, 0)
    expect(asked).toEqual([7])
  })

  it('fades the second month in from 0 when it arrives, to its share', async () => {
    const {maps, arrive} = setup()
    const blend = {a: 7, b: 8, w: 0.4}
    maps.step(blend, 0)
    await arrive(7)
    maps.step(blend, 0.016)
    expect(maps.uniforms.uMonthMix.value).toBe(0)
    await arrive(8)
    const mixes = []
    for (let i = 0; i < 60; i++) {
      maps.step(blend, 0.016)
      mixes.push(maps.uniforms.uMonthMix.value)
    }
    expect(mixes[0]).toBeGreaterThan(0)
    expect(mixes[0]).toBeLessThan(0.06)
    for (let i = 1; i < mixes.length; i++) {
      expect(mixes[i]).toBeGreaterThanOrEqual(mixes[i - 1])
    }
    expect(mixes.at(-1)).toBeCloseTo(0.4, 9)
  })

  it('passes a month on: the slot no longer shown takes the next, loading each month once', async () => {
    const {maps, asked, arrive} = setup()
    // From July's middle on through August's.
    let blend = {a: 7, b: 8, w: 0}
    maps.step(blend, 0)
    await arrive(7)
    for (let w = 0.05; w < 1; w += 0.05) {
      blend = {a: 7, b: 8, w}
      maps.step(blend, 0.1)
      if (asked.includes(8) && !maps.slots[1].ready) {
        await arrive(8)
      }
    }
    expect(asked).toEqual([7, 8])
    for (let w = 0; w < 0.6; w += 0.05) {
      maps.step({a: 8, b: 9, w}, 0.1)
      if (asked.includes(9) && !maps.slots.some((s) => s.month === 9 && s.ready)) {
        await arrive(9)
      }
    }
    expect(asked).toEqual([7, 8, 9])
    // Slot 0 held July and now holds September; the mix is September's share in slot 0.
    expect(maps.slots[0].month).toBe(9)
    expect(maps.uniforms.uMonthMix.value).toBeCloseTo(1 - 0.55, 1)
  })

  it('mixes the second texture into every sample of the map, three\'s and the small disc\'s', () => {
    const {maps} = setup()
    const shader = {uniforms: {}, fragmentShader: [
      '#include <common>', '#include <map_pars_fragment>', 'void main() {',
      'vec4 a = texture2D( map, vMapUv );', 'vec4 b = textureGrad(map, discUv, dx, dy);',
      'vec4 n = texture2D(uNightMap, vMapUv);', '}'].join('\n')}
    monthMapShaderMod(maps.uniforms)(shader)
    expect(shader.uniforms.uMonthMix).toBe(maps.uniforms.uMonthMix)
    expect(shader.fragmentShader).toContain('vec4 a = monthMap2D( vMapUv );')
    expect(shader.fragmentShader).toContain('vec4 b = monthMapGrad( discUv, dx, dy);')
    expect(shader.fragmentShader).toContain('texture2D(uNightMap, vMapUv)')
    expect(shader.fragmentShader).toContain('mix(texture2D(map, uv), texture2D(uMonthMap, uv), uMonthMix)')
  })
})
