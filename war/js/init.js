'use strict';

/**
 * Solar System simulator inspired by Celestia using Three.js.
 *
 * TODO
 * v1:
 * - Smooth transitions.
 * - Exponential zoom.
 * X Time control.
 * - Units for measurements.
 * - Q/A against Celestia.
 *   - Epoch-based locations.
 * v2:
 * - Stars and Galaxies.
 * - LRU scene-graph un-loading.
 * - View options, e.g. toggle orbits.
 * - Time slider.  Meaningful time steps: 1s, 1m, 1h, 1d, 1mo, 1yr, ...
 * BUGS:
 * - Scene select race before objects gain location in anim.
 *
 * @see http://shatters.net/celestia/
 * @see http://mrdoob.github.com/three.js/
 * @author Pablo Mayrgundter
 */

var test_hook = null;
var animationDelegate = animation;
var ctrl = null;
var scene = null;
var camera = null;
var targetPos = new THREE.Vector3();
var controls;
var date = new Date();
var dateElt;

window.onload = function() {
  var container = document.getElementById('scene');
  if (Detector.webgl) {
    container.innerHTML = '';
    scene = initCanvas(container, 0);
  }
}

function initCanvas(container, bgColor) {
  if (bgColor == null) {
    bgColor = 0xffffff;
  }
  dateElt = document.getElementById('date');
  var width = container.clientWidth;
  var height = container.clientHeight;
  if (width == 0 || height == 0) {
    width = window.innerWidth;
    height = window.innerHeight;
  }
  var renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setClearColor(bgColor, 1);
  renderer.setSize(width, height);
  renderer.sortObjects = true;
  renderer.autoClear = true;
  container.appendChild(renderer.domElement);
  var scene = new THREE.Scene();
  var cameraAndControls = initCameraAndControls(renderer);
  animate(renderer, cameraAndControls[0], cameraAndControls[1], scene);
  // This starts the scene loading process..
  ctrl = new Controller();
  ctrl.loadPath('milkyway');
  ctrl.loadPath(location.hash ? location.hash.substring(1) : '');
  return scene;
}

function initCameraAndControls(renderer) {

  // TODO(pablo): pass these as method args
  var width = renderer.domElement.clientWidth;
  var height = renderer.domElement.clientHeight;
  // TODO(pablo): should not be global.
  camera = new THREE.PerspectiveCamera(25, width / height, 1, 1E13);
  camera.rotationAutoUpdate = true;

  controls = new THREE.TrackballControls( camera );
  // Rotation speed is changed in controller.js depending on target
  // type: faster for sun, slow for planets.
  controls.rotateSpeed = 1;
  controls.zoomSpeed = 1;
  controls.panSpeed = 1;
  controls.noZoom = false;
  controls.noPan = false;
  controls.staticMoving = true;
  controls.dynamicDampingFactor = 0.3;

  window.addEventListener('resize',
                          function() {
                            onWindowResize(renderer, camera, controls);
                          },
                          false);
  window.addEventListener('hashchange',
                          function(e) {
                            ctrl.loadPath((location.hash || '#').substring(1));
                          },
                          false);

  window.addEventListener('keypress', keyPress, true);

  return [camera, controls];
}

function onWindowResize(renderer, camera, controls) {
  var width = window.innerWidth;
  var height = window.innerHeight;

  renderer.setSize(width, height);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  camera.radius = (width + height) / 4;

  if (controls) {
    controls.screen.width = width;
    controls.screen.height = height;
  }
}

function animate(renderer, camera, controls, scene) {
  updateUi();
  requestAnimationFrame(function() { animate(renderer, camera, controls, scene); } );
  render(renderer, camera, controls, scene);
}

var targetObj = null;
var targetObjLoc = new THREE.Matrix4;

var lastUiUpdateTime = 0;
function updateUi() {
  if (time > lastUiUpdateTime + 1000) {
    lastUiUpdateTime = time;
    dateElt.innerHTML = new Date(simTime) + '';
  }
}

function render(renderer, camera, controls, scene) {
  if (controls) {
    controls.update();
  }

  if (animationDelegate) {
    animationDelegate(scene);
  }

  renderer.clear();
  renderer.render(scene, camera);
}

function keyPress(e) {
  switch (e.which) {
    // 'o'
  case 111: ctrl.scene.toggleOrbits(); break;
  }
}
