import * as THREE from './lib/three.js/three.module.js';

import GalaxyBufferGeometry from './GalaxyBufferGeometry.js';
import {pathTexture} from './Material.js';


export default class Galaxy extends THREE.Points {
  // numPoints, ms
  // 400, 20
  // 500, 30
  // 600, 40
  // 700, 54
  // 800, 70
  // 900, 88
  // 1000, 110
  constructor(numPoints = 400) {
    super(new GalaxyBufferGeometry(numPoints),
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
    this.numPoints = numPoints;
    this.first = true;
  }


  animate(debug) {
    const G = 1e-8;
    const M = 1e-1;
    const coords = this.geometry.attributes.position.array;
    const sizes = this.geometry.attributes.size.array;
    const velocities = this.geometry.attributes.velocity.array;
    if (this.first) {
      this.first = false;
      if (debug) {
        console.log('first coords, velocities:', coords, velocities);
      }
    }

    // Two coords, a and b, each with...
    // Sizes
    let aS, bS;
    // X, Y, Z components
    let aX, aY, aZ, bX, bY, bZ;
    // Distance components between them
    let dX, dY, dZ;
    // Velocity components
    let aVX, aVY, aVZ, bVX, bVY, bVZ;
    let d, g;
    for (let i = 0; i < coords.length; i += 3) {
      const xi = i, yi = i + 1, zi = i + 2;
      aX = coords[xi];
      aY = coords[yi];
      aZ = coords[zi];
      aS = sizes[i / 3];
      aVX = velocities[xi];
      aVY = velocities[yi];
      aVZ = velocities[zi];
      for (let j = 0; j < coords.length; j += 3) {
        if (i == j) {
          continue;
        }
        const xj = j, yj = j + 1, zj = j + 2;
        bX = coords[xj];
        bY = coords[yj];
        bZ = coords[zj];
        bS = sizes[j / 3];
        bVX = velocities[xj];
        bVY = velocities[yj];
        bVZ = velocities[zj];

        dX = aX - bX;
        dY = aY - bY;
        dZ = aZ - bZ;
        if (debug) {
          console.log('dX, dY, dZ:', dX, dY, dZ);
        }
        d = Math.pow(dX*dX + dY*dY + dZ*dZ, 0.3333333333333333);
        if (debug) {
          console.log('dX, dY, dZ:', dX, dY, dZ);
        }
        g = G / (d * d);
        if (debug) {
          console.log(`d(${d}) g(${g})`);
        }
        const xG = dX * g, yG = dY * g, zG = dZ * g;
        aVX += bS * -xG;
        aVY += bS * -yG;
        aVZ += bS * -zG;
        bVX += aS * xG;
        bVY += aS * yG;
        bVZ += aS * zG;
        aX += aVX;
        aY += aVY;
        aZ += aVZ;
        bX += bVX;
        bY += bVY;
        bZ += bVZ;
        coords[xj] = bX;
        coords[yj] = bY;
        coords[zj] = bZ;
        velocities[xj] = bVX;
        velocities[yj] = bVY;
        velocities[zj] = bVZ;
      }
      coords[xi] = aX;
      coords[yi] = aY;
      coords[zi] = aZ;
      velocities[xi] = aVX;
      velocities[yi] = aVY;
      velocities[zi] = aVZ;
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
