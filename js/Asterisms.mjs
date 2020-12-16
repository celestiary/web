import Parser from './lib/parser.js/parser.mjs';
import * as THREE from './lib/three.js/three.module.js';

import AsterismsCatalog from './AsterismsCatalog.mjs';
import StarsCatalog from './StarsCatalog.mjs';
import {labelTextColor} from './Stars.mjs';
import * as Material from './material.js';
import * as Shapes from './shapes.mjs';
import {SCALE} from './Stars.mjs';


export default class Asterisms extends THREE.Object3D {
  constructor(stars, cb) {
    super();
    this.name = 'Asterisms';
    this.stars = stars;
    this.catalog = new AsterismsCatalog(stars.catalog);
    this.catalog.load(() => {
        for (let astrName in this.catalog.byName) {
          this.show(astrName);
        }
        if (cb) {
          cb();
        }
      });
  }


  show(astrName, filterFn) {
    if (!filterFn) {
      filterFn = (stars, hipId, name) => {
        if (this.stars.catalog.namesByHip[hipId].length >= 2) {
          if (!name.match(/\w{2,3} [\w\d]{3,4}/)) {
            return true;
          }
        }
        return false;
      };
    }
    const asterism = this.catalog.byName[astrName];
    if (!asterism) {
      throw new Error('Unknown asterism: ', astrName);
    }
    const paths = asterism.paths;
    for (let pathNdx in paths) {
      let prevStar = null;
      const pathNames = paths[pathNdx];
      for (let i = 0; i < pathNames.length; i++) {
        const [origName, name, hipId] = this.stars.catalog.reifyName(pathNames[i]);
        const star = this.stars.catalog.starsByHip[hipId];
        if (!star) {
          console.warn(`Cannot find star, hipId(${hipId})`, name);
          window.catalog = this.stars.catalog;
          console.log('added catalog to window.catalog', this.stars);
          continue;
        }
        if (filterFn(this.stars, hipId, name)) {
          this.stars.showStarName(star, name);
        }
        if (prevStar) {
          try {
            const line = Shapes.line(
              SCALE * prevStar.x, SCALE * prevStar.y, SCALE * prevStar.z,
              SCALE * star.x, SCALE * star.y, SCALE * star.z)
              line.material = new THREE.LineBasicMaterial({color: labelTextColor});
            this.add(line);
          } catch (e) {
            console.error(`origName: ${origName}, hipId: ${hipId}: ${e}`);
            continue;
          }
        }
        prevStar = star;
      }
    }
  }


  reify(record, catalog) {
    const paths = record.paths;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      for (let n = 0; n < path.length; n++) {
        const [origName, name, hipId] = this.stars.catalog.reifyName(path[n]);
        if (hipId) {
          path[n] = name;
        }
      }
    }
  }
}
