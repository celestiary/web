import {describe, expect, it} from 'bun:test'
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {jacobi} from '../cr3bp.js'
import {appBodies, j2000ToDate} from './bodies.js'
import {geocentricTracks} from './ephemeris.js'
import {
  EARTH_J2, EARTH_RADIUS, GM, SECONDS_PER_DAY, dopri5, newForceModel, orbitalEnergy, ratesOf, symplectic,
} from './integrator.js'
import {earthModel} from './transfer.js'
import {sunSyncInclination} from '../regimes.js'
import tess from './tess.horizons.json'


const vsop87c = await vsop87cLoader
const gm = GM.earth
const TIGHT = {rtol: 1e-12, atol: [1e-4, 1e-4, 1e-4, 1e-7, 1e-7, 1e-7]}
const ORBITS = 100

/**
 * An orbit's state at its pericentre, tilted 0.5 rad.
 *
 * @returns {Array<number>}
 */
function orbit(a, e) {
  const rp = a * (1 - e)
  const vp = Math.sqrt(gm * (1 + e) / rp)
  return [rp, 0, 0, 0, vp * Math.cos(0.5), vp * Math.sin(0.5)]
}

/** @returns {number} the period of the orbit through s, seconds */
const periodOf = (s) => 2 * Math.PI * Math.sqrt(((-gm / (2 * orbitalEnergy(gm, s))) ** 3) / gm)

/**
 * Integrate ORBITS periods and measure the worst energy error and how far
 * the craft ends from where it started (where it should be).
 *
 * @returns {{energy: number, miss: number}} relative, and metres
 */
function drift(s0, run) {
  const e0 = orbitalEnergy(gm, s0)
  let worst = 0
  const {y} = run((t, s) => {
    worst = Math.max(worst, Math.abs((orbitalEnergy(gm, s) - e0) / e0))
  })
  return {energy: worst, miss: Math.hypot(y[0] - s0[0], y[1] - s0[1], y[2] - s0[2])}
}


