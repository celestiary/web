const THREE = require('three');
const Shared = require('./shared.js');

let Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Time scale is applied to wall-clock time, so that by a larger time
 * scale will speed things up, 0 will be normal time, negative
 * backwards.
 */
let timeScale = 1;

/** Controlled by UI clicks.. timeScale is basically 2^steps. */
let timeScaleSteps = 0;

let lastSysTime = Date.now();

/** @exported */
const clocks = {
  sysTime: lastSysTime,
  simTime: lastSysTime,
};

/** @exported */
let postRenderCb = null;

let dt = clocks.sysTime - lastSysTime;
let simTimeSecs = clocks.simTime / 1000;


/** @exported */
function animation(scene, camera) {
  animateSystem(scene);
  updateView(camera, scene);
  if (postRenderCb) {
    postRenderCb();
    postRenderCb = null;
  }
}


/**
 * @param delta -1, 0 or 1 for slower, reset or faster.
 * @exported
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
  let msg = '';
  if (timeScaleSteps != 0) {
    msg = '(@ ' + timeScale + ' secs/s)';
  }
  document.getElementById('timeScale').innerHTML = msg;
}


/** @exported */
function invertTimeScale() {
  timeScale *= -1.0;
  updateTimeMsg();
}


/** Recursive animation of orbits and rotations at the current time. */
function animateSystem(system) {
  lastSysTime = clocks.sysTime;
  clocks.sysTime = Date.now();
  dt = clocks.sysTime - lastSysTime;
  clocks.simTime += dt * timeScale;
  simTimeSecs = clocks.simTime / 1000;

  if (system.siderealRotationPeriod) {
    // TODO(pablo): this is hand-calibrated for Earth and so is
    // incorrect for the other planets.  Earth Orientation Parameters
    // are here:
    //
    //   http://hpiers.obspm.fr/eop-pc/index.php?index=orientation
    // 
    // and also would also need them for the other planets.
    const angle = 1.5 * Math.PI + simTimeSecs / 86400 * Shared.twoPi;
    system.setRotationFromAxisAngle(Y_AXIS, angle);
  }

  // This is referred to by a comment in scene.js#addOrbitingPlanet.
  if (system.orbit) {
    const eccentricity = system.orbit.eccentricity;
    const aRadius = system.orbit.semiMajorAxis * Shared.orbitScale;
    const bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0));
    // -1.0 because orbits are counter-clockwise when viewed from above North of Earth.
    const angle = -1.0 * simTimeSecs / system.orbit.siderealOrbitPeriod * Shared.twoPi;
    const x = aRadius * Math.cos(angle);
    const y = 0;
    const z = bRadius * Math.sin(angle);
    system.position.set(x, y, z);
  }

  for (const ndx in system.children) {
    const child = system.children[ndx];
    animateSystem(child);
  }
}


function updateView(camera, scene) {
  if (Shared.targetObj) {
    Shared.targetObjLoc.identity();
    let curObj = Shared.targetObj;
    const objs = []; // TODO(pablo)
    while (curObj.parent && (curObj.parent != scene)) {
      objs.push(curObj);
      curObj = curObj.parent;
    }
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      Shared.targetObjLoc.multiply(o.matrix);
    }
    Shared.targetPos.setFromMatrixPosition(Shared.targetObjLoc);
    camera.lookAt(Shared.targetPos);
  }
}


module.exports = {
  animation: animation,
  updateView: updateView,
  clocks: clocks,
  postRenderCb: postRenderCb,
  changeTimeScale: changeTimeScale,
  invertTimeScale: invertTimeScale,
};
