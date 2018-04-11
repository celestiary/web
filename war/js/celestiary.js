'use strict';

const THREE = require('three');
const Animation = require('./animation.js');
const ThreeUi = require('./three_ui.js');
const Controller = require('./controller.js');
const Scene = require('./scene.js');

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
function Celestiary(canvasContainer, dateElt) {
  this.dateElt = dateElt;
  const postAnimationCb = () => {
      this.updateUi();
  };
  const updateViewCb = (camera, scene) => {
      Animation.updateView(camera, scene);
  };
  this.threeUi = new ThreeUi(
      canvasContainer, Animation.animation, postAnimationCb, updateViewCb);
  this.scene = new Scene(this.threeUi, updateViewCb);
  this.ctrl = new Controller(this.scene);
  window.addEventListener(
      'hashchange',
      (e) => {
        this.ctrl.loadPath((location.hash || '#').substring(1));
      },
      false);

  window.addEventListener(
      'keypress',
      (e) => {
        switch (e.which) {
          // 'o'
        case 111: this.ctrl.scene.toggleOrbits(); break;
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
Celestiary.prototype.changeTimeScale = Animation.changeTimeScale;
Celestiary.prototype.invertTimeScale = Animation.invertTimeScale;


module.exports = Celestiary;
