import {DataTexture} from 'three'
import TEXTURE_MEANS from './textureMeans.json'


/**
 * Stand-ins for a body's maps while they load (Planet.md, "While the maps
 * load"): one texel each, so a surface is drawn, lit and exposed as it
 * will be, from the first frame it's wanted, rather than hidden until its
 * colour map is in.  The colour map's is its mean stored value over the
 * sphere (textureMeans.json, tools/textureMeans.py), so the disc has the
 * light the textured one will have, on average; the normal map's is a
 * flat normal (an unloaded normal map samples black, a normal of
 * (-1, -1, -1)).  Each real map takes its stand-in's place once its image
 * is in: the same slot, so the same shader program.
 */


/** A tangent-space normal map's flat normal, as stored. */
export const FLAT_NORMAL = [0.5, 0.5, 1]


/**
 * @param {string} name A body's
 * @returns {?Array<number>} Its colour map's mean stored value, RGB 0-1,
 *   or null for a body without one
 */
export function textureMean(name) {
  return TEXTURE_MEANS[name] ?? null
}


/**
 * @param {Array<number>} rgb Stored values, 0-1
 * @returns {DataTexture} One texel of it
 */
export function solidTexture(rgb) {
  const [r, g, b] = rgb.map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255))
  const t = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
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
 *   'normalMap') to its stand-in's stored value; null for none
 * @returns {function(): boolean} Swaps in the maps that have loaded; true
 *   once all have
 */
export function standInMaps(material, slots) {
  const pending = []
  for (const [slot, value] of Object.entries(slots)) {
    const real = material[slot]
    if (real && !real.image && value) {
      material[slot] = solidTexture(value)
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
