#!/usr/bin/env bun
// Builds public/data/periodicOrbits.json from JPL's three-body periodic
// orbit catalogue (ssd-api.jpl.nasa.gov/periodic_orbits.api; Lagrange.md,
// three-body orbits): for each system the catalogue has, and each family
// the app draws, the catalogue's member that matches the app's own
// (periodicOrbits.js familyMember, made with the catalogue's mass ratio):
// the one at the same Jacobi constant whose crossing of the xz plane is
// nearest the app's, or for the 9:2 NRHO the L2 southern halo whose period
// is nearest 2/9 of a synodic month.  The app draws these where it has
// them, and its own elsewhere; periodicOrbits.test.js checks the two agree.
// Run by hand to refresh it; tests and the app never fetch it from JPL.
//
//   bun tools/periodic/fetchJpl.mjs > public/data/periodicOrbits.json
import {propagate} from '../../js/scene/cr3bp.js'
import {collinearDistances} from '../../js/scene/lagrange.js'
import {FAMILIES, familyMember} from '../../js/scene/periodicOrbits.js'


const API = 'https://ssd-api.jpl.nasa.gov/periodic_orbits.api'
// The pairs by their secondary, as the app keys them, and the catalogue's
// name for each.
const SYSTEMS = {
  moon: 'earth-moon',
  earth: 'sun-earth',
  mars: 'sun-mars',
  phobos: 'mars-phobos',
  europa: 'jupiter-europa',
  enceladus: 'saturn-enceladus',
  titan: 'saturn-titan',
}
// Each family's query.
const QUERIES = {
  l1Lyapunov: {family: 'lyapunov', libr: '1'},
  l2Lyapunov: {family: 'lyapunov', libr: '2'},
  l1Halo: {family: 'halo', libr: '1', branch: 'S'},
  l2Halo: {family: 'halo', libr: '2', branch: 'S'},
  dro: {family: 'dro'},
  nrho: {family: 'halo', libr: '2', branch: 'S'},
}
// The 9:2 NRHO's period in units of the pair's turn (2π a sidereal month):
// 2/9 of a synodic month.  By the time unit, not days: the catalogue's
// tunit makes 2π 27.85 days, not the Moon's 27.32, so its 6.56-day member
// is another orbit (C 3.0489, against 3.047 in Davis et al. 2022's table).
const NRHO_PERIOD = 2 * (2 * Math.PI * 29.530589 / 27.321661) / 9
// A match whose period is further than this from the app's member is none:
// the catalogue's family doesn't reach that size.
const PERIOD_TOLERANCE = 0.01


/**
 * @param {object} params
 * @returns {Promise<object>} the API's answer
 */
async function query(params) {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`)
  if (!res.ok) {
    throw new Error(`JPL answered ${res.status} for ${JSON.stringify(params)}`)
  }
  return res.json()
}


/**
 * The member of a catalogue family matching the app's.
 *
 * @param {object} answer the API's
 * @param {number} mu
 * @param {string} family
 * @returns {?object}
 */
function match(answer, mu, family) {
  const rows = (answer.data ?? []).map((r) => r.map(Number))
  if (rows.length === 0) {
    return null
  }
  let best = null
  const ours = familyMember(mu, family)
  if (!ours) {
    return null
  }
  if (family === 'nrho') {
    for (const r of rows) {
      const err = Math.abs(r[7] - NRHO_PERIOD)
      if (!best || err < best.err) {
        best = {r, err}
      }
    }
  } else {
    const c0 = jacobiOf(mu, ours.state)
    const crossings = [ours.state, propagate(mu, ours.state, {toCrossing: true}).s]
    // A halo may be listed as its twin across the plane (Titan's L1).
    if (FAMILIES[family].halo) {
      crossings.push(...crossings.map(([x, y, z]) => [x, y, -z]))
    }
    const [cMin, cMax] = answer.limits.jacobi.map(Number)
    const gamma = collinearDistances(mu).l1
    for (const r of rows) {
      const near = Math.min(...crossings.map((s) => Math.hypot(r[0] - s[0], r[1] - s[1], r[2] - s[2])))
      // Both in proportion: C against the family's range, the place
      // against the L1 distance (Phobos's is 17 km).
      const err = (Math.abs(r[6] - c0) / ((cMax - cMin) || 1)) + (near / gamma)
      if (!best || err < best.err) {
        best = {r, err}
      }
    }
  }
  const [x, y, z, vx, vy, vz, jacobi, period, stability] = best.r
  if (Math.abs((period / ours.period) - 1) > PERIOD_TOLERANCE) {
    return {unmatched: true, ours: {jacobi: jacobiOf(mu, ours.state), period: ours.period},
      nearest: {jacobi, period}, members: rows.length}
  }
  // How far apart the catalogue's members are here: the nearest other's
  // place, in the pair's units (a match is good to about this).
  const spacing = Math.min(...rows.filter((r) => r !== best.r)
      .map((r) => Math.hypot(r[0] - x, r[1] - y, r[2] - z)))
  // At the end of the catalogue's family: it stops short of the app's size
  // (Phobos's L1 halos), and this is its nearest.
  const edge = best.r === rows[0] || best.r === rows[rows.length - 1]
  return {state: [x, y, z, vx, vy, vz], jacobi, period, stability, members: rows.length, spacing,
    ...(edge ? {edge} : {})}
}


/**
 * @param {number} mu
 * @param {Array<number>} s
 * @returns {number} the Jacobi constant
 */
function jacobiOf(mu, s) {
  const [x, y, z, vx, vy, vz] = s
  const r1 = Math.hypot(x + mu, y, z)
  const r2 = Math.hypot(x - 1 + mu, y, z)
  return (x * x) + (y * y) + (2 * (1 - mu) / r1) + (2 * mu / r2) - ((vx * vx) + (vy * vy) + (vz * vz))
}


const out = {
  source: 'NASA/JPL Three-Body Periodic Orbits API (ssd-api.jpl.nasa.gov/periodic_orbits.api)',
  retrieved: new Date().toISOString().slice(0, 10),
  queries: QUERIES,
  note: 'CR3BP units of each system: state [x, y, z, vx, vy, vz] barycentric, period in tunit seconds; ' +
    'the member matching the app\'s (tools/periodic/fetchJpl.mjs)',
  systems: {},
}
for (const [secondary, sys] of Object.entries(SYSTEMS)) {
  let system = null
  const families = {}
  const unmatched = {}
  for (const [family, q] of Object.entries(QUERIES)) {
    if (FAMILIES[family].only && FAMILIES[family].only !== secondary) {
      continue
    }
    const answer = await query({sys, ...q})
    system ??= answer.system
    const mu = Number(answer.system.mass_ratio)
    const m = match(answer, mu, family)
    if (m?.unmatched) {
      unmatched[family] = m
    } else if (m) {
      families[family] = m
    }
  }
  out.systems[secondary] = {
    name: system.name, mu: Number(system.mass_ratio), lunit: system.lunit, tunit: system.tunit,
    radiusSecondary: system.radius_secondary, families,
    ...(Object.keys(unmatched).length > 0 ? {unmatched} : {}),
  }
}
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`)
