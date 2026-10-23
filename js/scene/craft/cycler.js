import {GM, SECONDS_PER_DAY, dopri5, newForceModel, ratesOf} from './integrator.js'
import {lambert} from './lambert.js'


// Aldrin's Earth-Mars cycler (Craft.md, cyclers; #272's scope 5): a craft
// on a solar orbit that meets the Earth every synodic period, 2.135 years,
// and Mars about 146 days after each Earth pass, for ever, with only the
// planets' gravity (nearly) to keep it so (Aldrin 1985; Byrnes, Longuski
// and Aldrin, "Cycler orbit between Earth and Mars", J. Spacecraft and
// Rockets 30, 1993).  Its line of apsides has to turn 51.4° a cycle, as the
// planets' configuration does, and the Earth's flyby turns it.
//
// Made in patched conics on the planets as VSOP87C has them: each cycle
// two Lambert arcs (lambert.js), Earth to Mars and Mars back to the Earth
// one cycle after the last Earth pass; at each flyby the craft's speed
// relative to the planet (v∞) must be turned from the arc in to the arc
// out.  What the planet's gravity can't do, above a least flyby height, is
// paid in Δv (a powered flyby: the burn at periapsis that matches the two
// speeds, and a rotation of the rest).  The ideal cycler on circles
// (idealAldrin) is one conic a cycle and checks against the papers; on the
// planets as they are, the cycles are seeded from it and adjusted together
// for the least Δv (aldrinCycler).

/** The flybys' least heights over the planets, m, and their radii. */
const FLYBY = {earth: {gm: GM.earth, radius: 6378e3, height: 300e3}, mars: {gm: GM.mars, radius: 3396e3, height: 200e3}}
/** The synodic period of the Earth and Mars, days. */
export const SYNODIC_DAYS = 779.94
// The ideal's search: the Mars pass looked for within LEG_DAYS[1] of the
// Earth's, the start's phase coarse then fine; days.
const LEG_DAYS = [100, 200]
const COARSE = 4
const FINE = 1
const AU = 149597870700
const J2000 = 2451545
// Mars's mean distance, AU (Standish's semi-major axis).
const MARS_AU = 1.52371
// Coordinate descent's steps, days, coarse to fine.
const DESCENT_STEPS = [8, 4, 2, 1, 0.5]
const GOLDEN_STEPS = 40
// The conics' Kepler arcs, integrated about the Sun alone.
const KEPLER = {rtol: 1e-10, atol: [1, 1, 1, 1e-6, 1e-6, 1e-6]}
// Steps no longer than this, seconds, where a least distance is read off them.
const MISS_STEP = SECONDS_PER_DAY / 8


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {number} the angle between them, radians
 */
function angle(a, b) {
  const dot = (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
  return Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b)))))
}


/**
 * The Δv a flyby needs to turn v∞ in to v∞ out: a burn at periapsis that
 * matches their speeds, where the turn can be had above the least height;
 * where it can't, the rest of the turn rotated at the speed out.
 *
 * @param {Array<number>} vin v∞ in, m/s
 * @param {Array<number>} vout v∞ out
 * @param {{gm: number, radius: number, height: number}} planet
 * @returns {{dv: number, turn: number, maxTurn: number, rp: number}}
 */
export function flybyDv(vin, vout, {gm, radius, height}) {
  const a = Math.hypot(...vin)
  const b = Math.hypot(...vout)
  const turn = angle(vin, vout)
  const rMin = radius + height
  // The turn of a hyperbola: asin(1/e) each side, e = 1 + rp v∞² / gm.
  const turnAt = (rp) => Math.asin(1 / (1 + (rp * a * a / gm))) + Math.asin(1 / (1 + (rp * b * b / gm)))
  const maxTurn = turnAt(rMin)
  let rp = rMin
  let rotate = 0
  if (turn <= maxTurn) {
    // Bisect for the periapsis that turns it just so.
    let lo = rMin
    let hi = rMin * 1e4
    for (let i = 0; i < 60; i++) {
      rp = (lo + hi) / 2
      if (turnAt(rp) > turn) {
        lo = rp
      } else {
        hi = rp
      }
    }
  } else {
    rotate = 2 * b * Math.sin((turn - maxTurn) / 2)
  }
  const burn = Math.abs(Math.sqrt((b * b) + (2 * gm / rp)) - Math.sqrt((a * a) + (2 * gm / rp)))
  return {dv: burn + rotate, turn, maxTurn, rp}
}


