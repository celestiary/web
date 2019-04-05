import * as THREE from './lib/three.module.js';

import ThreeUi from './three_ui.js';
import * as Animation from './animation.js';
import Controller from './controller.js';
import Scene from './scene.js';
import * as Shared from './shared.js';
import * as Utils from './utils.js';
import ControlPanel from './controlPanel.js';

/**
 * Solar System simulator inspired by Celestia using Three.js.
 *
 * TODO
 * v1:
 * - Smooth transitions.
 * - Exponential zoom.
 * X Time control.
 * X Units for measurements.
 * - Q/A against Celestia.
 *   - Epoch-based locations.
 * v2:
 * - Stars and Galaxies.
 * - LRU scene-graph un-loading.
 * X View options, e.g. toggle orbits.
 * - Time slider.  Meaningful time steps: 1s, 1m, 1h, 1d, 1mo, 1yr, ...
 * BUGS:
 *
 * @see http://shatters.net/celestia/
 * @see http://mrdoob.github.com/three.js/
 * @author Pablo Mayrgundter
 */
export default class Celestiary {
  constructor(canvasContainer, dateElt) {
    this.dateElt = dateElt;
    const postAnimationCb = () => {
      this.updateUi();
    };
    this.animation = Animation;
    canvasContainer.style.width = window.innerWidth + 'px';
    canvasContainer.style.height = window.innerHeight + 'px';
    this.ui = new ThreeUi(canvasContainer, Animation.animation);
    this.scene = new Scene(this.ui);

    // these are here for convenience debugging from jsconsole.
    this.shared = Shared;
    this.three = THREE;
    this.utils = Utils;

    const infoElt = document.getElementById('info');
    if (infoElt) {
      this.controlPanel = new ControlPanel(infoElt);
    } else {
      this.controlPanel = {
        showNavDisplay: () => {}
      };
    }
    const pathLoaded = (path, loaded) => {
      console.log(`path loaded: ${path}`, loaded);
      this.controlPanel.showNavDisplay(path, loaded);
      const targetElt = path[path.length - 1];
      this.scene.lookAtNamed(targetElt);
      this.scene.goTo();
    };

    // Load scene and then attach listeners after.
    this.ctrl = new Controller(this.scene);
    const path = location.hash ? location.hash.substring(1) : 'sun';
    this.ctrl.loadPath('milkyway');
    this.ctrl.loadPath(path, pathLoaded);

    window.addEventListener('hashchange', (e) => {
        console.log('hashchange');
        this.ctrl.loadPath((location.hash || '#').substring(1), pathLoaded);
      },
      false);

    window.addEventListener('keypress', (e) => {
        switch (e.which) {
        case 32: Animation.togglePause(); break; // ' '
        case 44: this.ui.multFov(0.9); break; // ','
        case 46: this.ui.multFov(1.1); break; // '.'
        case 48: this.scene.lookAtNamed('sun'); break; // '0'
        case 49: this.scene.lookAtNamed('mercury'); break; // '1'
        case 50: this.scene.lookAtNamed('venus'); break; // '2'
        case 51: this.scene.lookAtNamed('earth'); break; // '3'
        case 52: this.scene.lookAtNamed('mars'); break; // '4'
        case 53: this.scene.lookAtNamed('jupiter'); break; // '5'
        case 54: this.scene.lookAtNamed('saturn'); break; // '6'
        case 55: this.scene.lookAtNamed('uranus'); break; // '7'
        case 56: this.scene.lookAtNamed('neptune'); break; // '8'
        case 57: this.scene.lookAtNamed('pluto'); break; // '9'
        case 59: Animation.changeTimeScale(0); break; // ';'
        case 99: this.scene.lookAtCurrentTarget(); break; // 'c'
        case 100: this.ctrl.scene.toggleDebug(); break; // 'd'
        case 102: this.scene.follow(); break; // 'f'
        case 103: this.scene.goTo(); break; // 'g'
        case 106: Animation.invertTimeScale(); break; // 'j'
        case 107: Animation.changeTimeScale(-1); break; // 'k'
        case 108: Animation.changeTimeScale(1); break; // 'l'
        case 110: Animation.setTimeToNow(); break; // 'n'
        case 111: this.ctrl.scene.toggleOrbits(); break; // 'o'
        case 116: this.scene.track(); break; // 't'
        }
      },
      true);
  }


  /** Callback to update the HTML date element with the current time. */
  updateUi() {
    let lastUiUpdateTime = 0;
    if (Animation.time.sysTime > lastUiUpdateTime + 1000) {
      lastUiUpdateTime = Animation.time.sysTime;
      const showTime = new Date(Animation.time.simTime);
      if (this.dateElt) {
        this.dateElt.innerHTML = showTime + '';
      }
    }
  }


  select(name) {
    this.ctrl.scene.select(name);
  }
}
