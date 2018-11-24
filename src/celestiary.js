'use strict';

const THREE = require('three');
const Animation = require('./animation.js');
const ThreeUi = require('./three_ui.js');
const Controller = require('./controller.js');
const Scene = require('./scene.js');
const Shared = require('./shared.js');

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
 * - Scene select race before objects gain location in anim.
 *
 * @see http://shatters.net/celestia/
 * @see http://mrdoob.github.com/three.js/
 * @author Pablo Mayrgundter
 */
function Celestiary(canvasContainer, dateElt) {
  this.dateElt = dateElt;
  const postAnimationCb = () => {
      this.updateUi();
  };
  this.animation = Animation;
  // TODO: add back in windowResizeCb -> scene.updateView;
  this.ui = new ThreeUi(canvasContainer, Animation.animation, null);
  this.scene = new Scene(this.ui);
  this.ctrl = new Controller(this.scene);
  this.shared = Shared;

  window.addEventListener(
      'hashchange',
      (e) => {
        console.log('hashchange');
        this.ctrl.loadPath((location.hash || '#').substring(1));
      },
      false);

  window.addEventListener(
      'keypress',
      (e) => {
        switch (e.which) {
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
          case 59: this.changeTimeScale(0); break; // ';'
          case 99: this.scene.lookAtCurrentTarget(); break; // 'c'
          case 100: this.toggleDebug(); break; // 'd'
          case 103: this.scene.goTo(); break; // 'g'
          case 106: this.invertTimeScale(); break; // 'j'
          case 107: this.changeTimeScale(-1); break; // 'k'
          case 108: this.changeTimeScale(1); break; // 'l'
          case 111: this.toggleOrbits(); break; // 'o'
        }
      },
      true);

  this.ctrl.loadPath('milkyway');
  this.ctrl.loadPath(location.hash ? location.hash.substring(1) : '');
}

/** Callback to update the HTML date element with the current time. */
Celestiary.prototype.updateUi = function() {
  let lastUiUpdateTime = 0;
  if (Animation.clocks.sysTime > lastUiUpdateTime + 1000) {
    lastUiUpdateTime = Animation.clocks.sysTime;
    const showTime = new Date(Animation.clocks.simTime);
    this.dateElt.innerHTML = showTime + '';
  }
};

Celestiary.prototype.select = function(name) {
  this.ctrl.scene.select(name);
};
Celestiary.prototype.toggleOrbits = function() {
  this.ctrl.scene.toggleOrbits();
};
Celestiary.prototype.toggleDebug = function() {
  this.ctrl.scene.toggleDebug();
};
Celestiary.prototype.changeTimeScale = Animation.changeTimeScale;
Celestiary.prototype.invertTimeScale = Animation.invertTimeScale;


module.exports = Celestiary;
