import {Float32BufferAttribute, BufferGeometry} from 'three'


/** */
export default class GalaxyBufferGeometry extends BufferGeometry {
  /** @param {number} numStars */
  constructor(numStars) {
    super()
    const coords = new Float32Array(numStars * 3)
    const colors = new Float32Array(numStars * 3)
    const velocities = new Float32Array(numStars * 3)
    const masses = new Float32Array(numStars)
    this.setAttribute('position', new Float32BufferAttribute(coords, 3))
    this.setAttribute('mass', new Float32BufferAttribute(masses, 1))
    this.setAttribute('velocity', new Float32BufferAttribute(velocities, 3))
    this.setAttribute('color', new Float32BufferAttribute(colors, 3))
    this.computeBoundingSphere()
  }
}
