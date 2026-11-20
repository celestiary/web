import {describe, expect, it} from 'bun:test'
import {planetsApprox} from '../planetsApprox.js'
import {SLOW_WIND_KM_S} from '../sun/SolarWind.js'
import {AU, R_SUN} from './kepler'
import {buildMission} from './mission'
import {
  formatField,
  formatTemperature,
  gasTemperature,
  magneticField,
  readSensors,
  WIND_ASYMPTOTIC_SPEED,
  windSpeed,
} from './sensors'


describe('gas temperature', () => {
  it('follows the standard layers from the photosphere out', () => {
    expect(gasTemperature(R_SUN).kelvin).toBeCloseTo(5772, 6)
    expect(gasTemperature(R_SUN).layer).toBe('Photosphere')
    expect(gasTemperature(R_SUN + 500e3).kelvin).toBeCloseTo(4400, 6)
    // The temperature minimum is the base of the chromosphere.
    expect(gasTemperature(R_SUN + 500e3).layer).toBe('Chromosphere')
    // Cooler than the photosphere just above it, then the million-degree corona.
    expect(gasTemperature(R_SUN + 300e3).kelvin).toBeLessThan(5772)
    expect(gasTemperature(1.5 * R_SUN).kelvin).toBeCloseTo(1.5e6, 0)
    expect(gasTemperature(5 * R_SUN).layer).toBe('Corona')
    expect(gasTemperature(50 * R_SUN).layer).toBe('Solar wind')
    expect(gasTemperature(AU).kelvin).toBeCloseTo(1e5, 0)
    expect(gasTemperature(5 * AU).kelvin).toBeCloseTo(1e5, 0)
  })

  it('is continuous across the transition region', () => {
    const below = gasTemperature(R_SUN + 2499.9e3).kelvin
    const above = gasTemperature(R_SUN + 2500.1e3).kelvin
    expect(Math.abs(above - below) / above).toBeLessThan(0.01)
  })

  it('rates how well each layer is agreed', () => {
    expect(gasTemperature(R_SUN).agreement).toBe('well constrained')
    expect(gasTemperature(R_SUN + 1000e3).agreement).toBe('contested')
    expect(gasTemperature(R_SUN + 2200e3).layer).toBe('Transition region')
    expect(gasTemperature(R_SUN + 2200e3).agreement).toBe('model-dependent')
  })
})


describe('solar wind and magnetic field', () => {
  it('blows at the slow wind SolarWind.js draws', () => {
    expect(WIND_ASYMPTOTIC_SPEED).toBe(SLOW_WIND_KM_S * 1e3)
  })

  it('accelerates the wind from rest toward its asymptotic speed', () => {
    expect(windSpeed(R_SUN)).toBe(0)
    expect(windSpeed(10 * R_SUN) / 1e3).toBeGreaterThan(200)
    expect(windSpeed(10 * R_SUN) / 1e3).toBeLessThan(300)
    expect(windSpeed(AU) / 1e3).toBeCloseTo(400, 0)
  })

  it('gives the near-Earth field: about 3 nT radial, wound to about 45 degrees', () => {
    const field = magneticField(AU)
    expect(field.radial).toBeCloseTo(3, 6)
    expect(Math.abs(field.azimuthal) / field.radial).toBeGreaterThan(0.8)
    expect(Math.abs(field.azimuthal) / field.radial).toBeLessThan(1.3)
    expect(field.total).toBeGreaterThan(3.8)
    expect(field.total).toBeLessThan(5)
  })

  it('reaches about 100 nT at Parker\'s first perihelion and gauss at the surface', () => {
    expect(magneticField(35.66 * R_SUN).total).toBeGreaterThan(90)
    expect(magneticField(35.66 * R_SUN).total).toBeLessThan(130)
    expect(magneticField(R_SUN).total / 1e5).toBeGreaterThan(1)
    expect(magneticField(R_SUN).total / 1e5).toBeLessThan(10)
  })

  it('is continuous at the source surface', () => {
    const inside = magneticField(2.4999 * R_SUN).total
    const outside = magneticField(2.5001 * R_SUN).total
    expect(Math.abs(inside - outside) / outside).toBeLessThan(0.001)
  })
})


describe('readSensors', () => {
  const mission = buildMission(planetsApprox)

  it('has nothing to read before launch', () => {
    expect(readSensors(mission.stateAt(mission.tStart - 1))).toBe(null)
  })

  it('reads the relay orbit', () => {
    const relay = readSensors(mission.stateAt(mission.tArrive, 'relay'))
    expect(relay.distanceRs).toBeCloseTo(mission.numbers.syncRadiusRs, 6)
    expect(relay.suns).toBeCloseTo(37, 0)
    expect(relay.descentRateKms).toBeCloseTo(0, 6)
    expect(relay.layer).toBe('Outer corona')
    expect(relay.fieldNt).toBeGreaterThan(90)
  })

  it('reads the lander at the photosphere', () => {
    const lander = readSensors(mission.stateAt(mission.tArrive - 1, 'lander'))
    expect(lander.altitudeKm).toBeLessThan(1)
    expect(lander.speedKms).toBeCloseTo(609.1, 0)
    expect(lander.layer).toBe('Photosphere')
    expect(lander.plateTemperatureK).toBeCloseTo(5772, 0)
    // Rises steeply in the last metres as the Sun comes to fill half the sky.
    expect(lander.hullTemperatureK).toBeGreaterThan(4850)
    expect(lander.hullTemperatureK).toBeLessThan(4854)
    expect(lander.gasTemperatureK).toBeCloseTo(5772, -1)
    expect(lander.fieldNt / 1e5).toBeGreaterThan(1)
  })
})


describe('formatting', () => {
  it('picks the unit by size', () => {
    expect(formatField(3.21)).toBe('3.2 nT')
    expect(formatField(109.4)).toBe('109 nT')
    expect(formatField(22194)).toBe('22.19 µT')
    expect(formatField(346800)).toBe('3.47 G')
    expect(formatTemperature(4373.2)).toBe('4,373 K')
    expect(formatTemperature(1.5e6)).toBe('1.50 MK')
  })
})
