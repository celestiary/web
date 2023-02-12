// import CustomPoints from './lib/three-custom/points.js';
import * as THREE from 'three';
import Loader from './Loader.js';
import Object from './object.js';
import SpriteSheet from './SpriteSheet.js';
import StarsBufferGeometry from './StarsBufferGeometry.js';
import StarsCatalog, { FAVES } from './StarsCatalog.js';
import * as Material from './material.js';
import { FAR_OBJ } from './shared.js';
import { named } from './utils.js';
// > 10k is too much for my old laptop.
const MAX_LABELS = 10000;
/** */
export default class Stars extends Object {
    /** */
    constructor(props, catalogOrCb, pointsLoadedCb, showLabels = false, faves = FAVES) {
        super('Stars', props);
        this.labelsGroup = named(new THREE.Group, 'LabelsGroup');
        this.pointsLoadedCb = pointsLoadedCb;
        this.faves = faves;
        this.labelLOD = named(new THREE.LOD, 'LabelsLOD');
        this.labelLOD.visible = showLabels;
        this.labelLOD.addLevel(this.labelsGroup, 1);
        this.labelLOD.addLevel(FAR_OBJ, 1e14);
        this.add(this.labelLOD);
        this.geom = null;
        // Used by guide/Asterisms.jsx to center camera.
        this.labelCenterPosByName = {};
        if (catalogOrCb instanceof StarsCatalog) {
            console.log('Caller gave catalog: ', catalogOrCb);
            const catalog = catalogOrCb;
            if (!catalog.starsByHip) {
                throw new Error('Invalid stars catalog');
            }
            this.catalog = catalog;
            this.show();
            if (showLabels) {
                this.showLabels();
            }
        }
        else {
            this.catalog = new StarsCatalog();
            this.catalog.load(() => {
                this.show();
                if (typeof catalogOrCb === 'function') {
                    const cb = catalogOrCb;
                    cb();
                }
                if (showLabels) {
                    this.showLabels();
                }
            });
        }
    }
    /** */
    show() {
        this.geom = new StarsBufferGeometry(this.catalog);
        const starImage = Material.pathTexture('star_glow', '.png');
        const starsMaterial = new THREE.ShaderMaterial({
            uniforms: {
                texSampler: { value: starImage },
            },
            vertexShader: '/shaders/stars.vert',
            fragmentShader: '/shaders/stars.frag',
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            transparent: true,
        });
        new Loader().loadShaders(starsMaterial, () => {
            // const starPoints = named(new CustomPoints(this.geom, starsMaterial), 'StarsPoints');
            const starPoints = named(new THREE.Points(this.geom, starsMaterial), 'StarsPoints');
            starPoints.sortParticles = true;
            this.add(starPoints);
            window.sp = starPoints;
            if (this.pointsLoadedCb) {
                this.pointsLoadedCb();
            }
        });
        /*
        this.add(new THREE.Points(this.geom, new THREE.PointsMaterial({
          size: 3,
          sizeAttenuation: false
        })));
        */
    }
    /** */
    showLabels(level = 2) {
        const toShow = [];
        this.addFaves(toShow);
        for (const hipId in this.catalog.starsByHip) {
            if (this.faves[hipId]) {
                continue;
            }
            const star = this.catalog.starsByHip[hipId];
            const names = this.catalog.namesByHip[hipId];
            if (names && names.length > level) {
                toShow.push([star, names[0]]);
            }
            else if (star.absMag < -5) {
                toShow.push([star, `HIP ${hipId}`]);
            }
            if (toShow.length >= MAX_LABELS) {
                console.warn(`Stars#showLabels: hit max count of ${MAX_LABELS}`);
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
    /** */
    showStarName(star, name) {
        const scale = this.catalog.starScale;
        const x = scale * star.x;
        const y = scale * star.y;
        const z = scale * star.z;
        const sPos = new THREE.Vector3(x, y, z);
        this.starLabelSpriteSheet.add(x, y, z, name);
        this.labelCenterPosByName[name] = sPos;
    }
    /** */
    addFaves(toShow) {
        for (const hipId in this.faves) {
            if (!Object.prototype.hasOwnProperty.call(hipId, this.faves)) {
                continue;
            }
            const star = this.catalog.starsByHip[hipId];
            if (star) {
                toShow.push([star, this.faves[hipId]]);
            }
            else {
                throw new Error(`Null star for hipId(${hipId})`);
            }
        }
    }
}
