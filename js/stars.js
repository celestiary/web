import * as THREE from './lib/three.js/three.module.js';
import Object from './object.js';
import CustomPoints from './lib/three-custom/points.js';
import Loader from './loader.js';
import SpriteSheet from './SpriteSheet.js';
import * as CelestiaData from './celestia-data.mjs';
import * as Material from './material.js';
import * as Shapes from './shapes.js';
import * as Shared from './shared.js';
import {debug} from './log.mjs';


const SCALE = 9.461E12 * 1E3 * Shared.LENGTH_SCALE;

export default class Stars extends Object {
  constructor(props, onClick) {
    super('stars', props, onClick);
    const maxLabel = 'Rigel Kentaurus B';
    this.starLabelSpriteSheet = new SpriteSheet(13, maxLabel, Shared.labelTextFont);
    this.catalog = null;
    this.namesGroup = new THREE.Object3D;
    this.add(this.namesGroup);
    this.asterismsGroup = new THREE.Object3D;
    this.add(this.asterismsGroup);
    this.load(props);
  }


  load(props) {
    //const cursor = this.debugAxes(10);
    let origSizes = {}, lastNdx = null;

    const starInfo = (textPos, ndx, fullInfo) => {
      const starRecord = this.catalog.stars[ndx];
      const hipId = parseInt(starRecord.hipId);
      let name = this.catalog.namesByHip[hipId];
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

    /*
    const stars = this.scene.newObject('stars', props, (mouse, intersect, clickRoot) => {
        console.log(`Stars clicked: `, mouse, intersect, clickRoot);
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
          const label = makeLabel(info);
          label.position.copy(textPos);
          intersect.object.add(label);
        }
      });
    */
    CelestiaData.loadStars((catalog) => {
        console.log('catalog', catalog);
        this.catalog = catalog;
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
            this.add(starPoints);
          });

        const faveStars = {
          0: '  Sol  ', // TODO: short name width/height ratio bug.. tmp workaround.
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
          const star = catalog.index[hipId];
          if (!star) {
            console.error('cant find hip: ', hipId);
            continue;
          }
          const name = faveStars[hipId];
          this.showStarName(star, name);
        }
        fetch('data/asterisms.dat').then((rsp) => {
            rsp.text().then((text) => {
                catalog.asterisms = CelestiaData.readAsterismsFile(text);
                for (let i in catalog.asterisms) {
                  const asterism = catalog.asterisms[i];
                  this.showConstellation(asterism.paths, catalog);
                }
              });
          });
      });
  }


  showStarName(star, name) {
    const labelLOD = new THREE.LOD();
    const sPos = new THREE.Vector3(SCALE * star.x, SCALE * star.y, SCALE * star.z);
    const label = this.starLabelSpriteSheet.alloc(name, Shared.labelTextColor);
    labelLOD.position.copy(sPos);
    labelLOD.addLevel(label, 1);
    labelLOD.addLevel(Shared.FAR_OBJ, 1e13);
    this.namesGroup.add(labelLOD);
  }


  starGeomFromCelestia(catalog) {
    //catalog = Utils.testStarCube(catalog, 1);
    //catalog = Utils.sampleStarCatalog(catalog, 1E5);
    const stars = catalog.stars;
    // km/ly * m/km * lengthScale
    const scale = 9.461E12 * 1E3 * Shared.LENGTH_SCALE;
    const n = stars.length;
    console.log('Stars: ', n);
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
      sizes[i] = star.radiusMeters * Shared.LENGTH_SCALE * 1E1;
    }
    //console.log('coords: ', coords)
    geom.setAttribute('position', new THREE.BufferAttribute(coords, 3));
    geom.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    return geom;
  }


  showConstellation(paths, catalog) {
    for (let pathNdx in paths) {
      let lastStar = null;
      const pathNames = paths[pathNdx];
      for (let i = 0; i < pathNames.length; i++) {
        const [origName, name, hipId] = CelestiaData.reifyName(pathNames[i], catalog);
        const star = catalog.index[hipId];
        if (!star) {
          debug('Cannot find star: ', name);
          continue;
        }
        const starNames = catalog.namesByHip[hipId];
        if (!starNames) {
          throw new Error(`Star names catalog corrupted, missing hipId ${hipId} for origName ${origName}`);
        }
        // Only show interesting star names
        if (starNames.length > 2) {
          this.showStarName(star, name);
        }
        if (lastStar) {
          try {
            const line = Shapes.line(
              SCALE * lastStar.x, SCALE * lastStar.y, SCALE * lastStar.z,
              SCALE * star.x, SCALE * star.y, SCALE * star.z)
              line.material = new THREE.LineBasicMaterial({color: Shared.labelTextColor});
            this.asterismsGroup.add(line);
          } catch (e) {
            console.error(`origName: ${origName}, hipId: ${hipId}: ${e}`);
            continue;
          }
        }
        lastStar = star;
      }
    }
  }
}