import {Float32BufferAttribute, BufferGeometry} from './lib/three.js/three.module.mjs';


export default class GalaxyBufferGeometry extends BufferGeometry {
  constructor(numStars) {
    super();
    const radius = 10;
    const speed = 1e-5;
    const coords = new Float32Array(numStars * 3);
    const colors = new Float32Array(numStars * 3);
    const velocities = new Float32Array(numStars * 3);
    const sizes = new Float32Array(numStars);
    let xi, yi, zi;
    for (let i = 0; i < numStars; i++) {
      const off = 3 * i, xi = off, yi = off + 1, zi = off + 2;
      const x = radius * (Math.random() - 0.5);
      const y = radius * (Math.random() - 0.5);
      const z = radius * (Math.random() - 0.5);
      coords[xi] = x;
      coords[yi] = y;
      coords[zi] = z;
      colors[xi] = Math.random();
      colors[yi] = Math.random();
      colors[zi] = Math.random();
      sizes[i] = 10 * Math.random();
      velocities[xi] = -y * speed;
      velocities[yi] = x * speed;
      velocities[zi] = 0;
    }
    /*
    coords[0] = -1
    colors[0] = 1;
    sizes[0] = 1;
    velocities[1] = speed;

    colors[4] = 1;
    sizes[1] = 50;
    */
    this.setAttribute('position', new Float32BufferAttribute(coords, 3));
    this.setAttribute('size', new Float32BufferAttribute(sizes, 1));
    this.setAttribute('velocity', new Float32BufferAttribute(velocities, 3));
    this.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.computeBoundingSphere();
  }
}
