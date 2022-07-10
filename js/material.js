import {
  AdditiveBlending,
  LineBasicMaterial,
  MeshPhongMaterial,
  TextureLoader,
} from 'three'

const loader = new TextureLoader()

function loadTexture(texPath) {
  return loader.load(texPath)
}

function pathTexture(filebase, ext) {
  ext = ext || '.jpg'
  return loadTexture('/textures/' + filebase + ext)
}

const materials = []
function cacheMaterial(name, ext) {
  let m = materials[name]
  if (!m) {
    materials[name] = m = new MeshPhongMaterial({
      map: pathTexture(name, ext),
    })
  }
  return m
}

function lineMaterial(params, name) {
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

export {
  lineMaterial,
  pathTexture,
  cacheMaterial,
}
