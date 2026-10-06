import {BufferAttribute, BufferGeometry} from 'three'
import {blackbodyFromLut, sharedBlackbodyLut, starTeff} from './stellar.js'


/** Pack the data from a StarsCatalog into a BufferGeometry. */
export default class StarsBufferGeometry extends BufferGeometry {
  /** @param {object} catalog */
  constructor(catalog) {
    super()
    const numStars = catalog.numStars
    this.idsByNdx = new Int32Array(numStars)
    this.coords = new Float32Array(numStars * 3)
    this.starsArray = []
    const colors = new Float32Array(numStars * 3)
    const radii = new Float32Array(numStars)
    const lumens = new Float32Array(numStars)
    const lut = sharedBlackbodyLut()
    const colorByClass = new Map
    // const maxLum = Math.pow(8, 4)
    // positionLow stores the float64 residual after quantising to float32.
    // Together, coords (high) + positionLow (low) represent the full double-precision
    // star position, enabling RTE (Relative-To-Eye) in the vertex shader.
    const positionLow = new Float32Array(numStars * 3)
    let i = 0
    catalog.starByHip.forEach((star, hipId) => {
      this.idsByNdx[i] = hipId
      this.starsArray.push(star)
      const off = 3 * i
      const hx = Math.fround(star.x)
      const hy = Math.fround(star.y)
      const hz = Math.fround(star.z)
      this.coords[off] = hx
      this.coords[off + 1] = hy
      this.coords[off + 2] = hz
      positionLow[off] = star.x - hx
      positionLow[off + 1] = star.y - hy
      positionLow[off + 2] = star.z - hz
      // Its blackbody's colour at a luminance of 1 (stellar.js), so its
      // brightness is its lumens' alone, and the same colour as its disc.
      const key = `${star.kind}:${star.spectralType}:${star.sub}:${star.lumClass}:${star.teff}`
      let rgb = colorByClass.get(key)
      if (!rgb) {
        rgb = blackbodyFromLut(lut, starTeff(star))
        colorByClass.set(key, rgb)
      }
      colors[off] = rgb[0]
      colors[off + 1] = rgb[1]
      colors[off + 2] = rgb[2]
      radii[i] = star.radius
      lumens[i] = star.lumens
      i++
    })
    // https://github.com/mrdoob/three.js/blob/master/examples/webgl_custom_attributes_points.html
    this.setAttribute('position', new BufferAttribute(this.coords, 3))
    this.setAttribute('positionLow', new BufferAttribute(positionLow, 3))
    this.setAttribute('color', new BufferAttribute(colors, 3))
    this.setAttribute('radius', new BufferAttribute(radii, 1))
    this.setAttribute('lumens', new BufferAttribute(lumens, 1))
    this.computeBoundingSphere()
  }
}
