'use strict';

var RADIUS_SCALE_NORMAL = 1E-7;
var RADIUS_SCALE_BIG = 1E-4;
var ORBIT_SCALE_NORMAL = 1E-7;

var
  radiusScale = RADIUS_SCALE_NORMAL,
  atmosScale = radiusScale * 1.005,
  atmosUpperScale = atmosScale,
  orbitScale = ORBIT_SCALE_NORMAL;

var globe;
var starImage, starGlowMaterial;

var Scene = function() {
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
  var parentNode = this.sceneNodes[props.parent];
  if (!parentNode) {
    parentNode = scene;
  }

  var obj;
  if (props.type == 'galaxy') {
    // TODO(pablo): a nice galaxy.
    obj = new THREE.Object3D;
    obj.orbitPosition = obj;
  } else if (props.type == 'stars') {
    obj = this.newStars(this.starGeom(stars), props);
  } else if (props.type == 'star') {
    obj = this.newStar(props);
    obj.add(this.newPointLight());
    camera.position.set(0, 0, Measure.parseMeasure(props.radius).scalar * radiusScale * 1E3);
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

  this.lastAddTime = time;
};

Scene.prototype.select = function(name) {
  var node = this.sceneNodes[name];
  if (!node) {
    // TODO(pablo): this is a race on initial load.  The target is
    // selected before it's loaded, but the deferred select does work,
    // so not critical for now.
    return;
  }
  if (!node.orbitPosition) {
    throw new Error('No orbit position for target of select: ' + name)
  }
  targetObj = node.orbitPosition;

  if (this.lastAddTime == time) {
    var me = this;
    postRenderCb = function() {
      // TODO(pmy):
      //me.select(name);
      setTimeout('ctrl.scene.select("'+name+'")', 10);
    };
    return;
  }

  targetObjLoc.identity();
  var curObj = targetObj;
  var objs = [];
  while (curObj.parent != scene) {
    objs.push(curObj);
    curObj = curObj.parent;
  }
  for (var i = objs.length - 1; i >= 0; i--) {
    var o = objs[i];
    targetObjLoc.multiply(o.matrix);
  }

  targetPos.setFromMatrixPosition(targetObjLoc);
  var tStepBack = targetPos.clone();
  tStepBack.negate();
  // TODO(pablo): if the target is at the origin (i.e. the sun),
  // need some non-zero basis to use as a step-back.
  if (tStepBack.x == 0 && tStepBack.y == 0) {
    tStepBack.set(0,0,1);
  }
  var radius = node.props.radius;
  if (node.props.type == 'star') {
    radius = Measure.parseMeasure(node.props.radius).scalar;
    controls.rotateSpeed = 1;
    controls.zoomSpeed = 1;
    controls.panSpeed = 1;
  } else {
    controls.rotateSpeed = 0.001;
    controls.zoomSpeed = 0.001;
    controls.panSpeed = 0.001;
  }
  tStepBack.setLength(radius * orbitScale * 10.0);
  targetPos.add(tStepBack);
  camera.position.set(targetPos.x, targetPos.y, targetPos.z);
};

/** The stars from the data file. */
Scene.prototype.starGeom = function(stars) {
  var geom = new THREE.Geometry();

  for (var i = 0; i < stars.length; i++) {
    var s = stars[i];
    var ra = s[0] * toDeg; // why not toRad?
    var dec = s[1] * toDeg;
    var dist = s[2] * orbitScale;
    var vec = new THREE.Vector3(dist * Math.sin(ra) * Math.cos(dec),
                                dist * Math.sin(ra) * Math.sin(dec),
                                dist * Math.cos(ra));
    geom.vertices.push(vec);
  }
  return geom;
};

Scene.prototype.newStars = function(geom, props) {
  var orbitPlane = new THREE.Object3D;
  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  var starImage = pathTexture('star_glow', '.png');
  var starMiniMaterial =
    new THREE.PointCloudMaterial({ color: 0xffffff,
                                   size: radiusScale * props.radius * 5E5,
                                   map: starImage,
                                   sizeAttenuation: true,
                                   blending: THREE.AdditiveBlending,
                                   depthTest: true,
                                   transparent: true });

  var starPoints = new THREE.PointCloud(geom, starMiniMaterial);
  starPoints.sortParticles = true;
  orbitPosition.add(starPoints);
  orbitPlane.orbitPosition = orbitPosition;

  // A special one for the Sun. TODO(pmy): replace w/shader.
  var sunSpriteMaterial =
    new THREE.PointCloudMaterial({ color: 0xffffff,
                                   size: radiusScale * props.radius * 5E2,
                                   map: starImage,
                                   sizeAttenuation: true,
                                   blending: THREE.AdditiveBlending,
                                   depthTest: true,
                                   transparent: true });
  orbitPosition.add(new THREE.PointCloud(this.starGeom([[0,0,0]]), sunSpriteMaterial));
  return orbitPlane;
};

Scene.prototype.newPlanetStars = function(geom, props) {
  var orbitPlane = new THREE.Object3D;
  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  var planetStarMiniMaterial =
    new THREE.PointCloudMaterial({ color: 0xffffff,
                                   size: 3,
                                   sizeAttenuation: false,
                                   depthTest: true,
                                   transparent: false });

  var planetStarPoints = new THREE.PointCloud(geom, planetStarMiniMaterial);
  planetStarPoints.sortParticles = true;
  orbitPosition.add(planetStarPoints);
  orbitPlane.orbitPosition = orbitPosition;
  return orbitPlane;
};

Scene.prototype.newPointLight = function() {
  return new THREE.PointLight(0xffffff);
};

Scene.prototype.newStar = function(props) {
  var orbitPlane = new THREE.Object3D;
  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);
  // Can't do a x-platform star yet.. sprites don't size up equally on
  // all screens and don't know how to do a billboard otherwise, so
  // just leave this as placeholder.  Particle system above does that
  // actual rendering.
  //orbitPosition.add(new THREE.Object3D);
  var matr = {
    map: pathTexture('sun'),
    blending: THREE.AdditiveBlending,
  };
  var star = sphere({'radius': 20, 'matr': matr});
  orbitPosition.add(star);
  orbitPlane.orbitPosition = orbitPosition;
  return orbitPlane;
};

