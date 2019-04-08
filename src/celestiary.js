import Animation from './animation.js';
import ControlPanel from './controlPanel.js';
import Loader from './loader.js';
import Scene from './scene.js';
import * as Shapes from './shapes.js';
import ThreeUi from './three_ui.js';
import Time from './time.js';
import * as Shared from './shared.js';
import * as Utils from './utils.js';
import * as THREE from './lib/three.module.js';


const elt = (id) => { return document.getElementById(id); }

/** Main application class. */
export default class Celestiary {
  constructor(canvasContainer, dateElt, timeScaleElt, infoElt) {
    this.time = new Time(dateElt, timeScaleElt);
    this.animation = new Animation(this.time);
    canvasContainer.style.width = window.innerWidth + 'px';
    canvasContainer.style.height = window.innerHeight + 'px';
    const animCb = (scene) => {
      this.animation.animate(scene);
    };
    this.ui = new ThreeUi(canvasContainer, animCb);
    this.scene = new Scene(this.ui);
    this.loader = new Loader();
    this.controlPanel = new ControlPanel(infoElt, this.loader);
    this.load();
    this.setupListeners();
    // these are here for convenience debugging from jsconsole.
    this.shared = Shared;
    this.shapes = Shapes;
    this.three = THREE;
    this.utils = Utils;
  }


  load() {
    this.onLoadCb = (name, obj) => {
      this.scene.add(obj);
    };

    this.onDoneCb = (path, obj) => {
      this.controlPanel.showNavDisplay(path.split('/'), this.loader);
      // TODO(pablo): Hack to handle load order.  The path is loaded,
      // but not yet animated so positions will be incorrect.  So
      // schedule this after the next pass.
      setTimeout(() => {
          const parts = path.split('/');
          this.scene.targetNamed(parts[parts.length - 1]);
          this.scene.goTo();
        }, 0);
    };

    let path;
    if (location.hash) {
      path = location.hash.substring(1);
    } else {
      path = 'sun';
      location.hash = path;
    }
    this.loader.loadPath('milkyway', this.onLoadCb, () => {
        this.loader.loadPath(path, this.onLoadCb, this.onDoneCb);
      });
  }


  goTo() {
    const tObj = this.shared.targets.obj;
    if (tObj) {
      if (tObj.props && tObj.props.name) {
        const path = this.loader.pathByName[tObj.props.name];
        if (path) {
          window.location.hash = path;
        } else {
          console.error(`no loaded path for ${tObj.props.name}: ${path}`);
        }
      } else {
        console.error('target obj has no name prop: ', tObj);
      }
    } else {
      console.error('no target obj!');
    }
  }


  setupListeners() {
    window.addEventListener('hashchange', (e) => {
        this.loader.loadPath((window.location.hash || '#').substring(1), this.onLoadCb, this.onDoneCb);
      },
      false);

    window.addEventListener('keypress', (e) => {
        switch (e.which) {
        case 32: /* space */ this.time.togglePause(); break;
        case 44: /* , */ this.ui.multFov(0.9); break;
        case 46: /* . */ this.ui.multFov(1.1); break;
        case 47: /* / */ this.ui.resetFov(); break;
        case 48: /* 0 */ this.scene.targetCurNode(); break;
        case 49: /* 1 */ this.scene.targetNode(1); break;
        case 50: /* 2 */ this.scene.targetNode(2); break;
        case 51: /* 3 */ this.scene.targetNode(3); break;
        case 52: /* 4 */ this.scene.targetNode(4); break;
        case 53: /* 5 */ this.scene.targetNode(5); break;
        case 54: /* 6 */ this.scene.targetNode(6); break;
        case 55: /* 7 */ this.scene.targetNode(7); break;
        case 56: /* 8 */ this.scene.targetNode(8); break;
        case 57: /* 9 */ this.scene.targetNode(9); break;
        case 59: /* ; */ this.time.changeTimeScale(0); break;
        case 99: /* c */ this.scene.lookAtTarget(); break;
        case 100: /* d */ this.scene.toggleDebug(); break;
        case 102: /* f */ this.scene.follow(); break;
        case 103: /* g */ this.goTo(); break;
        case 106: /* j */ this.time.invertTimeScale(); break;
        case 107: /* k */ this.time.changeTimeScale(-1); break;
        case 108: /* l */ this.time.changeTimeScale(1); break;
        case 110: /* n */ this.time.setTimeToNow(); break;
        case 111: /* o */ this.scene.toggleOrbits(); break;
        case 116: /* t */ this.scene.track(); break;
        case 117: /* u */ this.scene.targetParent(); break;
        case 118: /* v */
          const nav = elt('nav-id');
          nav.style.display = nav.style.display == 'none' ? 'block' : 'none';
          break;
        }
      },
      true);
  }
}
