'use strict';

window.onload = function() {
  if (!Detector.webgl) {
    return;
  }
  var canvasContainer = document.getElementById('scene');
  var dateElt = document.getElementById('date');

  canvasContainer.innerHTML = '';

  new Celestiary(canvasContainer, dateElt);
}
