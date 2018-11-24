'use strict';

const THREE = require('three');
const Animation = require('./animation.js');
const Shared = require('./shared.js');
const stars = require('./t-1000.js');
const Material = require('./material.js');
const Shapes = require('./shapes.js');

const
  lengthScale = Shared.lengthScale,
  atmosScale = 1.01,
  stepBackMult = 10;

const Scene = function(threeUi) {
  this.ui = threeUi;
  this.sceneNodes = {};
  this.orbitShapes = {};
  this.debugShapes = [];
  this.orbitsVisible = true;
  this.debugVisible = true;
  this.lastAddTime = 0;
};


/**
 * Add an object to the scene.
 * @param {!object} props object properties, must include type.
 */
Scene.prototype.add = function(props) {

  // Find a parent or add directly to scene.  TODO(pablo): this is
  // ugly, since this is the only way the scene goes live.
  let parentNode = this.sceneNodes[props.parent];
  if (!parentNode) {
    parentNode = this.ui.scene;
    if (props.name != 'milky_way') {
      console.log(`No parent for ${props.name}, adding to root scene`);
    }
  }

  let obj;
  if (props.type == 'galaxy') {
    // TODO(pablo): a nice galaxy.
    obj = new THREE.Object3D;
    obj.orbitPosition = obj;
  } else if (props.type == 'stars') {
    obj = this.newStars(props);
  } else if (props.type == 'star') {
    obj = this.newStar(props);
    obj.add(this.newPointLight());
    // step back from the sun.
    this.ui.camera.position.set(
        0, 0, props.radius.scalar * lengthScale * stepBackMult);
  } else if (props.type == 'planet' || props.type == 'moon') {
    obj = this.newOrbitingPlanet(props);
  } else {
    throw new Error('Adding object of unknown type: ' + props.type);
  }

  // Add to scene in reference frame of parent's orbit position,
  // i.e. moons orbit planets, so they have to be added to the
  // planet's orbital center.
  if (parentNode.orbitPosition) {
    parentNode.orbitPosition.add(obj);
  } else {
    // Should only happen for milkyway.
    if (props.name != 'milky_way') {
      console.log('Parent has no orbit position: ' + props.name);
    }
    parentNode.add(obj);
  }

  obj['props'] = props;
  this.sceneNodes[props.name] = obj;
  this.lastAddTime = Animation.clocks.sysTime;
};


Scene.prototype.select = function(name) {
  const node = this.sceneNodes[name];
  if (!node) {
    // TODO(pablo): this is a race on initial load.  The target is
    // selected before it's loaded, but the deferred select does work,
    // so not critical for now.
    console.log('scene#checkedSelect: initial load race');
    return;
  }
  if (!node.orbitPosition) {
    throw new Error('No orbit position for target of select: ' + name)
  }
  console.log(`scene#checkedSelect: ${node.props.name}`);
  Shared.targetNode = node;
};


Scene.prototype.lookAtCurrentTarget = function() {
  if (!Shared.targetNode) {
    console.error('scene.js#lookAtTarget: no target node to look at.');
    return;
  }
  Shared.targetPos = Shared.targetNode.orbitPosition.position;
  console.log('targetPos: ', Shared.targetPos);
  this.ui.camera.lookAt(Shared.targetPos);
  // this.ui.controls.target = Shared.targetNode.orbitPosition;
};


Scene.prototype.lookAtNamed = function(name) {
  this.select(name);
  this.lookAtCurrentTarget();
};


Scene.prototype.goTo = function() {
  if (!Shared.targetNode) {
    console.error('Scene.goTo called with no target node.');
    return;
  }
  const node = Shared.targetNode;
  console.log('goto: ' + node.props.name);
  if (this.lastAddTime == Animation.clocks.sysTime) {
    Animation.postRenderCb = () => {
      setTimeout('global.select("' + node.props.name + '")', 10);
    };
    return;
  }
  const targetPos = node.orbitPosition.position;
  const camPos = targetPos.clone().negate().setScalar(node.props.radius.scalar * lengthScale * 2);
  console.log('camPos: ', camPos);
  node.orbitPosition.add(this.ui.camera);
  //this.ui.camera.position.copy(camPos);
  //this.ui.camera.target = 

  // Change control sensitivity depending on object size.
  if (node.props.type == 'star') {
    this.ui.controls.rotateSpeed = 1;
    this.ui.controls.zoomSpeed = 1;
    this.ui.controls.panSpeed = 1;
  } else {
    this.ui.controls.rotateSpeed = 0.001;
    this.ui.controls.zoomSpeed = 0.001;
    this.ui.controls.panSpeed = 0.001;
  }

  console.log('goto: done');
};


