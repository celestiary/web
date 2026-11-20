import {describe, expect, it} from 'bun:test'
import {
  AU,
  DAY,
  GM_SUN,
  R_SUN,
  circularSpeed,
  norm,
  orbitFromState,
  orbitState,
  sampleTimes,
  solveKepler,
  sub,
} from './kepler'
import {planetsApprox} from '../planetsApprox.js'
import {
  planetStates,
  SOLAR_CONSTANT,
  T_EFF_SUN,
  VENUS_FLYBYS,
  buildMission,
  solarFlux,
  solarRotationPeriod,
  sphereTemperature,
  sphereTemperatureDistance,
} from './mission'


describe('kepler', () => {
  it('solves Kepler\'s equation for sun-grazing eccentricities', () => {
    for (const e of [0, 0.3, 0.9, 0.9946]) {
      for (const M of [-3, -0.01, 0, 0.001, 1, 3.1]) {
        const E = solveKepler(M, e)
        expect(E - (e * Math.sin(E))).toBeCloseTo(M, 10)
      }
    }
  })

  it('round-trips a state through orbit elements', () => {
    const r = [0.7 * AU, 0.2 * AU, 0.01 * AU]
    const v = [-9e3, 21e3, 500]
    const orbit = orbitFromState(r, v, 1000)
    const back = orbitState(orbit, 1000)
    expect(norm(sub(back.r, r))).toBeLessThan(1)
    expect(norm(sub(back.v, v))).toBeLessThan(1e-6)
  })
})


describe('sampleTimes', () => {
  it('crowds samples at perihelion and covers one revolution', () => {
    const orbit = orbitFromState([0.05 * AU, 0, 0], [0, 170e3, 0], 0)
    const times = sampleTimes(orbit, 0, 10 * orbit.period, 100)
    expect(times.length).toBe(101)
    expect(times[100] - times[0]).toBeCloseTo(orbit.period, 0)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1])
    }
    // The first step, from perihelion, is far shorter than one at aphelion.
    expect(times[1] - times[0]).toBeLessThan((times[51] - times[50]) / 3)
  })
})


describe('planet states from planetsApprox', () => {
  const planetState = planetStates(planetsApprox)

  it('puts Venus and Earth at their distances and speeds', () => {
    const t = Date.parse('2024-11-06T18:01:00Z') / 1000
    expect(norm(planetState('venus', t).r) / AU).toBeGreaterThan(0.718)
    expect(norm(planetState('venus', t).r) / AU).toBeLessThan(0.729)
    expect(norm(planetState('venus', t).v) / 1e3).toBeCloseTo(35.0, 0)
    expect(norm(planetState('earth', t).r) / AU).toBeGreaterThan(0.983)
    expect(norm(planetState('earth', t).r) / AU).toBeLessThan(1.017)
    expect(norm(planetState('earth', t).v) / 1e3).toBeCloseTo(29.9, 0)
  })

  it('takes Venus\'s orbit normal 3.39 degrees from the ecliptic\'s', () => {
    const {normal} = planetState('venus', Date.parse('2020-01-01T00:00:00Z') / 1000)
    expect(Math.acos(normal[2]) * 180 / Math.PI).toBeCloseTo(3.39, 1)
  })
})


describe('thermal', () => {
  it('gives a grey sphere its textbook equilibrium temperatures', () => {
    // About 279 K at Earth's distance; half the sky is Sun at the photosphere.
    expect(sphereTemperature(AU)).toBeCloseTo(278.3, 0)
    expect(sphereTemperature(R_SUN)).toBeCloseTo(T_EFF_SUN / Math.pow(2, 0.25), 6)
  })

  it('inverts temperature to distance', () => {
    for (const kelvin of [300, 1650, 4373]) {
      expect(sphereTemperature(sphereTemperatureDistance(kelvin))).toBeCloseTo(kelvin, 6)
    }
    expect(sphereTemperatureDistance(5000)).toBe(R_SUN)
  })
})


