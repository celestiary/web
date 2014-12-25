'use strict';

var Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Time scale is applied to wall-clock time, so that by a larger time
 * scale will speed things up, 0 will be normal time, negative
 * backwards.
 */
var timeScale = 1;

/**
 * Controlled by UI clicks.. timeScale is basically 2^steps.
 */
var timeScaleSteps = 0;

var time = Date.now();
var lastTime = time;
var dt = time - lastTime;
var simTime = time;
var simTimeSecs = simTime / 1000;
var date = new Date(simTime);
var postRenderCb = null;

function animation(scene) {
  animateSystem(scene);
  updateView(scene);
  if (postRenderCb) {
    postRenderCb();
    postRenderCb = null;
  }
}

/**
 * @param delta -1, 0 or 1 for slower, reset or faster.
 */
function changeTimeScale(delta) {
  if (delta == 0) {
    timeScaleSteps = 0;
  } else {
    timeScaleSteps += delta;
  }
  timeScale = (timeScale < 0 ? -1 : 1) * Math.pow(2, Math.abs(timeScaleSteps));
  updateTimeMsg();
}

function updateTimeMsg() {
  var timeScaleElt = document.getElementById('timeScale');
  var msg = '';
  if (timeScaleSteps != 0) {
    msg = '(@ ' + timeScale + ' secs/s)';
  }
  timeScaleElt.innerHTML = msg;
}

function invertTimeScale() {
  timeScale *= -1.0;
  updateTimeMsg();
}

/**
 * Recursive animation of orbits and rotations at the current time.
 */
function animateSystem(system) {
  lastTime = time;
  time = Date.now();
  dt = time - lastTime;
  simTime += dt * timeScale;
  simTimeSecs = simTime / 1000;

  if (system.siderealRotationPeriod) {
    // TODO(pablo): this is hand-calibrated for Earth and so is
    // incorrect for the other planets.  Earth Orientation Parameters
    // are here:
    //
    //   http://hpiers.obspm.fr/eop-pc/index.php?index=orientation
    // 
    // and also would also need them for the other planets.
    var angle = 1.5 * Math.PI + simTimeSecs / 86400 * twoPi;
    system.setRotationFromAxisAngle(Y_AXIS, angle);
  }

  // This is referred to by a comment in scene.js#addOrbitingPlanet.
  if (system.orbit) {
    var eccentricity = system.orbit.eccentricity;
    var aRadius = system.orbit.semiMajorAxis * orbitScale;
    var bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0));
    // -1.0 because orbits are counter-clockwise when viewed from above North of Earth.
    var angle = -1.0 * simTimeSecs / system.orbit.siderealOrbitPeriod * twoPi;
    var x = aRadius * Math.cos(angle);
    var y = 0;
    var z = bRadius * Math.sin(angle);
    system.position.set(x, y, z);
    //system.particle.set(x, y, z);
    // if (system.orbit.siderealOrbitPeriod == 31536000) {
    //   console.log('earth angle: ' + angle);
    // }
  }

  for (var ndx in system.children) {
    var child = system.children[ndx];
    animateSystem(child);
  }
}

function updateView() {
  if (targetObj) {
    targetObjLoc.identity();
    var curObj = targetObj;
    var objs = []; // TODO(pablo)
    while (curObj.parent != scene) {
      objs.push(curObj);
      curObj = curObj.parent;
    }
    for (var i = objs.length - 1; i >= 0; i--) {
      var o = objs[i];
      targetObjLoc.multiply(o.matrix);
    }
    targetPos.setFromMatrixPosition(targetObjLoc);
    camera.lookAt(targetPos);
  }
}
