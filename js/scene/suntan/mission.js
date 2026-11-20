/**
 * The Suntan mission as a chain of heliocentric Kepler legs.
 *
 * Suntan is a concept study: follow a Parker Solar Probe (PSP) trajectory to
 * the Sun, lower into a sun-synchronous orbit as a relay, and drop a lander
 * to the photosphere.  This module turns that into numbers and a position at
 * any time, for the scene and the app (install.js, SuntanTrack.js, ui/SuntanApp.jsx)
 * and for the study notes
 * (tools/suntan/report.mjs -> design/suntan/trajectory.md).
 *
 * Three kinds of leg, with different standing:
 *
 * 1. Launch to the first Venus flyby is solved, not assumed: a Lambert arc
 *    from Earth at PSP's launch time to Venus at the first flyby.  Its
 *    departure energy (C3) is an output and can be compared with PSP's.
 * 2. The seven orbit families between and after the Venus flybys are a
 *    kinematic reconstruction from PSP's published perihelion times and
 *    distances.  Shape comes from those; orientation is whatever puts the
 *    craft at Venus's bearing at the flybys that bound the leg.  Nothing
 *    forces the legs to meet at Venus, so how closely they do
 *    (`flybys[].missKm`) measures how good the reconstruction is.  This is
 *    not a forward-propagated design and resolves no flyby altitude.
 * 3. Everything after the final 88-day orbit is the Suntan concept: impulsive
 *    burns between coplanar ellipses.  The burns are sized, not optimized.
 *
 * Simplification to know about: all legs after the first flyby lie in
 * Venus's orbital plane (3.39 degrees to the ecliptic; PSP's is 3.4), and
 * the Sun's equator is treated as lying in that plane too (it is really
 * 7.25 degrees to the ecliptic).
 */
import {
  AU,
  DAY,
  GM_SUN,
  R_SUN,
  TWO_PI,
  add,
  circularSpeed,
  cross,
  dot,
  makeOrbit,
  norm,
  orbitFromState,
  orbitState,
  scale,
  semiMajorAxisOf,
  sub,
  unit,
  visViva,
} from './kepler.js'
import {lambert} from '../craft/lambert.js'


const utc = (iso) => Date.parse(iso) / 1000
const HOUR = 3600
// Time.js toJulianDay's: the Unix epoch at JD 2440587.5 exactly.
const UNIX_EPOCH_JD = 2440587.5
const toDeg = 180 / Math.PI

// https://en.wikipedia.org/wiki/Stefan-Boltzmann_constant
const SIGMA = 5.670374419e-8
// IAU 2015 nominal solar effective temperature, K.
export const T_EFF_SUN = 5772
// Total solar irradiance at 1 AU, W/m^2; "one sun".
export const SOLAR_CONSTANT = 1361

export const LAUNCH = utc('2018-08-12T07:31:00Z')

// PSP's Venus closest approaches as flown (UTC).
export const VENUS_FLYBYS = [
  utc('2018-10-03T08:44:00Z'),
  utc('2019-12-26T18:14:00Z'),
  utc('2020-07-11T03:22:00Z'),
  utc('2021-02-20T20:05:00Z'),
  utc('2021-10-16T09:30:00Z'),
  utc('2023-08-21T12:03:00Z'),
  utc('2024-11-06T18:01:00Z'),
]

// PSP's seven orbit families as flown: the first and last perihelion of each
// (UTC), how many perihelia it had, and the perihelion distance in solar
// radii.  Family k follows flyby k.  The period is derived from these rather
// than quoted, so the legs stay in step with the real perihelia.
export const PSP_ORBIT_FAMILIES = [
  {first: '2018-11-06T03:27:00Z', last: '2019-09-01T17:50:00Z', count: 3, periRs: 35.66},
  {first: '2020-01-29T09:37:00Z', last: '2020-06-07T08:23:00Z', count: 2, periRs: 27.85},
  {first: '2020-09-27T09:16:00Z', last: '2021-01-17T17:40:00Z', count: 2, periRs: 20.35},
  {first: '2021-04-29T08:48:00Z', last: '2021-08-09T19:11:00Z', count: 2, periRs: 15.98},
  {first: '2021-11-21T08:23:00Z', last: '2023-06-22T03:46:00Z', count: 7, periRs: 13.28},
  {first: '2023-09-27T23:28:00Z', last: '2024-09-30T05:15:00Z', count: 5, periRs: 11.42},
  {first: '2024-12-24T11:53:00Z', last: '2025-03-22T22:42:00Z', count: 2, periRs: 9.86},
]


