import Stars from './stars-10000.js';
import * as CelestiaData from '/js/celestia-data.js';
import * as Material from './material.js';
import * as Shared from './shared.js';
import * as Shapes from './shapes.js';
import * as THREE from './lib/three.module.js';

const
  lengthScale = Shared.LENGTH_SCALE,
  atmosScale = 1.01,
  stepBackMult = 10;

export default class Scene {
  constructor(ui) {
    this.ui = ui;
    this.objects = {};
    this.orbitShapes = {};
    this.debugShapes = [];
    this.orbitsVisible = false;
    this.debugVisible = false;
    this.uniforms = null;
  }


  /**
   * Add an object to the scene.
   * @param {!object} props object properties, must include type.
   */
  add(props) {
    const name = props.name;
    let parentObj = this.objects[props.parent];
    let parentOrbitPosition = this.objects[props.parent + '.orbitPosition'];
    if (props.name == 'milkyway' || props.name == 'sun') {
      parentObj = parentOrbitPosition = this.ui.scene;
    }
    if (!parentObj || !parentOrbitPosition) {
      throw new Error(`No parent obj: ${parentObj} or pos: ${parentOrbitPosition} for ${name}`);
    }
    // Add to scene in reference frame of parent's orbit position,
    // e.g. moons orbit planets, so they have to be added to the
    // planet's orbital center.
    parentOrbitPosition.add(this.newObject(props));
  }


  newObject(props) {
    switch (props.type) {
    case 'galaxy':
      return this.newGalaxy(props);
    case 'stars':
      return this.newStars(props);
    case 'star':
      return this.newStar(props);
    case 'planet':
    case 'moon':
      return this.newOrbitingPlanet(props);
    }
    throw new Error(`Object has unknown type: ${props.type}`);
  }


  /**
   * @param name Prefix, attached to .frame suffix.
   * @param props Optional props to attach to a .props field on the frame.
   */
  newGroup(name, props) {
    const obj = new THREE.Object3D();
    this.objects[name] = obj;
    obj.name = name;
    if (props) {
      obj.props = props;
    }
    obj.add(this.debugAxes());
    return obj;
  }


  targetNamed(name) {
    this.setTarget(name);
    this.lookAtTarget();
  }


  targetParent() {
    const cObj = Shared.targets.cur;
    if (cObj && cObj.props && cObj.props.parent) {
      this.setTarget(cObj.props.parent);
    }
  }


  targetNode(index) {
    const cObj = Shared.targets.cur;
    if (cObj && cObj.props && cObj.props.system && cObj.props.system) {
      const sys = cObj.props.system;
      if (sys[index - 1]) {
        this.setTarget(sys[index - 1]);
      }
    }
  }


  targetCurNode() {
    const cObj = Shared.targets.cur;
    if (cObj && cObj.props && cObj.props.name) {
      this.setTarget(cObj.props.name);
    }
  }


  setTarget(name) {
    const obj = this.objects[name];
    if (!obj) {
      throw new Error(`scene#setTarget: no matching target: ${name}`);
    }
    Shared.targets.obj = obj;
  }


  lookAtTarget() {
    if (!Shared.targets.obj) {
      console.error('scene.js#lookAtTarget: no target obj to look at.');
      return;
    }
    const obj = Shared.targets.obj;
    const tPos = Shared.targets.pos;
    this.ui.scene.updateMatrixWorld();
    tPos.setFromMatrixPosition(obj.matrixWorld);
    this.ui.camera.lookAt(tPos);
  }


  goTo() {
    if (!Shared.targets.obj) {
      console.error('Scene.goTo called with no target obj.');
      return;
    }
    const obj = Shared.targets.obj;
    const tPos = Shared.targets.pos;
    this.ui.scene.updateMatrixWorld();
    tPos.setFromMatrixPosition(obj.matrixWorld);
    c.tp = tPos;
    const pPos = new THREE.Vector3;
    const cPos = new THREE.Vector3;
    const surfaceAltitude = obj.props.radius.scalar * lengthScale;
    const stepBackMult = 3;
    pPos.set(0, 0, 0); // TODO(pablo): maybe put platform at surfaceAltitude
    cPos.set(0, 0, surfaceAltitude * stepBackMult);
    obj.orbitPosition.add(this.ui.camera.platform);
    this.ui.camera.platform.position.copy(pPos);
    this.ui.camera.platform.lookAt(Shared.targets.origin);
    this.ui.camera.position.copy(cPos);
    this.ui.camera.lookAt(tPos);
    Shared.targets.track = Shared.targets.cur = Shared.targets.obj;
    this.ui.controls.update();
  }


  track(name) {
    if (Shared.targets.track) {
      Shared.targets.track = null;
    } else {
      Shared.targets.track = Shared.targets.obj;
    }
  }


