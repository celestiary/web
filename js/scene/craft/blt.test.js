import {describe, expect, it} from 'bun:test'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {designBlt} from './blt.js'
import {appBodies, j2000ToDate} from './bodies.js'
import {geocentricTracks} from './ephemeris.js'
import {ballisticTransfer} from './flights.js'
import {GM, SECONDS_PER_DAY, dopri5, ratesOf} from './integrator.js'
import {TOLERANCES, earthModel, lunarTransfer} from './transfer.js'
import missions from './blt.horizons.json'
import designs from '../../../public/data/blt.json'


const vsop87c = await vsop87cLoader
const MOON_RADIUS = 1737400
const KM = 1000
// GRAIL-A's and CAPSTONE's arrivals, JDE: 2011-12-31 22:00 and 2022-11-13 12:00.
const ARRIVALS = {grailA: 2455927.42, capstone: 2459897.0}

/** @returns {number} C3, m²/s², from a Horizons row (km, km/s) about a body */
const c3Of = ({r, v}, gm) => (((v[0] ** 2) + (v[1] ** 2) + (v[2] ** 2)) * 1e6) - (2 * gm / (Math.hypot(...r) * KM))

/**
 * Fly a design forward and measure it: its apogee and how far that is from
 * the Sun's direction, and where it is at its arrival.
 *
 * @returns {{apogee: number, sunAngle: number, height: number}}
 */
function fly(tracks, d) {
  let apogee = {r: 0}
  const {y} = dopri5(ratesOf(earthModel(tracks, d.departure)), d.state, 0, d.days * SECONDS_PER_DAY, {...TOLERANCES,
    onStep: (t, s) => {
      const r = Math.hypot(s[0], s[1], s[2])
      if (r > apogee.r) {
        apogee = {r, at: [s[0], s[1], s[2]], jde: d.departure + (t / SECONDS_PER_DAY)}
      }
    }})
  const sun = tracks.sun.at(apogee.jde)
  const cos = apogee.at.reduce((sum, x, k) => sum + (x * sun[k]), 0) / (apogee.r * Math.hypot(...sun))
  const m = tracks.moon.at(d.arrival)
  return {apogee: apogee.r, sunAngle: Math.acos(cos) * 180 / Math.PI,
    height: Math.hypot(y[0] - m[0], y[1] - m[1], y[2] - m[2]) - MOON_RADIUS}
}


