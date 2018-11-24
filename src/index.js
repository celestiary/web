'use strict';

const WebGL = require('./lib/WebGL.js');
const Celestiary = require('./celestiary.js');
const collapsor = require('./collapsor.js');

function init() {
  if (!WebGL.isWebGLAvailable()) {
    const errMsg = WebGL.getWebGLErrorMessage();
    console.log(errMsg);
    return;
  }
  global.c = global.celestiary = new Celestiary(
      document.getElementById('scene'),
      document.getElementById('date'));
  global.collapse = collapsor.collapse;
}

init();
