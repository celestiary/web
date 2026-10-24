import {AdditiveBlending, Color, Group} from 'three'
import Constellation from './Constellation.js'
import {clusterPlanes, inService, iridiumLinks} from './iridium.js'
import {newWideLines, setWideLineSegments} from '../wideLines.js'


// Iridium NEXT and its crosslinks (Networks.md, "Iridium"): the satellites as
// a Constellation propagated whole each frame (80 of them), coloured by
// plane, the spares grey; and the links between them, worked out again each
// frame from where the satellites are (iridium.js), as wide lines.


/** The six planes' colours, west to east from the seam. */
export const PLANE_COLORS = [0xff8f6f, 0xffc46f, 0xe8f06f, 0x8ff08f, 0x6fd8ff, 0xb09fff]
const SPARE_COLOR = 0x8a8a8a
const CROSS_COLOR = 0xe8e8ff
// The links are fainter than the satellites, and additive, so the crossings
// over the poles don't pile up into a white knot.
const IN_PLANE_GAIN = 0.55
const CROSS_GAIN = 0.4
const LINK_WIDTH_PX = 1.5
// Each satellite has at most two links in its plane and two across.
const LINKS_PER_SAT = 4
const RAD = 180 / Math.PI


/** */
export default class IridiumNetwork extends Group {
  /**
   * @param {Array<object>} records sgp4.js SatRecords, CelesTrak's iridium-NEXT
   * @param {object} [opts]
   * @param {?number} [opts.layer] the overlay layer
   * @param {?object} [opts.camera] the view's
   */
  constructor(records, {layer = null, camera = null} = {}) {
    super()
    this.name = 'iridium'
    this.records = records
    this.service = inService(records)
    // The node as the elements have it: the planes keep their order, and
    // each satellite its plane, over the snapshot's weeks.
    this.planes = clusterPlanes(records.map((r) => r.satrec.nodeo * RAD), this.service)
    this.planeOf = new Int8Array(records.length).fill(-1)
    this.planes.forEach((plane, k) => plane.forEach((i) => {
      this.planeOf[i] = k
    }))
    const colors = new Float32Array(records.length * 3)
    const c = new Color
    records.forEach((r, i) => {
      const k = this.planeOf[i]
      c.setHex(k >= 0 ? PLANE_COLORS[k % PLANE_COLORS.length] : SPARE_COLOR).toArray(colors, i * 3)
    })
    this.sats = new Constellation(records, {name: 'iridium', colors, pointSize: 3.5, refreshFrames: 1, layer, camera})
    // Driven from here, so the links follow this frame's positions.
    this.sats.preAnimCb = null
    this.add(this.sats)
    const capacity = Math.max(1, records.length * LINKS_PER_SAT / 2)
    this.inPlaneLines = this._newLines('iridium in-plane links', capacity, layer)
    this.crossLines = this._newLines('iridium cross-plane links', capacity, layer)
    this._seg = {start: new Float64Array(capacity * 3), end: new Float64Array(capacity * 3), color: new Float32Array(capacity * 3)}
    this.links = {inPlane: [], crossPlane: []}
    this.preAnimCb = (time, jd) => this.update(jd)
  }


  /** @param {number} jd Julian Day (UTC) */
  update(jd) {
    this.sats.update(jd, this.visible)
    const drawn = this.visible && this.sats.points.visible && this.sats.primed
    this.inPlaneLines.visible = this.crossLines.visible = drawn
    // Not drawn, or the clock held (nothing moved): the links stand.
    if (!drawn || this.sats.lastRefreshed === 0) {
      return
    }
    // Refreshed this frame, all of them: their states are where they are.
    const {r0, vw, shown} = this.sats
    this.links = iridiumLinks(r0, vw, this.planes, shown)
    this._write(this.inPlaneLines, this.links.inPlane, (link) => PLANE_COLORS[link[2] % PLANE_COLORS.length], IN_PLANE_GAIN)
    this._write(this.crossLines, this.links.crossPlane, () => CROSS_COLOR, CROSS_GAIN)
  }


  /**
   * @param {object} mesh
   * @param {Array<Array<number>>} links
   * @param {function(Array<number>): number} colorOf
   * @param {number} gain
   */
  _write(mesh, links, colorOf, gain) {
    const {start, end, color} = this._seg
    const r = this.sats.r0
    const c = new Color
    const n = Math.min(links.length, start.length / 3)
    for (let k = 0; k < n; k++) {
      const [a, b] = links[k]
      for (let d = 0; d < 3; d++) {
        start[(3 * k) + d] = r[(3 * a) + d]
        end[(3 * k) + d] = r[(3 * b) + d]
      }
      c.setHex(colorOf(links[k])).multiplyScalar(gain).toArray(color, 3 * k)
    }
    setWideLineSegments(mesh, this._seg, n)
  }


  /**
   * @param {string} name
   * @param {number} capacity
   * @param {?number} layer
   * @returns {object} a wideLines mesh of that many segments, none drawn yet
   */
  _newLines(name, capacity, layer) {
    const zeros = new Float64Array(capacity * 3)
    const mesh = newWideLines({start: zeros, end: zeros, color: new Float32Array(capacity * 3)}, {name})
    mesh.geometry.instanceCount = 0
    mesh.material.blending = AdditiveBlending
    mesh.material.uniforms.uWidthFirst.value = mesh.material.uniforms.uWidthLast.value = LINK_WIDTH_PX
    if (layer !== null) {
      mesh.layers.set(layer)
    }
    this.add(mesh)
    return mesh
  }


  /** Free the GPU buffers. */
  dispose() {
    this.removeFromParent()
    this.sats.dispose()
    for (const mesh of [this.inPlaneLines, this.crossLines]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
}
