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
    this.camera = new THREE.PerspectiveCamera(Shared.INITIAL_FOV, ratio, 1E-3, 1E35);
    this.camera.position.z = 1;
    this.camera.platform = new THREE.Object3D();
    this.camera.platform.add(this.camera);
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
    this.scene.add(this.camera.platform);
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
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.3;
    //controls.rotateSpeed = 1;
    //controls.zoomSpeed = 0.001;
    controls.target = camera.platform.position;
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


  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }


  multFov(factor) {
    // TODO(pablo): narrowing very far leads to overflow in the float
    // values, such that zooming out cannot return exactly to 45
    // degrees.
    const newFov = this.camera.fov * factor;
    if (newFov >= 180) {
      return;
    }
    this.setFov(newFov);
  }


  resetFov() {
    this.setFov(Shared.INITIAL_FOV);
  }


  renderLoop() {
    this.controls.update();
    if (Shared.targets.track) {
      c.scene.lookAtTarget();
    }
    this.animationCb(this.scene);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => {
        this.renderLoop();
      });
  }
}