/**
 * A Lambert arc between two planets, and the craft's v∞ at each end.
 *
 * @param {object} tracks heliocentric, by planet
 * @param {string} from
 * @param {number} t0 JDE
 * @param {string} to
 * @param {number} t1 JDE
 * @param {number} [revs] whole turns about the Sun first (lambert's)
 * @param {string} [branch] lambert's
 * @returns {?{from: string, to: string, t0: number, t1: number, r0: Array<number>,
 *     r1: Array<number>, v0: Array<number>, v1: Array<number>, vInf0: Array<number>,
 *     vInf1: Array<number>}}
 */
export function leg(tracks, from, t0, to, t1, revs = 0, branch = 'low') {
  const r0 = tracks[from].at(t0)
  const r1 = tracks[to].at(t1)
  const arc = lambert(r0, r1, (t1 - t0) * SECONDS_PER_DAY, GM.sun, [0, 0, 1], revs, branch)
  if (!arc) {
    return null
  }
  const p0 = velocityOf(tracks[from], t0)
  const p1 = velocityOf(tracks[to], t1)
  return {from, to, t0, t1, r0, r1, v0: arc.v1, v1: arc.v2, vInf0: arc.v1.map((x, k) => x - p0[k]),
    vInf1: arc.v2.map((x, k) => x - p1[k])}
}


/**
 * The cycle from an Earth pass at t: to Mars after `leg` days, back to the
 * Earth at t + `cycle` days; and what its flybys cost: Mars's within it,
 * and the Earth's at its start, given the arc it came in on.
 *
 * @returns {?{a: object, b: object, dvMars: number, dvEarth: number}}
 */
function cycleFrom(tracks, t, legDays, cycleDays, inbound) {
  const a = leg(tracks, 'earth', t, 'mars', t + legDays)
  const b = a && leg(tracks, 'mars', t + legDays, 'earth', t + cycleDays)
  if (!b) {
    return null
  }
  const dvMars = flybyDv(a.vInf1, b.vInf0, FLYBY.mars).dv
  // The first cycle's Earth departure: entering the cycler costs its v∞.
  const dvEarth = inbound ? flybyDv(inbound.vInf1, a.vInf0, FLYBY.earth).dv : Math.hypot(...a.vInf0)
  return {a, b, dvMars, dvEarth}
}


/**
 * Aldrin's cycler in the circular, coplanar model the papers use (Byrnes,
 * Longuski and Aldrin 1993): the planets on circles in one plane.  Each
 * cycle is one conic, from the Earth to the Earth a synodic period S later,
 * a little more than one turn round the Sun (the more energetic of the two
 * one-turn Lambert arcs); after S the whole configuration has turned by the
 * same angle, so the next cycle is this one turned, and the Earth's flyby
 * joins the arc in to its own copy turned.  The start's phase is searched
 * for the conic's crossing of Mars's orbit to fall where Mars is.
 *
 * @param {{earth: object, mars: object}} tracks on circles (any {at(jde)})
 * @param {number} start JDE: the phases searched are those of the next S days
 * @returns {?{t: number, conic: object, mars: {jde: number, miss: number, vInf: number},
 *     vInfEarth: number, earth: object, a: number, e: number, period: number}}
 *     miss the conic's least distance from Mars, m; earth flybyDv's
 */
