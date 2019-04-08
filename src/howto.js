'use strict';

const Detector = require('./lib/Detector.js');
const THREE = require('three');
const ThreeUi = require('./three_ui.js');
const Shapes = require('./shapes.js');

function init() {
  if (!Detector.webgl) {
    return;
  }
  const threeUi = new ThreeUi(document.getElementById('scene.id'));
  threeUi.camera.position.set(0, 0, 10);
  threeUi.scene.add(Shapes.cube());
}

init();
