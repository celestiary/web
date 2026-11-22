/**
 * The final tone map's operators, for diagnosis (the performance panel's
 * Tone map control, perf/RenderPanel.js; HDR.md, "Trying other tone maps").
 *
 * Celestiary's one tone map is PBR Neutral, run last in the atmosphere pass
 * (hdr.js neutralToneMap).  The others are three.js's operators, as its
 * tonemapping_pars_fragment has them (r187) but without the exposure
 * multiply: the scene buffer already holds exposed values.  They swap only
 * that final map: renderer.toneMapping stays the scene pass's exposure-only
 * CustomToneMapping, which the HDR buffer depends on.
 *
 * Not in the first load: the atmosphere pass's own finalToneMap is PBR
 * Neutral alone (Atmosphere.js DEFAULT_TONE_MAP_GLSL), and installToneMaps
 * swaps this in, with its uToneMap uniform, the first time another map is
 * asked for (ThreeUi.setToneMap).  TONE_MAP_IDS are uToneMap's values.
 * It imports nothing: a lazy chunk that imports a first-load module splits
 * that module into a file of its own (AGENTS.md, "Keep the first load lean").
 */


/** @type {{[key: string]: number}} */
export const TONE_MAP_IDS = {neutral: 0, aces: 1, agx: 2, reinhard: 3, cineon: 4, linear: 5, greyscale: 6}


const AGX_INSET = [
  [0.856627153315983, 0.137318972929847, 0.11189821299995],
  [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
  [0.0482516061458583, 0.101439036467562, 0.811302368396859],
]
const AGX_OUTSET = [
  [1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
  [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
  [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405],
]
const AGX_MIN_EV = -12.47393
const AGX_MAX_EV = 4.026069
const LUMA = [0.2126, 0.7152, 0.0722]


/**
 * GLSL: `vec3 finalToneMap(vec3 color)`, the atmosphere pass's last step,
 * by uToneMap (TONE_MAP_IDS; 0, PBR Neutral, the default).  Needs
 * NEUTRAL_GLSL before it, which the atmosphere pass has.  A non-finite input shows as white, as
 * neutralToneMap's does.
 */
export const TONE_MAP_GLSL = `
uniform float uToneMap;
vec3 acesFit(vec3 v) {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
}
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 finalToneMap(vec3 color) {
  if (uToneMap < 0.5 || any(isnan(color)) || any(isinf(color))) return neutralToneMap(color);
  if (uToneMap < 1.5) {
    mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    return clamp(outM * acesFit(inM * (color / 0.6)), 0.0, 1.0);
  }
  if (uToneMap < 2.5) {
    mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    mat3 toSrgb = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
    mat3 inset = mat3(vec3(${AGX_INSET[0].join(', ')}), vec3(${AGX_INSET[1].join(', ')}), vec3(${AGX_INSET[2].join(', ')}));
    mat3 outset = mat3(vec3(${AGX_OUTSET[0].join(', ')}), vec3(${AGX_OUTSET[1].join(', ')}), vec3(${AGX_OUTSET[2].join(', ')}));
    vec3 c = inset * (toRec2020 * color);
    c = clamp((log2(max(c, 1e-10)) - (${AGX_MIN_EV})) / (${AGX_MAX_EV - AGX_MIN_EV}), 0.0, 1.0);
    c = pow(max(outset * agxContrast(c), vec3(0.0)), vec3(2.2));
    return clamp(toSrgb * c, 0.0, 1.0);
  }
  if (uToneMap < 3.5) return clamp(color / (1.0 + color), 0.0, 1.0);
  if (uToneMap < 4.5) {
    vec3 c = max(vec3(0.0), color - 0.004);
    return pow((c * (6.2 * c + 0.5)) / (c * (6.2 * c + 1.7) + 0.06), vec3(2.2));
  }
  if (uToneMap < 5.5) return clamp(color, 0.0, 1.0);
  return vec3(dot(neutralToneMap(color), vec3(${LUMA.join(', ')})));
}
`


/**
 * Give the atmosphere pass every operator: replace its PBR Neutral-only
 * finalToneMap with TONE_MAP_GLSL and add uToneMap.  The program recompiles
 * once; later calls do nothing.
 *
 * @param {object} material The atmosphere pass's ShaderMaterial
 * @param {string} defaultGlsl The line it replaces (Atmosphere.js DEFAULT_TONE_MAP_GLSL)
 */
export function installToneMaps(material, defaultGlsl) {
  if (material.uniforms.uToneMap) {
    return
  }
  if (!material.fragmentShader.includes(defaultGlsl)) {
    throw new Error('The atmosphere pass has no finalToneMap to replace')
  }
  material.uniforms.uToneMap = {value: 0}
  material.fragmentShader = material.fragmentShader.replace(defaultGlsl, TONE_MAP_GLSL)
  material.needsUpdate = true
}
