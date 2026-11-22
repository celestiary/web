import {Texture} from 'three'
import {monthWeight, stepMonthShares} from './monthly.js'


/**
 * A colour map of one month's picture blended with the next's by the date
 * (monthly.js monthBlendOfJulianDay; Planet.md, "The months blended by
 * day"): two textures, the material's `map` and a second sampled beside it,
 * mixed in linear light (both decoded from sRGB as they are sampled).  Each
 * holds one month; when the blend moves on to a month neither holds, the
 * one no longer shown takes it, so a month is loaded and uploaded once as a
 * timelapse passes it.  A month's share grows from 0 once its picture is
 * in (stepMonthShares), so nothing jumps when it arrives.
 *
 * The heavier month is wanted at once; the lighter only once the scene is
 * on screen (`deferred`), so the first load fetches one month's picture, as
 * it did, and only past LIGHTER_MIN of it, where a share under that
 * wouldn't show.
 */


/** The lighter month's share under which its picture isn't fetched. */
export const LIGHTER_MIN = 0.02


export default class MonthMaps {
  /**
   * @param {function(number): Promise<object>} load A month's picture (an
   *   image), by month 1-12
   * @param {string} colorSpace The pictures' (material.js colorMapSpace)
   * @param {function(): boolean} [deferred] Whether the lighter month must
   *   wait (true until the scene is on screen)
   */
  constructor(load, colorSpace, deferred = () => false) {
    this.load = load
    this.deferred = deferred
    this.slots = [0, 1].map(() => {
      const texture = new Texture()
      texture.colorSpace = colorSpace
      return {texture, month: 0, ready: false, shown: 0, token: 0}
    })
    // The second texture and its share, for the shader (monthMapShaderMod).
    this.uniforms = {uMonthMap: {value: this.slots[1].texture}, uMonthMix: {value: 0}}
    this.failed = new Set()
  }


  /** @returns {Texture} The material's map: the first slot's texture */
  get map() {
    return this.slots[0].texture
  }


  /**
   * Fetch what the blend wants, and set the mix for it.
   *
   * @param {{a: number, b: number, w: number}} blend
   * @param {number} dtS Seconds since the last step
   */
  step(blend, dtS) {
    const heavier = blend.w > 0.5 ? blend.b : blend.a
    const lighter = heavier === blend.a ? blend.b : blend.a
    const wanted = [heavier]
    if (lighter !== heavier && monthWeight(blend, lighter) > LIGHTER_MIN && !this.deferred()) {
      wanted.push(lighter)
    }
    for (const month of wanted) {
      if (this.failed.has(month) || this.slots.some((s) => s.month === month)) {
        continue
      }
      // A slot no longer shown, and not holding a month of the blend.
      const free = this.slots.find((s) => s.shown === 0 && monthWeight(blend, s.month) === 0)
      if (free) {
        this._fill(free, month)
      }
    }
    const shares = stepMonthShares(this.slots, blend, dtS)
    if (shares[0] + shares[1] > 0) {
      this.uniforms.uMonthMix.value = shares[1]
    }
  }


  /**
   * @param {object} slot
   * @param {number} month
   */
  _fill(slot, month) {
    const token = ++slot.token
    slot.month = month
    slot.ready = false
    this.load(month).then((image) => {
      if (slot.token === token) {
        slot.texture.image = image
        slot.texture.needsUpdate = true
        slot.ready = true
      }
    }).catch((err) => {
      this.failed.add(month)
      console.warn(`couldn't load the month's colour map (${month})`, err)
    })
  }
}


/**
 * The surface shader's map samples, the two months mixed: each sample of
 * `map` (three's map_fragment's, and the small disc's by gradients) becomes
 * the mix of `map` and the second texture at the same place.  Run after the
 * mods that write map samples of their own (smallDisc.js).
 *
 * @param {{uMonthMap: object, uMonthMix: object}} uniforms MonthMaps'
 * @returns {function(object): void} An onBeforeCompile mod
 */
export function monthMapShaderMod(uniforms) {
  return (shader) => {
    shader.uniforms.uMonthMap = uniforms.uMonthMap
    shader.uniforms.uMonthMix = uniforms.uMonthMix
    shader.fragmentShader = shader.fragmentShader
        .replace(/texture2D\(\s*map\s*,/g, 'monthMap2D(')
        .replace(/textureGrad\(\s*map\s*,/g, 'monthMapGrad(')
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
#ifdef USE_MAP
uniform sampler2D uMonthMap;
uniform float uMonthMix;
vec4 monthMap2D(vec2 uv) {
  return mix(texture2D(map, uv), texture2D(uMonthMap, uv), uMonthMix);
}
vec4 monthMapGrad(vec2 uv, vec2 dx, vec2 dy) {
  return mix(textureGrad(map, uv, dx, dy), textureGrad(uMonthMap, uv, dx, dy), uMonthMix);
}
#endif`)
  }
}
