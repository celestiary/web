import {DoubleSide, SRGBColorSpace, ShaderMaterial} from 'three'


// The material of an image tile on the celestial sphere, shared by Rubin's
// discovery image (rubin/RubinImage.js) and the HiPS layer (HipsLayer.js):
// Sky.md and Rubin.md, "The imagery".  A tile is a grid on a unit sphere in
// the stars' frame, drawn at the camera by the model-view's turn alone and at
// the far plane, its texels display-referred sRGB, decoded on sampling and
// through sceneReferred, so the encoded screen shows the picture's bytes.

/** Clip z as a fraction of w: the stars' (exposure.js STAR_FAR_PLANE_INSIDE), so bodies in front hide it. */
export const FAR_PLANE_INSIDE = 0.999999
/** After the bodies and the stars, before the overlays; a tile adds its order or level. */
export const TILE_RENDER_ORDER = 10
/** With `keyBlack`, the picture's value (0 to 1, sRGB) from which a tile is opaque. */
export const KEY_BLACK_FULL = 2 / 255


/**
 * A picture's value decoded, as the texel is sampled.  Not srgb.js's
 * srgbDecode: this module is in lazy chunks that import nothing of the first
 * load's (AGENTS.md).
 *
 * @param {number} v sRGB, 0 to 1
 * @returns {number} Linear
 */
export function keyLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}


/**
 * @param {Function} [sceneReferred] hdr.js's, handed in
 * @param {object} [opts]
 * @param {boolean} [opts.keyBlack] Take a black texel as no data and let
 *   what's under it through: a HiPS tile covers its whole cell, and one
 *   with no alpha (Rubin's webp) is black where the survey has nothing,
 *   which hid the stars round the image
 * @param {number} [opts.keyBlackFrom] The picture's value (0 to 1, sRGB)
 *   up to which a keyed tile is clear: 0, or a jpeg survey's (a manifest's
 *   `keyBlack`, in counts: the compression rings round the edge of the data,
 *   out to 16 counts into the no-data black; Sky.md, "Black as no data")
 * @param {number} [opts.keyBlackFull] The picture's value from which it's
 *   opaque: KEY_BLACK_FULL, or a jpeg survey's
 * @param {boolean} [opts.invert] Show the tile's negative: ESASky's Hubble
 *   tiles are stretched dark-on-light (stars black, the sky near white),
 *   with black, keyed out first, where there's no data; the key then reads
 *   the darkest of the texel's neighbours too, so the edge of the data
 *   doesn't show as a bright rim
 * @returns {ShaderMaterial}
 */
export function newTileMaterial(sceneReferred = null, {
  keyBlack = false, keyBlackFrom = 0, keyBlackFull = KEY_BLACK_FULL, invert = false,
} = {}) {
  const material = new ShaderMaterial({
    uniforms: {
      map: {value: null},
      uOpacity: {value: 1},
      uKeyBlack: {value: keyBlack ? 1 : 0},
      // Decoded, as the texel is.
      uKeyFrom: {value: keyLinear(keyBlackFrom)},
      uKeyFull: {value: keyLinear(keyBlackFull)},
      uInvert: {value: invert ? 1 : 0},
    },
    vertexShader: `varying vec2 vUv;
void main() {
  vUv = uv;
  // The turn only (mat3): the tiles are at the camera, exactly.  With the
  // mesh moved to the camera's place and the whole matrix used, the two
  // places, each 1.5e11 m from the origin, left a few 1e-5 m of difference
  // between them: tens of arcseconds on a 1 m sphere, new each frame, so
  // the picture shook more the further in the field went.
  gl_Position = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
  // At the far plane, as the stars are: behind every body, whatever the
  // sphere's radius.
  gl_Position.z = ${FAR_PLANE_INSIDE} * gl_Position.w;
}`,
    // The texel, display-referred sRGB decoded on sampling (prepareTileTexture),
    // which sceneReferred turns into what the tone map gives back and the
    // screen's encoding shows as the picture's bytes.  A tile's alpha (a HiPS
    // PNG's blank sky) lets what's under it through, and so does black where
    // it's keyed: none at 0, all from 2/255 of the picture's (the darkest sky
    // a survey holds is a few counts over it; a jpeg survey's ramp is wider),
    // decoded as the texel is.  An inverted survey is keyed on its texel as
    // served, then shown as its negative, taken of the picture's bytes
    // (encoded, 1 less it, decoded); and keyed on the darkest of its
    // neighbours a screen pixel and a half off (or a texel and a half), as
    // the edge of its data is a blend of the no-data black and the sky, which
    // the negative turns into a bright rim (Sky.md, "Black as no data").
    fragmentShader: `uniform sampler2D map;
uniform float uOpacity;
uniform float uKeyBlack;
uniform float uKeyFrom;
uniform float uKeyFull;
uniform float uInvert;
varying vec2 vUv;
float level(vec2 uv) {
  vec3 t = texture2D(map, uv).rgb;
  return max(t.r, max(t.g, t.b));
}
float enc(float c) {
  return c <= 0.0031308 ? c * 12.92 : (1.055 * pow(c, 1.0 / 2.4)) - 0.055;
}
float dec(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
void main() {
  vec4 texel = texture2D(map, vUv);
  float v = max(texel.r, max(texel.g, texel.b));
  vec3 rgb = texel.rgb;
  if (uInvert > 0.5) {
    vec2 d = max(fwidth(vUv) * 1.5, vec2(1.5 / 512.0));
    v = min(min(v, min(level(vUv + d), level(vUv - d))),
        min(level(vUv + vec2(d.x, -d.y)), level(vUv - vec2(d.x, -d.y))));
    rgb = vec3(dec(1.0 - enc(rgb.r)), dec(1.0 - enc(rgb.g)), dec(1.0 - enc(rgb.b)));
  }
  float lit = smoothstep(uKeyFrom, uKeyFull, v);
  gl_FragColor = vec4(rgb, texel.a * uOpacity * mix(1.0, lit, uKeyBlack));
}`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    toneMapped: false,
  })
  return sceneReferred ? sceneReferred(material) : material
}


/**
 * A loaded tile's texture made ready for the material: rows from the top
 * (uv's v runs down the image), sRGB (decoded on sampling, and mipmapped in
 * linear light), mipmapped.
 *
 * @param {object} texture A three Texture
 * @returns {object} The texture
 */
export function prepareTileTexture(texture) {
  texture.flipY = false
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}


/**
 * A tile's mesh out of the scene, its geometry, texture and material freed.
 *
 * @param {?object} mesh
 */
export function disposeTileMesh(mesh) {
  if (!mesh) {
    return
  }
  mesh.removeFromParent()
  mesh.geometry.dispose()
  mesh.material.uniforms.map.value?.dispose?.()
  mesh.material.dispose()
}
