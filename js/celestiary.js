import * as THREE from './lib/three.js/three.module.js';
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


const DEFAULT_TARGET = 'sun';
const elt = (id) => { return document.getElementById(id); }

/** Main application class. */
export default class Celestiary {
  constructor(canvasContainer, dateElt, timeScaleElt, navElt) {
    Utils.assertArgs(arguments, 4);
    this.time = new Time(dateElt, timeScaleElt);
    this.animation = new Animation(this.time);
    canvasContainer.style.width = window.innerWidth + 'px';
    canvasContainer.style.height = window.innerHeight + 'px';
    const animCb = (scene) => {
      this.animation.animate(scene);
      if (Shared.targets.track) {
        this.scene.lookAtTarget();
      }
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


  setTitle(parts) {
    let title = 'Celestiary';
    if (parts.length >= 1) {
      title = Utils.capitalize(parts[parts.length - 1]);
    }
    document.title = title;
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
          let targetName = parts[parts.length - 1];
          if (targetName.indexOf('-') >= 0) {
            targetName = targetName.split('-')[0];
          }
          this.scene.targetNamed(targetName);
          this.scene.goTo();
          this.setTitle(parts);
        }, 0);
    };

    let path;
    if (location.hash) {
      path = location.hash.substring(1);
    } else {
      path = DEFAULT_TARGET;
      location.hash = path;
    }
    this.loader.loadPath('milkyway', this.onLoadCb, () => {
      this.loader.loadPath(path, this.onLoadCb, this.onDoneCb, () => {
        // On error.
        location.hash = DEFAULT_TARGET;
      });
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
    k.map('Escape', () => { this.hideActiveDialog(); },
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
    k.map('c', () => { this.scene.lookAtTarget(); },
          'Look at target');
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
    k.map('t', () => { this.scene.track(); },
          'Track target node');
    k.map('u', () => { this.scene.targetParent(); },
          'Look at parent of current system');
    k.map('A', () => { this.scene.toggleAsterisms(); },
          'Show/hide asterisms');
    k.map('O', () => { this.scene.toggleOrbits(); },
          'Show/hide orbits');
    k.map('P', () => { this.scene.togglePlanetLabels(); },
          'Show/hide planet and moon names');
    k.map('S', () => { this.scene.toggleStarLabels(); },
          'Show/hide star names');
    k.map('V', () => {
        const panels = [elt('nav-id'), elt('time-id')];
        panels.map((panel) => { panel.style.visibility = this.navVisible ? 'hidden' : 'visible' });
        this.navVisible = !this.navVisible;
      }, 'Show/hide navigation panels');
    k.map('?', () => { this.toggleShowKeys(); },
          'Show/hide keyboard shortcuts');
    this.keys = k;
  }


  hideActiveDialog() {
    document.querySelectorAll('.dialog').forEach(elt => this.hideElt(elt));
  }


  hideElt(elt) {
    elt.style.display = 'none';
  }


  /** @return True iff showing */
  toggleEltDisplay(elt) {
    if (elt.style.display == 'block') {
      this.hideElt(elt);
      return false;
    } else {
      this.hideActiveDialog();
      elt.style.display = 'block';
      return true;
    }
  }


  toggleAbout() {
    const aboutElt = elt('about-id');
    if (this.toggleEltDisplay(aboutElt)) {
      aboutElt.innerHTML = ABOUT;
    }
  }


  toggleShowKeys() {
    const keysElt = elt('keys-id');
    if (this.toggleEltDisplay(keysElt)) {
      if (!keysElt.domDone) {
        keysElt.appendChild(this.keys.toHtml());
        keysElt.domDone = true;
      }
    }
  }


  hideHelpOnEscape() {
    const keysElt = elt('keys-id');
    keysElt.style.display = 'none';
  }
}


const ABOUT = `<h1>About</h1>
Celestiary is a cosmological simulator.

<h2>News</h2>
<ul>
  <li>2021 Jan 25 - Works in Safari 13.1.2+ on OSX, maybe earlier.
  Now all major browsers tested except IE.
</ul>
<h2>Features</h2>
<ul>
  <li>Keplerian orbits (6 orbital elements)
  <li>Time controls, to alter rate and direction of time
  <li>Star colors based on surface temperatures
  <li>Star surface dynamics simulation (Perlin noise in black-body spectra)
  <li>9 planets, 20 moons
  <li>Permanent links for scene locations
  <li>Even kinda works on mobile! :)
</ul>
<h2>Datasets</h2>
<ul>
  <li>~100,000 stars
  <li>~3k star names
  <li>~80 Asterisms/constellations
</ul>
<h2>Learn more</h2>
<ul>
  <li><a href="howto/index.html" target="_blank">Software development guide</a>
  <li><a href="https://github.com/pablo-mayrgundter/celestiary" target="_blank">Source code (GitHub)</a>
</ul>`;
