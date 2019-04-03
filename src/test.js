'use strict';

const WebGL = require('./lib/WebGL.js');
const Celestiary = require('./celestiary.js');
const collapsor = require('./collapsor.js');

function init() {
  const sceneElt = document.getElementById('scene')
  if (!WebGL.isWebGLAvailable()) {
    const errMsg = WebGL.getWebGLErrorMessage();
    console.log(errMsg);
    sceneElt.innerHTML = errMsg;
    return;
  }
  const dateElt = document.getElementById('date');
  global.c = global.celestiary = new Celestiary(sceneElt, dateElt, true);
  global.collapse = collapsor.collapse;
}

init();
