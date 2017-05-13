var targetPos = new THREE.Vector3();
var targetObj = null;
var targetObjLoc = new THREE.Matrix4;
var date = new Date();
var ctrl;

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
  // TODO(pablo): hack to move camera from global to local.
  var animationCb = animation;
  // TODO(pablo): add back clock update.
  var postAnimationCb = function() {};
  var threeUi = new ThreeUi(canvasContainer, animationCb, postAnimationCb);
  this.scene = new Scene(threeUi);
  this.ctrl = new Controller(this.scene);
  ctrl = this.ctrl;
  var me = this;
  window.addEventListener(
      'hashchange',
      function(e) {
        me.ctrl.loadPath((location.hash || '#').substring(1));
      },
      false);

  window.addEventListener(
      'keypress',
      function(e) {
        switch (e.which) {
          // 'o'
        case 111: me.ctrl.scene.toggleOrbits(); break;
        }
      },
      true);

  this.ctrl.loadPath('milkyway');
  this.ctrl.loadPath(location.hash ? location.hash.substring(1) : '');
}


/** Callback to update the HTML date element with the current time. */
Celestiary.prototype.updateUi = function(dateElt) {
  var lastUiUpdateTime = 0;
  if (time > lastUiUpdateTime + 1000) {
    lastUiUpdateTime = time;
    dateElt.innerHTML = new Date(simTime) + '';
  }
};