/** The stars from the data file. */
Scene.prototype.starGeom = function(stars) {
  const geom = new THREE.Geometry();
  // The sun first.
  geom.vertices.push(new THREE.Vector3);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const ra = s[0] * Shared.toDeg; // TODO: why not toRad?
    const dec = s[1] * Shared.toDeg;
    const dist = s[2] * 1e3; // convert from kilometer to meter.
    const vec = new THREE.Vector3(dist * Math.sin(ra) * Math.cos(dec),
                                  dist * Math.sin(ra) * Math.sin(dec),
                                  dist * Math.cos(ra));
    geom.vertices.push(vec);
  }
  return geom;
};


Scene.prototype.newStars = function(props) {
  const geom = this.starGeom(stars);
  const orbitPlane = new THREE.Object3D;
  const orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  const starImage = Material.pathTexture('star_glow', '.png');
  // Not sure why need the 10x multiple, but otherwise they're too small.
  const avgStarRadius = props.radius.scalar * 1e1;
  const starMiniMaterial =
    new THREE.PointsMaterial({ size: avgStarRadius,
			       map: starImage,
			       blending: THREE.AdditiveBlending,
			       depthTest: true,
                               depthWrite: false,
                               transparent: true });
  const starPoints = new THREE.Points(geom, starMiniMaterial);
  starPoints.sortParticles = true;
  orbitPosition.add(starPoints);
  orbitPlane.orbitPosition = orbitPosition;
  orbitPlane.scale.setScalar(lengthScale);
  return orbitPlane;
};


Scene.prototype.newPlanetStars = function(geom, props) {
  const orbitPlane = new THREE.Object3D;
  const orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  const planetStarMiniMaterial =
    new THREE.PointsMaterial({ color: 0xffffff,
                               size: 3,
                               sizeAttenuation: false,
                               depthTest: true,
                               transparent: false });

  const planetStarPoints = new THREE.Points(geom, planetStarMiniMaterial);
  planetStarPoints.sortParticles = true;
  orbitPosition.add(planetStarPoints);
  orbitPlane.orbitPosition = orbitPosition;
  return orbitPlane;
};


Scene.prototype.newPointLight = function() {
  return new THREE.PointLight(0xffffff);
};


Scene.prototype.newStar = function(props) {
  const orbitPlane = new THREE.Object3D;
  const orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);
  const matr = new THREE.MeshBasicMaterial({
    map: Material.pathTexture('sun'),
    blending: THREE.AdditiveBlending,
  });
  const star = Shapes.sphere({
      radius: 1,
      matr: props.matr || matr
    });
  orbitPosition.add(star);
  orbitPlane.orbitPosition = orbitPosition;
  orbitPlane.scale.setScalar(props.radius.scalar * lengthScale);
  return orbitPlane;
};


Scene.prototype.toggleOrbits = function() {
  this.orbitsVisible = !this.orbitsVisible;
  for (let i in this.orbitShapes) {
    const shape = this.orbitShapes[i];
    if (shape.hasOwnProperty('visible')) {
      this.orbitShapes[i].visible = this.orbitsVisible;
    }
  }
};


Scene.prototype.toggleDebug = function() {
  this.debugVisible = !this.debugVisible;
  for (let i = 0; i < this.debugShapes.length; i++) {
    this.debugShapes[i].visible = this.debugVisible;
  }
};


/**
 * A new planet at its place in orbit.
 * https://en.wikipedia.org/wiki/Orbital_elements
 * https://en.wikipedia.org/wiki/Equinox#Celestial_coordinate_systems
 * https://en.wikipedia.org/wiki/Epoch_(astronomy)#Julian_years_and_J2000
 */
Scene.prototype.newOrbitingPlanet = function(planetProps) {
  const name = planetProps.name;
  const referencePlane = new THREE.Object3D;

  const orbit = planetProps.orbit;

  const orbitPlane = new THREE.Object3D;
  orbitPlane.name = name + '.orbitPlane';
  referencePlane.add(orbitPlane);

  const orbitShape = this.newOrbit(orbit);
  orbitShape.scale.multiplyScalar(lengthScale);
  orbitPlane.add(orbitShape);
  orbitShape.visible = this.orbitsVisible;
  this.orbitShapes[name] = orbitShape;

  orbitPlane.rotation.x = orbit.inclination * Shared.toRad;
  orbitPlane.rotation.y = orbit.longitudeOfPerihelion * Shared.toRad;

  const orbitPosition = new THREE.Object3D;
  orbitPosition.name = name + '.orbitPosition';
  orbitPlane.add(orbitPosition);

  // Attaching this property triggers orbit of planet during animation.
  // See animation.js#animateSystem.
  orbitPosition.orbit = planetProps.orbit;

  const planetTilt = new THREE.Object3D;
  orbitPosition.add(planetTilt);
  planetTilt.rotateZ(planetProps.axialInclination * Shared.toRad);

  const planet = this.newPlanet(planetProps);
  planet.scale.multiplyScalar(lengthScale);
  planetTilt.add(planet);
  orbitPosition.add(Shapes.point());

  // referencePlane.rotation.y = orbit.longitudeOfAscendingNode * Shared.toRad;
  // Children centered at this planet's orbit position.
  referencePlane.orbitPosition = orbitPosition;

  return referencePlane;
};