Scene.prototype.toggleOrbits = function() {
  this.orbitsVisible = !this.orbitsVisible;
  for (var i = 0; i < this.orbitShapes.length; i++) {
    this.orbitShapes[i].visible = this.orbitsVisible;
  }
};

Scene.prototype.newOrbitingPlanet = function(planetProps) {

  var orbit = planetProps.orbit;

  var orbitPlane = new THREE.Object3D;
  var orbitShape = this.newOrbit(orbit);
  this.orbitShapes.push(orbitShape);
  orbitPlane.add(orbitShape);

  orbitPlane.rotation.x = orbit.inclination * toRad;
  orbitPlane.rotation.y = orbit.longitudeOfPerihelion * toRad;

  //orbitPlane.add(line(new THREE.Vector3(0, 0, 0),
  //                    new THREE.Vector3(orbit.semiMajorAxis * orbitScale, 0, 0)));

  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  // Attaching this property triggers orbit of planet during animation.
  // See animation.js#animateSystem.
  orbitPosition.orbit = planetProps.orbit;

  var planet = this.newPlanet(planetProps);
  orbitPosition.add(planet);
  orbitPosition.add(point());

  var referencePlane = new THREE.Object3D;
  referencePlane.add(orbitPlane);
  referencePlane.rotation.y = orbit.longitudeOfAscendingNode * toRad;
  // Children centered at this planet's orbit position.
  referencePlane.orbitPosition = orbitPosition;

  return referencePlane;
};

