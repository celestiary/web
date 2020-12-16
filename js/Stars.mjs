//import CustomPoints from './lib/three-custom/points.js';
import * as THREE from './lib/three.js/three.module.js';

import Loader from './loader.js';
import Object from './object.js';
import SpriteSheet from './SpriteSheet.js';
import StarsBufferGeometry from './StarsBufferGeometry.mjs';
import StarsCatalog from './StarsCatalog.mjs';
import * as Material from './material.js';
import * as Shapes from './shapes.mjs';
import {STARS_SCALE, labelTextColor, labelTextFont, FAR_OBJ} from './shared.mjs';
import {debug} from './log.mjs';
import {named} from './utils.mjs';


export default class Stars extends Object {
  constructor(props, catalogOrCb) {
    super('Stars', props);
    this.starLabelSpriteSheet = new SpriteSheet(17, 'Rigel Kentaurus B', labelTextFont);
    this.labelsGroup = named(new THREE.Group, 'LabelsGroup');
    this.labelsByName = {};
    this.labelLOD = named(new THREE.LOD, 'LabelsLOD');
    this.labelLOD.addLevel(this.labelsGroup, 1);
    this.labelLOD.addLevel(FAR_OBJ, 1e13);
    this.add(this.labelLOD);
    if (typeof catalogOrCb == 'StarsCatalog') {
      const catalog = catalogOrCb;
      if (!catalog.starsByHip) {
        throw new Error('Invalid stars catalog');
      }
      this.catalog = catalog;
      this.show();
    } else {
      this.catalog = new StarsCatalog();
      this.catalog.load(() => {
          this.show();
          if (typeof catalogOrCb == 'function') {
            const cb = catalogOrCb;
            cb();
          }
        });
    }
  }


  show() {
    const geom = new StarsBufferGeometry(this.catalog);
    const starImage = Material.pathTexture('star_glow', '.png');
    const starsMaterial = new THREE.ShaderMaterial({
        uniforms: {
          texSampler: { value: starImage }
        },
        vertexShader: 'js/shaders/stars.vert',
        fragmentShader: 'js/shaders/stars.frag',
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true
        });
    new Loader().loadShaders(starsMaterial, () => {
        //const starPoints = named(new CustomPoints(geom, starsMaterial), 'StarsPoints');
        const starPoints = named(new THREE.Points(geom, starsMaterial), 'StarsPoints');
        starPoints.sortParticles = true;
        this.add(starPoints);
        window.sp = starPoints;
      });
      //const starsMaterial = new THREE.PointsMaterial( { size: 10, vertexColors: true, sizeAttenuation: false } );
      //const starPoints = named(new CustomPoints(geom, starsMaterial), 'StarsPoints');
      //this.add(starPoints);
    for (let hipId in faves) {
      const star = this.catalog.starsByHip[hipId];
      if (star) {
        this.showStarName(star, faves[hipId]);
      } else {
        throw new Error(`Null star for hipId(${hipId})`);
      }
    }
  }


  // TODO fix this in the SpriteSheet.
  maybeWiden(str) {
    while (str.length < 8) {
      str = ` ${str} `;
    }
    return str;
  }


  showStarName(star, name) {
    if (this.labelsByName[name]) {
      //console.log('skipping double show of name: ', name);
      return;
    }
    const sPos = new THREE.Vector3(
        STARS_SCALE * star.x, STARS_SCALE * star.y, STARS_SCALE * star.z);
    const label = this.starLabelSpriteSheet.alloc(this.maybeWiden(name), labelTextColor);
    label.position.copy(sPos);
    this.labelsGroup.attach(label);
    this.labelsByName[name] = label;
  }
}


export const faves = {
  0: 'Sol',
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
  80763: 'Antares',
  83608: 'Arrakis',
  91262: 'Vega',
  102098: 'Deneb',
  97649: 'Altair',
  113881: 'Scheat'
};
