import {DataTexture, NoColorSpace, SRGBColorSpace} from 'three'
import {srgbEncode} from './srgb.js'
import TEXTURE_MEANS from './textureMeans.json'


/**
 * Stand-ins for a body's maps while they load (Planet.md, "While the maps
 * load"): one texel each, so a surface is drawn, lit and exposed as it
 * will be, from the first frame it's wanted, rather than hidden until its
 * colour map is in.  The colour map's is its mean over the sphere, in
 * linear light: of the decoded values for a picture, sRGB-encoded (the
 * mean of the decoded values, not the decode of the mean;
 * textureMeans.json, tools/textureMeans.py), so the disc has the light the
 * textured one will have, on average; the normal map's is a
 * flat normal (an unloaded normal map samples black, a normal of
 * (-1, -1, -1)).  Each real map takes its stand-in's place once its image
 * is in: the same slot, so the same shader program.
 */


/** A tangent-space normal map's flat normal, as stored. */
export const FLAT_NORMAL = [0.5, 0.5, 1]


/**
 * @param {string} name A body's
 * @returns {?Array<number>} Its colour map's mean, linear RGB 0-1 (what a
 *   shader samples from it), or null for a body without one
 */
export function textureMean(name) {
  return TEXTURE_MEANS[name] ?? null
}


/**
 * One texel of a value as a shader is to sample it.  In an sRGB map's
 * colour space the texel holds the value encoded, and the GPU decodes it
 * back: so 8 bits keep a dark mean (Earth's 0.09) to within 1%, where a
 * linear byte would round it by 4%.
 *
 * @param {Array<number>} rgb Linear values, 0-1 (a data map's: as stored)
 * @param {string} [colorSpace] The real map's; NoColorSpace (data) by default
 * @returns {DataTexture}
 */
export function solidTexture(rgb, colorSpace = NoColorSpace) {
  const encode = colorSpace === SRGBColorSpace ? srgbEncode : (v) => v
  const [r, g, b] = rgb.map((v) => Math.round(encode(Math.min(Math.max(v, 0), 1)) * 255))
  const t = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
  t.colorSpace = colorSpace
  t.needsUpdate = true
  t.userData.standIn = true
  return t
}


/**
 * Put a stand-in in each of the material's map slots whose image isn't in
 * yet, and return the swap: call it each frame (from the animation loop,
 * not from a path tests drive: AGENTS.md) until it says every real map is
 * in its slot.
 *
 * @param {object} material A three material
 * @param {{[slot: string]: ?Array<number>}} slots The slot's name ('map',
 *   'normalMap') to its stand-in's value, linear (as sampled); null for none
 * @param {{[slot: string]: string}} [colorSpaces] A slot's colour space, when
 *   not the real map's own (a map whose colour space is set later)
 * @returns {function(): boolean} Swaps in the maps that have loaded; true
 *   once all have
 */
export function standInMaps(material, slots, colorSpaces = {}) {
  const pending = []
  for (const [slot, value] of Object.entries(slots)) {
    const real = material[slot]
    if (real && !real.image && value) {
      material[slot] = solidTexture(value, colorSpaces[slot] ?? real.colorSpace)
      pending.push([slot, real])
    }
  }
  return () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const [slot, real] = pending[i]
      if (real.image) {
        const standIn = material[slot]
        material[slot] = real
        standIn?.dispose?.()
        pending.splice(i, 1)
      }
    }
    return pending.length === 0
  }
}
