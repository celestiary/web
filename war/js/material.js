'use strict';

function loadTexture(texPath) {
  return THREE.ImageUtils.loadTexture(texPath);
}

function pathTexture(filebase, ext) {
  ext = ext || '.jpg';
  return loadTexture('textures/' + filebase + ext);
}

var materials = [];
function cacheMaterial(name) {
  var m = materials[name];
  if (!m) {
    materials[name] = m = new THREE.MeshPhongMaterial({
        map: pathTexture(name),
      });
  }
  return m;
}

function lineMaterial(params, name) {
  var params = params || {};
  params.color = params.color || 0xff0000;
  params.lineWidth = params.lineWidth || 1;
  var name = name || 'line-basic';
  var m = materials[name];
  if (!m) {
    materials[name] = m = new THREE.LineBasicMaterial({
    color: params.color,
    lineWidth: params.lineWidth,
    blending: THREE.AdditiveBlending,
    transparent: false});
  }
  return m;
}
