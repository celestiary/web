/**
 * Simulated instruments for the Suntan craft: what a sensor would read at a
 * point on the trajectory, from simple standard models of the Sun's
 * atmosphere and field.  The Suntan app's panel (ui/SuntanApp.jsx) shows
 * these.
 *
 * These are smooth averages with no weather: no active regions, flares,
 * coronal mass ejections or sector structure.  Each reading says how much
 * to trust it; `agreement` on the gas temperature uses the ratings of
 * design/suntan/psp-working-study.md section 4.
 */
import {AU, R_SUN, TWO_PI, dot, norm} from './kepler.js'
import {
  SOLAR_CONSTANT,
  plateTemperature,
  solarFlux,
  solarRotationPeriod,
  sphereTemperature,
} from './mission.js'


const KM = 1e3
// Top of the transition region.
const CORONA_BASE = 2500 * KM

// Gas temperature against height above the photosphere, in the standard
// picture, interpolated in log temperature.  Each entry's
// layer name and agreement rating describe the stretch from its height up to
// the next entry's.  The 4,400 K minimum at 500 km and the chromospheric rise
// are the semi-empirical (VAL/FAL) models' averages; the corona and wind
// values are round numbers consistent with spectroscopy near the Sun and
// with Parker Solar Probe and 1 AU spacecraft further out.
const GAS_PROFILE = [
  {height: 0, kelvin: 5772, layer: 'Photosphere', agreement: 'well constrained'},
  {height: 500 * KM, kelvin: 4400, layer: 'Chromosphere', agreement: 'contested'},
  {height: 2000 * KM, kelvin: 2e4, layer: 'Transition region', agreement: 'model-dependent'},
  {height: CORONA_BASE, kelvin: 1e6, layer: 'Low corona', agreement: 'well constrained'},
  {height: 0.5 * R_SUN, kelvin: 1.5e6, layer: 'Corona', agreement: 'well constrained'},
  {height: 9 * R_SUN, kelvin: 1e6, layer: 'Outer corona', agreement: 'well constrained'},
  {height: 35 * R_SUN, kelvin: 4e5, layer: 'Solar wind', agreement: 'well constrained'},
  {height: AU - R_SUN, kelvin: 1e5, layer: 'Solar wind', agreement: 'well constrained'},
]

// Open magnetic flux spreads radially beyond the source surface, so the
// radial field falls as 1/r^2 there.  3 nT at 1 AU is the usual near-Earth
// average and gives about 110 nT at 35.7 Rs, in line with Parker's first
// perihelion.
const FIELD_RADIAL_AT_1AU_NT = 3
// Where potential-field models put the transition from closed loops to open,
// radial field.  Inside it the large-scale field is taken as a dipole, 1/r^3.
const SOURCE_SURFACE = 2.5 * R_SUN

// Slow solar wind: asymptotic speed and the scale over which it accelerates.
// SolarWind.js's slow wind, which it draws (sensors.test.js holds them equal;
// imported, a module of the first load would be split into a chunk of its own).
export const WIND_ASYMPTOTIC_SPEED = 4e5
const WIND_ACCELERATION_SCALE = 15 * R_SUN


/**
 * @param {number} dist Meters from the Sun's center
 * @returns {{kelvin: number, layer: string, agreement: string}} Ambient gas
 *   temperature, the layer it is in, and how well that layer's value is agreed
 */
export function gasTemperature(dist) {
  const height = Math.max(0, dist - R_SUN)
  const last = GAS_PROFILE[GAS_PROFILE.length - 1]
  if (height >= last.height) {
    return {kelvin: last.kelvin, layer: last.layer, agreement: last.agreement}
  }
  const i = GAS_PROFILE.findIndex((point) => point.height > height) - 1
  const [below, above] = [GAS_PROFILE[i], GAS_PROFILE[i + 1]]
  // The thin layers under the corona change with height itself; the corona
  // and wind fall off as power laws, so there the fraction is in log height.
  const frac = below.height < CORONA_BASE ?
    (height - below.height) / (above.height - below.height) :
    Math.log(height / below.height) / Math.log(above.height / below.height)
  const kelvin = Math.exp(Math.log(below.kelvin) + (frac * Math.log(above.kelvin / below.kelvin)))
  return {kelvin, layer: below.layer, agreement: below.agreement}
}


