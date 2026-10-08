import {ShaderChunk, Vector3} from 'three'
import {LUNAR_PHOTOMETRY_GLSL, earthshineFraction} from './lunarPhotometry.js'
import {irradianceAt} from './exposure.js'


/**
 * Celestiary's Moon mesh lit by the lunar photometric function, sunlight
 * and earthshine alike (lunarPhotometry.js; Planet.md, "Lighting and
 * exposure").  A step of Planet.nearShape's onBeforeCompile chain, on its
 * MeshPhysicalMaterial, for a body with `photometry: 'lunar'`:
 *
 * - **Sunlight**: three's direct diffuse, `dotNL × E × diffuse / π`, becomes
 *   `E × diffuse / π × lunarReflectance(μ0, μ, cos α)`, with μ0, μ from the
 *   normal-mapped normal (#199's relief) and α the fragment's own phase
 *   angle.  The colour map × texture_gain is the normal albedo.  The
 *   material's specular is off (Planet.js): the photometric function is the
 *   regolith's whole reflectance, and Cesium's Moon has no other.
 * - **Earthshine**: the same function toward Earth, at the irradiance Earth
 *   reflects onto the Moon (earthshineFraction × the Sun's irradiance at the
 *   Moon, in three's units), as Cesium's Moon has it (CesiumLayers
 *   _setEarthshine).  Seen from Earth that's at a phase of ~1°, where the
 *   function is flat to the limb: the regolith's opposition brightening
 *   Lambert left out.
 */


/**
 * @returns {object} The uniforms lunarSurfaceShaderMod and updateLunarSurface share
 */
export function newLunarSurfaceUniforms() {
  return {
    // Toward Earth, view space.
    uEarthDir: {value: new Vector3(0, 0, 1)},
    // Earth's light on the Moon, three's units (as the Sun's PointLight's
    // irradiance).
    uEarthshine: {value: 0},
  }
}


/** The line of three's RE_Direct_Physical that lights a surface by Lambert's law. */
export const LAMBERT_DIRECT_GLSL = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );'

const LUNAR_DIRECT_GLSL = `reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseColor ) *
    lunarReflectance( dot( geometryNormal, directLight.direction ), dot( geometryNormal, geometryViewDir ),
        dot( directLight.direction, geometryViewDir ) );`


/**
 * @param {object} uniforms From newLunarSurfaceUniforms
 * @returns {function(object): void} An onBeforeCompile step
 */
export function lunarSurfaceShaderMod(uniforms) {
  return (shader) => {
    Object.assign(shader.uniforms, uniforms)
    const pars = ShaderChunk.lights_physical_pars_fragment
    if (!pars.includes(LAMBERT_DIRECT_GLSL)) {
      throw new Error('lunarSurface: three\'s RE_Direct_Physical has changed; its Lambert line is gone')
    }
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uEarthDir;
uniform float uEarthshine;
${LUNAR_PHOTOMETRY_GLSL}`)
        .replace('#include <lights_physical_pars_fragment>', pars.replace(LAMBERT_DIRECT_GLSL, LUNAR_DIRECT_GLSL))
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.directDiffuse += uEarthshine * BRDF_Lambert( material.diffuseColor ) *
    lunarReflectance( dot( geometryNormal, uEarthDir ), dot( geometryNormal, geometryViewDir ),
        dot( uEarthDir, geometryViewDir ) );`)
  }
}


const _moon = new Vector3()
const _toSun = new Vector3()
const _toMoon = new Vector3()


/**
 * Per frame (the surface's onBeforeRender): Earth's direction and its light.
 *
 * @param {object} uniforms From newLunarSurfaceUniforms
 * @param {object} surface The Moon's surface mesh
 * @param {object} camera
 * @param {Vector3} sunWorld The Sun's world position
 * @param {Vector3|null} earthWorld Earth's world position; null for no earthshine
 */
export function updateLunarSurface(uniforms, surface, camera, sunWorld, earthWorld) {
  if (!earthWorld) {
    uniforms.uEarthshine.value = 0
    return
  }
  surface.getWorldPosition(_moon)
  _toSun.copy(sunWorld).sub(earthWorld)
  _toMoon.copy(_moon).sub(earthWorld)
  const distance = _toMoon.length()
  if (!(distance > 0)) {
    uniforms.uEarthshine.value = 0
    return
  }
  const fraction = earthshineFraction(_toSun.angleTo(_toMoon), distance)
  uniforms.uEarthshine.value = fraction * irradianceAt(Math.max(_moon.distanceTo(sunWorld), 1))
  uniforms.uEarthDir.value.copy(_toMoon).negate().normalize().transformDirection(camera.matrixWorldInverse)
}