/**
 * Sidereal rotation period of the Sun's photosphere at a latitude, from the
 * Doppler fit of Snodgrass & Ulrich (1990, ApJ 351, 309):
 * 14.713 - 2.396 sin^2(lat) - 1.787 sin^4(lat) degrees/day.  The Sun rotates
 * differentially, so "sun-synchronous" depends on where the lander is.
 *
 * @param {number} latitudeDeg
 * @returns {number} Seconds
 */
export function solarRotationPeriod(latitudeDeg = 0) {
  const s2 = Math.pow(Math.sin(latitudeDeg / toDeg), 2)
  const degPerDay = 14.713 - (2.396 * s2) - (1.787 * s2 * s2)
  return (360 / degPerDay) * DAY
}


/**
 * Sunlight on a plate facing the Sun.  Exact at any distance for a uniform
 * disc, including right at the photosphere where the Sun is no longer a
 * point source; limb darkening is ignored.
 *
 * @param {number} dist Meters from the Sun's center
 * @returns {number} W/m^2
 */
export function solarFlux(dist) {
  return SIGMA * Math.pow(T_EFF_SUN, 4) * Math.pow(R_SUN / dist, 2)
}


/**
 * Temperature at which a sun-facing black plate with an insulated back
 * re-radiates what it absorbs.  A coated shield runs cooler (PSP's white
 * alumina face) and a body lit from all sides, as inside the photosphere,
 * tends to T_EFF_SUN itself.
 *
 * @param {number} dist Meters from the Sun's center
 * @returns {number} Kelvin
 */
export function plateTemperature(dist) {
  return Math.pow(solarFlux(dist) / SIGMA, 0.25)
}


/**
 * Radiative-equilibrium temperature of a small grey sphere above the
 * photosphere: one that absorbs sunlight over the solid angle the Sun fills
 * and re-radiates over its whole surface.  Independent of the sphere's
 * emissivity as long as that equals its absorptivity.  Far out this is the
 * familiar T_sun * sqrt(R / 2d); at the photosphere the Sun fills half the
 * sky and it reaches T_sun / 2^(1/4).  This is the lander's passive floor:
 * what the hull would settle at with no ablation, cooling or reflective coat.
 *
 * @param {number} dist Meters from the Sun's center, >= R_SUN
 * @returns {number} Kelvin
 */
export function sphereTemperature(dist) {
  const cosSunHalfAngle = Math.sqrt(Math.max(0, 1 - Math.pow(R_SUN / dist, 2)))
  return T_EFF_SUN * Math.pow((1 - cosSunHalfAngle) / 2, 0.25)
}


/**
 * Inverse of sphereTemperature: how close a passive grey sphere can come
 * before it reaches a temperature.
 *
 * @param {number} kelvin
 * @returns {number} Meters from the Sun's center; R_SUN if it never gets that hot
 */
export function sphereTemperatureDistance(kelvin) {
  const skyFraction = Math.pow(kelvin / T_EFF_SUN, 4)
  if (skyFraction >= 0.5) {
    return R_SUN
  }
  return R_SUN / Math.sqrt(1 - Math.pow(1 - (2 * skyFraction), 2))
}


/**
 * A planet's state from an ephemeris of positions, the velocity by central
 * difference over an hour (planetsApprox's elements change far slower).
 *
 * @param {Function} planetsAt (jd UTC) => {venus: {x, y, z}, earth: ...},
 *   AU in the mean ecliptic and equinox of date: planetsApprox's form
 * @returns {Function} (name, t) => {r, v, normal}, metres, m/s, a unit vector;
 *   t in Unix seconds
 */
export function planetStates(planetsAt) {
  const at = (name, t) => {
    const p = planetsAt((t / DAY) + UNIX_EPOCH_JD)[name]
    return [p.x * AU, p.y * AU, p.z * AU]
  }
  return (name, t) => {
    const r = at(name, t)
    const v = scale(sub(at(name, t + HOUR), at(name, t - HOUR)), 1 / (2 * HOUR))
    return {r, v, normal: unit(cross(r, v))}
  }
}


/** @returns {number} Angle between two vectors, radians */
function angleBetween(a, b) {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b)))))
}


/**
 * Reconstruct one PSP orbit family in Venus's plane.
 *
 * @param {Function} planetState From planetStates
 * @param {object} family Entry of PSP_ORBIT_FAMILIES
 * @param {number} tStart Flyby that starts the family
 * @param {number|undefined} tEnd Flyby that ends it, if any
 * @returns {object} orbit
 */
