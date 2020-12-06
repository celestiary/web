import * as THREE from './lib/three.js/three.module.js';
import Object from './object.js';
import SpriteSheet from './SpriteSheet.js';
import * as Shapes from './shapes.js';
import * as Shared from './shared.js';
import * as Material from './material.js';
import {capitalize} from './utils.js';
import {assertFinite, assertInRange} from './lib/testing.js/testing.mjs';


export default class Planet extends Object {


  static LABEL_SHEET = new SpriteSheet(5, 'Jupiter', Shared.labelTextFont);


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
    orbitPlane.rotation.x = assertInRange(orbit.inclination, 0, 360) * Shared.toRad;
    orbitPlane.rotation.y = assertInRange(orbit.longitudeOfPerihelion, 0, 360) * Shared.toRad;

    const orbitShape = this.newOrbit(this.scene, orbit, this.name);
    orbitPlane.add(orbitShape);
    orbitShape.visible = this.orbitsVisible;
    this.scene.orbitShapes[this.name] = orbitShape;

    const orbitPosition = this.scene.newGroup(this.name + '.orbitPosition');
    orbitPlane.add(orbitPosition);

    // Attaching this property triggers orbit of planet during animation.
    // See animation.js#animateSystem.
    orbitPosition.orbit = this.props.orbit;

    const planetTilt = this.scene.newGroup(this.name + '.planetTilt');
    orbitPosition.add(planetTilt);
    planetTilt.rotateZ(assertInRange(this.props.axialInclination, 0, 360) * Shared.toRad);

    const planet = this.newPlanet(this.scene);
    planetTilt.add(planet);
    planet.orbitPosition = orbitPosition;

    // group.rotation.y = orbit.longitudeOfAscendingNode * Shared.toRad;
    // Children centered at this planet's orbit position.

    const nearLOD = new THREE.LOD();
    nearLOD.addLevel(Planet.LABEL_SHEET.alloc(capitalize(this.name),
                                              Shared.labelTextColor), 1);
    nearLOD.addLevel(Shared.FAR_OBJ, this.isMoon ? 1e3 : 1e7);
    planet.orbitPosition.add(nearLOD);

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
    pathShape.rotation.x = Shared.halfPi;
    group.add(pathShape);
    group.add(Shapes.line(1, 0, 0));
    group.scale.setScalar(assertFinite(orbit.semiMajorAxis) * Shared.LENGTH_SCALE);
    return group;
  }


  /**
   * Creates a planet with waypoint, surface, atmosphere and locations,
   * scaled-down by Shared.LENGTH_SCALE (i.e. 1e-7), and set to rotate.
   */
  newPlanet(scene) {
    const planet = scene.newObject(this.name, this.props, (mouse, intersect, clickRoot) => {
        console.log(`Planet ${this.name} clicked: `, mouse, intersect, clickRoot);
        //const tElt = document.getElementById('target-id');
        //tElt.innerText = this.name + (firstName ? ` (${firstName})` : '');
        //tElt.style.left = `${mouse.clientX}px`;
        //tElt.style.top = `${mouse.clientY}px`;
        //this.setTarget(this.name);
        //this.lookAtTarget();
      });
    const pointSize = this.props.radius.scalar * Shared.LENGTH_SCALE * 1E1;
    // console.log(`${this.name} point size: ${pointSize}`);
    planet.add(Shapes.point());
    planet.add(this.newSurface(this.props));
    if (this.props.texture_atmosphere) {
      planet.add(this.newAtmosphere());
    }
    if (this.props.has_locations) {
      planet.add(this.loadLocations(this.props));
    }
    planet.scale.setScalar(assertFinite(this.props.radius.scalar) * Shared.LENGTH_SCALE);
    // Attaching this property triggers rotation of planet during animation.
    planet.siderealRotationPeriod = this.props.siderealRotationPeriod;
    return planet;
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