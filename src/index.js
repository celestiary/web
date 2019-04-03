import Celestiary from './celestiary.js';
import * as collapsor from './collapsor.js';

function init() {
  const sceneElt = document.getElementById('scene')
  const dateElt = document.getElementById('date');
  window.c = window.celestiary = new Celestiary(sceneElt, dateElt);
  window.collapse = collapsor.collapse;
}

init();