describe('a ballistic lunar transfer', () => {
  const tracks = geocentricTracks(appBodies(vsop87c))

  it('has GRAIL\'s and CAPSTONE\'s signature in Horizons: leaving near C3 −0.7, arriving near 0', () => {
    const grail = missions.transfers.grailA
    expect(c3Of(grail.transfer[0], GM.earth) / 1e6).toBeCloseTo(-0.71, 1)
    for (const name of ['grailA', 'capstone']) {
      const t = missions.transfers[name]
      // The farthest from the Earth: 1.5 million km, 20° off the Sun's way.
      const far = t.transfer.reduce((a, b) => (Math.hypot(...b.r) > Math.hypot(...a.r) ? b : a))
      expect(Math.hypot(...far.r) / 1e6).toBeGreaterThan(1.45)
      expect(Math.hypot(...far.r) / 1e6).toBeLessThan(1.6)
      // Nearly parabolic about the Moon a day out: a direct transfer's is
      // about +0.7 km²/s².
      expect(Math.abs(c3Of(t.approach[0], GM.moon) / 1e6)).toBeLessThan(0.1)
    }
    // CAPSTONE's farthest, 1,538,320 km on 2022 Aug 26: as Advanced Space
    // and Terran Orbital reported it (1.538 million km on 26 August).
    const cap = missions.transfers.capstone.transfer
    const far = cap.reduce((a, b) => (Math.hypot(...b.r) > Math.hypot(...a.r) ? b : a))
    expect(Math.hypot(...far.r) / 1e3).toBeCloseTo(1538, 0)
    expect(far.jd).toBeCloseTo(2459817.5, 0)
  })

  it('flies CAPSTONE\'s coast 1 million km out to kilometres', () => {
    // Ten days between its manoeuvres, where the Sun pulls as the Earth
    // does: 29 km without the light pressure, under 10 with a 25 kg craft's
    // 0.01 m²/kg.  A steady 0.6 km a day stays: its momentum dumps.
    const rows = missions.transfers.capstone.coast
    const s0 = [...j2000ToDate(rows[0].r, rows[0].jd), ...j2000ToDate(rows[0].v, rows[0].jd)].map((x) => x * KM)
    const last = rows[rows.length - 1]
    const want = j2000ToDate(last.r, last.jd).map((x) => x * KM)
    const miss = (srp) => {
      const {y} = dopri5(ratesOf(earthModel(tracks, rows[0].jd, srp)), s0, 0, (last.jd - rows[0].jd) * SECONDS_PER_DAY,
          TOLERANCES)
      return Math.hypot(y[0] - want[0], y[1] - want[1], y[2] - want[2])
    }
    expect(miss(null) / KM).toBeGreaterThan(20)
    expect(miss({areaToMass: 0.01, cr: 1.3}) / KM).toBeLessThan(10)
  })

  // GRAIL-A: launched 2011-09-10 13:08, 112 days; CAPSTONE: left its
  // Photon stage 2022-07-04, 132 days.  The design keeps, of those it finds
  // arriving then, the one leaving nearest the mission.
  const DEPARTURES = {grailA: 2455815.05, capstone: 2459764.8}
  for (const [name, arrival] of Object.entries(ARRIVALS)) {
    it(`designs one between ${name}'s dates like it, and cheaper at the Moon than a direct transfer`, () => {
      const far = Math.max(...missions.transfers[name].transfer.map((row) => Math.hypot(...row.r) * KM))
      const d = designBlt(tracks, arrival, {departure: DEPARTURES[name]})
      expect(d).not.toBeNull()
      // Leaving at C3 −0.5 to −0.7 km²/s² (GRAIL's −0.71); 40 to 80 m/s more
      // than a direct transfer's burn from the same orbit.
      expect(d.c3 / 1e6).toBeGreaterThan(-0.8)
      expect(d.c3 / 1e6).toBeLessThan(-0.45)
      const direct = lunarTransfer(tracks, arrival - 4.5)
      expect(d.dv - direct.dv).toBeGreaterThan(40)
      expect(d.dv - direct.dv).toBeLessThan(80)
      // Within three weeks of the mission's flight time, and out as far to
      // 15%, within 45° of the Sun's way or the opposite (theirs: 21°).
      expect(Math.abs(d.days - (arrival - DEPARTURES[name]))).toBeLessThan(21)
      const flown = fly(tracks, d)
      expect(Math.abs((flown.apogee / far) - 1)).toBeLessThan(0.15)
      expect(Math.min(flown.sunAngle, 180 - flown.sunAngle)).toBeLessThan(45)
      // And flown forward from its burn, it arrives where it was designed.
      expect(Math.abs(flown.height - 100e3)).toBeLessThan(1e3)
      // Into a circular 100 km orbit: 100 to 250 m/s less than the direct
      // transfer's (GRAIL's design saved about 130 m/s, into an ellipse).
      // Its energy about the Moon is the design's, C3 −0.02 km²/s².
      const rp = MOON_RADIUS + 100e3
      const blt = Math.sqrt(-2e4 + (2 * GM.moon / rp)) - Math.sqrt(GM.moon / rp)
      const loiDirect = Math.hypot(...direct.perilune.relV) - Math.sqrt(GM.moon / direct.perilune.r)
      expect(loiDirect - blt).toBeGreaterThan(100)
      expect(loiDirect - blt).toBeLessThan(250)
    }, 20000) // 2 to 3 s alone; over bun's 5 s on a cold or loaded machine
  }

  it('flies the designs the app offers to their arrival', () => {
    expect(designs.designs.length).toBeGreaterThan(40)
    for (const d of [designs.designs[0], designs.designs[Math.floor(designs.designs.length / 2)]]) {
      expect(d.departure).toBeLessThan(d.arrival)
      const path = ballisticTransfer(d.departure, appBodies(vsop87c), designs)
      expect(path.facts.departure).toBe(d.departure)
      expect(Math.abs(path.facts.height - 100e3)).toBeLessThan(1e3)
      expect(path.facts.loi).toBeGreaterThan(600)
      expect(path.facts.loi).toBeLessThan(720)
    }
    // The earliest leaving on or after the day, whatever its arrival; none
    // after the last.
    const last = Math.max(...designs.designs.map((d) => d.departure))
    expect(ballisticTransfer(last + 1, appBodies(vsop87c), designs)).toBeNull()
  })
})