function reconstructFamily(planetState, family, tStart, tEnd) {
  const first = utc(family.first)
  const period = (utc(family.last) - first) / (family.count - 1)
  const normal = planetState('venus', tStart).normal
  const xRef = unit(cross([0, 0, 1], normal))
  const yRef = cross(normal, xRef)
  const shape = {periapsis: family.periRs * R_SUN, period, tPeri: first, normal}
  const unoriented = makeOrbit({...shape, periDir: xRef})
  // Perihelion bearing that puts the craft on Venus's bearing at a flyby.
  const bearingFrom = (t) => {
    const venus = planetState('venus', t).r
    const venusAngle = Math.atan2(dot(venus, yRef), dot(venus, xRef))
    return venusAngle - orbitState(unoriented, t).trueAnomaly
  }
  const bearings = [bearingFrom(tStart)]
  if (tEnd !== undefined) {
    bearings.push(bearingFrom(tEnd))
  }
  // Average on the circle; the two estimates differ by the reconstruction error.
  const c = bearings.reduce((s, w) => s + Math.cos(w), 0)
  const s = bearings.reduce((sum, w) => sum + Math.sin(w), 0)
  const w = Math.atan2(s, c)
  const periDir = add(scale(xRef, Math.cos(w)), scale(yRef, Math.sin(w)))
  return makeOrbit({...shape, periDir})
}


/**
 * @param {Function} planetsAt The planets' places, planetsApprox's form
 *   (planetStates); handed in, since it's the first load's (install.js)
 * @param {object} [opts]
 * @param {number} [opts.landingLatitudeDeg] Sets the rotation rate the relay matches
 * @param {number} [opts.departNotBefore] Unix seconds; the Suntan burns start at
 *   the first aphelion of the final orbit after this
 * @param {number} [opts.syncRevsBeforeRelease] Relay orbits flown before lander release
 * @returns {object} {legs, flybys, burns, numbers, stateAt, tStart, tEnd}
 */
