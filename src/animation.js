import * as THREE from './lib/three.module.js';
import * as Shared from './shared.js';

let Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Time scale is applied to wall-clock time, so that by a larger time
 * scale will speed things up, 0 will be normal time, negative
 * backwards.
 */
let timeScale = 1;

/** Controlled by UI clicks.. timeScale is basically 2^steps. */
let timeScaleSteps = 0;

let shaderUpdateCb = null;

let preAnimCbs = {};

const clock = new THREE.Clock();
clock.start();
const startTime = clock.startTime;
const time = {
  sysTime: startTime,
  simTime: startTime * timeScale,
  simTimeDelta: 0,
  simTimeSecs: startTime / 1000.0
}


/** @exported */
function invertTimeScale() {
  timeScale *= -1.0;
  updateTimeMsg();
}


function updateTime() {
  const cDelta = clock.getDelta();
  time.sysTime = startTime + clock.elapsedTime;
  //console.log(time.sysTime);
  time.simTime = time.sysTime * timeScale;
  time.simTimeDelta = cDelta * timeScale;
  time.simTimeElapsed = clock.elapsedTime * timeScale;
  time.simTimeSecs = time.simTime / 1000;
  //console.log(`cDelta: ${cDelta}, sysTime: ${time.sysTime}, simTime: ${time.simTime}`
  //    + `simTimeDelta: ${time.simTimeDelta}, simTimeElapsed: ${time.simTimeElapsed}, `
  //    + `simTimeSecs: ${time.simTimeSecs}`);
}


function addPreAnimCb(cb) {
  let key = {};
  preAnimCbs[key] = cb;
  return key;
}


function removePreAnimCb(key) {
  delete preAnimCbs[key];
}


/** @exported */
function animation(scene) {
  updateTime();
  animateSystem(scene, time.simTimeSecs);
  for (let i in preAnimCbs) {
    let preAnimCb = preAnimCbs[i];
    preAnimCb(time.simTime);
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


// TODO: move this to scene.
/** Recursive animation of orbits and rotations at the current time. */
function animateSystem(system, simTimeSecs) {
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
    const aRadius = system.orbit.semiMajorAxis * Shared.lengthScale;
    const bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0));
    // -1.0 because orbits are counter-clockwise when viewed from above North of Earth.
    const angle = -1.0 * simTimeSecs / system.orbit.siderealOrbitPeriod * Shared.twoPi;
    const x = aRadius * Math.cos(angle);
    const y = 0;
    const z = bRadius * Math.sin(angle);
    //console.log(`${eccentricity} ${aRadius} ${bRadius} ${simTimeSecs} ${system.orbit.siderealOrbitPeriod}`);
    system.position.set(x, y, z);
    if (system.postAnimCb) {
      system.postAnimCb(system);
    }
  }

  for (const ndx in system.children) {
    const child = system.children[ndx];
    animateSystem(child, simTimeSecs);
  }
}

function setShaderUpdateCallback(cb) {
  shaderUpdateCb = cb;
}

function getShaderUpdateCallback() {
  return shaderUpdateCb;
}

export {
  addPreAnimCb,
  animation,
  clock,
  changeTimeScale,
  getShaderUpdateCallback,
  invertTimeScale,
  removePreAnimCb,
  setShaderUpdateCallback,
  time,
  updateTime
};
