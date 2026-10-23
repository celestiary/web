import {Group} from 'three'
import {newRings} from '../LagrangeMarks.js'
import {newLabels} from '../overlayMarks.js'
import {utcToTtJulianDay} from '../celestialFrame.js'
import {newWideLineStrip} from '../wideLines.js'


// A craft's flight (flights.js), drawn about its central body: its path,
// and a marker and its name where the craft is at the clock's time, shown
// only while it's in flight.  Positions are ecliptic of date, the scene's
// frame, turned to the scene's axes (x, z, −y).

const WIDTH = 1.5
const OPACITY = 0.9


/** */
export default class CraftTrack extends Group {
  /**
   * @param {object} flight a FLIGHTS entry
   * @param {{t: Float64Array, xyz: Float64Array}} path flights.js make's
   * @param {number} [layer]
   */
  constructor(flight, path, layer = null) {
    super()
    this.name = `craft.${flight.code}`
    this.flight = flight
    this.path = path
    const n = path.t.length
    const points = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      points[3 * i] = path.xyz[3 * i]
      points[(3 * i) + 1] = path.xyz[(3 * i) + 2]
      points[(3 * i) + 2] = -path.xyz[(3 * i) + 1]
    }
    this.points = points
    this.line = newWideLineStrip(points, {name: `craft.${flight.code}.path`, color: flight.color, width: WIDTH,
      opacity: OPACITY})
    this.marker = newRings(flight.color, 1)
    this.marker.name = `craft.${flight.code}.now`
    this.labels = newLabels([{text: flight.name, color: flight.color}])
    this.add(this.line, this.marker, this.labels.sprites)
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
    }
    // Animation calls this with the frame's Julian Day (UTC).
    this.preAnimCb = (time, jd) => this.place(utcToTtJulianDay(jd))
    this.place(path.t[0] - 1)
  }


  /**
   * Put the marker where the craft is at a time, by linear interpolation
   * between the integrator's steps; hide it outside the flight.
   *
   * @param {number} jde
   * @returns {boolean} whether it's in flight
   */
  place(jde) {
    const {t} = this.path
    const flying = jde >= t[0] && jde <= t[t.length - 1]
    this.marker.visible = flying
    this.labels.sprites.visible = flying
    if (!flying) {
      return false
    }
    let lo = 0
    let hi = t.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (t[mid] <= jde) {
        lo = mid
      } else {
        hi = mid
      }
    }
    const f = (jde - t[lo]) / ((t[hi] - t[lo]) || 1)
    const p = this.points
    const at = [0, 1, 2].map((k) => p[(3 * lo) + k] + (f * (p[(3 * hi) + k] - p[(3 * lo) + k])))
    const attr = this.marker.geometry.getAttribute('position')
    attr.setXYZ(0, ...at)
    attr.needsUpdate = true
    const labels = this.labels.sheet.positionAttribute
    if (labels) {
      labels.setXYZ(0, ...at)
      labels.needsUpdate = true
    }
    return true
  }


  /** Free the GPU buffers. */
  dispose() {
    this.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    this.removeFromParent()
  }
}
