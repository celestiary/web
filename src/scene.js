import * as THREE from './lib/three.module.js';
import * as Animation from './animation.js';
import * as Shared from './shared.js';
import Stars from './t-1000.js';
import * as Material from './material.js';
import * as Shapes from './shapes.js';

const
  lengthScale = Shared.lengthScale,
  atmosScale = 1.01,
  stepBackMult = 10;

export default class Scene {
  constructor(threeUi) {
    this.ui = threeUi;
    this.frames = {};
    this.orbitShapes = {};
    this.debugShapes = [];
    this.orbitsVisible = false;
    this.debugVisible = false;
    this.lastAddTime = 0;
    this.uniforms = null;
  }


  /**
   * Add an object to the scene.
   * @param {!object} props object properties, must include type.
   */
  add(props) {
    const name = props.name;
    let parentObj = this.frames[props.parent];
    let parentOrbitPosition = this.frames[props.parent + '.orbitPosition'];
    if (props.name == 'milkyway' || props.name == 'sun') {
      parentObj = parentOrbitPosition = this.ui.scene;
    }
    if (!parentObj || !parentOrbitPosition) {
      throw new Error(`No parent obj: ${parentObj} or pos: ${parentOrbitPosition} for ${name}`);
    }

    let obj;
    switch (props.type) {
    case 'galaxy':
      obj = this.newGalaxy(props);
      break;
    case 'stars':
      obj = this.newStars(props);
      break;
    case 'star':
      obj = this.newStar(props);
      // step back from the sun.
      this.ui.camera.position.set(0, 0, props.radius.scalar * lengthScale * stepBackMult);
      break;
    case 'planet':
    case 'moon':
      obj = this.newOrbitingPlanet(props);
      break;
    default:
      throw new Error(`Object has unknown type: ${props.type}`);
    }

    // Add to scene in reference frame of parent's orbit position,
    // e.g. moons orbit planets, so they have to be added to the
    // planet's orbital center.
    parentOrbitPosition.add(obj);

    this.lastAddTime = Animation.time.sysTime;
  }


  select(name) {
    const obj = this.frames[name];
    if (!obj) {
      throw new Error(`scene#checkedSelect: initial load race, this.frames[${name}]: ${obj}`);
    }
    Shared.targetRefs.targetObj = obj;
  }


  lookAtCurrentTarget() {
    if (!Shared.targetRefs.targetObj) {
      console.error('scene.js#lookAtTarget: no target obj to look at.');
      return;
    }
    this.ui.scene.updateMatrixWorld();
    Shared.targetRefs.targetPos.setFromMatrixPosition(Shared.targetRefs.targetObj.matrixWorld);
    this.ui.controls.target = Shared.targetRefs.targetPos;
    this.ui.controls.update();
    this.ui.camera.lookAt(Shared.targetRefs.targetPos);
  }


  lookAtNamed(name) {
    this.select(name);
    this.lookAtCurrentTarget();
  }


  goTo() {
    if (!Shared.targetRefs.targetObj) {
      console.error('Scene.goTo called with no target obj.');
      return;
    }
    const obj = Shared.targetRefs.targetObj;
    const objPos = Shared.targetRefs.targetPos.clone();
    const camPos = objPos.clone();
    // TODO(pablo): figure out why hacky step back needed.
    const stepBack = obj.props.radius.scalar * lengthScale * 2E2;
    if (objPos.length() == 0) {
      // Sun pos is 0,0.0.
      camPos.set(0, 0, 2E2);
    } else {
      camPos.add(objPos.negate().setLength(stepBack));
    }
    this.ui.camera.position.copy(camPos);
    this.lookAtCurrentTarget();
  }


  track(name) {
    if (Shared.targetRefs.trackObj) {
      console.log('stop tracking');
      Shared.targetRefs.trackObj = null;
    } else {
      Shared.targetRefs.trackObj = Shared.targetRefs.targetObj;
      console.log('start tracking', Shared.targetRefs.trackObj);
    }
  }


