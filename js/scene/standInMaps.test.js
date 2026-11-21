import {existsSync, readFileSync} from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {LinearSRGBColorSpace, NoColorSpace, SRGBColorSpace} from 'three'
import BODY_DIRS from '../bodyDirs.json'
import {descriptorUrl} from '../bodyBundle.js'
import {colorMapSpace} from './material.js'
import {srgbDecode} from './srgb.js'
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

  it('a data map\'s stand-in is one texel of the value as stored, held to 0-1', () => {
    const t = solidTexture([1.2, -0.1, 0.5])
    expect(t.image.width).toBe(1)
    expect(t.image.height).toBe(1)
    expect(t.image.data).toEqual(new Uint8Array([255, 0, 128, 255]))
    expect(t.colorSpace).toBe(NoColorSpace)
  })

  it('an sRGB map\'s stand-in holds its linear mean encoded, which the GPU decodes back', () => {
    // Earth's mean, dark: encoded, the byte keeps it to within 1%.
    const mean = [0.0976, 0.0934, 0.0878]
    const t = solidTexture(mean, SRGBColorSpace)
    expect(t.colorSpace).toBe(SRGBColorSpace)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs((srgbDecode(t.image.data[i] / 255) / mean[i]) - 1)).toBeLessThan(0.01)
    }
    // The stand-in takes the real map's colour space, or the one asked for.
    const material = {map: {image: null, colorSpace: SRGBColorSpace}}
    standInMaps(material, {map: mean})
    expect(material.map.colorSpace).toBe(SRGBColorSpace)
    const moon = {map: {image: null, colorSpace: NoColorSpace}}
    standInMaps(moon, {map: [0.3175, 0.3175, 0.3175]}, {map: LinearSRGBColorSpace})
    expect(moon.map.colorSpace).toBe(LinearSRGBColorSpace)
    expect(moon.map.image.data).toEqual(new Uint8Array([81, 81, 81, 255]))
  })

  it('reads every colour map as a picture, sRGB, but the Moon\'s linear stretch of I/F', () => {
    const moon = JSON.parse(readFileSync(`public/${descriptorUrl('moon')}`, 'utf8'))
    expect(colorMapSpace(moon)).toBe(LinearSRGBColorSpace)
    for (const name of ['mercury', 'earth', 'mars', 'jupiter', 'titan']) {
      const props = JSON.parse(readFileSync(`public/${descriptorUrl(name)}`, 'utf8'))
      expect(colorMapSpace(props), name).toBe(SRGBColorSpace)
    }
  })

  it('takes the means in linear light: a picture\'s decoded first, darker than its stored mean', () => {
    // tools/textureMeans.py: the mean of the decoded values.  Earth's stored
    // mean luma was 0.163 and Mars's 0.386; decoded they are 0.094 and
    // 0.135.  The Moon's map is linear and keeps its stored mean, 0.3175.
    const luma = ([r, g, b]) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
    expect(luma(textureMean('earth'))).toBeCloseTo(0.094, 3)
    expect(luma(textureMean('mars'))).toBeCloseTo(0.135, 3)
    expect(textureMean('moon')).toEqual([0.3175, 0.3175, 0.3175])
  })

  it('has a mean for every planet and moon with a colour map', () => {
    let checked = 0
    for (const name of Object.keys(BODY_DIRS)) {
      const props = JSON.parse(readFileSync(`public/${descriptorUrl(name)}`, 'utf8'))
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


describe('the planets\' albedo', () => {
  it('puts each planet\'s decoded map, by its texture_gain, at its measured geometric albedo', () => {
    // Planet.md, "Albedo": a Lambert sphere's geometric albedo is 2/3 of
    // its albedo; the measured ones are Mallama & Hilton's (2018) V(1, 0)
    // over each planet's radius, as Planet.md's Horizons table has them.
    const measured = {mercury: 0.13, venus: 0.70, mars: 0.17, jupiter: 0.53, saturn: 0.51, uranus: 0.49, neptune: 0.47}
    const luma = ([r, g, b]) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
    for (const [name, p] of Object.entries(measured)) {
      const props = JSON.parse(readFileSync(`public/${descriptorUrl(name)}`, 'utf8'))
      const geometric = 2 / 3 * luma(textureMean(name)) * props.texture_gain
      expect(geometric / p, name).toBeCloseTo(1, 2)
    }
  })
})