export function buildMission(planetsAt, opts = {}) {
  const planetState = planetStates(planetsAt)
  const {
    landingLatitudeDeg = 0,
    departNotBefore = utc('2027-01-01T00:00:00Z'),
    syncRevsBeforeRelease = 2,
    venusFlybys = VENUS_FLYBYS,
  } = opts
  const legs = []
  const kepler = (orbit) => (t) => orbitState(orbit, t)
  const addLeg = (leg) => {
    legs.push({...leg, stateAt: leg.stateAt || kepler(leg.orbit)})
    return leg.orbit
  }

  // 1. Launch to Venus flyby 1, solved.
  const earth = planetState('earth', LAUNCH)
  const venus1 = planetState('venus', venusFlybys[0])
  const launchArc = lambert(earth.r, venus1.r, venusFlybys[0] - LAUNCH, GM_SUN)
  const launchOrbit = addLeg({
    id: 'launch',
    name: 'Launch to Venus flyby 1',
    phase: 'psp',
    vehicle: 'both',
    t0: LAUNCH,
    t1: venusFlybys[0],
    orbit: orbitFromState(earth.r, launchArc.v1, LAUNCH),
  })
  const launchVInf = norm(sub(launchArc.v1, earth.v))

  // 2. PSP's seven orbit families, reconstructed.
  const families = PSP_ORBIT_FAMILIES.map((family, i) => reconstructFamily(
      planetState, family, venusFlybys[i], venusFlybys[i + 1]))
  const finalOrbit = families[families.length - 1]

  // 3. Suntan.  The relay matches the rotation of the photosphere below it.
  const rotationPeriod = solarRotationPeriod(landingLatitudeDeg)
  const syncRadius = semiMajorAxisOf(rotationPeriod)
  const {periDir, normal} = finalOrbit

  // Burn 1, prograde at aphelion, where raising perihelion is cheapest:
  // lift perihelion from 9.86 Rs up to the synchronous radius.
  const firstAphelion = finalOrbit.tPeri + (finalOrbit.period / 2)
  const orbitsToWait = Math.max(0, Math.ceil((departNotBefore - firstAphelion) / finalOrbit.period))
  const tBurn1 = firstAphelion + (orbitsToWait * finalOrbit.period)
  const transferA = (syncRadius + finalOrbit.apoapsis) / 2
  const tBurn2 = tBurn1 + (Math.PI * Math.sqrt(Math.pow(transferA, 3) / GM_SUN))
  const transfer = makeOrbit({
    periapsis: syncRadius, apoapsis: finalOrbit.apoapsis, tPeri: tBurn2, periDir, normal})
  // Burn 2, retrograde at the new perihelion: circularize.
  const sync = makeOrbit({periapsis: syncRadius, apoapsis: syncRadius, tPeri: tBurn2, periDir, normal})
  // Burn 3, the lander's: drop perihelion to the photosphere.  Released at
  // the same bearing as burn 2, so it arrives half an orbit round, at -periDir.
  const tRelease = tBurn2 + (syncRevsBeforeRelease * rotationPeriod)
  const descentA = (syncRadius + R_SUN) / 2
  const tArrive = tRelease + (Math.PI * Math.sqrt(Math.pow(descentA, 3) / GM_SUN))
  const descent = makeOrbit({
    periapsis: R_SUN, apoapsis: syncRadius, tPeri: tArrive, periDir: scale(periDir, -1), normal})
  const tEnd = tArrive + (2 * rotationPeriod)

  families.forEach((orbit, i) => addLeg({
    id: `psp${i + 1}`,
    name: `PSP orbit family ${i + 1} (${PSP_ORBIT_FAMILIES[i].periRs} Rs)`,
    phase: 'psp',
    vehicle: 'both',
    t0: venusFlybys[i],
    t1: i + 1 < families.length ? venusFlybys[i + 1] : tBurn1,
    orbit,
  }))
  addLeg({
    id: 'transfer', name: 'Transfer to synchronous radius', phase: 'suntan', vehicle: 'both',
    t0: tBurn1, t1: tBurn2, orbit: transfer})
  addLeg({
    id: 'sync', name: 'Sun-synchronous relay orbit', phase: 'suntan', vehicle: 'both',
    t0: tBurn2, t1: tRelease, orbit: sync})
  addLeg({
    id: 'relay', name: 'Sun-synchronous relay orbit', phase: 'suntan', vehicle: 'relay',
    t0: tRelease, t1: Infinity, orbit: sync})
  addLeg({
    id: 'descent', name: 'Lander descent', phase: 'suntan', vehicle: 'lander',
    t0: tRelease, t1: tArrive, orbit: descent})
  // If it could stop there, the lander would ride the photosphere round.
  const surfaceSpeed = (TWO_PI * R_SUN) / rotationPeriod
  addLeg({
    id: 'surface', name: 'At the photosphere', phase: 'suntan', vehicle: 'lander',
    t0: tArrive, t1: Infinity, orbit: sync,
    stateAt: (t) => {
      const angle = Math.PI + (((t - tArrive) / rotationPeriod) * TWO_PI)
      const radial = add(scale(periDir, Math.cos(angle)), scale(sync.alongDir, Math.sin(angle)))
      const along = add(scale(periDir, -Math.sin(angle)), scale(sync.alongDir, Math.cos(angle)))
      return {
        r: scale(radial, R_SUN), v: scale(along, surfaceSpeed),
        dist: R_SUN, speed: surfaceSpeed, trueAnomaly: angle}
    },
  })

  /**
   * @param {number} t Unix seconds
   * @param {string} [vehicle] 'relay' or 'lander'; they are one stack until release
   * @returns {object|null} State plus the leg, or null outside the mission
   */
  const stateAt = (t, vehicle = 'relay') => {
    if (t < LAUNCH) {
      return null
    }
    const leg = legs.find((l) => t >= l.t0 && t < l.t1 && (l.vehicle === 'both' || l.vehicle === vehicle))
    if (!leg) {
      return null
    }
    const state = leg.stateAt(t)
    return {
      ...state,
      leg,
      flux: solarFlux(state.dist),
      plateTemperature: plateTemperature(state.dist),
    }
  }

  // How well the reconstruction closes at each flyby, and what the flyby did.
  const flybys = venusFlybys.map((t, i) => {
    const venus = planetState('venus', t)
    const before = orbitState(i === 0 ? launchOrbit : families[i - 1], t)
    const after = orbitState(families[i], t)
    return {
      n: i + 1,
      t,
      missBeforeKm: norm(sub(before.r, venus.r)) / 1e3,
      missAfterKm: norm(sub(after.r, venus.r)) / 1e3,
      vInfInKms: norm(sub(before.v, venus.v)) / 1e3,
      vInfOutKms: norm(sub(after.v, venus.v)) / 1e3,
    }
  })

  const speedAt = (orbit, r) => visViva(r, orbit.a)
  const vSync = circularSpeed(syncRadius)
  const burns = [
    {
      id: 'burn1', t: tBurn1, name: 'Raise perihelion to synchronous radius (at aphelion)',
      dvKms: (speedAt(transfer, transfer.apoapsis) - speedAt(finalOrbit, finalOrbit.apoapsis)) / 1e3},
    {
      id: 'burn2', t: tBurn2, name: 'Circularize at synchronous radius',
      dvKms: (speedAt(transfer, syncRadius) - vSync) / 1e3},
    {
      id: 'burn3', t: tRelease, name: 'Lander deorbit to the photosphere',
      dvKms: (vSync - speedAt(descent, syncRadius)) / 1e3},
  ]

  const relayAtArrival = orbitState(sync, tArrive)
  const landerAtArrival = orbitState(descent, tArrive)
  const horizonDeg = Math.acos(R_SUN / syncRadius) * toDeg
  const separationDeg = angleBetween(relayAtArrival.r, landerAtArrival.r) * toDeg
  // Falling straight down instead: kill all orbital speed at release.
  const radialFallTime = Math.PI * Math.sqrt(Math.pow(syncRadius / 2, 3) / GM_SUN)
  const radialSeparationDeg = (radialFallTime / rotationPeriod) * 360

  const firstFamily = families[0]
  const numbers = {
    launchC3: Math.pow(launchVInf / 1e3, 2),
    rotationPeriodDays: rotationPeriod / DAY,
    syncRadiusRs: syncRadius / R_SUN,
    syncRadiusAu: syncRadius / AU,
    syncSpeedKms: vSync / 1e3,
    finalPerihelionSpeedKms: speedAt(finalOrbit, finalOrbit.periapsis) / 1e3,
    finalAphelionAu: finalOrbit.apoapsis / AU,
    firstPerihelionSpeedKms: speedAt(firstFamily, firstFamily.periapsis) / 1e3,
    relayDvKms: burns[0].dvKms + burns[1].dvKms,
    landerDvKms: burns[2].dvKms,
    descentDays: (tArrive - tRelease) / DAY,
    arrivalSpeedKms: landerAtArrival.speed / 1e3,
    surfaceRotationSpeedKms: surfaceSpeed / 1e3,
    surfaceGravity: GM_SUN / (R_SUN * R_SUN),
    fluxAtFinalPerihelion: solarFlux(finalOrbit.periapsis),
    fluxAtSync: solarFlux(syncRadius),
    fluxAtSurface: solarFlux(R_SUN),
    horizonDeg,
    relayLanderSeparationDeg: separationDeg,
    relaySeesLander: separationDeg < horizonDeg,
    alternatives: {
      // Stop the Venus sequence early: PSP's first perihelion is already
      // almost exactly at the synchronous radius.
      circularizeAtFirstPerihelionKms: (speedAt(firstFamily, firstFamily.periapsis) -
        circularSpeed(firstFamily.periapsis)) / 1e3,
      firstPerihelionRs: firstFamily.periapsis / R_SUN,
      // Match the rotation period but stay eccentric: one burn at perihelion.
      resonantEllipseKms: (speedAt(finalOrbit, finalOrbit.periapsis) -
        visViva(finalOrbit.periapsis, syncRadius)) / 1e3,
      resonantEllipseAphelionRs: ((2 * syncRadius) - finalOrbit.periapsis) / R_SUN,
      // Send the lander straight from the final orbit's aphelion instead.
      landerFromFinalAphelionKms: (speedAt(finalOrbit, finalOrbit.apoapsis) -
        visViva(finalOrbit.apoapsis, (finalOrbit.apoapsis + R_SUN) / 2)) / 1e3,
      landerFromFinalAphelionArrivalKms: visViva(R_SUN, (finalOrbit.apoapsis + R_SUN) / 2) / 1e3,
      radialDropKms: vSync / 1e3,
      radialDropDays: radialFallTime / DAY,
      radialDropArrivalKms: Math.sqrt(2 * GM_SUN * ((1 / R_SUN) - (1 / syncRadius))) / 1e3,
      radialDropSeparationDeg: radialSeparationDeg,
      radialDropRelaySeesLander: radialSeparationDeg < horizonDeg,
    },
  }

  return {
    legs, flybys, burns, numbers, stateAt,
    tStart: LAUNCH, tBurn1, tBurn2, tRelease, tArrive, tEnd,
    orbits: {launch: launchOrbit, families, transfer, sync, descent},
  }
}
