#!/usr/bin/env bun
/**
 * Writes the Suntan trajectory numbers and plots from the mission model:
 *
 *   bun tools/suntan/report.mjs     # -> design/suntan/trajectory.{md,svg}, trajectory-inner.svg
 *
 * The outputs are build products of js/scene/suntan/mission.js.  Edit the model and
 * re-run; don't edit the tables by hand.
 */
import {writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {AU, DAY, GM_SUN, R_SUN, TWO_PI, dot, visViva} from '../../js/scene/suntan/kepler.js'
import {planetsApprox} from '../../js/scene/planetsApprox.js'
import {
  SOLAR_CONSTANT,
  buildMission,
  planetStates,
  plateTemperature,
  solarFlux,
  sphereTemperature,
  sphereTemperatureDistance,
} from '../../js/scene/suntan/mission.js'


const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'suntan')
const mission = buildMission(planetsApprox)
const planetState = planetStates(planetsApprox)
const n = mission.numbers
const alt = n.alternatives

const date = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const f = (x, digits = 1) => x.toFixed(digits)
const mw = (flux) => flux >= 1e6 ? `${f(flux / 1e6)} MW/m²` : `${f(flux / 1e3, 0)} kW/m²`
const suns = (flux) => Math.round(flux / SOLAR_CONSTANT).toLocaleString('en-US')
const row = (...cells) => `| ${cells.join(' | ')} |`


// Radiant exposure of a sun-facing plate over the lander's descent, and how
// long it spends deeper than anything has flown.
const descent = mission.legs.find((leg) => leg.id === 'descent')
const steps = 20000
const dt = (descent.t1 - descent.t0) / steps
let fluence = 0
let secondsInsidePsp = 0
const pspPerihelion = mission.orbits.families[6].periapsis
for (let i = 0; i < steps; i++) {
  const dist = descent.stateAt(descent.t0 + ((i + 0.5) * dt)).dist
  fluence += solarFlux(dist) * dt
  if (dist < pspPerihelion) {
    secondsInsidePsp += dt
  }
}

// The concept's landing idea is a rotating carrier whose rim speed subtracts
// from the lander's.  Bound it by the best fibre's breaking speed.
const FIBRE_STRENGTH = 7.0e9
const FIBRE_DENSITY = 1790
const wheelRimKms = Math.sqrt((2 * FIBRE_STRENGTH) / FIBRE_DENSITY) / 1e3
// Mass per unit area at which radiation pressure on a perfect reflector
// equals the Sun's gravity: L / (2 pi c GM), independent of distance.
const SPEED_OF_LIGHT = 299792458
const sailLoading = (4 * Math.PI * R_SUN * R_SUN * n.fluxAtSurface) / (TWO_PI * SPEED_OF_LIGHT * GM_SUN)

// The descent by altitude: when the lander crosses each height, how fast, how
// steeply, and in how much sunlight.  The layer names are the standard
// picture's; psp-working-study.md section 4 has their temperatures and how
// well each is agreed.
const KM = 1e3
// The concept doc's hull limit: hafnium carbonitride melting near 4,100 C.
const HULL_LIMIT_K = 4100 + 273.15
const hullLimitAltitude = sphereTemperatureDistance(HULL_LIMIT_K) - R_SUN
const profileStops = [
  [descent.orbit.apoapsis - R_SUN, 'Release from the relay orbit'],
  [pspPerihelion - R_SUN, 'Parker\'s closest approach'],
  [R_SUN, 'One solar radius up'],
  [0.1 * R_SUN, 'Inner corona'],
  [hullLimitAltitude, 'Passive hull limit (see below)'],
  [10000 * KM, 'Low corona'],
  [2000 * KM, 'Top of the chromosphere'],
  [500 * KM, 'Temperature minimum'],
  [0, 'Photosphere, optical depth 1'],
]
const profile = profileStops.map(([altitude, label]) => {
  // Distance falls monotonically over the descent, so bisect for the crossing.
  let [lo, hi] = [descent.t0, descent.t1]
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (descent.stateAt(mid).dist > R_SUN + altitude) {
      lo = mid
    } else {
      hi = mid
    }
  }
  const state = descent.stateAt(hi)
  const sinAngle = -dot(state.r, state.v) / (state.dist * state.speed)
  return {
    label,
    altitude,
    secondsToGo: descent.t1 - hi,
    speedKms: state.speed / 1e3,
    // Level at both apsides, where rounding leaves a signed zero.
    angleDeg: Math.abs(sinAngle) < 1e-6 ? 0 : (Math.asin(Math.max(-1, Math.min(1, sinAngle))) * 180) / Math.PI,
    flux: solarFlux(state.dist),
    plateK: plateTemperature(state.dist),
    sphereK: sphereTemperature(state.dist),
  }
})
const duration = (seconds) => {
  if (seconds >= DAY) {
    return `${f(seconds / DAY, 2)} d`
  }
  if (seconds >= 3600) {
    return `${f(seconds / 3600)} h`
  }
  return seconds >= 60 ? `${f(seconds / 60)} min` : `${f(seconds, 0)} s`
}
const height = (altitude) => altitude >= 0.05 * R_SUN ?
  `${f(altitude / R_SUN, 2)} Rs` : `${Math.round(altitude / KM).toLocaleString('en-US')} km`
