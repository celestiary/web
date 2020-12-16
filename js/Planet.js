import * as THREE from './lib/three.js/three.module.js';
import {assertFinite, assertInRange} from './lib/testing.js/testing.mjs';

import Object from './object.js';
import SpriteSheet from './SpriteSheet.js';

import * as Shapes from './shapes.mjs';
import {FAR_OBJ, LENGTH_SCALE, labelTextColor, halfPi, toRad} from './shared.mjs';
import * as Material from './material.js';
import {capitalize} from './utils.mjs';


export default class Planet extends Object {


  /**
   * A new planet at its place in orbit.
   * https://en.wikipedia.org/wiki/Orbital_elements
   * https://en.wikipedia.org/wiki/Equinox#Celestial_coordinate_systems
   * https://en.wikipedia.org/wiki/Epoch_(astronomy)#Julian_years_and_J2000
   */
  constructor(scene, props, isMoon = false) {
    super(props.name, props);
    this.scene = scene;
    this.isMoon = isMoon;
    this.load();
  }


  load() {
    const orbit = this.props.orbit;
    const group = this.scene.newGroup(this.name + '.group');

    const orbitPlane = this.scene.newGroup(this.name + '.orbitPlane');
    group.add(orbitPlane);
    orbitPlane.rotation.x = assertInRange(orbit.inclination, 0, 360) * toRad;
    orbitPlane.rotation.y = assertInRange(orbit.longitudeOfPerihelion, 0, 360) * toRad;

    const orbitShape = this.newOrbit(this.scene, orbit, this.name);
    orbitPlane.add(orbitShape);
    orbitShape.visible = this.scene.orbitsVisible;
    this.scene.orbitShapes[this.name] = orbitShape;

    const orbitPosition = this.scene.newGroup(this.name + '.orbitPosition');
    orbitPlane.add(orbitPosition);

    // Attaching this property triggers orbit of planet during animation.
    // See animation.js#animateSystem.
    orbitPosition.orbit = this.props.orbit;

    const planetTilt = this.scene.newGroup(this.name + '.planetTilt');
    orbitPosition.add(planetTilt);
    planetTilt.rotateZ(assertInRange(this.props.axialInclination, 0, 360) * toRad);

    const planet = this.newPlanet(this.scene, orbitPosition, this.isMoon);
    planetTilt.add(planet);

    // group.rotation.y = orbit.longitudeOfAscendingNode * toRad;
    // Children centered at this planet's orbit position.

    this.add(group);
  }


  newOrbit(scene, orbit) {
    const group = scene.newGroup(this.name + '.orbit');
    const ellipseCurve = new THREE.EllipseCurve(
        0, 0,
        1, Shapes.ellipseSemiMinorAxisCurve(assertInRange(orbit.eccentricity, 0, 1)),
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
    pathShape.rotation.x = halfPi;
    group.add(pathShape);
    group.add(Shapes.line(1, 0, 0));
    group.scale.setScalar(assertFinite(orbit.semiMajorAxis) * LENGTH_SCALE);
    return group;
  }


  /**
   * Creates a planet with waypoint, surface, atmosphere and locations,
   * scaled-down by LENGTH_SCALE (i.e. 1e-7), and set to rotate.
   */
  newPlanet(scene, orbitPosition, isMoon) {
    const planet = new THREE.Object3D;//scene.newObject(this.name, this.props, );

    planet.scale.setScalar(assertFinite(this.props.radius.scalar) * LENGTH_SCALE);
    // Attaching this property triggers rotation of planet during animation.
    planet.siderealRotationPeriod = this.props.siderealRotationPeriod;
    // Attaching this is used by scene#goTo.
    planet.orbitPosition = orbitPosition;
    planet.props = this.props;
    if (scene.objects) //hack
      scene.objects[this.name] = planet;

    if (this.props.has_locations) {
      // TODO: lod for names
      planet.add(this.loadLocations(this.props));
    }

    // An object must have a mesh to have onBeforeRender called, so
    // add a little helper.
    const closePoint = Shapes.point({
        color: 'green',//0x55aaff, // todo: earth-ish for now. get planet color index data.
        size: 1,//isMoon ? 2 : 3,
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        transparent: true
      });
    planet.add(closePoint);

    const farPoint = Shapes.point({
        color: 0x55aaff, // todo: earth-ish for now. get planet color index data.
        size: isMoon ? 1 : 2,
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        transparent: true
      });

    const planetLOD = new THREE.LOD();
    planetLOD.addLevel(planet, 1);
    planetLOD.addLevel(farPoint, 1e3);
    planetLOD.addLevel(FAR_OBJ, this.isMoon ? 1e7 : 1e8);

    closePoint.onBeforeRender = () => {
      planet.add(this.newSurface(this.props));
      if (this.props.texture_atmosphere) {
        planet.add(this.newAtmosphere());
      }
      planet.hasSurface = true;
      closePoint.onBeforeRender = null;
      delete closePoint['onBeforeRender'];
    }

    const labelLOD = new THREE.LOD();
    labelLOD.addLevel(this.scene.planetLabels.alloc(capitalize(this.name),
                                                    labelTextColor), 1);
    labelLOD.addLevel(FAR_OBJ, this.isMoon ? 1e3 : 1e6);

    const group = new THREE.Object3D;
    group.add(planetLOD);
    group.add(labelLOD);
    /*
    group.onClick = (mouse, intersect, clickRoot) => {
        console.log(`Planet group ${this.name} clicked: `, mouse, intersect, clickRoot);
        //const tElt = document.getElementById('target-id');
        //tElt.innerText = this.name + (firstName ? ` (${firstName})` : '');
        //tElt.style.left = `${mouse.clientX}px`;
        //tElt.style.top = `${mouse.clientY}px`;
        //this.setTarget(this.name);
        //this.lookAtTarget();
      }
    group.type = 'Group';
    return group;
    */
    return group;
  }


  /**
   * A surface with a shiny hydrosphere and bumpy terrain materials.
   * TODO(pablo): get shaders working again.
   */
  newSurface(scene) {
    let planetMaterial;
    if (!(this.props.texture_hydrosphere || this.props.texture_terrain)) {
      planetMaterial = Material.cacheMaterial(this.name);
      planetMaterial.shininess = 30;
    } else if (this.props.texture_hydrosphere || this.props.texture_terrain) {
      planetMaterial = Material.cacheMaterial(this.name);
      planetMaterial.shininess = 30;
      if (this.props.texture_terrain) {
        planetMaterial.bumpMap = Material.pathTexture(this.name + "_terrain");
        planetMaterial.bumpScale = 0.001;
      }
      if (this.props.texture_hydrosphere) {
        const hydroTex = Material.pathTexture(this.name + "_hydro");
        planetMaterial.specularMap = hydroTex;
        planetMaterial.shininess = 50;
      }
    }
    const shape = Shapes.sphere({
        matr: planetMaterial
      });
    //shape.name = this.name + '.surface';
    //scene.objects[shape.name] = shape;
    return shape;
  }


  newAtmosphere() {
    const atmosScale = 1.01;
    // TODO: https://threejs.org/examples/webgl_shaders_sky.html
    const atmosTex = Material.pathTexture(this.name, '_atmos.jpg');
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
    shape.name = this.name + '.atmosphere';
    return shape;
  }
}