  follow(name) {
    if (Shared.targetRefs.followObj) {
      delete Shared.targetRefs.followObj.postAnimCb;
      Shared.targetRefs.followObj = null;
    } else {
      if (Shared.targetRefs.targetObj) {
        if (Shared.targetRefs.targetObj.orbitPosition) {
          console.log('Starting follow....');
          const tObj = Shared.targetRefs.targetObj;
          // Follow the orbit position for less jitter.
          const followed = Shared.targetRefs.targetObj.orbitPosition;
          Shared.targetRefs.followObj = followed;

          let cp = this.ui.camera.position;
          console.log(`${cp.x} ${cp.y} ${cp.z}`);
          const cameraPlatform = new THREE.Object3D;
          this.ui.camera.position.set(0,0,0);
          this.ui.controls.rotateSpeed = 0.001;
          this.ui.controls.zoomSpeed = 0.001;
          this.ui.scene.add(cameraPlatform);
          Shared.targetRefs.cameraPlatform = cameraPlatform;

          let i = 0;
          followed.postAnimCb = (obj) => {
            const tPos = new THREE.Vector3;
            this.ui.scene.updateMatrixWorld();
            tPos.setFromMatrixPosition(obj.matrixWorld);
            tPos.add(tPos.clone().negate().setLength(1E2));
            //tPos.multiplyScalar(0.999);
            //console.log(tPos);
            cameraPlatform.position.copy(tPos);
            if (i++ == 0) {
              console.log(`${cp.x} ${cp.y} ${cp.z}`);
            }
          };

          followed.postAnimCb(followed);
          cp = cameraPlatform.position;
          cameraPlatform.add(this.ui.camera);
          console.log(`${cp.x} ${cp.y} ${cp.z}`);
        } else {
          console.error('Target to follow has no orbitPosition property.');
        }
      } else {
        console.error('No target object to follow.');
      }
    }
  }


  newStars(props) {
    const geom = this.starGeom(Stars);
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
    starPoints.scale.setScalar(lengthScale);
    return starPoints;
  }


  newGalaxy(galaxyProps) {
    const frame = this.newFrame(galaxyProps.name, galaxyProps);
    this.frames[galaxyProps.name + '.orbitPosition'] = frame;
    return frame;
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
      const dist = s[2] * 1e3; // convert from kilometer to meter.
      const vec = new THREE.Vector3(dist * Math.sin(ra) * Math.cos(dec),
                                    dist * Math.sin(ra) * Math.sin(dec),
                                    dist * Math.cos(ra));
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
      Animation.addPreAnimCb((time) => {
          // Sun looks bad changing too quickly.
          time = Math.log(time);
          if (Shared.targetRefs.targetPos) {
            this.uniforms.iTime.value = time;
            const d = Shared.targetRefs.targetPos.distanceTo(this.ui.camera.position);
            this.uniforms.iDist.value = d * 1E-2;
          }
        });
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
    const frame = this.newFrame(starProps.name, starProps);
    this.frames[starProps.name + '.orbitPosition'] = frame;
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
        const star = Shapes.sphere({
            radius: 1,
            matr: matr
          });
        frame.add(star);
        if (finishedCb) {
          finishedCb();
        }
      });
    frame.scale.setScalar(starProps.radius.scalar * lengthScale);
    frame.add(new THREE.PointLight(0xffffff));
    return frame;
  }


  /**
   * @param name Prefix, attached to .frame suffix.
   * @param props Optional props to attach to a .props field on the frame. */
  newFrame(name, props) {
    const frame = new THREE.Object3D();
    this.frames[name] = frame;
    frame.name = name;
    if (props) {
      frame.props = props;
    }
    frame.add(this.debugAxes());
    return frame;
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

    const frame = this.newFrame(name + '.frame');

    const orbitPlane = this.newFrame(name + '.orbitPlane');
    frame.add(orbitPlane);
    orbitPlane.rotation.x = inclination * Shared.toRad;
    orbitPlane.rotation.y = longitudeOfPerihelion * Shared.toRad;

    const orbitShape = this.newOrbit(orbit, name);
    orbitShape.scale.multiplyScalar(lengthScale);
    orbitPlane.add(orbitShape);
    orbitShape.visible = this.orbitsVisible;
    this.orbitShapes[name] = orbitShape;

    const orbitPosition = this.newFrame(name + '.orbitPosition');
    orbitPlane.add(orbitPosition);

    // Attaching this property triggers orbit of planet during animation.
    // See animation.js#animateSystem.
    orbitPosition.orbit = planetProps.orbit;

    const planetTilt = this.newFrame(name + '.planetTilt');
    orbitPosition.add(planetTilt);
    planetTilt.rotateZ(planetProps.axialInclination * Shared.toRad);

    const planet = this.newPlanet(planetProps);
    planet.scale.multiplyScalar(lengthScale);
    planetTilt.add(planet);
    orbitPosition.add(Shapes.point());
    planet.orbitPosition = orbitPosition;

    // frame.rotation.y = orbit.longitudeOfAscendingNode * Shared.toRad;
    // Children centered at this planet's orbit position.
    return frame;
  }


  newPlanet(planetProps) {
    const planet = this.newFrame(planetProps.name, planetProps);
    planet.add(this.newSurface(planetProps));
    if (planetProps.texture_atmosphere) {
      planet.add(this.newAtmosphere(planetProps));
    }

    // Attaching this property triggers rotation of planet during animation.
    planet.siderealRotationPeriod = planetProps.siderealRotationPeriod;
    planet.scale.setScalar(planetProps.radius.scalar);
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
    const frame = this.newFrame(name + '.orbit');
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
    frame.add(pathShape);
    frame.add(Shapes.line(1, 0, 0));
    frame.scale.multiplyScalar(orbit.semiMajorAxis);
    return frame;
  }
}
