import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {FLAT_NORMAL, solidTexture, standInMaps, textureMean} from './standInMaps.js'


describe('standInMaps', () => {
  /** @returns {object} A material whose maps are loading, as TextureLoader's are */
  const loading = () => ({map: {image: null}, normalMap: {image: null}, bumpMap: {image: null}})

  it('stands in for each map not yet loaded, and swaps each real one in as it comes', () => {
    const material = loading()
    const realMap = material.map
    const realNormal = material.normalMap
    const swap = standInMaps(material, {map: [0.47, 0.36, 0.36], normalMap: FLAT_NORMAL})
    // Drawn from the start: each slot has an image.
    expect(material.map.image.data).toEqual(new Uint8Array([120, 92, 92, 255]))
    expect(material.normalMap.image.data).toEqual(new Uint8Array([128, 128, 255, 255]))
    // A slot not asked for is left as it is.
    expect(material.bumpMap.image).toBeNull()
    expect(swap()).toBe(false)
    realMap.image = {width: 2048}
    expect(swap()).toBe(false)
    expect(material.map).toBe(realMap)
    expect(material.normalMap.userData.standIn).toBe(true)
    realNormal.image = {width: 1024}
    expect(swap()).toBe(true)
    expect(material.normalMap).toBe(realNormal)
    expect(swap()).toBe(true)
  })

  it('leaves a map already in, and a body without a mean, as they are', () => {
    const material = loading()
    const map = material.map
    map.image = {width: 1}
    expect(standInMaps(material, {map: [0.5, 0.5, 0.5]})()).toBe(true)
    expect(material.map).toBe(map)
    const none = loading()
    const noneMap = none.map
    expect(standInMaps(none, {map: textureMean('no-such-body')})()).toBe(true)
    expect(none.map).toBe(noneMap)
  })

  it('a stand-in is one texel of the stored value, held to 0-1', () => {
    const t = solidTexture([1.2, -0.1, 0.5])
    expect(t.image.width).toBe(1)
    expect(t.image.height).toBe(1)
    expect(t.image.data).toEqual(new Uint8Array([255, 0, 128, 255]))
  })

  it('has a mean for every planet and moon with a colour map', () => {
    const dir = 'public/data'
    let checked = 0
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      let props
      try {
        props = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))
      } catch {
        continue
      }
      if (props?.type !== 'planet' && props?.type !== 'moon') {
        continue
      }
      const tex = props.texture_monthly ?
        `public/textures/${props.texture_monthly.replace('{MM}', '01')}.jpg` :
        `public/textures/${props.texture_dir ?? ''}${props.name}.jpg`
      if (!existsSync(tex)) {
        continue
      }
      const mean = textureMean(props.name)
      expect(mean, props.name).not.toBeNull()
      expect(mean.length).toBe(3)
      for (const v of mean) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(20)
  })
})
