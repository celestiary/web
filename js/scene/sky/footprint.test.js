import {describe, expect, it} from 'bun:test'
import {footprintCells, footprintFrame, outsideFootprint} from './footprint.js'
import {lonLatToVec, mocFromCells} from './hips.js'
import {RUBIN_FIRST_LOOK} from './surveys.js'


const toDeg = 180 / Math.PI
const [VIRGO, TRIFID] = RUBIN_FIRST_LOOK.footprints


describe('Rubin\'s First Look footprints', () => {
  it('turns the Trifid and Lagoon image as its screen-size image shows it', () => {
    // On noirlab2521b's screen image (13.12″ a pixel from its centre) the
    // Trifid's centre is 295 px right and 142 px up: 1.075°, 0.518°.
    const {c, r, u} = footprintFrame(TRIFID)
    const v = lonLatToVec(270.596, -23.03)
    const w = (v[0] * c[0]) + (v[1] * c[1]) + (v[2] * c[2])
    const x = ((v[0] * r[0]) + (v[1] * r[1]) + (v[2] * r[2])) / w * toDeg
    const y = ((v[0] * u[0]) + (v[1] * u[1]) + (v[2] * u[2])) / w * toDeg
    expect(Math.abs(x - 1.075)).toBeLessThan(0.03)
    expect(Math.abs(y - 0.518)).toBeLessThan(0.03)
  })

  it('holds the Trifid, the Lagoon and the Virgo field\'s centre, and not what is beyond', () => {
    expect(outsideFootprint(TRIFID, lonLatToVec(270.596, -23.03))).toBe(0)
    expect(outsideFootprint(TRIFID, lonLatToVec(270.904, -24.38))).toBe(0)
    expect(outsideFootprint(VIRGO, lonLatToVec(VIRGO.raDeg, VIRGO.decDeg))).toBe(0)
    expect(outsideFootprint(TRIFID, lonLatToVec(271.6, -28))).toBeGreaterThan(0)
    expect(outsideFootprint(TRIFID, lonLatToVec(90, 20))).toBe(Infinity)
  })

  it('is the manifest\'s committed coverage (tools/hips/coverage.mjs footprints, order 8, 0.05° pad)', () => {
    const cells = new Set
    for (const f of RUBIN_FIRST_LOOK.footprints) {
      for (const pix of footprintCells(8, f, 0.05)) {
        cells.add(pix)
      }
    }
    const moc = mocFromCells(8, cells)
    expect(Object.fromEntries(Object.entries(moc).map(([k, v]) => [String(k), v]))).toEqual(RUBIN_FIRST_LOOK.coverage)
  })
})
