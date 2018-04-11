'use strict';

const Detector = require('./lib/Detector.js');
const Celestiary = require('./celestiary.js');
const collapsor = require('./collapsor.js');

function init() {
  if (!Detector.webgl) {
    return;
  }
  global.celestiary = new Celestiary(
      document.getElementById('scene'),
      document.getElementById('date'));
  global.collapse = collapsor.collapse;
}

init();
