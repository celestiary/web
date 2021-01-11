import * as THREE from './lib/three.js/three.module.js';

import GalaxyBufferGeometry from './GalaxyBufferGeometry.js';
import {pathTexture} from './Material.js';


const Tau = 2.0 * Math.PI;
const armDensityRatio = 0.4;
const G = 1e-6;
const speed = 30;
const colorTemp = 0.5;

export default class Galaxy extends THREE.Points {
  // numStars, ms
  // 400, 20
  // 500, 30
  // 600, 40
  // 700, 54
  // 800, 70
  // 900, 88
  // 1000, 110
  constructor(numStars = 2000, radius = 10, mass = numStars) {
    super(new GalaxyBufferGeometry(numStars),
          new THREE.ShaderMaterial({
              uniforms: {
                texSampler: { value: pathTexture('star_glow', '.png') },
              },
              vertexShader: vertexShader,
              fragmentShader: fragmentShader,
              blending: THREE.AdditiveBlending,
              depthTest: true,
              depthWrite: false,
              transparent: true,
            }));
    this.numStars = numStars;
    this.first = true;

    const coords = this.geometry.attributes.position.array;
    const sizes = this.geometry.attributes.size.array;
    const velocities = this.geometry.attributes.velocity.array;
    const colors = this.geometry.attributes.color.array;
    let xi, yi, zi;
    for (let i = 0; i < numStars; i++) {
      const off = 3 * i, xi = off, yi = off + 1, zi = off + 2;
      const theta = Math.random() * Tau;
      const numSpokes = 8;
      const r = Math.random() * radius;
      const x = r * Math.cos(theta);
      const y = (radius / 8) * (Math.random() - 0.5);
      const z = r * Math.sin(theta);
      coords[xi] = x;
      coords[yi] = y;
      coords[zi] = z;
      colors[xi] = 1 - colorTemp + colorTemp * Math.random();
      colors[yi] = 1 - colorTemp + colorTemp * Math.random();
      colors[zi] = 1 - colorTemp + colorTemp * Math.random();
      sizes[i] = 10 * ((1 - armDensityRatio) + armDensityRatio * Math.cos(theta * numSpokes));// * (mass / numStars) * Math.random();
      velocities[xi] = 0;
      velocities[yi] = 0;
      velocities[zi] = 0;
    }
  }


  animate(debug) {
    const coords = this.geometry.attributes.position.array;
    const sizes = this.geometry.attributes.size.array;
    const velocities = this.geometry.attributes.velocity.array;
    const newVelos = new Array(velocities.length).fill(0);
    if (this.first) {
      this.first = false;
      if (debug) {
        console.log('first coords, velocities:', coords, velocities);
      }
    }

    for (let i = 0; i < coords.length; i += 3) {
      const xi = i, yi = i + 1, zi = i + 2;
      const aX = coords[xi];
      const aY = coords[yi];
      const aZ = coords[zi];
      const aS = sizes[i / 3];
      let fX = 0, fY = 0, fZ = 0;
      for (let j = 0; j < coords.length; j += 3) {
        if (i == j) {
          continue;
        }
        const xj = j, yj = j + 1, zj = j + 2;
        const bX = coords[xj];
        const bY = coords[yj];
        const bZ = coords[zj];
        const bS = sizes[j / 3];

        const dX = bX - aX;
        const dY = bY - aY;
        const dZ = bZ - aZ;
        if (debug) {
          console.log('dX, dY, dZ:', dX, dY, dZ);
        }
        const d = Math.pow(dX*dX + dY*dY + dZ*dZ, 0.5);
        if (debug) {
          console.log('dX, dY, dZ:', dX, dY, dZ);
        }
        const g = G / (d * d);
        if (debug) {
          console.log(`d(${d}) g(${g})`);
        }
        const bSG = bS * g;
        fX += bSG * dX;
        fY += bSG * dY;
        fZ += bSG * dZ;
      }
      newVelos[xi] += fX;
      newVelos[yi] += fY;
      newVelos[zi] += fZ;
    }
    for (let i = 0; i < coords.length; i += 3) {
      const xi = i, yi = i + 1, zi = i + 2;
      velocities[xi] = speed * newVelos[zi];
      velocities[zi] = speed * -newVelos[xi];
      coords[xi] += velocities[xi] += newVelos[xi];
      coords[yi] += velocities[yi] += newVelos[yi];
      coords[zi] += velocities[zi] += newVelos[zi];
      newVelos[xi] = newVelos[yi] = newVelos[zi] = 0;
    }
    if (debug) {
      console.log(coords, velocities);
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}


const vertexShader = `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * 50. / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;


const fragmentShader = `
  uniform sampler2D texSampler;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.) * texture(texSampler, gl_PointCoord);
  }
`;
