import Celestiary from './celestiary.js';
import * as collapsor from './collapsor.js';

const elt = (id) => { return document.getElementById(id); }

function init() {
  window.c = window.celestiary =
    new Celestiary(elt('scene-id'), elt('date-id'), elt('time-scale-id'), elt('nav-id'));
  window.collapse = collapsor.collapse;
}

init();
