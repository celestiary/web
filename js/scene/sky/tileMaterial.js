import {DoubleSide, NoColorSpace, ShaderMaterial} from 'three'


// The material of an image tile on the celestial sphere, shared by Rubin's
// discovery image (rubin/RubinImage.js) and the HiPS layer (HipsLayer.js):
// Sky.md and Rubin.md, "The imagery".  A tile is a grid on a unit sphere in
// the stars' frame, drawn at the camera by the model-view's turn alone and at
// the far plane, its texels display-referred sRGB through sceneReferred.

/** Clip z as a fraction of w: the stars' (exposure.js STAR_FAR_PLANE_INSIDE), so bodies in front hide it. */
export const FAR_PLANE_INSIDE = 0.999999
/** After the bodies and the stars, before the overlays; a tile adds its order or level. */
export const TILE_RENDER_ORDER = 10


/**
 * @param {Function} [sceneReferred] hdr.js's, handed in
 * @returns {ShaderMaterial}
 */
export function newTileMaterial(sceneReferred = null) {
  const material = new ShaderMaterial({
    uniforms: {map: {value: null}, uOpacity: {value: 1}},
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
    // The texel as it is: display-referred sRGB (the texture is read without
    // decoding), which sceneReferred turns into what the tone map gives back.
    // A tile's alpha (a HiPS PNG's blank sky) lets what's under it through.
    fragmentShader: `uniform sampler2D map;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(map, vUv);
  gl_FragColor = vec4(texel.rgb, texel.a * uOpacity);
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
 * (uv's v runs down the image), no colour decoding, mipmapped.
 *
 * @param {object} texture A three Texture
 * @returns {object} The texture
 */
export function prepareTileTexture(texture) {
  texture.flipY = false
  texture.colorSpace = NoColorSpace
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