/**
 * @param {number} dist Meters from the Sun's center
 * @returns {number} Solar wind speed, m/s
 */
export function windSpeed(dist) {
  const height = Math.max(0, dist - R_SUN)
  return WIND_ASYMPTOTIC_SPEED * Math.sqrt(1 - Math.exp(-height / WIND_ACCELERATION_SCALE))
}


/**
 * Large-scale average magnetic field: a Parker spiral outside the source
 * surface and a dipole-like field inside it.  The azimuthal part is the
 * winding of radial field lines by the Sun's rotation, so it is zero at the
 * source surface and overtakes the radial part near 1 AU.  The sign of the
 * field (toward or away from the Sun) depends on the magnetic sector and is
 * not modelled; the radial part is given as positive.
 *
 * @param {number} dist Meters from the Sun's center
 * @returns {{total: number, radial: number, azimuthal: number}} Nanotesla
 */
export function magneticField(dist) {
  const r = Math.max(dist, R_SUN)
  const atSourceSurface = FIELD_RADIAL_AT_1AU_NT * Math.pow(AU / SOURCE_SURFACE, 2)
  if (r < SOURCE_SURFACE) {
    const radial = atSourceSurface * Math.pow(SOURCE_SURFACE / r, 3)
    return {total: radial, radial, azimuthal: 0}
  }
  const radial = atSourceSurface * Math.pow(SOURCE_SURFACE / r, 2)
  const rotationRate = TWO_PI / solarRotationPeriod(0)
  const azimuthal = -radial * ((rotationRate * (r - SOURCE_SURFACE)) / windSpeed(r))
  return {total: Math.hypot(radial, azimuthal), radial, azimuthal}
}


/**
 * Every instrument's reading for a craft state.
 *
 * @param {object|null} state From mission.stateAt
 * @returns {object|null} Readings, or null when there is no state (before launch)
 */
export function readSensors(state) {
  if (!state) {
    return null
  }
  const {dist} = state
  const flux = solarFlux(dist)
  const gas = gasTemperature(dist)
  const field = magneticField(dist)
  return {
    distanceRs: dist / R_SUN,
    altitudeKm: (dist - R_SUN) / KM,
    speedKms: state.speed / KM,
    // Positive falling toward the Sun.
    descentRateKms: -dot(state.r, state.v) / norm(state.r) / KM,
    sunlightWm2: flux,
    suns: flux / SOLAR_CONSTANT,
    plateTemperatureK: plateTemperature(dist),
    hullTemperatureK: sphereTemperature(dist),
    gasTemperatureK: gas.kelvin,
    layer: gas.layer,
    agreement: gas.agreement,
    windSpeedKms: windSpeed(dist) / KM,
    fieldNt: field.total,
    fieldRadialNt: field.radial,
    fieldAzimuthalNt: field.azimuthal,
  }
}


/**
 * @param {number} nanotesla
 * @returns {string} With the unit a reader would expect at that size
 */
export function formatField(nanotesla) {
  const size = Math.abs(nanotesla)
  if (size >= 1e5) {
    // One gauss is 100,000 nT; solar surface fields are quoted in gauss.
    return `${(nanotesla / 1e5).toFixed(2)} G`
  }
  if (size >= 1e3) {
    return `${(nanotesla / 1e3).toFixed(2)} µT`
  }
  return `${nanotesla.toFixed(size >= 100 ? 0 : 1)} nT`
}


/**
 * @param {number} kelvin
 * @returns {string}
 */
export function formatTemperature(kelvin) {
  if (kelvin >= 1e5) {
    return `${(kelvin / 1e6).toFixed(2)} MK`
  }
  return `${Math.round(kelvin).toLocaleString('en-US')} K`
}
