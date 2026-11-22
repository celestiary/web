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
// Decoded, as the texel is sampled: in sRGB's linear segment (under 0.04045),
// so exactly over 12.92.  Not srgb.js's srgbDecode: this module is in lazy
// chunks that import nothing of the first load's (AGENTS.md).
const KEY_BLACK_FULL_LINEAR = KEY_BLACK_FULL / 12.92


/**
 * @param {Function} [sceneReferred] hdr.js's, handed in
 * @param {object} [opts]
 * @param {boolean} [opts.keyBlack] Take a black texel as no data and let
 *   what's under it through: a HiPS tile covers its whole cell, and one
 *   with no alpha (Rubin's webp) is black where the survey has nothing,
 *   which hid the stars round the image
 * @returns {ShaderMaterial}
 */
export function newTileMaterial(sceneReferred = null, {keyBlack = false} = {}) {
  const material = new ShaderMaterial({
    uniforms: {map: {value: null}, uOpacity: {value: 1}, uKeyBlack: {value: keyBlack ? 1 : 0}},
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
    // a survey holds is a few counts over it), decoded as the texel is.
    fragmentShader: `uniform sampler2D map;
uniform float uOpacity;
uniform float uKeyBlack;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(map, vUv);
  float lit = smoothstep(0.0, ${KEY_BLACK_FULL_LINEAR.toExponential(6)}, max(texel.r, max(texel.g, texel.b)));
  gl_FragColor = vec4(texel.rgb, texel.a * uOpacity * mix(1.0, lit, uKeyBlack));
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
