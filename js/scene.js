import Stars from './stars-10000.js';
import Loader from './loader.js';
import CustomRaycaster from './lib/three-custom/raycaster.js';
import CustomPoints from './lib/three-custom/points.js';
import SpriteSheet from './SpriteSheet.js';
import * as CelestiaData from './celestia-data.js';
import * as Material from './material.js';
import * as Shared from './shared.js';
import * as Shapes from './shapes.js';
import * as THREE from './lib/three.module.js';
import * as Utils from './utils.js';

const
  lengthScale = Shared.LENGTH_SCALE,
  atmosScale = 1.01,
  stepBackMult = 10;

const SCALE = 9.461E12 * 1E3 * lengthScale;

const labelTextFont = '12px arial';
const labelTextColor = '#7fa0e0';
const FAR_OBJ = new THREE.Object3D; // for invisible LOD.

export default class Scene {
  constructor(ui) {
    this.ui = ui;
    this.objects = {};
    this.orbitShapes = {};
    this.debugShapes = [];
    this.orbitsVisible = false;
    this.debugVisible = false;
    this.uniforms = null;
    this.mouse = new THREE.Vector2;
    this.raycaster = new THREE.Raycaster;
    //this.raycaster = new CustomRaycaster;
    this.raycaster.params.Points.threshold = 3;
    const maxLabel = 'Rigel Kentaurus B';
    this.starLabelSpriteSheet = new SpriteSheet(10, maxLabel, labelTextFont);
    this.planetLabelSpriteSheet = new SpriteSheet(10, maxLabel, labelTextFont);
    ui.addClickCb((click) => {
        this.onClick(click);
      });
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
    parentOrbitPosition.add(this.objectFactory(props));
  }


  objectFactory(props) {
    console.log(props);
    switch (props.type) {
    case 'galaxy':
      return this.newGalaxy(props);
    case 'stars':
      return this.newStars(props);
    case 'star':
      return this.newStar(props);
    case 'planet':
      return this.newOrbitingPlanet(props);
    case 'moon':
      return this.newOrbitingPlanet(props, true);
    }
    throw new Error(`Object has unknown type: ${props.type}`);
  }


  /**
   * A primary scene object composed.
   */
  newObject(name, props, onClick) {
    const obj = this.newGroup(name, props);
    if (!onClick) {
      throw new Error('Must provide an onClick handler');
    }
    obj.onClick = onClick;
    return obj;
  }


