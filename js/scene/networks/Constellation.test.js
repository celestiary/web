import {describe, expect, it} from 'bun:test'
import {Group, Vector3} from 'three'
import Constellation, {carry} from './Constellation.js'
import {newSatRecord, temePosition, temeToEquator} from '../satellites/sgp4.js'


// A Starlink-like shell (made up): 40 satellites, 53°, ~550 km.
const EPOCH = '2026-10-22T12:00:00.000'
const records = Array.from({length: 40}, (_, i) => newSatRecord({
  NORAD_CAT_ID: 50000 + i, OBJECT_NAME: `S ${i}`, EPOCH, MEAN_MOTION: 15.06, ECCENTRICITY: 0.00015,
  INCLINATION: 53.05, RA_OF_ASC_NODE: (i % 8) * 45, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: i * 9, BSTAR: 1e-4,
  MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
}, 'starlink'))
const JD = records[0].epochJd + 0.25
const SEC = 1 / 86400


/** @returns {Constellation} */
function shell(opts = {}) {
  const c = new Constellation(records, {name: 'test', colors: new Float32Array(records.length * 3), refreshFrames: 4, ...opts})
  new Group().add(c)
  return c
}


/**
 * @param {object} rec
 * @param {number} jd
 * @returns {Vector3} SGP4's position in the scene's frame
 */
function sgp4At(rec, jd) {
  return temeToEquator(temePosition(rec, jd), new Vector3)
}


describe('Constellation', () => {
  it('propagates all on the first frame, then a slice a frame', () => {
    const c = shell()
    c.update(JD)
    expect(c.lastRefreshed).toBe(40)
    c.update(JD + SEC)
    expect(c.lastRefreshed).toBe(10)
    // A jump in the date: all again.
    c.update(JD + 3)
    expect(c.lastRefreshed).toBe(40)
  })

  it('does nothing while hidden, and starts whole again', () => {
    const c = shell()
    c.update(JD)
    c.visible = false
    c.update(JD + SEC)
    expect(c.lastRefreshed).toBe(0)
    c.visible = true
    c.update(JD + (2 * SEC))
    expect(c.lastRefreshed).toBe(40)
  })

  it('carries a satellite between refreshes to within metres of SGP4', () => {
    const c = shell({refreshFrames: 1e9})
    c.update(JD)
    const out = new Vector3
    // Real time, a few frames: under a metre.  A minute (a fast clock): tens of metres.
    for (const [dt, tol] of [[0, 0.01], [0.2, 1], [2, 5], [60, 100]]) {
      c.update(JD + (dt * SEC))
      for (const i of [0, 17, 39]) {
        // Not refreshed since JD (one a frame, from 0: 1, 2, 3 were).
        if (i <= 3 && dt > 0) {
          continue
        }
        c.positionOf(i, out)
        expect(out.distanceTo(sgp4At(records[i], JD + (dt * SEC)))).toBeLessThan(tol)
      }
    }
  })

  it('puts on the GPU what the CPU mirror carries', () => {
    const c = shell()
    c.update(JD)
    c.update(JD + (30 * SEC))
    const attrs = c.points.geometry.attributes
    const u = c.points.material.uniforms.uNow.value
    const i = 39
    const r0 = [attrs.position.getX(i), attrs.position.getY(i), attrs.position.getZ(i)]
    const vw = [attrs.aVw.getX(i), attrs.aVw.getY(i), attrs.aVw.getZ(i)]
    const gpu = carry(r0, vw, 0, attrs.aState.getX(i), u - attrs.aState.getY(i), new Vector3)
    expect(gpu.distanceTo(c.positionOf(i, new Vector3))).toBeLessThan(5)
    expect(attrs.aState.getZ(i)).toBe(1)
  })

  it('hides a satellite outside its elements\' window', () => {
    const c = shell()
    c.update(records[0].epochJd + 45)
    expect(c.shown.every((s) => s === 0)).toBe(true)
    expect(c.positionOf(0, new Vector3)).toBeNull()
  })
})
