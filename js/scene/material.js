import {
  AdditiveBlending,
  LineBasicMaterial,
  Material,
  MeshPhysicalMaterial,
  Texture,
  TextureLoader,
} from 'three'


const loader = new TextureLoader()

/**
 * @returns {Texture}
 */
export function loadTexture(texPath) {
  return loader.load(texPath)
}

/**
 * @returns {Texture}
 */
export function pathTexture(filebase, ext) {
  ext = ext || '.jpg'
  return loadTexture(`/textures/${ filebase }${ext}`)
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
 * @returns {Material}
 */
export function cacheMaterial(name, ext, pathPrefix = '') {
  let m = materials[name]
  if (!m) {
    materials[name] = m = new MeshPhysicalMaterial({
      map: pathTexture(`${pathPrefix}${name}`, ext),
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
