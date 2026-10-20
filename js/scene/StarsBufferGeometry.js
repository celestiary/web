import {BufferAttribute, BufferGeometry} from 'three'
import {blackbodyFromLut, sharedBlackbodyLut, starTeff} from './stellar.js'


/**
 * The star shader's attributes (shaders/stars.vert) for catalogue stars,
 * in the order given: one law for the whole catalogue in one geometry
 * (StarsBufferGeometry) and for each of its tiles
 * (catalogue/catalogueTile.js), so a star draws the same either way.
 *
 * @param {Array<object>} stars StarProps
 * @param {number} n How many
 * @returns {{idsByNdx: Int32Array, coords: Float32Array, positionLow: Float32Array, colors: Float32Array,
 *   radii: Float32Array, lumens: Float32Array}}
 */
export function starAttributes(stars, n) {
  const idsByNdx = new Int32Array(n)
  const coords = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const radii = new Float32Array(n)
  const lumens = new Float32Array(n)
  const lut = sharedBlackbodyLut()
  const colorByClass = new Map
  // positionLow stores the float64 residual after quantising to float32.
  // Together, coords (high) + positionLow (low) represent the full double-precision
  // star position, enabling RTE (Relative-To-Eye) in the vertex shader.
  const positionLow = new Float32Array(n * 3)
  let i = 0
  for (const star of stars) {
    idsByNdx[i] = star.hipId
    const off = 3 * i
    const hx = Math.fround(star.x)
    const hy = Math.fround(star.y)
    const hz = Math.fround(star.z)
    coords[off] = hx
    coords[off + 1] = hy
    coords[off + 2] = hz
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
  }
  return {idsByNdx, coords, positionLow, colors, radii, lumens}
}


/** Pack the data from a StarsCatalog into a BufferGeometry. */
export default class StarsBufferGeometry extends BufferGeometry {
  /** @param {object} catalog */
  constructor(catalog) {
    super()
    // Every star it holds, the Sun's too (at HIP 0).
    const stars = [...catalog.starByHip.values()]
    const a = starAttributes(stars, stars.length)
    this.idsByNdx = a.idsByNdx
    this.coords = a.coords
    this.starsArray = stars
    // https://github.com/mrdoob/three.js/blob/master/examples/webgl_custom_attributes_points.html
    this.setAttribute('position', new BufferAttribute(this.coords, 3))
    this.setAttribute('positionLow', new BufferAttribute(a.positionLow, 3))
    this.setAttribute('color', new BufferAttribute(a.colors, 3))
    this.setAttribute('radius', new BufferAttribute(a.radii, 1))
    this.setAttribute('lumens', new BufferAttribute(a.lumens, 1))
    this.computeBoundingSphere()
  }
}