export function idealAldrin(tracks, start) {
  const s = SYNODIC_DAYS
  const e0 = tracks.earth.at(start)
  const e1 = tracks.earth.at(start + s)
  const turn = Math.atan2(e1[1], e1[0]) - Math.atan2(e0[1], e0[0])
  const rotate = (v) => [(Math.cos(turn) * v[0]) - (Math.sin(turn) * v[1]),
    (Math.sin(turn) * v[0]) + (Math.cos(turn) * v[1]), v[2]]
  const marsPass = (t) => {
    const conic = leg(tracks, 'earth', t, 'earth', t + s, 1, 'high')
    if (!conic) {
      return null
    }
    // The conic's least distance from Mars over its first leg, by Kepler
    // propagation in short steps.
    let best = null
    const accel = newForceModel({gm: GM.sun, epoch: t})
    dopri5(ratesOf(accel), [...conic.r0, ...conic.v0], 0, LEG_DAYS[1] * SECONDS_PER_DAY, {...KEPLER, hMax: MISS_STEP,
      onStep: (time, y) => {
        const m = tracks.mars.at(t + (time / SECONDS_PER_DAY))
        const d = Math.hypot(y[0] - m[0], y[1] - m[1], y[2] - m[2])
        if (!best || d < best.miss) {
          best = {miss: d, time, y: Float64Array.from(y)}
        }
      }})
    return {conic, ...best}
  }
  // The miss over the phases, coarse; then golden-section about the least.
  let bestT = start
  let bestMiss = Infinity
  for (let t = start; t < start + s; t += COARSE) {
    const p = marsPass(t)
    if (p && p.miss < bestMiss) {
      bestMiss = p.miss
      bestT = t
    }
  }
  let lo = bestT - COARSE
  let hi = bestT + COARSE
  const g = (Math.sqrt(5) - 1) / 2
  for (let i = 0; i < GOLDEN_STEPS; i++) {
    const c = hi - (g * (hi - lo))
    const d = lo + (g * (hi - lo))
    if ((marsPass(c)?.miss ?? Infinity) < (marsPass(d)?.miss ?? Infinity)) {
      hi = d
    } else {
      lo = c
    }
  }
  const t = (lo + hi) / 2
  const p = marsPass(t)
  if (!p) {
    return null
  }
  const {conic} = p
  const jde = t + (p.time / SECONDS_PER_DAY)
  const vm = velocityOf(tracks.mars, jde)
  const vInfMars = Math.hypot(...[3, 4, 5].map((k) => p.y[k] - vm[k - 3]))
  const r = Math.hypot(...conic.r0)
  const v2 = (conic.v0[0] ** 2) + (conic.v0[1] ** 2) + (conic.v0[2] ** 2)
  const a = 1 / ((2 / r) - (v2 / GM.sun))
  const h = (conic.r0[0] * conic.v0[1]) - (conic.r0[1] * conic.v0[0])
  const e = Math.sqrt(1 - ((h * h) / (GM.sun * a)))
  return {t, conic, mars: {jde, miss: p.miss, vInf: vInfMars}, vInfEarth: Math.hypot(...conic.vInf0),
    earth: flybyDv(conic.vInf1, rotate(conic.vInf0), FLYBY.earth), a, e,
    period: 2 * Math.PI * Math.sqrt((a ** 3) / GM.sun) / SECONDS_PER_DAY}
}


/**
 * @param {object} track
 * @param {number} jde
 * @returns {Array<number>} its velocity, m/s, by a central difference
 */
function velocityOf(track, jde) {
  const dt = 0.5
  const a = track.at(jde + dt)
  const b = track.at(jde - dt)
  return a.map((x, k) => (x - b[k]) / (2 * dt * SECONDS_PER_DAY))
}


/**
 * The ecliptic longitude by which Mars leads the Earth, radians in [0, 2π).
 *
 * @param {object} tracks
 * @param {number} jde
 * @returns {number}
 */
