import * as THREE from './lib/three.module.js';

const loader = new THREE.TextureLoader();

function loadTexture(texPath) {
  return loader.load(texPath);
}

function pathTexture(filebase, ext) {
  ext = ext || '.jpg';
  return loadTexture('textures/' + filebase + ext);
}

const materials = [];
function cacheMaterial(name) {
  let m = materials[name];
  if (!m) {
    materials[name] = m = new THREE.MeshPhongMaterial({
        map: pathTexture(name),
      });
  }
  return m;
}

function lineMaterial(params, name) {
  params = params || {};
  params.color = params.color || 0xff0000;
  params.linewidth = params.lineWidth || 1;
  name = name || 'line-basic';
  let m = materials[name];
  if (!m) {
    materials[name] = m = new THREE.LineBasicMaterial({
    color: params.color,
    linewidth: params.linewidth,
    blending: THREE.AdditiveBlending,
    transparent: false});
  }
  return m;
}

export {
  lineMaterial,
  pathTexture,
  cacheMaterial
};
