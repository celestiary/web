$LAB
.script('js/three_ui.js')
.script('js/rest.js')
.script('js/shared.js')
.script('js/material.js')
.script('js/shapes.js')
.script('js/scene.js')
.script('js/controller.js')
.script('js/measure.js')
.script('js/animation.js')
.script('js/t-1000.js')
.script('js/collapsor.js')
.script('js/celestiary.js')
.wait(function() {
  init();
});

function init() {
  if (!Detector.webgl) {
    return;
  }
  var canvasContainer = document.getElementById('scene');
  var dateElt = document.getElementById('date');

  canvasContainer.innerHTML = '';

  new Celestiary(canvasContainer, dateElt);
}