  follow(name) {
    if (Shared.targets.follow) {
      delete Shared.targets.follow.postAnimCb;
      Shared.targets.follow = null;
    } else {
      if (Shared.targets.obj) {
        if (Shared.targets.obj.orbitPosition) {
          // Follow the orbit position for less jitter.
          const followed = Shared.targets.obj.orbitPosition;
          Shared.targets.follow = followed;

          followed.postAnimCb = (obj) => {
            this.ui.camera.platform.lookAt(Shared.targets.origin);
          };

          followed.postAnimCb(followed);
        } else {
          console.error('Target to follow has no orbitPosition property.');
        }
      } else {
        console.error('No target object to follow.');
      }
    }
  }


  manageDebugShape(shape) {
    this.debugShapes.push(shape);
    shape.visible = this.debugVisible;
    return shape;
  }


  debugAxes(size) {
    return this.manageDebugShape(new THREE.AxesHelper(size || 1));
  }


  toggleOrbits() {
    this.orbitsVisible = !this.orbitsVisible;
    for (let i in this.orbitShapes) {
      const shape = this.orbitShapes[i];
      if (shape.hasOwnProperty('visible')) {
        this.orbitShapes[i].visible = this.orbitsVisible;
      }
    }
  }


  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    for (let i = 0; i < this.debugShapes.length; i++) {
      this.debugShapes[i].visible = this.debugVisible;
    }
  }


  newStars(props) {
    //const geom = this.starGeom(Stars);
    CelestiaData.loadStars((catalog) => {
        const geom = this.starGeomFromCelestia(catalog.stars);
        const starImage = Material.pathTexture('star_glow', '.png');
        const avgStarSize = props.radius.scalar;
        const starMiniMaterial =
        new THREE.PointsMaterial({ size: avgStarSize,
                                   map: starImage,
                                   blending: THREE.AdditiveBlending,
                                   depthTest: true,
                                   depthWrite: false,
                                   transparent: true });
        const starPoints = new THREE.Points(geom, starMiniMaterial);
        starPoints.sortParticles = true;
        this.ui.scene.add(starPoints); // hack
      });
    return new THREE.Object3D(); // dummy
  }


  newGalaxy(galaxyProps) {
    const group = this.newGroup(galaxyProps.name, galaxyProps);
    this.objects[galaxyProps.name + '.orbitPosition'] = group;
    return group;
  }


  /** The stars from the data file. */
  starGeom(stars) {
    const geom = new THREE.Geometry();
    // The sun first.
    geom.vertices.push(new THREE.Vector3);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const ra = s[0] * Shared.toDeg; // TODO: why not toRad?
      const dec = s[1] * Shared.toDeg;
      const dist = s[2] * lengthScale * 1E3; // convert from kilometer to meter.
      const vec = new THREE.Vector3(dist * Math.sin(ra) * Math.cos(dec),
                                    dist * Math.sin(ra) * Math.sin(dec),
                                    dist * Math.cos(ra));
      geom.vertices.push(vec);
    }
    return geom;
  }


  starGeomFromCelestia(stars) {
    const geom = new THREE.Geometry();
    // The sun first.
    geom.vertices.push(new THREE.Vector3);
    // km/ly * m/km * lengthScale
    const scale = 9.461E12 * 1E3 * lengthScale;
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      const vec = new THREE.Vector3(star.x * scale, star.y * scale, star.z * scale);
      geom.vertices.push(vec);
    }
    return geom;
  }


  newPlanetStars(geom, props) {
    const planetStarMiniMaterial =
      new THREE.PointsMaterial({ color: 0xffffff,
                                 size: 3,
                                 sizeAttenuation: false,
                                 depthTest: true,
                                 transparent: false });
    const planetStarPoints = new THREE.Points(geom, planetStarMiniMaterial);
    planetStarPoints.sortParticles = true;
    return planetStarPoints;
  }


  findCreateUniforms() {
    if (this.uniforms == null) {
      this.uniforms = {
        iTime: {
          type: "f",
          value: 1.0
        },
        iResolution: {
          type: "v2",
          value: new THREE.Vector2()
        },
        iScale: {
          type: "f",
          value: 100.0
        },
        iDist: {
          type: "f",
          value: 1.0
        }
      };
    }
    return this.uniforms;
  }


  // The star uses a Perlin noise for a naturalistic rough noise
  // process.  However, solar surface dynamics are better described by
  // Benard convection cells:
  //   https://en.wikipedia.org/wiki/Granule_(solar_physics)
  //   https://en.wikipedia.org/wiki/Rayleigh%E2%80%93B%C3%A9nard_convection
  // Some example implementations:
  //   https://www.shadertoy.com/view/llScRy
  //   https://www.shadertoy.com/view/XlsfWM
  //
  // Current approach uses:
  //   https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/
  // Which derives from:
  //   https://www.seedofandromeda.com/blogs/51-procedural-star-rendering
  //
  // A next level up is to include a magnetic field model for the entire
  // star and use it to mix in a representation of differential plasma
  // flows along the field lines.
  newStar(starProps, finishedCb) {
    const group = this.newGroup(starProps.name, starProps);
    this.objects[starProps.name + '.orbitPosition'] = group;
    const shaders = {
      uniforms: this.findCreateUniforms(),
      vertexShader: null,
      fragmentShader: null,
    };
    const loadShaders = (shaderConfig, doneCb) => {
      let mainDone = false, fragDone = false;
      const checkDone = () => {
        if (mainDone && fragDone) {
          doneCb(shaderConfig);
        }
      }
      fetch('/js/shaders/main2.vert').then((rsp) => {
          rsp.text().then((text) => {
              shaderConfig.vertexShader = text;
              mainDone = true;
              checkDone();
            });
        });
      fetch('/js/shaders/star2.frag').then((rsp) => {
          rsp.text().then((text) => {
              shaderConfig.fragmentShader = text;
              fragDone = true;
              checkDone();
            });
        });
    };
    loadShaders(shaders, (completeShaderConfig) => {
        window.shaders = completeShaderConfig;
        const matr = new THREE.ShaderMaterial(completeShaderConfig);
        const star = Shapes.sphere({ matr: matr });
        star.scale.setScalar(starProps.radius.scalar * lengthScale);
        group.add(star);
        if (finishedCb) {
          finishedCb();
        }
      });
    group.add(new THREE.PointLight(0xffffff));
    group.orbitPosition = group;

    group.preAnimCb = (time) => {
      // Sun looks bad changing too quickly.
      time = Math.log(1 + time.simTimeElapsed * 5E-6);
      if (Shared.targets.pos) {
        shaders.uniforms.iTime.value = time;
        const d = Shared.targets.pos.distanceTo(this.ui.camera.position);
        shaders.uniforms.iDist.value = d * 1E-2;
      }
    };

    return group;
  }


  /**
   * A new planet at its place in orbit.
   * https://en.wikipedia.org/wiki/Orbital_elements
   * https://en.wikipedia.org/wiki/Equinox#Celestial_coordinate_systems
   * https://en.wikipedia.org/wiki/Epoch_(astronomy)#Julian_years_and_J2000
   */
  newOrbitingPlanet(planetProps) {
    const name = planetProps.name;
    const orbit = planetProps.orbit;
    const inclination = orbit.inclination || 0;
    const longitudeOfPerihelion = orbit.longitudeOfPerihelion || 0;

    const group = this.newGroup(name + '.group');

    const orbitPlane = this.newGroup(name + '.orbitPlane');
    group.add(orbitPlane);
    orbitPlane.rotation.x = inclination * Shared.toRad;
    orbitPlane.rotation.y = longitudeOfPerihelion * Shared.toRad;

    const orbitShape = this.newOrbit(orbit, name);
    orbitPlane.add(orbitShape);
    orbitShape.visible = this.orbitsVisible;
    this.orbitShapes[name] = orbitShape;

    const orbitPosition = this.newGroup(name + '.orbitPosition');
    orbitPlane.add(orbitPosition);

    // Attaching this property triggers orbit of planet during animation.
    // See animation.js#animateSystem.
    orbitPosition.orbit = planetProps.orbit;

    const planetTilt = this.newGroup(name + '.planetTilt');
    orbitPosition.add(planetTilt);
    planetTilt.rotateZ(planetProps.axialInclination * Shared.toRad);

    const planet = this.newPlanet(planetProps);
    planetTilt.add(planet);
    orbitPosition.add(Shapes.point());
    planet.orbitPosition = orbitPosition;

    // group.rotation.y = orbit.longitudeOfAscendingNode * Shared.toRad;
    // Children centered at this planet's orbit position.
    return group;
  }


  newPlanet(planetProps) {
    const planet = this.newGroup(planetProps.name, planetProps);
    planet.add(this.newSurface(planetProps));
    if (planetProps.texture_atmosphere) {
      planet.add(this.newAtmosphere(planetProps));
    }

    // Attaching this property triggers rotation of planet during animation.
    planet.siderealRotationPeriod = planetProps.siderealRotationPeriod;
    planet.scale.setScalar(planetProps.radius.scalar * lengthScale);
    return planet;
  }


  // TODO(pablo): get shaders working again.
  newSurface(planetProps) {
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
    const shape = Shapes.sphere({matr: planetMaterial});
    shape.name = planetProps.name + '.surface';
    this.objects[shape.name] = shape;
    return shape;
  }


  newAtmosphere(planetProps) {
    // TODO: https://threejs.org/examples/webgl_shaders_sky.html
    const atmosTex = Material.pathTexture(planetProps.name, '_atmos.jpg');
    const shape = Shapes.sphere({
        radius: atmosScale, // assumes radius of planet is 1.
        matr: new THREE.MeshPhongMaterial({
            color: 0xffffff,
            alphaMap: atmosTex,
            transparent: true,
            specularMap: atmosTex,
            shininess: 100
          })
      });
    shape.name = planetProps.name + '.atmosphere';
    return shape;
  }


  newOrbit(orbit, name) {
    const group = this.newGroup(name + '.orbit');
    const ellipseCurve = new THREE.EllipseCurve(
        0, 0,
        1, Shapes.ellipseSemiMinorAxisCurve(orbit.eccentricity),
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
    group.add(pathShape);
    group.add(Shapes.line(1, 0, 0));
    group.scale.setScalar(orbit.semiMajorAxis * lengthScale);
    return group;
  }
}
