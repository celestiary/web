const THREE = require('three');
const Shared = require('./shared.js');
const TrackballControls = require('./lib/TrackballControls.js');

function ThreeUi(container, animationCb, windowResizeCb) {
  container.innerHTML = '';
  this.container = container;
  this.animationCb = animationCb || (() => {});
  this.windowResizeCb = windowResizeCb || (() => {});
  this.setSize();
  this.initRenderer(container);
  this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 1E-3, 1E35);
  this.camera.rotationAutoUpdate = true;
  this.initControls(this.camera);
  this.scene = new THREE.Scene();

  window.addEventListener(
      'resize',
      () => {
        this.onWindowResize();
      },
      false);

  this.renderLoop();
}


ThreeUi.prototype.setSize = function() {
  this.width = this.container.clientWidth || window.innerWidth;
  this.height = this.container.clientHeight || window.innerHeight;
};


ThreeUi.prototype.initRenderer = function(container) {
  const r = new THREE.WebGLRenderer({antialias: true});
  r.setClearColor(0, 1);
  r.setSize(this.width, this.height);
  r.sortObjects = true;
  r.autoClear = true;
  container.appendChild(r.domElement);
  this.renderer = r;
};


ThreeUi.prototype.initControls = function(camera) {
  const c = new TrackballControls(camera);
  // Rotation speed is changed in scene.js depending on target
  // type: faster for sun, slow for planets.
  c.noZoom = false;
  c.noPan = false;
  c.staticMoving = true;
  c.dynamicDampingFactor = 0.3;
  this.controls = c;
};


ThreeUi.prototype.onWindowResize = function() {
  this.setSize();
  this.renderer.setSize(this.width, this.height);
  this.camera.aspect = this.width / this.height;
  this.camera.updateProjectionMatrix();
  this.camera.radius = (this.width + this.height) / 4;
  this.controls.screen.width = this.width;
  this.controls.screen.height = this.height;
  // TODO(pablo): this doesn't tilt the view when JS console is toggled?
  this.windowResizeCb(this.camera, this.scene);
};


ThreeUi.prototype.multFov = function(factor) {
  // TODO(pablo): narrowing very far leads to overflow in the float
  // values, such that zooming out cannot return exactly to 45
  // degrees.
  const newFov = this.camera.fov * factor;
  if (newFov >= 180) {
    return;
  }
  this.camera.fov = newFov;
  this.camera.updateProjectionMatrix();
};


ThreeUi.prototype.renderLoop = function() {
  if (Shared.targetNode) {
    this.controls.target = Shared.targetNode.orbitPosition.position;
  }
  this.controls.update();
  this.animationCb(this.scene);
  this.renderer.render(this.scene, this.camera);
  requestAnimationFrame(() => {
      this.renderLoop();
  });
}

module.exports = ThreeUi;
