'use strict';

const THREE = require('three');
const Animation = require('./animation.js');
const Measure = require('./measure.js');
const Shared = require('./shared.js');
const stars = require('./t-1000.js');
const Material = require('./material.js');
const Shapes = require('./Shapes.js');

const RADIUS_SCALE_NORMAL = 1E-7;
const RADIUS_SCALE_BIG = 1E-4;

const
  radiusScale = RADIUS_SCALE_NORMAL,
  atmosScale = radiusScale * 1.005,
  atmosUpperScale = atmosScale;

const Scene = function(threeUi, updateViewCb) {
  this.threeUi = threeUi;
  this.updateViewCb = updateViewCb;
  this.sceneNodes = {};
  this.orbitShapes = [];
  this.orbitsVisible = true;
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
    parentNode = this.threeUi.scene;
  }

  let obj;
  if (props.type == 'galaxy') {
    // TODO(pablo): a nice galaxy.
    obj = new THREE.Object3D;
    obj.orbitPosition = obj;
  } else if (props.type == 'stars') {
    obj = this.newStars(this.starGeom(stars), props);
  } else if (props.type == 'star') {
    obj = this.newStar(props);
    obj.add(this.newPointLight());
    // step back from the sun.
    this.threeUi.camera.position.set(
        0, 0, Measure.parse(props.radius).scalar * radiusScale * 10.0);
  } else if (props.type == 'planet') {
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
    if (!(props.name == 'milky_way')) {
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
    return;
  }
  if (!node.orbitPosition) {
    throw new Error('No orbit position for target of select: ' + name)
  }
  Shared.targetObj = node.orbitPosition;

  if (this.lastAddTime == Animation.clocks.sysTime) {
    Animation.postRenderCb = () => {
      setTimeout('global.select("' + name + '")', 10);
    };
    return;
  }

  this.updateViewCb(this.threeUi.camera, this.threeRoot);
  const tStepBack = Shared.targetPos.clone();
  tStepBack.negate();
  // TODO(pablo): if the target is at the origin (i.e. the sun),
  // need some non-zero basis to use as a step-back.
  if (tStepBack.x == 0 && tStepBack.y == 0) {
    tStepBack.set(0,0,1);
  }
  let radius = node.props.radius;
  if (node.props.type == 'star') {
    radius = Measure.parse(node.props.radius).scalar;
    this.threeUi.controls.rotateSpeed = 1;
    this.threeUi.controls.zoomSpeed = 1;
    this.threeUi.controls.panSpeed = 1;
  } else {
    this.threeUi.controls.rotateSpeed = 0.001;
    this.threeUi.controls.zoomSpeed = 0.001;
    this.threeUi.controls.panSpeed = 0.001;
  }
  tStepBack.setLength(radius * Shared.orbitScale * 10.0);
  Shared.targetPos.add(tStepBack);
  this.threeUi.camera.position.set(
      Shared.targetPos.x, Shared.targetPos.y, Shared.targetPos.z);
};


/** The stars from the data file. */
Scene.prototype.starGeom = function(stars) {
  const geom = new THREE.Geometry();

  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const ra = s[0] * Shared.toDeg; // why not toRad?
    const dec = s[1] * Shared.toDeg;
    const dist = s[2] * Shared.orbitScale;
    const vec = new THREE.Vector3(dist * Math.sin(ra) * Math.cos(dec),
                                dist * Math.sin(ra) * Math.sin(dec),
                                dist * Math.cos(ra));
    geom.vertices.push(vec);
  }
  return geom;
};


Scene.prototype.newStars = function(geom, props) {
  const orbitPlane = new THREE.Object3D;
  const orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  const starImage = Material.pathTexture('star_glow', '.png');
  const starMiniMaterial =
    new THREE.PointsMaterial({ color: 0xffffff,
                               size: radiusScale * props.radius * 5E5,
			       map: starImage,
			       sizeAttenuation: true,
			       blending: THREE.AdditiveBlending,
			       depthTest: true,
			       transparent: true });

  const starPoints = new THREE.Points(geom, starMiniMaterial);
  starPoints.sortParticles = true;
  orbitPosition.add(starPoints);
  orbitPlane.orbitPosition = orbitPosition;

  // A special one for the Sun. TODO(pmy): replace w/shader.
  const sunSpriteMaterial =
    new THREE.PointsMaterial({ color: 0xffffff,
                               size: radiusScale * props.radius * 5E2,
                               map: starImage,
                               sizeAttenuation: true,
                               blending: THREE.AdditiveBlending,
                               depthTest: true,
                               transparent: true });
  orbitPosition.add(new THREE.Points(this.starGeom([[0,0,0]]), sunSpriteMaterial));
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
  // Can't do a x-platform star yet.. sprites don't size up equally on
  // all screens and don't know how to do a billboard otherwise, so
  // just leave this as placeholder.  Particle system above does that
  // actual rendering.
  //orbitPosition.add(new THREE.Object3D);
  const matr = {
    map: Material.pathTexture('sun'),
    blending: THREE.AdditiveBlending,
  };
  const star = Shapes.sphere({'radius': 20, 'matr': matr});
  orbitPosition.add(star);
  orbitPlane.orbitPosition = orbitPosition;
  return orbitPlane;
};


