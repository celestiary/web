'use strict';

var
  radiusScale = 1E-5,
  atmosScale = radiusScale * 1.005,
  atmosUpperScale = atmosScale,
  orbitScale = 1E-5;

function newStars(starProps, stars, s) {
  var orbitPlane = new THREE.Object3D;
  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  var starsGeometry = new THREE.Geometry();

  // Fist one is at 0,0,0 for the sun.
  starsGeometry.vertices.push(new THREE.Vector3());

  // Then the stars from the data file.
  for (var i = 0; i < stars.length; i++) {
    var s = stars[i];
    var ra = s[0] * toDeg; // why not toRad?
    var dec = s[1] * toDeg;
    var dist = s[2] * orbitScale;
    var vec = new THREE.Vector3(dist * Math.sin(ra) * Math.cos(dec),
                                dist * Math.sin(ra) * Math.sin(dec),
                                dist * Math.cos(ra));
    starsGeometry.vertices.push(vec);
  }

  // Lots of fiddling with the following options to get smooth
  // rendering of the sun's glow, the mini stars and the orbit lines,
  // without flicker, overdraw, etc.
  var starImage = pathTexture('star_glow', '.png');
  var starGlowMaterial =
    new THREE.ParticleBasicMaterial({ color: 0xffffff,
                                      size: starProps.radius * 1E3 * radiusScale,
                                      map: starImage,
                                      sizeAttenuation: true,
                                      blending: THREE.AdditiveBlending,
                                      depthTest: true,
                                      depthWrite: false,
                                      transparent: true }); 

  var starMiniMaterial =
    new THREE.ParticleBasicMaterial({ color: 0xffffff,
                                      size: 5,
                                      map: starImage,
                                      sizeAttenuation: false,
                                      depthTest: true,
                                      transparent: false });

  var shape = new THREE.Object3D();

  var starPoints = new THREE.ParticleSystem(starsGeometry, starMiniMaterial);
  starPoints.sortParticles = true;
  shape.add(starPoints);

  var starGlows = new THREE.ParticleSystem(starsGeometry, starGlowMaterial);
  starGlows.sortParticles = true;
  shape.add(starGlows);

  orbitPosition.add(shape);
  orbitPlane.orbitPosition = orbitPosition;
  return orbitPlane;
}

function newPointLight() {
  return new THREE.PointLight(0xffffff);
}

function newStar(props) {
  var orbitPlane = new THREE.Object3D;
  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);
  var opts = {radius: Measure.parseMeasure(props.radius).scalar * radiusScale,
              color: 0xffffff};
  var matr = new THREE.MeshBasicMaterial({color: 0xffffff,
                                          map: pathTexture('sun'),
                                          transparent: false});
  var starMesh = sphere(opts, matr);
  orbitPosition.add(starMesh);
  orbitPlane.orbitPosition = orbitPosition;
  return orbitPlane;
}

function newOrbitingPlanet(planetProps) {

  var debug = planetProps.name == 'earth';
  var orbitProps = planetProps.orbit;

  // The plane of the orbit, centered at the planet's parent position.
  var orbitPlane = new THREE.Object3D;
  orbitPlane.add(newOrbit(orbitProps));
  if (debug)
    orbitPlane.add(grid({stepSize: 1E4, color: 0x0000ff}));

  orbitPlane.rotation.x = orbitProps.inclination * toRad;
  orbitPlane.rotation.y = orbitProps.longitudeOfPerihelion * toRad;

  var l = line(new THREE.Vector3(orbitProps.semiMajorAxis * orbitScale, 0, 0));
  orbitPlane.add(l);

  // Orbit position is where the planet is in the scene, centered at
  // the parent.
  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  // Attaching this property triggers orbit of planet during animation.
  orbitPosition.orbitProps = orbitProps;

  var planet = newPlanet(planetProps);
  orbitPosition.add(planet);

  var referencePlane = new THREE.Object3D;
  referencePlane.add(orbitPlane);
  referencePlane.rotation.y = orbitProps.longitudeOfAscendingNode * toRad;
  // Children centered at this planet's orbit position.
  referencePlane.orbitPosition = orbitPosition;

  if (debug)
    referencePlane.add(grid({stepSize: 1E5}));

  return referencePlane;
};

function newPlanet(planetProps) {
  var planet = new THREE.Object3D;
  // TODO(pablo): put these in near LOD only.
  if (planetProps.texture_atmosphere) {
    planet.add(newClouds(planetProps));
    //planet.add(atmos(planetProps.radius * atmosUpperScale));
  }

  // TODO(pablo): if underlying planet is a BasicMeshMaterial, order
  // matters and surface has to go after atmosphere; adding surface
  // before atmosphere causes failure of atmosphere display.  No idea
  // why.  This is not currently the case, but this appears to be
  // idemopotent given then current config, so leaving it this way.
  planet.add(newSurface(planetProps));

  // Tilt could be set in orbit configuration, but for the moment
  // seems more intrinsic.
  planet.rotation.z = planetProps.axialInclination * toRad;
  //planet.rotation.x += planetProps.axialInclination * toDeg;

  // Attaching this property triggers rotation of planet during animation.
  planet.siderealRotationPeriod = planetProps.siderealRotationPeriod;

  return planet;
}

// TODO(pablo): get shaders working again.
function newSurface(planetProps) {
  var planetMaterial;
  if (true || !(planetProps.texture_hydrosphere || planetProps.texture_terrain)) {
    planetMaterial = cacheMaterial(planetProps.name);
  } else {

    // Fancy planets.
    var shader = THREE.ShaderUtils.lib['normal'];
    var uniforms = THREE.UniformsUtils.clone(shader.uniforms);

    var tex = pathTexture(planetProps.name);
    console.log(tex);
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

  var planetSceneRadius = planetProps.radius * radiusScale;
  console.log('planetSceneRadius: ' + planetSceneRadius);
  return lodSphere(planetSceneRadius, planetMaterial);
}

function newClouds(planetProps) {
  var matr =
    new THREE.MeshLambertMaterial({color: 0xffffff,
                                   map: pathTexture(planetProps.name, '_atmos.png'),
                                   transparent: true});
  var clouds = sphere(planetProps, matr);
  clouds.scale.set(atmosScale, atmosScale, atmosScale);
  return clouds;
}

function newOrbit(orbit) {
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
      color: 0x000055,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true
    });
  
  var line = new THREE.Line(ellipseGeometry, orbitMaterial);
  line.rotation.x = halfPi;
  return line;
}