const chromosphere = profile.find((stop) => stop.altitude === 2000 * KM)
const hullLimit = profile.find((stop) => stop.altitude === hullLimitAltitude)
const kelvin = (k) => Math.round(k).toLocaleString('en-US')
const overLimitK = Math.round((sphereTemperature(R_SUN) - HULL_LIMIT_K) / 10) * 10

const families = mission.orbits.families
const finalPeriRs = f(families[6].periapsis / R_SUN, 2)
const seen = (visible, stress = false) => visible ? 'visible' : (stress ? '**not visible**' : 'not visible')
const dropSeen = seen(alt.radialDropRelaySeesLander)
const lines = [
  '# Suntan trajectory numbers',
  '',
  '_Generated by `bun tools/suntan/report.mjs` from `js/scene/suntan/mission.js`. Do not edit by hand._',
  '',
  'Plots: [whole trajectory](trajectory.svg), [inner region](trajectory-inner.svg).',
  '',
  '## 1. The Parker-like approach, and how well the model reproduces Parker',
  '',
  'Launch to the first Venus flyby is a solved Lambert arc. The seven orbit families are',
  'reconstructed from Parker\'s published perihelion times and distances and oriented to put the',
  'craft on Venus\'s bearing at each flyby. Nothing forces the legs to meet at Venus, so the miss',
  'distance is the measure of the reconstruction. An unpowered flyby must also leave the',
  'Venus-relative speed unchanged.',
  '',
  row('Check', 'Model', 'Parker as flown'),
  row('---', '---', '---'),
  row('Launch energy C3', `${f(n.launchC3)} km²/s²`, 'about 154 km²/s²'),
  row('Speed at perihelion 1', `${f(n.firstPerihelionSpeedKms)} km/s`, 'about 95 km/s'),
  row('Speed at 9.86 Rs', `${f(n.finalPerihelionSpeedKms)} km/s`, '191–192 km/s'),
  row('Final aphelion', `${f(n.finalAphelionAu, 3)} AU`, 'about 0.73 AU'),
  row('Sunlight at 9.86 Rs', `${suns(n.fluxAtFinalPerihelion)} suns`, 'about 475 suns'),
  '',
  row('Venus flyby', 'Date', 'Miss, inbound leg (km)', 'Miss, outbound leg (km)', 'v∞ in (km/s)', 'v∞ out (km/s)'),
  row('---', '---', '---', '---', '---', '---'),
  ...mission.flybys.map((fb) => row(
      fb.n, date(fb.t), Math.round(fb.missBeforeKm).toLocaleString('en-US'),
      Math.round(fb.missAfterKm).toLocaleString('en-US'), f(fb.vInfInKms), f(fb.vInfOutKms))),
  '',
  'For scale: Venus\'s radius is 6,052 km and its orbit is 108 million km across, so the legs',
  'meet to a few parts in ten thousand, but the model does not resolve flyby altitude.',
  '',
  row('Orbit family', 'Perihelion (Rs)', 'Aphelion (AU)', 'Period (d)', 'Perihelion speed (km/s)',
      'Sunlight at perihelion', 'Black-plate temperature (K)'),
  row('---', '---', '---', '---', '---', '---', '---'),
  ...families.map((o, i) => row(
      i + 1, f(o.periapsis / R_SUN, 2), f(o.apoapsis / AU, 3), f(o.period / DAY),
      f(visViva(o.periapsis, o.a) / 1e3), `${mw(solarFlux(o.periapsis))} (${suns(solarFlux(o.periapsis))} suns)`,
      Math.round(plateTemperature(o.periapsis)).toLocaleString('en-US'))),
  '',
  '## 2. The sun-synchronous relay orbit',
  '',
  `The photosphere at the equator turns once in ${f(n.rotationPeriodDays, 2)} days (sidereal; Snodgrass & Ulrich 1990).`,
  `A circular orbit with that period sits at **${f(n.syncRadiusRs, 2)} Rs (${f(n.syncRadiusAu, 3)} AU)**,`,
  `moving at ${f(n.syncSpeedKms)} km/s,`,
  `in ${mw(n.fluxAtSync)} of sunlight (${suns(n.fluxAtSync)} suns).`,
  '',
  `That is almost exactly Parker's *first* perihelion, ${f(alt.firstPerihelionRs, 2)} Rs. Parker's final orbit dips far`,
  'inside the synchronous radius; what the relay needs is not a lower perihelion but a lower',
  'aphelion, and Venus cannot provide that, because every Venus-flyby orbit still reaches Venus.',
  '',
  'Simulated plan, from the final 88-day orbit:',
  '',
  row('Burn', 'Date', 'Δv (km/s)'),
  row('---', '---', '---'),
  ...mission.burns.map((b) => row(b.name, date(b.t), f(b.dvKms, 2))),
  '',
  `Relay total: **${f(n.relayDvKms)} km/s**. For comparison Parker carried well under 1 km/s of propellant.`,
  '',
  'Alternatives the model sizes but does not animate:',
  '',
  row('Option', 'Δv (km/s)', 'Note'),
  row('---', '---', '---'),
  row('Stop after Venus flyby 1 and circularize at perihelion 1', f(alt.circularizeAtFirstPerihelionKms),
      'One burn; skips flybys 2–7'),
  row('Match the rotation period but stay eccentric', f(alt.resonantEllipseKms),
      `One burn at perihelion; orbit ${finalPeriRs} × ${f(alt.resonantEllipseAphelionRs)} Rs, ` +
      'over the same longitude once per rotation, not continuously'),
  '',
  '## 3. The lander descent',
  '',
  row('Quantity', 'Value'),
  row('---', '---'),
  row('Deorbit Δv from the relay orbit', `${f(n.landerDvKms)} km/s`),
  row('Fall time', `${f(n.descentDays, 2)} days`),
  row('Speed on reaching the photosphere', `**${f(n.arrivalSpeedKms)} km/s**, horizontal`),
  row('Photosphere\'s own rotation speed', `${f(n.surfaceRotationSpeedKms, 2)} km/s`),
  row('Surface gravity', `${f(n.surfaceGravity)} m/s² (${f(n.surfaceGravity / 9.80665)} g)`),
  row('Sunlight at the photosphere', `${mw(n.fluxAtSurface)} (${suns(n.fluxAtSurface)} suns)`),
  row('Radiant exposure over the descent, sun-facing plate', `${f(fluence / 1e12, 2)} TJ/m²`),
  row('Time spent inside Parker\'s closest approach', `${f(secondsInsidePsp / 3600)} hours`),
  row('Relay-to-lander angle at arrival',
      `${f(n.relayLanderSeparationDeg)}° (horizon is ${f(n.horizonDeg)}°): ${seen(n.relaySeesLander, true)}`),
  '',
  'The descent by altitude. Layer names are the standard picture\'s; their temperatures, and how',
  'well each is agreed, are in [psp-working-study.md](psp-working-study.md) section 4.',
  '',
  row('Crossing', 'Height above the photosphere', 'Time to go', 'Speed (km/s)', 'Angle below horizontal',
      'Sunlight', 'Sun-facing plate (K)', 'Whole sphere (K)'),
  row('---', '---', '---', '---', '---', '---', '---', '---'),
  ...profile.map((stop) => row(
      stop.label, height(stop.altitude), duration(stop.secondsToGo), f(stop.speedKms), `${f(stop.angleDeg)}°`,
      `${mw(stop.flux)} (${suns(stop.flux)} suns)`, kelvin(stop.plateK), kelvin(stop.sphereK))),
  '',
  'The two temperatures are radiative equilibrium with nothing done about it: a black plate facing the',
  'Sun with an insulated back, and a grey sphere radiating from its whole surface, which is the',
  'lander\'s shape.',
  '',
  `**Passive hull limit.** The concept's hull material melts near 4,100 °C (${kelvin(HULL_LIMIT_K)} K). The sphere`,
  `reaches that by sunlight alone ${height(hullLimit.altitude)} (${kelvin(hullLimit.altitude / KM)} km) above the photosphere,`,
  `${duration(hullLimit.secondsToGo)} before arrival, and would settle at ${kelvin(sphereTemperature(R_SUN))} K at the photosphere itself.`,
  `That is about ${overLimitK} K over the limit, a narrower gap than the 1,400 °C the concept doc`,
  'works from, because half the sphere\'s sky is still cold space until it sinks into the gas.',
  'Everything below that height has to be paid for by ablation, active cooling or reflectivity; this',
  'counts sunlight only, not the heating from moving through the gas at 600 km/s.',
  '',
  'A minimum-energy descent arrives level, not falling: it spends its last',
  `${duration(chromosphere.secondsToGo)} below 2,000 km, skimming about`,
  `${Math.round((chromosphere.secondsToGo * chromosphere.speedKms) / 1e3).toLocaleString('en-US')},000 km round the Sun as it sinks.`,
  `A straight drop crosses the same 2,000 km in about ${f(2000 / alt.radialDropArrivalKms, 0)} seconds.`,
  '',
  'Alternatives:',
  '',
  row('Option', 'Δv (km/s)', 'Arrival speed (km/s)', 'Note'),
  row('---', '---', '---', '---'),
  row('Fall straight down from the relay orbit', f(alt.radialDropKms), f(alt.radialDropArrivalKms),
      `${f(alt.radialDropDays, 2)} days; arrives vertically, ${f(alt.radialDropSeparationDeg)}° from the relay: ${dropSeen}`),
  row('Send the lander from the final orbit\'s aphelion instead', f(alt.landerFromFinalAphelionKms),
      f(alt.landerFromFinalAphelionArrivalKms), 'Cheapest by far, but no relay overhead'),
  '',
  '## 4. What the numbers say',
  '',
  `- **Every route arrives at about ${Math.round(n.arrivalSpeedKms / 10) * 10} km/s.** That is the Sun's escape speed`,
  '  less a little; it is set by',
  '  the depth of the gravity well, not by the route. Shedding it is the landing problem.',
  `- **The relay orbit is expensive and the lander delivery is cheap, from different orbits.** The relay`,
  `  costs ${f(alt.circularizeAtFirstPerihelionKms)}–${f(n.relayDvKms)} km/s; a lander dropped from aphelion costs`,
  `  ${f(alt.landerFromFinalAphelionKms)} km/s. Dropping the`,
  `  lander *from* the relay orbit is the worst case at ${f(n.landerDvKms)} km/s.`,
  '- **A minimum-energy descent lands out of the relay\'s sight**, half an orbit round while the relay',
  `  has moved only ${f(180 - n.relayLanderSeparationDeg)}°. The steeper the descent, the nearer it lands to the relay.`,
  `- **The sling wheel cannot shed that speed.** An untapered spoke fails at a rim speed of √(2σ/ρ): ${f(wheelRimKms)} km/s for`,
  `  carbon fibre (${FIBRE_STRENGTH / 1e9} GPa, ${FIBRE_DENSITY} kg/m³; values from memory, check them), which is`,
  `  ${f((wheelRimKms / n.arrivalSpeedKms) * 100, 2)}% of the`,
  '  arrival speed. Tapering buys a small multiple of that at exponential mass cost, not a factor of 200.',
  `- **Light pressure is the one force that scales with gravity here.** Both fall as 1/r², so a reflector lighter than`,
  `  ${f(sailLoading * 1e3, 2)} g/m² (all-up mass over sail area) is pushed out harder than it is pulled in, at any distance, and`,
  '  could descend slowly instead of falling. Not modelled; it trades the speed problem for a materials one.',
  '',
].join('\n')
writeFileSync(join(outDir, 'trajectory.md'), lines)