Scene.prototype.newPlanet = function(planetProps) {
  var planet = new THREE.Object3D;
  // TODO(pablo): put these in near LOD only.
  if (planetProps.texture_atmosphere) {
    planet.add(this.newAtmosphere(planetProps));
    //planet.add(atmos(planetProps.radius * atmosUpperScale));
  }

  // TODO(pablo): if underlying planet is a BasicMeshMaterial, order
  // matters and surface has to go after atmosphere; adding surface
  // before atmosphere causes failure of atmosphere display.  No idea
  // why.  This is not currently the case, but this appears to be
  // idemopotent given then current config, so leaving it this way.
  planet.add(this.newSurface(planetProps));

  // Tilt could be set in orbit configuration, but for the moment
  // seems more intrinsic.
  planet.rotation.z = planetProps.axialInclination * toRad;
  //planet.rotation.x += planetProps.axialInclination * toDeg;

  // Attaching this property triggers rotation of planet during animation.
  planet.siderealRotationPeriod = planetProps.siderealRotationPeriod;

  return planet;
};

// TODO(pablo): get shaders working again.
Scene.prototype.newSurface = function(planetProps) {
  var planetMaterial;
  if (true || !(planetProps.texture_hydrosphere || planetProps.texture_terrain)) {
    planetMaterial = cacheMaterial(planetProps.name);
  } else {

    // Fancy planets.
    var shader = THREE.ShaderUtils.lib['normal'];
    var uniforms = THREE.UniformsUtils.clone(shader.uniforms);

    var tex = pathTexture(planetProps.name);
    uniforms['tDiffuse'].texture = tex;
    uniforms['enableAO'].value = false;
    uniforms['enableDiffuse'].value = true;
    uniforms['uDiffuseColor'].value.setHex(0xffffff);
    uniforms['uAmbientColor'].value.setHex(0x000000);
    uniforms['uShininess'].value = 100.0 * planetProps.albedo;
    uniforms['uDiffuseColor'].value.convertGammaToLinear();
    uniforms['uAmbientColor'].value.convertGammaToLinear();

    if (false && planetProps.texture_hydrosphere) {
      uniforms['enableSpecular'].value = true;
      uniforms['tSpecular'].texture = pathTexture(planetProps.name, '_hydro.jpg');
      uniforms['uSpecularColor'].value.setHex(0xffffff);
      uniforms['uSpecularColor'].value.convertGammaToLinear();
    }

    if (false && planetProps.texture_terrain) {
      uniforms['tNormal'].texture = pathTexture(planetProps.name, '_terrain.jpg');
      uniforms['uNormalScale'].value = 0.1;
    }

    planetMaterial = new THREE.ShaderMaterial({
        fragmentShader: shader.fragmentShader,
        vertexShader: shader.vertexShader,
        uniforms: uniforms,
        lights: true
      });
  }

  return lodSphere(planetProps.radius * radiusScale, planetMaterial);
};

Scene.prototype.newAtmosphere = function(planetProps) {
  var mat =
    new THREE.MeshLambertMaterial({color: 0xffffff,
                                   map: pathTexture(planetProps.name, '_atmos.png'),
                                   transparent: true});
  return lodSphere(planetProps.radius * atmosScale, mat);
};

Scene.prototype.newOrbit = function(orbit) {
  var ellipseCurve = new THREE.EllipseCurve(0, 0,
                                            orbit.semiMajorAxis * orbitScale,
                                            orbit.eccentricity,
                                            0, 2.0 * Math.PI,
                                            false);
  var ellipseCurvePath = new THREE.CurvePath();
  ellipseCurvePath.add(ellipseCurve);
  var ellipseGeometry = ellipseCurvePath.createPointsGeometry(100);
  ellipseGeometry.computeTangents();
  var orbitMaterial = new THREE.LineBasicMaterial({
      color: 0x0000ff,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: false
    });
  
  var line = new THREE.Line(ellipseGeometry, orbitMaterial);
  line.rotation.x = halfPi;

  // Orbits may be turned off when this orbit is added, so set it to
  // current visibility.
  line.visible = this.orbitsVisible;
  return line;
};
