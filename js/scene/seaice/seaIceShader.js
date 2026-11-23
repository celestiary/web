import {DataTexture, RedFormat, UnsignedByteType, Vector3} from 'three'
import {sceneColors} from '../../theme.js'
import {srgbDecode} from '../srgb.js'


/**
 * The day's sea ice on celestiary's Earth (design/Cryosphere.md, phase 1;
 * Planet.md, "Sea ice"): a step in the surface material's shader, after its
 * colour, roughness and metalness are read and before it's lit.  Over the
 * ocean (the hydrosphere map, white for water), the colour goes to the
 * ice's by the concentration, and the ice takes the water's shine away: the
 * land's roughness (the material's own, where the hydrosphere map makes
 * water glossier) and not metallic, so no glint off the pack and it's lit
 * as the Blue Marble's snow is.  In linear light, as
 * concentration is a share of the area; Cesium's globe mixes its layer the
 * same way (its imagery decoded by sRGB's curve before it's blended:
 * CESIUM.md, "Colour").
 *
 * The ice's colour is multiplied by the material's colour (`diffuse`, the
 * body's texture_gain), as the map's texels are, so a white of the ice and a
 * white of the Blue Marble are lit alike.
 */


/** The ice's colour as stored, sRGB bytes (theme.js). */
export const SEA_ICE_RGB = Object.freeze([
  (sceneColors.seaIce >> 16) & 255, (sceneColors.seaIce >> 8) & 255, sceneColors.seaIce & 255])


/**
 * The map's loader is a chunk of its own, after the first load (SeaIceMap.js;
 * Planet.newSeaIceNode), so the shader is compiled against a stand-in, no
 * ice, until its texture is set (setSeaIceMap).
 *
 * @returns {object} The shader's uniforms; uSeaIceShare is set each frame
 *   (updateSeaIce)
 */
export function newSeaIceUniforms() {
  const none = new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)
  none.needsUpdate = true
  return {
    uSeaIceMap: {value: none},
    uSeaIceColor: {value: new Vector3(...SEA_ICE_RGB.map((v) => srgbDecode(v / 255)))},
    uSeaIceShare: {value: 0},
  }
}


/**
 * @param {object} uniforms newSeaIceUniforms'
 * @param {object} map SeaIceMap: its texture in place of the stand-in
 */
export function setSeaIceMap(uniforms, map) {
  uniforms.uSeaIceMap.value = map.texture
}


/**
 * @param {object} uniforms newSeaIceUniforms'
 * @param {number} share 0 to 1: the map's fade in, 0 with the sea ice off
 */
export function updateSeaIce(uniforms, share) {
  uniforms.uSeaIceShare.value = share
}


/**
 * The step.  Before `normal_fragment_begin`, which no other mod replaces
 * (a chunk two mods both replace loses the first's code: AGENTS.md).  The
 * map's row 0 is north and the Blue Marble's v is 1 there, hence 1 − v.
 *
 * @param {object} uniforms newSeaIceUniforms'
 * @returns {function(object): void} An onBeforeCompile mod
 */
export function seaIceShaderMod(uniforms) {
  return (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uSeaIceMap;
uniform vec3 uSeaIceColor;
uniform float uSeaIceShare;`)
        .replace('#include <normal_fragment_begin>', `#ifdef USE_MAP
{
  float seaIce = texture2D(uSeaIceMap, vec2(vMapUv.x, 1.0 - vMapUv.y)).r * uSeaIceShare;
  #ifdef USE_ROUGHNESSMAP
  seaIce *= texture2D(roughnessMap, vRoughnessMapUv).g;
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * uSeaIceColor, seaIce);
  roughnessFactor = mix(roughnessFactor, roughness, seaIce);
  metalnessFactor *= 1.0 - seaIce;
}
#endif
#include <normal_fragment_begin>`)
  }
}
