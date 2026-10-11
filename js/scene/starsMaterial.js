import {AdditiveBlending, ShaderMaterial, Vector3} from 'three'
import {absoluteUniforms} from './hdr.js'


/**
 * The star points' material: one shader (shaders/stars.vert and .frag) for
 * the bundled catalogue and every point population drawn as stars
 * (js/scene/Gaia.md), so a star's light, size and colour follow one law
 * (HDR.md, "Physical stars").  Physical brightness, in exposure units: the
 * exposure, viewport, field of view and the user's star gain are the
 * shared absoluteUniforms, which ThreeUi sets each frame.  The sprite is an
 * analytic Gaussian (stars.frag), not a texture.
 *
 * The shader paths are the material's vertexShader and fragmentShader
 * until Loader.loadShaders replaces them with the sources.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.motion] Move each point by its `velocity`
 *   attribute (km/s) over `uMotionYears` (the POINT_MOTION define)
 * @returns {ShaderMaterial}
 */
export function newStarsMaterial({motion = false} = {}) {
  const uniforms = {
    ...absoluteUniforms,
    // A star's quad: as large as the visible star (stars.vert), from
    // the eye's patch in pixels (1 px here, 4 on a 1080 px screen) to
    // 96 px for the Sun from the outer planets.
    MIN_STAR_SIZE_PX: {value: 1},
    MAX_STAR_SIZE_PX: {value: 96},
    // RTE uniforms: camera position in star catalog coords, split high/low
    uCamPosWorldHigh: {value: new Vector3()},
    uCamPosWorldLow: {value: new Vector3()},
  }
  const defines = {}
  if (motion) {
    uniforms.uMotionYears = {value: 0}
    defines.POINT_MOTION = ''
  }
  return new ShaderMaterial({
    uniforms,
    defines,
    vertexShader: 'shaders/stars.vert',
    fragmentShader: 'shaders/stars.frag',
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
}
