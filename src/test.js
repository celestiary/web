'use strict';

const Detector = require('./lib/Detector.js');
const THREE = require('three');
const ThreeUi = require('./three_ui.js');
const Controller = require('./controller.js');
const Scene = require('./scene.js');
const Shared = require('./shared.js');
// for debug.
const Shapes = require('./shapes.js');

let animationCb = () => {};

function animate() {
  animationCb();
}

function Celestiary(canvasContainer) {
  this.ui = new ThreeUi(canvasContainer, animate);
  this.scene = new Scene(this.ui);
  this.ctrl = new Controller(this.scene);
  this.shared = Shared;
  // For debug
  this.three = THREE;
  this.shapes = Shapes;
}

function init() {
  if (!Detector.webgl) {
    return;
  }
  global.celestiary = new Celestiary(document.getElementById('scene'));
  global.c = celestiary;
}

init();