Scene.prototype.newPlanet = function(planetProps) {
  const planet = new THREE.Object3D;
  const planetName = planetProps.name;
  planet.props = planetProps;
  planet.name =  planetName + '.planetGroup';

  const axes = new THREE.AxesHelper(2);
  axes.visible = true;
  this.debugShapes.push(axes);
  planet.add(axes);

  const planetSurface = this.newSurface(planetProps);
  planetSurface.name = planetName + '.surface';
  planet.add(planetSurface);

  if (planetProps.texture_atmosphere) {
    const atmos = this.newAtmosphere(planetProps);
    atmos.name = planetName + '.atmosphere';
    planet.add(atmos);
  }

  // Attaching this property triggers rotation of planet during animation.
  planet.siderealRotationPeriod = planetProps.siderealRotationPeriod;

  planet.scale.setScalar(planetProps.radius.scalar);
  return planet;
};


// TODO(pablo): get shaders working again.
Scene.prototype.newSurface = function(planetProps) {
  let planetMaterial;
  if (!(planetProps.texture_hydrosphere || planetProps.texture_terrain)) {
    planetMaterial = Material.cacheMaterial(planetProps.name);
    planetMaterial.shininess = 30;
  } else if (planetProps.texture_hydrosphere || planetProps.texture_terrain) {
    planetMaterial = Material.cacheMaterial(planetProps.name);
    planetMaterial.shininess = 30;
    if (planetProps.texture_terrain) {
      planetMaterial.bumpMap = Material.pathTexture(planetProps.name + "_terrain");
      planetMaterial.bumpScale = 0.001;
    }
    if (planetProps.texture_hydrosphere) {
      const hydroTex = Material.pathTexture(planetProps.name + "_hydro");
      planetMaterial.specularMap = hydroTex;
      planetMaterial.shininess = 50;
    }
  }
  return Shapes.sphere({matr: planetMaterial});
};


Scene.prototype.newAtmosphere = function(planetProps) {
  // TODO: https://threejs.org/examples/webgl_shaders_sky.html
  const atmosTex = Material.pathTexture(planetProps.name, '_atmos.jpg');
  return Shapes.sphere({
      radius: atmosScale, // assumes radius of planet is 1.
      matr: new THREE.MeshPhongMaterial({
          color: 0xffffff,
          alphaMap: atmosTex,
          transparent: true,
          specularMap: atmosTex,
          shininess: 100
        })
    });
};


Scene.prototype.newOrbit = function(orbit) {
  const shape = new THREE.Object3D();
  // https://en.wikipedia.org/wiki/Semi-major_and_semi-minor_axes
  const a = 1;
  const e = orbit.eccentricity;
  // Semi-minor axis.
  const b = a * Math.sqrt(1 - Math.pow(e, 2));
  // TODO, API docs say 3rd and 4th args should be a, b, but it
  // appears eccentricity is used instead.
  const ellipseCurve = new THREE.EllipseCurve(0, 0,
                                              a, e,
                                              0, Math.PI);
  const ellipsePoints = ellipseCurve.getPoints(1000);
  const ellipseGeometry = new THREE.BufferGeometry().setFromPoints(ellipsePoints);
  const orbitMaterial = new THREE.LineBasicMaterial({
      color: 0x0000ff,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: false
    });
  const pathShape = new THREE.Line(ellipseGeometry, orbitMaterial);
  // Orbit is in the x/y plane, so rotate it around x by 90 deg to put
  // it in the x/z plane (top comes towards camera until it's flat
  // edge on).
  pathShape.rotation.x = Shared.halfPi;
  shape.add(pathShape);
  shape.add(Shapes.line(1, 0, 0));
  shape.scale.multiplyScalar(orbit.semiMajorAxis);
  return shape;
};


module.exports = Scene;
