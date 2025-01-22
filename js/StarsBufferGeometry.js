import {BufferAttribute, BufferGeometry} from 'three'
import {StarSpectra} from './StarsCatalog.js'


/** Pack the data from a StarsCatalog into a BufferGeometry. */
export default class StarsBufferGeometry extends BufferGeometry {
  /** @param {StarsCatalog} */
  constructor(catalog) {
    super()
    const numStars = catalog.numStars
    this.idsByNdx = new Int32Array(numStars)
    this.coords = new Float32Array(numStars * 3)
    this.starsArray = []
    const colors = new Float32Array(numStars * 3)
    const radii = new Float32Array(numStars)
    const lumens = new Float32Array(numStars)
    const sunSpectrum = StarSpectra[4]
    // const maxLum = Math.pow(8, 4)
    let i = 0
    catalog.starByHip.forEach((star, hipId) => {
      this.idsByNdx[i] = hipId
      this.starsArray.push(star)
      const off = 3 * i
      this.coords[off] = star.x
      this.coords[off + 1] = star.y
      this.coords[off + 2] = star.z
      let rgb = StarSpectra[star.spectralType]
      rgb = rgb || sunSpectrum
      // const lumRelSun = star.lumRelSun
      const r = rgb[0] / 255
      const g = rgb[1] / 255
      const b = rgb[2] / 255
      colors[off] = r
      colors[off + 1] = g
      colors[off + 2] = b
      radii[i] = star.radius
      lumens[i] = star.lumens
      i++
    })
    // https://github.com/mrdoob/three.js/blob/master/examples/webgl_custom_attributes_points.html
    this.setAttribute('position', new BufferAttribute(this.coords, 3))
    this.setAttribute('color', new BufferAttribute(colors, 3))
    this.setAttribute('radius', new BufferAttribute(radii, 1))
    this.setAttribute('lumens', new BufferAttribute(lumens, 1))
    this.computeBoundingSphere()
  }
}
