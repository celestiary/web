import Animation from './animation.js';
import ControlPanel from './controlPanel.js';
import Keys from './keys.js';
import Loader from './loader.js';
import Reify from './reify.js';
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
  constructor(canvasContainer, dateElt, timeScaleElt, navElt) {
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
    this.controlPanel = new ControlPanel(navElt, this.loader);
    this.load();
    this.setupListeners();
    this.navVisible = true;
    // these are here for convenience debugging from jsconsole.
    this.shared = Shared;
    this.shapes = Shapes;
    this.three = THREE;
    this.utils = Utils;
  }


  load() {
    this.onLoadCb = (name, obj) => {
      Reify(obj);
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

    const k = new Keys();
    k.map('Escape', () => { this.hideHelpOnEscape(); },
          'Hide active dialog');
    k.map(' ', () => { this.time.togglePause(); },
          'Toggle time pause');
    k.map(',', () => { this.ui.multFov(0.9); },
          'Narrow field-of-vision');
    k.map('.', () => { this.ui.multFov(1.1); },
          'Broaden field-of-vision');
    k.map('/', () => { this.ui.resetFov(); },
          'Reset field-of-vision to ' + Shared.INITIAL_FOV + 'º');
    k.map('0', () => { this.scene.targetCurNode(); },
          'Target current system');
    for (let i = 1; i <= 9; i++) {
      k.map(''+i, () => { const ndx = i; this.scene.targetNode(ndx); },
            `Look at child ${i} of current system`);
    }
    k.map(';', () => { this.time.changeTimeScale(0); },
          'Change time scale to real-time');
    k.map('?', () => { this.toggleShowKeys(); },
          'Show/hide keyboard shortcuts');
    k.map('c', () => { this.scene.lookAtTarget(); },
          'Look at target');
    k.map('d', () => { this.scene.toggleDebug(); },
          'Show/hide debug shapes');
    k.map('f', () => { this.scene.follow(); },
          'Follow current node');
    k.map('g', () => { this.goTo(); },
          'Go to target node');
    k.map('j', () => { this.time.invertTimeScale();},
          'Reverse time');
    k.map('k', () => { this.time.changeTimeScale(-1); },
          'Slow down time');
    k.map('l', () => { this.time.changeTimeScale(1); },
          'Speed up time');
    k.map('n', () => { this.time.setTimeToNow(); },
          'Set time to now');
    k.map('o', () => { this.scene.toggleOrbits(); },
          'Show/hide orbits');
    k.map('t', () => { this.scene.track(); },
          'Track target node');
    k.map('u', () => { this.scene.targetParent(); },
          'Look at parent of current system');
    k.map('v', () => {
        const panels = [elt('nav-id'), elt('time-id')];
        panels.map((panel) => { panel.style.visibility = this.navVisible ? 'hidden' : 'visible' });
        this.navVisible = !this.navVisible;
      }, 'Show/hide navigation panels');
    this.keys = k;

    window.addEventListener('keydown', (e) => {
        this.keys.onKeyDown(e);
      }, true);
  }


  hideHelpOnEscape() {
    const keysElt = elt('keys-id');
    keysElt.style.display = 'none';
  }


  toggleShowKeys() {
    const keysElt = elt('keys-id');
    if (keysElt.style.display == 'block') {
      keysElt.style.display = 'none';
    } else {
      this.keys.appendHelp(keysElt);
      keysElt.style.display = 'block';
    }
  }
}
