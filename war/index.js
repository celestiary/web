'use strict';

/**
 * Solar System simulator inspired by Celestia using Three.js.
 *
 * TODO:
 * - Units for measurements.
 * - Q/A against Celestia.
 *   - Add actual epoch-based locations.
 *   - Add actual epoch-based locations.
 * - LRU scene-graph un-loading.
 * - View options, e.g. toggle orbits.
 * - Stars and Galaxies.
 * - Time slider.
 * - Zoom in.
 * BUGS:
 * - Scene select race before objects gain location in anim.
 *
 * @see http://shatters.net/celestia/
 * @see http://mrdoob.github.com/three.js/
 * @author Pablo Mayrgundter
 */

//var camera;
//var cameraControls;

function init(canvasContainerElt) {
  var width = canvasContainerElt.clientWidth;
  var height = canvasContainerElt.clientHeight;
  if (width == 0 || height == 0) {
    width = window.innerWidth;
    height = window.innerHeight;
  }
  var renderer = new THREE.WebGLRenderer({
      antialias: true,
      clearAlpha: 1,
      clearColor: 0 });
  renderer.setSize(width, height);
  renderer.sortObjects = true;
  renderer.autoClear = true;
  canvasContainerElt.appendChild(renderer.domElement);

  var scene = new THREE.Scene();

  var camera = new THREE.PerspectiveCamera(80, width / height, 1, 1E13);
  scene.add(camera);
  //var cameraControls = null;
  var cameraControls = new THREE.FlyControls(camera, canvasContainerElt);
  //cameraControls.domElement = canvasContainerElt;
  cameraControls.movementSpeed = 5E6;
  cameraControls.lookSpeed = 1E-1;
  cameraControls.rollSpeed = Math.PI / 2;
  cameraControls.autoForward = false;
  cameraControls.noFly = false;
  cameraControls.activeLook = false;
  cameraControls.dragToLook = true;

  // in animation.js
  renderLoop(renderer, scene, camera, cameraControls);

  // This starts the scene loading process..
  var ctrl = new Controller(scene);

  // Scene selections are handled through URL hash changes.
  if (location.hash) {
    ctrl.load(location.hash.substring(1).split(','));
  }
  window.addEventListener('hashchange',
                          function() {
                            var hash = (location.hash || '#').substring(1);
                            hash = hash.split(',');
                            ctrl.load(hash);
                          },
                          false);

  window.addEventListener('resize',
                          function() {
                            var width = window.innerWidth;
                            var height = window.innerHeight;
                            renderer.setSize(width, height);
                            camera.aspect = width / height;
                            camera.updateProjectionMatrix();
                            camera.radius = (width + height) / 4;
                          },
                          false);
}