export function marsLead(tracks, jde) {
  const e = tracks.earth.at(jde)
  const m = tracks.mars.at(jde)
  const d = Math.atan2(m[1], m[0]) - Math.atan2(e[1], e[0])
  return ((d % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI)
}


/**
 * A chain of cycles: from an Earth pass at t0, each cycle to Mars after its
 * leg's days and back to the Earth after its cycle's; and what its flybys
 * cost, Mars's in each cycle and the Earth's between cycles (not the
 * departure: entering the cycler is a launch).
 *
 * @param {object} tracks
 * @param {Array<number>} x [t0, legs..., cycles...]
 * @param {number} n cycles
 * @returns {?{legs: Array<object>, flybys: Array<object>, cost: number}}
 */
export function chain(tracks, x, n) {
  const legs = []
  const flybys = []
  let t = x[0]
  let cost = 0
  let inbound = null
  for (let k = 0; k < n; k++) {
    const c = cycleFrom(tracks, t, x[1 + k], x[1 + n + k], inbound)
    if (!c) {
      return null
    }
    flybys.push(inbound ? {body: 'earth', jde: t, vInfIn: Math.hypot(...inbound.vInf1), vInfOut: Math.hypot(...c.a.vInf0),
      dv: c.dvEarth} : {body: 'earth', jde: t, vInfIn: 0, vInfOut: Math.hypot(...c.a.vInf0), dv: 0, entry: true})
    flybys.push({body: 'mars', jde: c.a.t1, vInfIn: Math.hypot(...c.a.vInf1), vInfOut: Math.hypot(...c.b.vInf0),
      dv: c.dvMars})
    cost += c.dvMars + (inbound ? c.dvEarth : 0)
    legs.push(c.a, c.b)
    inbound = c.b
    t = c.b.t1
  }
  flybys.push({body: 'earth', jde: t, vInfIn: Math.hypot(...inbound.vInf1), vInfOut: 0, dv: 0})
  return {legs, flybys, cost}
}


/**
 * Aldrin's cycler on the planets as they are (VSOP87C), from about a date:
 * started when Mars leads the Earth as it does at the ideal cycler's start
 * (idealAldrin, on circles), each cycle seeded with the ideal's leg to Mars
 * and the synodic period, then all of them adjusted together by coordinate
 * descent for the least Δv at the flybys.  Not ballistic: the planets'
 * orbits are neither circles nor in one plane, and every cycle differs.
 *
 * @param {object} tracks heliocentric tracks of the Earth and Mars
 *     (ephemeris.js heliocentricTracks)
 * @param {number} start JDE
 * @param {number} [cycles]
 * @param {?object} [ideal] idealAldrin's, if made already
 * @returns {?{legs: Array<object>, flybys: Array<{body: string, jde: number,
 *     vInfIn: number, vInfOut: number, dv: number}>, cost: number,
 *     ideal: object}} v∞ m/s, cost the flybys' Δv, m/s
 */
export function aldrinCycler(tracks, start, cycles = 3, ideal = idealOnCircles()) {
  const lead = marsLead(ideal.tracks, ideal.t)
  // The first day from start when Mars leads by that.
  let t0 = null
  for (let t = start; t < start + SYNODIC_DAYS; t += FINE) {
    const a = marsLead(tracks, t) - lead
    const b = marsLead(tracks, t + FINE) - lead
    if (Math.sign(a) !== Math.sign(b) && Math.abs(a - b) < Math.PI) {
      t0 = t + (FINE * a / (a - b))
      break
    }
  }
  if (t0 === null) {
    return null
  }
  const legDays = ideal.mars.jde - ideal.t
  let x = [t0, ...new Array(cycles).fill(legDays), ...new Array(cycles).fill(SYNODIC_DAYS)]
  let best = chain(tracks, x, cycles)
  if (!best) {
    return null
  }
  for (const step of DESCENT_STEPS) {
    let improved = true
    while (improved) {
      improved = false
      for (let k = 0; k < x.length; k++) {
        for (const d of [-step, step]) {
          const y = x.slice()
          y[k] += d
          const c = chain(tracks, y, cycles)
          if (c && c.cost < best.cost) {
            best = c
            x = y
            improved = true
          }
        }
      }
    }
  }
  return {...best, x, ideal}
}


/**
 * The ideal cycler on circles: the Earth's and Mars's mean distances, in
 * one plane.
 *
 * @returns {object} idealAldrin's, with its `tracks`
 */
export function idealOnCircles() {
  const circle = (a) => {
    const n = Math.sqrt(GM.sun / (a ** 3))
    return {at: (jde, out = [0, 0, 0]) => {
      const th = n * (jde - J2000) * SECONDS_PER_DAY
      out[0] = a * Math.cos(th)
      out[1] = a * Math.sin(th)
      out[2] = 0
      return out
    }}
  }
  const tracks = {earth: circle(AU), mars: circle(MARS_AU * AU)}
  return {...idealAldrin(tracks, J2000), tracks}
}