/**
 * Top-down (ecliptic north up) plot of the trajectory.
 *
 * @param {number} halfWidthAu Half the plotted width
 * @param {Array<string>} legIds Legs to draw
 * @param {string} title
 * @returns {string} SVG
 */
function plot(halfWidthAu, legIds, title) {
  const size = 900
  const k = size / (2 * halfWidthAu * AU)
  const pt = (r) => `${f((size / 2) + (r[0] * k), 1)},${f((size / 2) - (r[1] * k), 1)}`
  const colors = {psp: '#b06020', transfer: '#ffe040', sync: '#40ff90', relay: '#40ff90', descent: '#ff3050'}
  const path = (points, color, width = 1.2, dash = '') => {
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
    return `<polyline fill="none" stroke="${color}" stroke-width="${width}"${dashAttr} points="${points.join(' ')}"/>`
  }
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" font-family="sans-serif" font-size="13">`,
    `<rect width="${size}" height="${size}" fill="#05070c"/>`,
    `<text x="16" y="26" fill="#c8d4e8" font-size="16">${title}</text>`,
  ]
  for (const [planet, color] of [['venus', '#8a7a50'], ['earth', '#4a6a9a']]) {
    const pts = []
    for (let i = 0; i <= 360; i++) {
      pts.push(pt(planetState(planet, mission.tStart + ((i / 360) * 366 * DAY)).r))
    }
    out.push(path(pts, color, 0.8, '4 4'))
  }
  for (const leg of mission.legs) {
    if (!legIds.includes(leg.id)) {
      continue
    }
    const span = Math.min(leg.t1 - leg.t0, leg.orbit.period)
    const pts = []
    for (let i = 0; i <= 720; i++) {
      pts.push(pt(leg.stateAt(leg.t0 + ((span * i) / 720)).r))
    }
    out.push(path(pts, colors[leg.id] || colors[leg.phase], leg.phase === 'psp' ? 1 : 1.8))
  }
  const sunR = Math.max(R_SUN * k, 2.5)
  out.push(`<circle cx="${size / 2}" cy="${size / 2}" r="${f(sunR, 1)}" fill="#ffd060"/>`)
  // Resonant flybys recur at the same point of Venus's orbit, so label each
  // place once with every flyby that happened there.
  const places = []
  for (const fb of mission.flybys) {
    const [x, y] = pt(planetState('venus', fb.t).r).split(',').map(Number)
    const place = places.find((p) => Math.hypot(p.x - x, p.y - y) < 12)
    if (place) {
      place.names.push(`V${fb.n}`)
    } else {
      places.push({x, y, names: [`V${fb.n}`]})
    }
  }
  for (const {x, y, names} of places) {
    if (Math.abs(x - (size / 2)) < size / 2 && Math.abs(y - (size / 2)) < size / 2) {
      out.push(`<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="#e0d0a0"/>`)
      out.push(`<text x="${x + 7}" y="${y - 5}" fill="#e0d0a0">${names.join(', ')}</text>`)
    }
  }
  const legend = [
    ['Parker-like approach (launch, 7 orbit families)', colors.psp],
    ['Transfer to synchronous radius', colors.transfer],
    ['Sun-synchronous relay orbit', colors.sync],
    ['Lander descent', colors.descent],
    ['Venus and Earth orbits; V1–V7 flybys', '#8a7a50'],
  ]
  legend.forEach(([label, color], i) => {
    const y = size - 96 + (i * 18)
    out.push(`<line x1="16" y1="${y - 4}" x2="44" y2="${y - 4}" stroke="${color}" stroke-width="2"/>`)
    out.push(`<text x="52" y="${y}" fill="#c8d4e8">${label}</text>`)
  })
  const barAu = halfWidthAu > 0.5 ? 0.5 : 0.05
  out.push(`<line x1="${size - 16 - (barAu * AU * k)}" y1="${size - 20}" x2="${size - 16}" y2="${size - 20}" stroke="#c8d4e8"/>`)
  out.push(`<text x="${size - 16}" y="${size - 28}" fill="#c8d4e8" text-anchor="end">${barAu} AU (${f((barAu * AU) / R_SUN, 0)} Rs)</text>`)
  out.push('</svg>')
  return out.join('\n')
}

const allLegs = mission.legs.map((leg) => leg.id)
writeFileSync(join(outDir, 'trajectory.svg'), plot(1.1, allLegs, 'Suntan trajectory, heliocentric, ecliptic north up'))
writeFileSync(join(outDir, 'trajectory-inner.svg'),
    plot(0.2, ['psp1', 'psp7', 'transfer', 'sync', 'relay', 'descent'],
        'Suntan inner region: Parker families 1 and 7, relay orbit, lander descent'))
console.log(`Wrote trajectory.md, trajectory.svg, trajectory-inner.svg to ${outDir}`)