  /**
   * A secondary grouping of scene objects.
   * @param name Prefix, attached to .frame suffix.
   * @param props Optional props to attach to a .props field on the frame.
   */
  newGroup(name, props) {
    const obj = new THREE.Object3D;
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


  onClick(mouse) {
    this.ui.scene.updateMatrixWorld();
    this.raycaster.setFromCamera(mouse, this.ui.camera);
    const t = Date.now();
    const intersects = this.raycaster.intersectObjects(this.ui.scene.children, true);
    const elapsedSeconds = (Date.now() - t) / 1000;
    if (elapsedSeconds > 0.1) {
      console.error('Scene picking taking a long time (seconds): ', elapsedSeconds);
    }
    if (intersects.length == 0) {
      return;
    }
    let nearestMeshIntersect, nearestPointIntersect,
      nearestStarPointIntersect, nearestDefaultIntersect;
    for (let i = 0; i < intersects.length; i++) {
      const intersect = intersects[i];
      const dist = intersect.distance;
      const obj = intersect.object;
      if (obj.isAnchor) {
        console.log('raycast skipping anchor');
        continue;
      }
      //console.log(`intersect ${i} dist: ${dist}, type: ${obj.type}, obj: `, obj);
      switch (obj.type) {
        case 'Mesh': {
          if (nearestMeshIntersect
              && nearestMeshIntersect.distance < dist) {
            continue;
          }
          nearestMeshIntersect = intersect;
        } break;
        case 'Points': {
          if (obj.isStarPoints) {
            if (nearestStarPointIntersect
                && nearestStarPointIntersect.distanceToRay < intersect.distanceToRay) {
              continue;
            }
            //console.log('New nearest star point: ', intersect);
            nearestStarPointIntersect = intersect;
          } else {
            if (nearestPointIntersect
                && nearestPointIntersect.distance < dist) {
              continue;
            }
            //console.log('New nearest point: ', intersect);
            nearestPointIntersect = intersect;
          }
        } break;
        default: {
          //console.log('Raycasting default handler for object type: ', obj.type);
          if (nearestDefaultIntersect
              && nearestDefaultIntersect.distance < dist) {
            continue;
          }
          //console.log('New nearest default: ', intersect);
          nearestDefaultIntersect = intersect;
        }
      }
    }
    const nearestIntersect = nearestMeshIntersect ? nearestMeshIntersect
      : nearestPointIntersect ? nearestPointIntersect
      : nearestStarPointIntersect ? nearestStarPointIntersect
      : nearestDefaultIntersect ? nearestDefaultIntersect
      : null;
    if (!nearestIntersect) {
      throw new Error("Picking did not yield an intersect.  Intersects: ", intersects);
    }
    let obj = nearestIntersect.object;
    //console.log('Nearest object type: ', obj.isStarPoints ? '<star points>' : obj.type);
    let firstName;
    do {
      if (obj.name || (obj.props && obj.props.name) && !firstName) {
        firstName = obj.name || (obj.props && obj.props.name);
      }
      if (obj.onClick) {
        obj.onClick(mouse, nearestIntersect, obj);
        break;
      }
      if (obj == obj.parent) {
        console.error('no clickable object found in path to root.');
        break;
      }
    } while (obj = obj.parent);
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


  newGalaxy(galaxyProps) {
    const group = this.newObject(galaxyProps.name, galaxyProps, (click) => {
        console.error('Well done, you found the galaxy!');
      });
    this.objects[galaxyProps.name + '.orbitPosition'] = group;
    return group;
  }


  newStars(props) {
    const cursor = this.debugAxes(10);
    let origSizes = {}, lastNdx = null;

    let stars;

    const starInfo = (textPos, ndx, fullInfo) => {
      const starRecord = stars.catalog.stars[ndx];
      const hipId = parseInt(starRecord.hipId);
      let name = stars.catalog.namesByHip[hipId];
      name = name ? name : hipId ? ('HIP ' + hipId) : 'Unknown';
      let desc = name;
      if (fullInfo) {
        desc += '\n' + JSON.stringify(starRecord).replace(/,/g, '\n');
      }
      //Shared.targets.obj = labelAnchor;
      //Shared.targets.pos = textPos;
      //Shared.targets.track = textPos;
      return desc;
    }

    stars = this.newObject('stars', props, (mouse, intersect, clickRoot) => {
        //console.log(`Stars clicked: `, mouse, intersect, clickRoot);
        cursor.position.copy(intersect.point);
        const ndx = intersect.index;
        if (intersect.object.children.length > 0
            && intersect.object.children[0] instanceof THREE.Sprite) {
          intersect.object.remove(intersect.object.children[0]);
          return;
        }
        const geom = intersect.object.geometry;
        if (!geom || !geom.getAttribute) return;
        const position = geom.getAttribute('position');
        const textPos = new THREE.Vector3;
        const posArr = position.array;
        const off = 3 * ndx;
        textPos.set(posArr[off], posArr[off + 1], posArr[off + 2]);
        const info = starInfo(textPos, ndx);
        if (info) {
          const name = typeof info == 'string' ? info : info[0];
          //const label = makeLabel(info);
          //label.position.copy(textPos);
          //intersect.object.add(label);
        }
      });
    stars.add(cursor);
    CelestiaData.loadStars((catalog) => {
        stars.catalog = catalog;
        const geom = this.starGeomFromCelestia(catalog);
        const starImage = Material.pathTexture('star_glow', '.png');
        const shaderMaterial = new THREE.ShaderMaterial({
            uniforms: {
              amplitude: { value: 1.0 },
              color: { value: new THREE.Color( 0xffff00 ) },
              texSampler: { value: starImage }
            },
            vertexShader: 'js/shaders/stars.vert',
            fragmentShader: 'js/shaders/stars.frag',
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            transparent: true
          });
        new Loader().loadShaders(shaderMaterial, () => {
            //const testMatr = new THREE.PointsMaterial({color: 0x0000ff, size: 1, sizeAttenuation: true});
            //const starPoints = new THREE.Points(geom, shaderMaterial);
            const starPoints = new CustomPoints(geom, shaderMaterial);
            starPoints.sortParticles = true;
            stars.add(starPoints);
          });

        const faveStars = {
          439: 'Gliese 1',
          8102: 'Tau Ceti',
          11767: 'Polaris',
          21421: 'Aldebaran',
          24436: 'Rigel',
          25336: 'Bellatrix',
          27989: 'Betelgeuse',
          30438: 'Canopus',
          32349: 'Sirius',
          37279: 'Procyon',
          49669: 'Regulus',
          57632: 'Denebola',
          65474: 'Spica',
          69673: 'Arcturus',
          70890: 'Proxima Centauri',
          71681: 'Rigel Kentaurus B',
          80763: 'Antares',
          83608: 'Arrakis',
          91262: 'Vega',
          102098: 'Deneb',
          97649: 'Altair',
          113881: 'Scheat'
        };
        for (let hipId in faveStars) {
          const name = faveStars[hipId];
          const star = catalog.index[hipId];
          this.showStarName(stars, star, name);
        }
        if (true) {
          const ursaMinorNames = [
              "ALF UMi", "DEL UMi", "EPS UMi",
              "ZET UMi", "BET UMi", "GAM UMi",
              "ETA UMi", "ZET UMi" ];
          this.showConstellation(ursaMinorNames, stars, catalog);
        }
      });
    return stars;
  }


  showStarName(stars, star, name) {
    const labelLOD = new THREE.LOD();
    const sPos = new THREE.Vector3(SCALE * star.x, SCALE * star.y, SCALE * star.z);
    const label = this.starLabelSpriteSheet.alloc(name, labelTextColor);
    labelLOD.position.copy(sPos);
    labelLOD.addLevel(label, 1);
    labelLOD.addLevel(FAR_OBJ, 1e13);
    stars.add(labelLOD);
  }


  starGeomFromCelestia(catalog) {
    //catalog = Utils.testStarCube(catalog, 1);
    //catalog = Utils.sampleStarCatalog(catalog, 1E5);
    const stars = catalog.stars;
    // km/ly * m/km * lengthScale
    const scale = 9.461E12 * 1E3 * lengthScale;
    const n = stars.length;
    console.log('num stars loaded: ', n);
    const geom = new THREE.BufferGeometry();
    const coords = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    // TODO(pablo): plenty of color work to do here based on
    // https://en.wikipedia.org/wiki/Stellar_classification. The
    // method used here to choose colors is to hover my mouse over the
    // color chart near the top of the page, above a given class, and
    // record the RGB values in the table below.
    const sunSpectrum = [255,238,229];
    const spectrum = [
                [142,176,255], // O
                [165,191,255], // B
                [205,218,255], // A
                [242,239,254], // F
                sunSpectrum, // G
                [255,219,178], // K
                [255,180,80], // M
                [255,180,80], // R, like M
                [255,180,80], // S, like M
                [255,180,80], // N, like M
                [142,176,255], // WC, like O
                [142,176,255], // WN, like O
                [142,176,255], // Unknown, like O?
                [255,118,0], // L
                [255,0,0],   // T
                [10,10,10,]]; // Carbon star?
    const minSize = 1;
    const maxLum = Math.pow(8, 4);
    for (let i = 0; i < n; i++) {
      const star = stars[i];
      const off = 3 * i;
      coords[off] = scale * star.x;
      coords[off + 1] = scale * star.y;
      coords[off + 2] = scale * star.z;
      let rgb = spectrum[star.type];
      rgb = rgb || sunSpectrum;
      const lumRelSun = star.lumRelSun;
      const r = rgb[0] / 255;
      const g = rgb[1] / 255;
      const b = rgb[2] / 255;
      colors[off] = r;
      colors[off + 1] = g;
      colors[off + 2] = b;
      // Added 2E1 for looks.  Stars too small otherwise.
      sizes[i] = star.radiusMeters * lengthScale * 1E1;
    }
    //console.log('coords: ', coords)
    geom.setAttribute('position', new THREE.BufferAttribute(coords, 3));
    geom.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    return geom;
  }


  showConstellation(names, stars, catalog) {
    let lastStar = null;
    for (let i = 0; i < names.length; i++) {
      name = names[i];
      const hipId = catalog.hipByName[name];
      const altNames = catalog.namesByHip[hipId];
      if (!altNames) {
        console.error('No alternative names found for constellation node: ', name);
        continue;
      }
      name = altNames[0];
      const star = catalog.index[hipId];
      if (!star) {
        console.error('Cannot find star: ', name);
        continue;
      }
      this.showStarName(stars, star, name);
      if (lastStar) {
        stars.add(Shapes.line(
            SCALE * lastStar.x, SCALE * lastStar.y, SCALE * lastStar.z,
            SCALE * star.x, SCALE * star.y, SCALE * star.z));
      }
      lastStar = star;
    }
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
    const name = starProps.name;
    const group = this.newObject(name, starProps, (mouse, intersect, clickRoot) => {
        console.log(`Star ${name} clicked`, mouse, intersect, clickRoot);
      });
    this.objects[name + '.orbitPosition'] = group;
    const shaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 1.0 },
        iResolution: { value: new THREE.Vector2() },
        iScale: { value: 100.0 },
        iDist: { value: 1.0 }
      },
      vertexShader: 'js/shaders/star.vert',
      fragmentShader: 'js/shaders/star.frag'
    });
    new Loader().loadShaders(shaderMaterial, () => {
        const star = Shapes.sphere({ matr: shaderMaterial });
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
        shaderMaterial.uniforms.iTime.value = time;
        const d = Shared.targets.pos.distanceTo(this.ui.camera.position);
        shaderMaterial.uniforms.iDist.value = d * 1E-2;
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
  newOrbitingPlanet(planetProps, isMoon = false) {
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
    planet.orbitPosition = orbitPosition;

    // group.rotation.y = orbit.longitudeOfAscendingNode * Shared.toRad;
    // Children centered at this planet's orbit position.

    const nearLOD = new THREE.LOD();
    planet.orbitPosition.add(nearLOD);

    nearLOD.addLevel(this.planetLabelSpriteSheet.alloc(Utils.capitalize(name), labelTextColor), 1);
    let lodDist = isMoon ? 1e3 : 1e7;
    nearLOD.addLevel(FAR_OBJ, lodDist);
    console.log(name, isMoon, lodDist);

    return group;
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


  newPlanet(planetProps) {
    const name = planetProps.name;
    const planet = this.newObject(name, planetProps, (mouse, intersect, clickRoot) => {
        console.log(`Planet ${name} clicked: `, mouse, intersect, clickRoot);
        //const tElt = document.getElementById('target-id');
        //tElt.innerText = name + (firstName ? ` (${firstName})` : '');
        //tElt.style.left = `${mouse.clientX}px`;
        //tElt.style.top = `${mouse.clientY}px`;
        //this.setTarget(name);
        //this.lookAtTarget();
      });
    const pointSize = planetProps.radius.scalar * lengthScale * 1E1;
    // console.log(`${name} point size: ${pointSize}`);
    planet.add(Shapes.point());
    planet.add(this.newSurface(planetProps));
    if (planetProps.texture_atmosphere) {
      planet.add(this.newAtmosphere(planetProps));
    }
    if (planetProps.has_locations) {
      planet.add(this.loadLocations(planetProps));
    }
    planet.scale.setScalar(planetProps.radius.scalar * lengthScale);
    // Attaching this property triggers rotation of planet during animation.
    planet.siderealRotationPeriod = planetProps.siderealRotationPeriod;
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
    const shape = Shapes.sphere({
        matr: planetMaterial
      });
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


  loadLocations() {
    
  }
}
