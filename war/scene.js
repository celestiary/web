var
  radiusScale = 1E-7,
  atmosScale = radiusScale * 1.005,
  atmosUpperScale = atmosScale,
  orbitScale = 1E-7;

var globe;
var starImage, starGlowMaterial;

function newStars(starProps, stars) {
  var orbitPlane = new THREE.Object3D;
  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  var starsGeometry = new THREE.Geometry();

  // For the sun.
  starsGeometry.vertices.push(new THREE.Vertex(new THREE.Vector3()));
  for (var i = 0; i < stars.length; i++) {
    var s = stars[i];
    var ra = s[0] * toDeg; // why not toRad?
    var dec = s[1] * toDeg;
    var dist = s[2] * orbitScale;
    var vec = new THREE.Vector3(dist * Math.sin(ra) * Math.cos(dec),
                                dist * Math.sin(ra) * Math.sin(dec),
                                dist * Math.cos(ra));
    starsGeometry.vertices.push(new THREE.Vertex(vec));
  }

  var starImage = pathTexture('star_glow', '.png');
  var starGlowMaterial =
    new THREE.ParticleBasicMaterial({ color: 0xffffff,
                                      size: starProps.radius * 1E3 * radiusScale,
                                      map: starImage,
                                      sizeAttenuation: true,
                                      blending: THREE.AdditiveBlending,
                                      depthTest: false,
                                      transparent: true });

  var starMiniMaterial =
    new THREE.ParticleBasicMaterial({ color: 0xffffff,
                                      size: 4,
                                      map: starImage,
                                      sizeAttenuation: false,
                                      blending: THREE.AdditiveBlending,
                                      depthTest: true,
                                      transparent: true });

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

function newStar(starProps) {
  var orbitPlane = new THREE.Object3D;
  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  // TODO(pablo): add back in 'sun-white' sunspot texture.
  var star = lodSphere(starProps.radius * radiusScale,
                       new THREE.MeshBasicMaterial({color: 0xffffff,
                                                    depthTest: false,
                                                    wireframe: false,
                                                    transparent: true }));
  orbitPosition.add(star);

  orbitPlane.orbitPosition = orbitPosition;
  return orbitPlane;
}

var n = {};

function newOrbitingPlanet(planetProps) {

  var orbit = planetProps.orbit;

  var orbitPlane = new THREE.Object3D;
  orbitPlane.add(newOrbit(orbit));

  orbitPlane.rotation.x = orbit.inclination * toRad;
  orbitPlane.rotation.y = orbit.longitudeOfPerihelion * toRad;

  orbitPlane.add(line(new THREE.Vector3(orbit.semiMajorAxis * orbitScale, 0, 0)));

  var orbitPosition = new THREE.Object3D;
  orbitPlane.add(orbitPosition);

  // Attaching this property triggers orbit of planet during animation.
  orbitPosition.orbit = planetProps.orbit;

  var planet = newPlanet(planetProps);
  orbitPosition.add(planet);

  var referencePlane = new THREE.Object3D;
  referencePlane.add(orbitPlane);
  referencePlane.rotation.y = orbit.longitudeOfAscendingNode * toRad;
  // Children centered at this planet's orbit position.
  referencePlane.orbitPosition = orbitPosition;
  n[planetProps.name] = referencePlane;
  return referencePlane;
};

function newPlanet(planetProps) {
  var planet = new THREE.Object3D;
  // TODO(pablo): put these in near LOD only.
  if (planetProps.texture_atmosphere) {
    planet.add(newAtmosphere(planetProps));
    planet.add(atmos(planetProps.radius * atmosUpperScale));
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

function newSurface(planetProps) {
  var planetMaterial;
  if (!(planetProps.texture_hydrosphere || planetProps.texture_terrain)) {
    planetMaterial = cacheMaterial(planetProps.name);
  } else {
    // Fancy planets.
    var shader = THREE.ShaderUtils.lib['normal'];
    var uniforms = THREE.UniformsUtils.clone(shader.uniforms);

    uniforms['tDiffuse'].texture = pathTexture(planetProps.name);
    uniforms['enableAO'].value = false;
    uniforms['enableDiffuse'].value = true;
    uniforms['uDiffuseColor'].value.setHex(0xffffff);
    uniforms['uAmbientColor'].value.setHex(0);
    uniforms['uShininess'].value = 100.0 * planetProps.albedo;

    if (planetProps.texture_hydrosphere) {
      uniforms['enableSpecular'].value = true;
      uniforms['tSpecular'].texture = pathTexture(planetProps.name, '_hydro.jpg');
      uniforms['uSpecularColor'].value.setHex(0xffffff);
    }

    if (planetProps.texture_terrain) {
      uniforms['tNormal'].texture = pathTexture(planetProps.name, '_terrain.jpg');
      uniforms['uNormalScale'].value = 0.1;
    }

    planetMaterial = new THREE.ShaderMaterial({
        fragmentShader: shader.fragmentShader,
        vertexShader: shader.vertexShader,
        uniforms: uniforms,
        wireframe: false,
        lights: true
      });
  }

  return lodSphere(planetProps.radius * radiusScale, planetMaterial);
}

function newAtmosphere(planetProps) {
  var mat =
    new THREE.MeshLambertMaterial({color: 0xffffff,
                                   map: pathTexture(planetProps.name, '_atmos.png'),
                                   transparent: true});
  return lodSphere(planetProps.radius * atmosScale, mat);
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
      color: 0x0000ff,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: false
    });
  
  var line = new THREE.Line(ellipseGeometry, orbitMaterial);
  line.rotation.x = halfPi;
  return line;
}
