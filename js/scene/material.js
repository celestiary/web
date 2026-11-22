import {
  AdditiveBlending,
  LineBasicMaterial,
  LinearSRGBColorSpace,
  Material,
  MeshPhysicalMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'
import {dataUrl} from '../dataUrl.js'


const loader = new TextureLoader()

/**
 * Each texture says what its values are (HDR.md, "Colour spaces"):
 *
 * - a picture (a body's colour map, its night lights, the rings' colour) is
 *   sRGB-encoded, `SRGBColorSpace`: three uploads it as SRGB8_ALPHA8 and the
 *   GPU decodes each sample to linear light, so the surface is lit in it;
 * - a colour map that is a calibrated linear quantity (the Moon's, a linear
 *   stretch of I/F: its descriptor's `texture_encoding: "linear"`) is
 *   `LinearSRGBColorSpace`, read as stored;
 * - data (terrain, normals, the ocean mask, opacity) has no colour space,
 *   `NoColorSpace`, the default here: read as stored.
 *
 * @param {string} texPath
 * @param {string} [colorSpace] three's; NoColorSpace (data) by default
 * @returns {Texture}
 */
export function loadTexture(texPath, colorSpace = NoColorSpace) {
  const texture = loader.load(texPath)
  texture.colorSpace = colorSpace
  return texture
}

/**
 * @param {string} filebase Under textures/, without its extension
 * @param {string} [ext] '.jpg' by default
 * @param {string} [colorSpace] As loadTexture's
 * @returns {Texture}
 */
export function pathTexture(filebase, ext, colorSpace = NoColorSpace) {
  ext = ext || '.jpg'
  return loadTexture(dataUrl(`textures/${ filebase }${ext}`), colorSpace)
}


/**
 * A body's colour map's colour space, from its descriptor: sRGB, a
 * picture's, unless `texture_encoding` is "linear" (the Moon's).
 *
 * @param {object} [props] A body's
 * @returns {string} SRGBColorSpace or LinearSRGBColorSpace
 */
export function colorMapSpace(props) {
  return props?.texture_encoding === 'linear' ? LinearSRGBColorSpace : SRGBColorSpace
}

const materials = []
/**
 * Get-or-build a per-body MeshPhysicalMaterial.  Cached by `name` so the
 * material instance is shared across scenes and re-renders.  An optional
 * `pathPrefix` is prepended to the texture lookup (e.g. 'earth/' keeps
 * earth-specific assets in their own subdir while preserving the
 * by-name cache key).
 *
 * @param {string} name Body name; also the texture base filename
 * @param {string} [ext] Texture extension; defaults to '.jpg'
 * @param {string} [pathPrefix] Optional sub-path prefix under /textures/
 * @param {Texture} [map] The colour map, instead of loading `name`'s
 * @param {string} [colorSpace] The colour map's (colorMapSpace): a picture's,
 *   sRGB, by default
 * @returns {Material}
 */
export function cacheMaterial(name, ext, pathPrefix = '', map = undefined, colorSpace = SRGBColorSpace) {
  let m = materials[name]
  if (!m) {
    if (map) {
      map.colorSpace = colorSpace
    }
    materials[name] = m = new MeshPhysicalMaterial({
      map: map ?? pathTexture(`${pathPrefix}${name}`, ext, colorSpace),
      depthTest: true,
      depthWrite: true,
    })
  }
  return m
}

/**
 * @returns {Material}
 */
export function lineMaterial(params, name) {
  params = params || {}
  params.color = params.color || 0xff0000
  params.linewidth = params.lineWidth || 1
  name = name || 'line-basic'
  let m = materials[name]
  if (!m) {
    materials[name] = m = new LineBasicMaterial({
      color: params.color,
      linewidth: params.linewidth,
      blending: AdditiveBlending,
      transparent: false})
  }
  return m
}