describe('a craft\'s integrator', () => {
  const twoBody = newForceModel({gm, epoch: 2461336.5})

  it('keeps a low orbit\'s energy: bounded with Yoshida\'s order 4, drifting slowly with Dormand-Prince', () => {
    const s0 = orbit(EARTH_RADIUS + 400e3, 0)
    const T = periodOf(s0)
    const yoshida = drift(s0, (cb) => symplectic(twoBody, s0, 0, ORBITS * T, T / 1000, {order: 4, onStep: cb}))
    const leapfrog = drift(s0, (cb) => symplectic(twoBody, s0, 0, ORBITS * T, T / 1000, {order: 2, onStep: cb}))
    const dp = drift(s0, (cb) => dopri5(ratesOf(twoBody), s0, 0, ORBITS * T, {...TIGHT, onStep: cb}))
    // Measured over 1000 orbits (Craft.md): 1.8e-13, 3.9e-10, 4.5e-8.
    expect(yoshida.energy).toBeLessThan(1e-12)
    expect(leapfrog.energy).toBeLessThan(1e-9)
    expect(dp.energy).toBeLessThan(1e-8)
    // Where it ends, 100 orbits on: the phase error.
    expect(yoshida.miss).toBeLessThan(100)
    expect(dp.miss).toBeLessThan(500)
    expect(leapfrog.miss).toBeGreaterThan(10e3)
  })

  it('needs the adaptive integrator on an eccentric orbit', () => {
    // Molniya, e 0.72: a fixed step that's fine at apogee is far too long at
    // perigee.
    const s0 = orbit(26554e3, 0.722)
    const T = periodOf(s0)
    const dp = drift(s0, (cb) => dopri5(ratesOf(twoBody), s0, 0, 20 * T, {...TIGHT, onStep: cb}))
    const yoshida = drift(s0, (cb) => symplectic(twoBody, s0, 0, 20 * T, T / 200, {order: 4, onStep: cb}))
    expect(dp.energy).toBeLessThan(1e-8)
    expect(dp.miss).toBeLessThan(1e3)
    expect(yoshida.energy).toBeGreaterThan(1e-5)
  })

  it('turns a sun-synchronous orbit\'s node with the Sun, by J2', () => {
    // regimes.js's inclination at 700 km, flown: the node should turn
    // 360° a year.
    const a = EARTH_RADIUS + 700e3
    const deg = sunSyncInclination({gm, j2: EARTH_J2, equatorialRadius: EARTH_RADIUS}, 365.2422 * SECONDS_PER_DAY, a)
    expect(deg).toBeCloseTo(98.19, 1)
    const i = deg * Math.PI / 180
    const v = Math.sqrt(gm / a)
    const s0 = [a, 0, 0, 0, v * Math.cos(i), v * Math.sin(i)]
    const accel = newForceModel({gm, j2: EARTH_J2, radius: EARTH_RADIUS, pole: [0, 0, 1], epoch: 2461336.5})
    const node = (s) => {
      const h = [(s[1] * s[5]) - (s[2] * s[4]), (s[2] * s[3]) - (s[0] * s[5])]
      return Math.atan2(h[0], -h[1])
    }
    const days = 10
    const {y} = dopri5(ratesOf(accel), s0, 0, days * SECONDS_PER_DAY, TIGHT)
    const turned = (node(y) - node(s0)) * 180 / Math.PI
    expect(turned / days).toBeCloseTo(360 / 365.2422, 2)
  })

  it('keeps the Jacobi constant with the Moon on a circle (the CR3BP)', () => {
    // The Moon on a circle at the pair's mean motion: the force model, about
    // the Earth with the frame's acceleration, is then the CR3BP, whose
    // Jacobi constant (cr3bp.js) a transfer must keep.
    const a = 384400e3
    const n = Math.sqrt((GM.earth + GM.moon) / (a ** 3))
    const mu = GM.moon / (GM.earth + GM.moon)
    const circle = {at: (jde, out = [0, 0, 0]) => {
      const th = n * (jde - 2461336.5) * SECONDS_PER_DAY
      out[0] = a * Math.cos(th)
      out[1] = a * Math.sin(th)
      out[2] = 0
      return out
    }}
    const accel = newForceModel({gm, perturbers: [{gm: GM.moon, track: circle}], epoch: 2461336.5})
    const toCr3bp = (t, s) => {
      const th = n * t
      const c = Math.cos(-th)
      const sn = Math.sin(-th)
      // Barycentric: less μ of the Moon's place and velocity.
      const m = circle.at(2461336.5 + (t / SECONDS_PER_DAY))
      const vm = [-n * m[1], n * m[0], 0]
      const r = [s[0] - (mu * m[0]), s[1] - (mu * m[1]), s[2]]
      const v = [s[3] - (mu * vm[0]), s[4] - (mu * vm[1]), s[5]]
      const rr = [(c * r[0]) - (sn * r[1]), (sn * r[0]) + (c * r[1]), r[2]]
      const vr = [(c * v[0]) - (sn * v[1]), (sn * v[0]) + (c * v[1]), v[2]]
      // Less the frame's turn, ω × r.
      vr[0] += n * rr[1]
      vr[1] -= n * rr[0]
      return [...rr.map((x) => x / a), ...vr.map((x) => x / (a * n))]
    }
    // A translunar injection from 185 km.
    const rp = EARTH_RADIUS + 185e3
    const s0 = [-rp, 0, 0, 0, -10.92e3, 0]
    const c0 = jacobi(mu, toCr3bp(0, s0))
    let worst = 0
    dopri5(ratesOf(accel), s0, 0, 5 * SECONDS_PER_DAY, {...TIGHT, onStep: (t, s) => {
      worst = Math.max(worst, Math.abs(jacobi(mu, toCr3bp(t, s)) - c0))
    }})
    // C is 2.5 here, the difference of 2U and v², each about 117 at 185 km:
    // 2e-9 of it is 2e-11 of them.
    expect(worst).toBeLessThan(5e-9)
  })

  it('flies TESS as Horizons has it, to a few hundred metres in three days', () => {
    // TESS's lunar-resonant orbit, between momentum dumps (tess.horizons.json,
    // tools/craft/fetchHorizons.mjs).  The Sun's light pressure is all that's
    // left: a cannonball of 0.015 m²/kg, Cr 1.3, fitted on the first arc,
    // holds the second, two weeks on, too.
    const tracks = geocentricTracks(appBodies(vsop87c))
    for (const arc of tess.arcs) {
      const s0 = [...j2000ToDate(arc[0].r, arc[0].jd), ...j2000ToDate(arc[0].v, arc[0].jd)].map((x) => x * 1000)
      for (const [srp, bound] of [[null, 4e3], [{areaToMass: 0.015, cr: 1.3}, 300]]) {
        const rates = ratesOf(earthModel(tracks, arc[0].jd, srp))
        const last = arc[arc.length - 1]
        const want = j2000ToDate(last.r, last.jd).map((x) => x * 1000)
        const {y} = dopri5(rates, s0, 0, (last.jd - arc[0].jd) * SECONDS_PER_DAY, TIGHT)
        const miss = Math.hypot(y[0] - want[0], y[1] - want[1], y[2] - want[2])
        expect(miss).toBeLessThan(bound)
        if (!srp) {
          // Without it, kilometres: the pressure's 1.4e-7 m/s².
          expect(miss).toBeGreaterThan(2e3)
        }
      }
    }
  })
})
