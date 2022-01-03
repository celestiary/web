import {BufferAttribute, BufferGeometry} from 'three';

import {StarSpectra} from './StarsCatalog.js';


export default class StarsBufferGeometry extends BufferGeometry {
  constructor(catalog) {
    super();
    const numStars = catalog.numStars;
    this.coords = new Float32Array(numStars * 3);
    this.starsArray = [];
    const colors = new Float32Array(numStars * 3);
    const sizes = new Float32Array(numStars);
    const sunSpectrum = StarSpectra[4];
    const minSize = 1;
    const maxLum = Math.pow(8, 4);
    let i = 0;
    for (let hipId in catalog.starsByHip) {
      const star = catalog.starsByHip[hipId];
      this.starsArray.push(star);
      const off = 3 * i;
      this.coords[off] = catalog.starScale * star.x;
      this.coords[off + 1] = catalog.starScale * star.y;
      this.coords[off + 2] = catalog.starScale * star.z;
      let rgb = StarSpectra[star.spectralType];
      rgb = rgb || sunSpectrum;
      const lumRelSun = star.lumRelSun;
      const r = rgb[0] / 255;
      const g = rgb[1] / 255;
      const b = rgb[2] / 255;
      colors[off] = r;
      colors[off + 1] = g;
      colors[off + 2] = b;
      sizes[i] = star.radiusMeters * catalog.lengthScale;
      i++;
    }
    // https://github.com/mrdoob/three.js/blob/master/examples/webgl_custom_attributes_points.html
    this.setAttribute('position', new BufferAttribute(this.coords, 3));
    this.setAttribute('color', new BufferAttribute(colors, 3));
    this.setAttribute('size', new BufferAttribute(sizes, 1));
    this.computeBoundingSphere();
  }
}
