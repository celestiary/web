import * as THREE from './lib/three.module.js';
import * as Shared from './shared.js';
import TrackballControls from './lib/TrackballControls.js';
import Fullscreen from './fullscreen.js';


export default class ThreeUi {
  constructor(container, animationCb, backgroundColor) {
    if (typeof container == 'string') {
      this.container = document.getElementById(container);
    } else if (typeof container == 'object') {
      this.container = container;
    } else {
      throw new Error(`Given container must be DOM ID or element: ${container}`);
    }
    this.animationCb = animationCb || (() => {});
    this.renderer =
      this.initRenderer(this.container, backgroundColor || 0x000000);
    const w = this.container.offsetWidth;
    const h = this.container.offsetHeight;
    const ratio = w / h;
    this.camera = new THREE.PerspectiveCamera(45, ratio, 1E-3, 1E35);
    this.camera.rotationAutoUpdate = true;
    this.initControls(this.camera);
    this.fs = new Fullscreen(this.container, () => {
        this.onResize();
      });
    window.addEventListener('resize', () => {
        if (this.fs.isFullscreen()) {
          this.onResize();
        }
      });
    this.onResize();
    this.scene = new THREE.Scene();
    this.renderLoop();
  }


  initRenderer(container, backgroundColor) {
    const renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    const width = this.container.offsetWidth;
    const height = this.container.offsetHeight;
    renderer.setClearColor(backgroundColor, 1);
    renderer.setSize(width, height);
    renderer.sortObjects = true;
    renderer.autoClear = true;
    container.appendChild(renderer.domElement);
    return renderer;
  }


  initControls(camera) {
    const controls = new TrackballControls(camera);
    // Rotation speed is changed in scene.js depending on target
    // type: faster for sun, slow for planets.
    controls.noZoom = false;
    controls.noPan = false;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;
    this.controls = controls;
  }


  onResize() {
    let width, height;
    if (this.fs.isFullscreen()) {
      width = window.innerWidth;
      height = window.innerHeight;
    } else {
      width = this.container.offsetWidth;
      height = this.container.offsetHeight;
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.controls.handleResize();
    // console.log(`onResize: ${width} x ${height}`);
  }


  multFov(factor) {
    // TODO(pablo): narrowing very far leads to overflow in the float
    // values, such that zooming out cannot return exactly to 45
    // degrees.
    const newFov = this.camera.fov * factor;
    if (newFov >= 180) {
      return;
    }
    this.camera.fov = newFov;
    this.camera.updateProjectionMatrix();
  }


  renderLoop() {
    this.controls.update();
    if (Shared.targetRefs.trackObj) {
      c.scene.lookAtCurrentTarget();
    }
    this.animationCb(this.scene);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => {
        this.renderLoop();
      });
  }
}
