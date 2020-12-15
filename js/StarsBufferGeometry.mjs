import {BufferAttribute, BufferGeometry} from './lib/three.js/three.module.mjs';

import {SCALE as STARS_SCALE} from './Stars.mjs';
import {LENGTH_SCALE} from './shared.mjs';
import {StarSpectra} from './StarsCatalog.mjs';


export default class StarsBufferGeometry extends BufferGeometry {
  constructor(catalog) {
    super();
    const numStars = catalog.numStars;
    const coords = new Float32Array(numStars * 3);
    const colors = new Float32Array(numStars * 3);
    const sizes = new Float32Array(numStars);
    const sunSpectrum = StarSpectra[4];
    const minSize = 1;
    const maxLum = Math.pow(8, 4);
    let i = 0;
    const scale = STARS_SCALE;
    for (let hipId in catalog.starsByHip) {
      const star = catalog.starsByHip[hipId];
      const off = 3 * i;
      coords[off] = scale * star.x;
      coords[off + 1] = scale * star.y;
      coords[off + 2] = scale * star.z;
      let rgb = StarSpectra[star.spectralType];
      rgb = rgb || sunSpectrum;
      const lumRelSun = star.lumRelSun;
      const r = rgb[0] / 255;
      const g = rgb[1] / 255;
      const b = rgb[2] / 255;
      colors[off] = r;
      colors[off + 1] = g;
      colors[off + 2] = b;
      // 1E1 looks decent.  2E1 much more intriguing but a little fake.
      const scaleUp = 1e1;
      sizes[i] = star.radiusMeters * LENGTH_SCALE * scaleUp;
      i++;
    }
    // https://github.com/mrdoob/three.js/blob/master/examples/webgl_custom_attributes_points.html
    this.setAttribute('position', new BufferAttribute(coords, 3));
    this.setAttribute('color', new BufferAttribute(colors, 3));
    this.setAttribute('size', new BufferAttribute(sizes, 1));
    this.computeBoundingSphere();
  }
}
