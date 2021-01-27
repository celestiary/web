import * as THREE from './lib/three.js/three.module.js';

import GalaxyBufferGeometry from './GalaxyBufferGeometry.js';
import {pathTexture} from './material.js';


const Tau = 2.0 * Math.PI;
const armDensityRatio = 0.4;
const G = 1e-8;
const colorTemp = 0.5;
const minDistnce = 0.1;

export default class Galaxy extends THREE.Points {
  // numStars, ms
  // 400, 20
  // 500, 30
  // 600, 40
  // 700, 54
  // 800, 70
  // 900, 88
  // 1000, 110
  constructor(numStars = 2, radius = 10, mass = numStars) {
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
    const masses = this.geometry.attributes.mass.array;
    const velocities = this.geometry.attributes.velocity.array;
    const colors = this.geometry.attributes.color.array;
    let xi, yi, zi;
    if (false) {
      //masses[0] = 1000;
      //colors[0] = colors[1] = colors[2] = 0;
      for (let i = 0; i < numStars; i++) {
        const off = 3 * i, xi = off, yi = off + 1, zi = off + 2;
        const theta = Math.random() * Tau;
        const numSpokes = 0;
        const r = Math.random() * radius;
        coords[xi] = r * Math.cos(theta);
        coords[yi] = (radius / 8) * (Math.random() - 0.5);
        coords[zi] = r * Math.sin(theta);
        colors[xi] = 1 - colorTemp + colorTemp * Math.random();
        colors[yi] = 1 - colorTemp + colorTemp * Math.random();
        colors[zi] = 1 - colorTemp + colorTemp * Math.random();
        masses[i] = 10 * ((1 - armDensityRatio) + armDensityRatio * Math.cos(theta * numSpokes));
      }
    } else {
      // Custom setup for testing..
      // star 0: 0,0,0
      masses[0] = 1000;
      colors[0] = colors[1] = colors[2] = 1;

      // star 1: 1,0,0
      coords[3] = 1;
      masses[1] = 5;
      colors[3] = 1;
      const axes = new THREE.AxesHelper();
      axes.position.set(1, 0, 0);
      this.add(axes);

      // star 2: -1,0,0
      /*
      coords[6] = -1;
      masses[2] = 5;
      colors[7] = 1;

      // star 3: 2,0,0
      coords[9] = 2;
      masses[3] = 5;
      colors[9] = colors[10] = 1;

      // star 4: -2,0,0
      coords[12] = -2;
      masses[4] = 5;
      colors[12] = colors[14] = 1;
      */
    }
    this.newAccels = new Float32Array(velocities.length);

    const M0 = masses[0];
    // Set the orbital speed the the magnitude from this equation:
    //   https://en.wikipedia.org/wiki/Orbital_speed#Mean_orbital_speed
    // and normal (tangent, along the orbit) to the gravity vector (inward).
    this.computeAccels(coords, masses, velocities, this.newAccels);
    for (let i = 0; i < numStars; i++) {
      const off = 3 * i, xi = off, yi = off + 1, zi = off + 2;
      const x = coords[xi], z = coords[zi];
      const R = Math.sqrt(x * x + z * z);
      const M = masses[i];
      const aX = this.newAccels[xi], aZ = this.newAccels[zi];
      const aR = Math.sqrt(aX * aX + aZ * aZ);
      const fR = M * aR;
      if (false) {
        // https://en.wikipedia.org/wiki/Standard_gravitational_parameter#Small_body_orbiting_a_central_body
        const T = 1.4e3;
        const mu = (4 * Math.PI * Math.PI * R*R*R) / (T * T);
        const F = R == 0 ? 0 : Math.sqrt(mu * M) / R;
        velocities[xi] = F * z;
        velocities[zi] = F * -x;
      } else if (true) {
        const mu = G * M0;
        const F = R == 0 ? 0 : Math.sqrt(mu * R) / R;
        velocities[xi] = F * z;
        velocities[zi] = F * -x;
      } else {
        const speed = aR * 1e6;
        velocities[xi] = speed * aZ;
        velocities[zi] = speed * -aX;
      }
      //console.log(`${xi} ${zi} ${R} ${F}`);
    }
    //console.log('first coords, velocities:', coords, velocities);
  }


  computeAccels(coords, masses, velocities, newAccels) {
    for (let i = 0; i < coords.length; i += 3) {
      const xi = i, yi = i + 1, zi = i + 2;
      const aX = coords[xi];
      const aY = coords[yi];
      const aZ = coords[zi];
      const aM = masses[i / 3];
      let fX = 0, fY = 0, fZ = 0;
      for (let j = coords.length - 3; j > i ; j -= 3) {
        const xj = j, yj = j + 1, zj = j + 2;
        const bX = coords[xj];
        const bY = coords[yj];
        const bZ = coords[zj];
        const bM = masses[j / 3];

        const dX = bX - aX;
        const dY = bY - aY;
        const dZ = bZ - aZ;
        const d = Math.sqrt(dX*dX + dY*dY + dZ*dZ) + minDistnce;
        const g = G / (d * d * d);
        const bMG = bM * g;
        const aMG = aM * g;
        fX += bMG * dX;
        fY += bMG * dY;
        fZ += bMG * dZ;
        newAccels[xj] += aMG * -dX;
        newAccels[yj] += aMG * -dY;
        newAccels[zj] += aMG * -dZ;
        //if (false) {
        //  console.log(`d(${d}) g(${g}) dX(${dX}) dY(${dY}) dZ(${dZ})`);
        //}
      }
      newAccels[xi] += fX;
      newAccels[yi] += fY;
      newAccels[zi] += fZ;
    }
  }


  move(coords, velocities, newAccels) {
    for (let i = 0; i < this.numStars; i++) {
      const off = 3 * i, xi = off, yi = off + 1, zi = off + 2;
      coords[xi] += velocities[xi] += newAccels[xi];
      coords[yi] += velocities[yi] += newAccels[yi];
      coords[zi] += velocities[zi] += newAccels[zi];
      newAccels[xi] = newAccels[yi] = newAccels[zi] = 0;
    }
  }


  animate(debug) {
    const coords = this.geometry.attributes.position.array;
    const masses = this.geometry.attributes.mass.array;
    const velocities = this.geometry.attributes.velocity.array;
    const newAccels = this.newAccels;
    this.computeAccels(coords, masses, velocities, newAccels);
    this.move(coords, velocities, newAccels);
    //console.log('newAccels:', newAccels);
    if (this.first) {
      this.first = false;
      if (debug) {
        console.log('first coords, velocities:', coords, velocities);
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}


const vertexShader = `
  attribute float mass;
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = mass * 50. / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;


const fragmentShader = `
// https://gamedev.stackexchange.com/questions/138384/how-do-i-avoid-using-the-wrong-texture2d-function-in-glsl
#if __VERSION__ < 130
#define TEXTURE2D texture2D
#else
#define TEXTURE2D texture
#endif
  uniform sampler2D texSampler;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.) * TEXTURE2D(texSampler, gl_PointCoord);
  }
`;
