'use strict';
// TODO(pablo): change to renderer.js?

var targetLoc = new THREE.Matrix4;
var clock = new THREE.Clock();

function renderLoop(renderer, scene, camera, controls) {
  render(renderer, scene, camera, controls);
  requestAnimationFrame(function() {
      renderLoop(renderer, scene, camera, controls);
    });
}

function render(renderer, scene, camera, controls) {
  var curTime = clock.getElapsedTime();
  curTime = 0;
  animateSystem(scene, curTime);
  if (scene.targetNode) {
    updateView(scene.targetNode, camera);
    scene.targetNode = null;
  }
  renderer.clear();
  renderer.render(scene, camera);
  if (controls)
    controls.update(clock.getDelta());
}

// Recurisvely animate scene graph.
// TODO(pablo): switch to a generic scene visitor?
function animateSystem(system, time) {
  var twoPiTime = twoPi * time * timeScale;
  if (system.siderealRotationPeriod) {
    system.rotation.y = twoPiTime / system.siderealRotationPeriod;
  }
  if (system.orbitProps) {
    var eccentricity = system.orbitProps.eccentricity;
    var aRadius = system.orbitProps.semiMajorAxis * orbitScale;
    var bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0));
    var t = twoPiTime / system.orbitProps.siderealOrbitPeriod;
    system.position.set(aRadius * Math.cos(t),
                        0,
                        bRadius * Math.sin(t));
  }
  for (var ndx in system.children) {
    var child = system.children[ndx];
    animateSystem(child, time);
  }
}

// All system positions are relative to their parent's, so create a
// composite transform from the target (or actually it's
// orbitPosition) up through its parents to the scene root, which
// should be at 0,0,0.  Each step will have a vector and (?) rotation,
// so will have to learn matrix math to do this correctly.  With that
// in hand, same step-back logic should apply to that composite
// location.
function updateView(targetNode, camera) {
  if (!targetNode.orbitPosition.grid) {
    targetNode.orbitPosition.add(grid({stepSize: 1E4, color: 0x00ff00}));
    targetNode.orbitPosition.grid = true;
  }
  console.log('targetNode:');
  console.log(targetNode);

  console.log('camera:');
  console.log(camera);

  var targetPos = targetNode.orbitPosition.position;
  console.log('targetPos:');
  console.log(targetPos);

  var sumTrans = new THREE.Vector3;
  var last = targetNode;
  var cur = targetNode.parent;
  while (cur) {
    sumTrans.add(cur.position);
    cur.add(line(last, cur));
    last = cur;
    cur = cur.parent;
  }

  camera.lookAt(targetPos);

  // Then move camera back outside of target.
  var tStepBack = targetPos.clone();
  tStepBack.negate();
  // TODO(pablo): if the target is at the origin (i.e. the sun),
  // need some non-zero basis to use as a step-back.
  if (tStepBack.isZero()) {
    tStepBack.set(0,0,1);
  }
  var radius = targetNode.props.radius;
  if (targetNode.props.type == 'star') {
    radius = Measure.parseMeasure(targetNode.props.radius).scalar;
  }
  tStepBack.setLength(radius * orbitScale * 10.0);
  targetPos.addSelf(tStepBack);
  camera.position.set(targetPos.x, targetPos.y, targetPos.z);
  camera.lookAt(targetPos);
}
