import {
  AdditiveBlending,
  LineBasicMaterial,
  Material,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
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
 * @returns {Material}
 */
export function cacheMaterial(name, ext) {
  let m = materials[name]
  if (!m) {
    materials[name] = m = new MeshPhysicalMaterial({
      map: pathTexture(name, ext),
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
