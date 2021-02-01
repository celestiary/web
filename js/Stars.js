//import CustomPoints from './lib/three-custom/points.js';
import * as THREE from './lib/three.js/three.module.js';

import Loader from './loader.js';
import Object from './object.js';
import SpriteSheet from './SpriteSheet.js';
import StarsBufferGeometry from './StarsBufferGeometry.js';
import StarsCatalog from './StarsCatalog.js';
import * as Material from './material.js';
import * as Shapes from './shapes.js';
import {STARS_SCALE, labelTextColor, FAR_OBJ} from './shared.js';
import {debug} from './log.js';
import {named} from './utils.js';


// > 10k is too much for my old laptop.
const MAX_LABELS = 10000;


export default class Stars extends Object {
  constructor(props, catalogOrCb, showLabels = false, pointsLoadedCb) {
    super('Stars', props);
    this.labelsGroup = named(new THREE.Group, 'LabelsGroup');
    this.pointsLoadedCb = pointsLoadedCb;
    this.labelCenterPosByName = {};
    this.labelLOD = named(new THREE.LOD, 'LabelsLOD');
    this.labelLOD.visible = showLabels;
    this.labelLOD.addLevel(this.labelsGroup, 1);
    this.labelLOD.addLevel(FAR_OBJ, 1e14);
    this.add(this.labelLOD);
    if (typeof catalogOrCb == 'StarsCatalog') {
      const catalog = catalogOrCb;
      if (!catalog.starsByHip) {
        throw new Error('Invalid stars catalog');
      }
      this.catalog = catalog;
      this.show();
      if (showLabels) {
        this.showLabels();
      }
    } else {
      this.catalog = new StarsCatalog();
      this.catalog.load(() => {
          this.show();
          if (typeof catalogOrCb == 'function') {
            const cb = catalogOrCb;
            cb();
          }
          if (showLabels) {
            this.showLabels();
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
        if (this.pointsLoadedCb) {
          this.pointsLoadedCb();
        }
      });
      //const starsMaterial = new THREE.PointsMaterial( { size: 10, vertexColors: true, sizeAttenuation: false } );
      //const starPoints = named(new CustomPoints(geom, starsMaterial), 'StarsPoints');
      //this.add(starPoints);
  }


  showLabels(level = 2) {
    const toShow = [];
    this.addFaves(toShow);
    for (let hipId in this.catalog.starsByHip) {
      if (faves[hipId]) {
        continue;
      }
      const star = this.catalog.starsByHip[hipId];
      const names = this.catalog.namesByHip[hipId];
      if (names && names.length > level) {
        toShow.push([star, names[0]]);
      } else if (star.absMag < -5) {
        toShow.push([star, 'HIP ' + hipId]);
      }
      if (toShow.length >= MAX_LABELS) {
        console.warn('Stars#showLabels: hit max count of ' + MAX_LABELS);
        break;
      }
    }
    this.starLabelSpriteSheet = new SpriteSheet(toShow.length, 'Rigel Kentaurus B');
    for (let i = 0; i < toShow.length; i++) {
      const [star, name] = toShow[i];
      this.showStarName(star, name);
    }
    this.labelsGroup.add(this.starLabelSpriteSheet.compile());
  }


  showStarName(star, name) {
    if (this.labelCenterPosByName[name]) {
      console.warn('skipping double show of name: ', name);
      return;
    }
    const x = STARS_SCALE * star.x, y = STARS_SCALE * star.y, z = STARS_SCALE * star.z;
    const sPos = new THREE.Vector3(x, y, z);
    this.starLabelSpriteSheet.add(x, y, z, name);
    this.labelCenterPosByName[name] = sPos;
  }


  addFaves(toShow) {
    for (let hipId in faves) {
      const star = this.catalog.starsByHip[hipId];
      if (star) {
        toShow.push([star, faves[hipId]]);
      } else {
        throw new Error(`Null star for hipId(${hipId})`);
      }
    }
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