Scene.prototype.toggleOrbits = function() {
  this.orbitsVisible = !this.orbitsVisible;
  for (let i = 0; i < this.orbitShapes.length; i++) {
    this.orbitShapes[i].visible = this.orbitsVisible;
  }
};


Scene.prototype.newOrbitingPlanet = function(planetProps) {
  const orbit = planetProps.orbit;

  const orbitPlane = new THREE.Object3D;
  const orbitShape = this.newOrbit(orbit);
  this.orbitShapes.push(orbitShape);
  orbitPlane.add(orbitShape);

  orbitPlane.rotation.x = orbit.inclination * Shared.toRad;
  orbitPlane.rotation.y = orbit.longitudeOfPerihelion * Shared.toRad;

  //orbitPlane.add(Shapes.line(new THREE.Vector3(0, 0, 0),
  //    new THREE.Vector3(orbit.semiMajorAxis * Shared.orbitScale, 0, 0)));

  const orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  // Attaching this property triggers orbit of planet during animation.
  // See animation.js#animateSystem.
  orbitPosition.orbit = planetProps.orbit;

  const planet = this.newPlanet(planetProps);
  orbitPosition.add(planet);
  orbitPosition.add(Shapes.point());

  const referencePlane = new THREE.Object3D;
  referencePlane.add(orbitPlane);
  referencePlane.rotation.y = orbit.longitudeOfAscendingNode * Shared.toRad;
  // Children centered at this planet's orbit position.
  referencePlane.orbitPosition = orbitPosition;

  return referencePlane;
};


Scene.prototype.newPlanet = function(planetProps) {
  const planet = new THREE.Object3D;
  // TODO(pablo): put these in near LOD only.
  if (planetProps.texture_atmosphere) {
    planet.add(this.newAtmosphere(planetProps));
  }

  // TODO(pablo): if underlying planet is a BasicMeshMaterial, order
  // matters and surface has to go after atmosphere; adding surface
  // before atmosphere causes failure of atmosphere display.  No idea
  // why.  This is not currently the case, but this appears to be
  // idemopotent given then current config, so leaving it this way.
  planet.add(this.newSurface(planetProps));

  // Tilt could be set in orbit configuration, but for the moment
  // seems more intrinsic.
  planet.rotation.z = planetProps.axialInclination * Shared.toRad;
  //planet.rotation.x += planetProps.axialInclination * Shared.toDeg;

  // Attaching this property triggers rotation of planet during animation.
  planet.siderealRotationPeriod = planetProps.siderealRotationPeriod;

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
  return Shapes.lodSphere(planetProps.radius * radiusScale, planetMaterial);
};

Scene.prototype.newAtmosphere = function(planetProps) {
  const atmosTex = Material.pathTexture(planetProps.name, '_atmos.jpg');
  const mat =
    new THREE.MeshPhongMaterial({color: 0xffffff,
				 alphaMap: atmosTex,
                                 transparent: true,
				 specularMap: atmosTex,
				 shininess: 100
				 });
  return Shapes.lodSphere(planetProps.radius * atmosScale, mat);
};


Scene.prototype.newOrbit = function(orbit) {
  const ellipseCurve = new THREE.EllipseCurve(0, 0,
                                            orbit.semiMajorAxis * Shared.orbitScale,
                                            orbit.eccentricity,
                                            0, 2.0 * Math.PI,
                                            false);
  //const ellipseCurvePath = new THREE.CurvePath();
  //ellipseCurvePath.add(ellipseCurve);
  //const ellipseGeometry = ellipseCurvePath.createPointsGeometry(100);
  const ellipsePoints = ellipseCurve.getPoints(100);
  const ellipseGeometry = new THREE.BufferGeometry().setFromPoints(ellipsePoints);
  const orbitMaterial = new THREE.LineBasicMaterial({
      color: 0x0000ff,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: false
    });
  
  const line = new THREE.Line(ellipseGeometry, orbitMaterial);
  line.rotation.x = Shared.halfPi;

  // Orbits may be turned off when this orbit is added, so set it to
  // current visibility.
  line.visible = this.orbitsVisible;
  return line;
};


module.exports = Scene;