describe('Suntan mission', () => {
  const mission = buildMission(planetsApprox)
  const n = mission.numbers

  // The reconstructed legs are not forced to meet at Venus, so that they do
  // is the check that PSP's timeline was transcribed and modelled correctly.
  it('meets Venus at all seven flybys', () => {
    expect(mission.flybys.length).toBe(7)
    for (const flyby of mission.flybys) {
      expect(flyby.missBeforeKm).toBeLessThan(1e5)
      expect(flyby.missAfterKm).toBeLessThan(1e5)
    }
  })

  // An unpowered gravity assist turns the Venus-relative velocity without
  // changing its magnitude.
  it('conserves v-infinity through each flyby', () => {
    for (const flyby of mission.flybys) {
      expect(Math.abs(flyby.vInfInKms - flyby.vInfOutKms)).toBeLessThan(0.5)
    }
  })

  // The closure is sensitive enough to tell flyby dates apart: sources
  // disagree on three of them by five days (studies/suntan/psp-working-study.md).
  it('misses Venus when given the wrong flyby dates', () => {
    const shifted = [...VENUS_FLYBYS]
    for (const i of [2, 4, 5]) {
      shifted[i] -= 5 * DAY
    }
    const worstMiss = Math.max(...buildMission(planetsApprox, {venusFlybys: shifted}).flybys.map(
        (flyby) => Math.max(flyby.missBeforeKm, flyby.missAfterKm)))
    expect(worstMiss).toBeGreaterThan(1e6)
  })

  it('reproduces PSP\'s launch energy and perihelion speeds', () => {
    // PSP: C3 about 154 km^2/s^2, 95 km/s at perihelion 1, 191-192 km/s at 9.86 Rs.
    expect(n.launchC3).toBeGreaterThan(148)
    expect(n.launchC3).toBeLessThan(160)
    expect(n.firstPerihelionSpeedKms).toBeCloseTo(95.3, 0)
    expect(n.finalPerihelionSpeedKms).toBeGreaterThan(190)
    expect(n.finalPerihelionSpeedKms).toBeLessThan(193)
    expect(n.finalAphelionAu).toBeCloseTo(0.73, 2)
    expect(n.fluxAtFinalPerihelion / SOLAR_CONSTANT).toBeCloseTo(475, -1)
  })

  it('finds the synchronous radius next to PSP\'s first perihelion', () => {
    expect(solarRotationPeriod(0) / DAY).toBeCloseTo(24.47, 2)
    expect(solarRotationPeriod(60)).toBeGreaterThan(solarRotationPeriod(0))
    expect(n.syncRadiusRs).toBeGreaterThan(35)
    expect(n.syncRadiusRs).toBeLessThan(36)
    expect(Math.abs(n.syncRadiusRs - n.alternatives.firstPerihelionRs)).toBeLessThan(0.5)
  })

  it('is continuous in position across every burn and release', () => {
    for (const t of [mission.tBurn1, mission.tBurn2, mission.tRelease, mission.tArrive]) {
      for (const vehicle of ['relay', 'lander']) {
        const before = mission.stateAt(t - 1, vehicle)
        const after = mission.stateAt(t + 1, vehicle)
        // Two seconds of flight at up to 610 km/s.
        expect(norm(sub(after.r, before.r))).toBeLessThan(1.3e6)
      }
    }
  })

  it('changes speed at each burn by that burn\'s delta-v', () => {
    const [burn1, burn2, burn3] = mission.burns
    const jump = (t, vehicle) => (mission.stateAt(t + 1, vehicle).speed -
      mission.stateAt(t - 1, vehicle).speed) / 1e3
    expect(jump(burn1.t, 'relay')).toBeCloseTo(burn1.dvKms, 2)
    expect(jump(burn2.t, 'relay')).toBeCloseTo(-burn2.dvKms, 2)
    expect(jump(burn3.t, 'lander')).toBeCloseTo(-burn3.dvKms, 2)
    expect(jump(burn3.t, 'relay')).toBeCloseTo(0, 2)
  })

  it('holds the relay at the synchronous radius and speed', () => {
    const relay = mission.stateAt(mission.tArrive + (10 * DAY), 'relay')
    expect(relay.dist / R_SUN).toBeCloseTo(n.syncRadiusRs, 6)
    expect(relay.speed).toBeCloseTo(circularSpeed(relay.dist), 3)
  })

  it('delivers the lander to the photosphere near escape speed', () => {
    const justBefore = mission.stateAt(mission.tArrive - 1, 'lander')
    expect(justBefore.dist / R_SUN).toBeCloseTo(1, 4)
    expect(n.arrivalSpeedKms).toBeGreaterThan(600)
    expect(n.arrivalSpeedKms).toBeLessThan(Math.sqrt((2 * GM_SUN) / R_SUN) / 1e3)
    expect(solarFlux(justBefore.dist) / 1e6).toBeCloseTo(62.9, 0)
    const landed = mission.stateAt(mission.tArrive + DAY, 'lander')
    expect(landed.dist).toBeCloseTo(R_SUN, 0)
    expect(landed.speed / 1e3).toBeCloseTo(n.surfaceRotationSpeedKms, 6)
  })

  it('reports that the relay cannot see a Hohmann-descent lander', () => {
    expect(n.relaySeesLander).toBe(false)
    expect(n.alternatives.radialDropRelaySeesLander).toBe(true)
  })

  it('has no state before launch', () => {
    expect(mission.stateAt(mission.tStart - 1)).toBe(null)
  })
})
