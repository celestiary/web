import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'bun:test'
import StarsCatalog from './StarsCatalog.js'
import {
  CATALOGUE_NORTH,
  MEASURED_STARS,
  effectiveGravity,
  inferLuminosityB,
  luminosityFromMagnitude,
  massFromLuminosity,
  radiusFromLuminosity,
  rocheModel,
  rotationAxis,
  spotsByType,
  starParams,
} from './starParams.js'
import {SUN_TEFF, granulesPerRadius} from './stellar.js'


/** @returns {StarsCatalog} The bundled catalogue, with its names */
function catalogue() {
  const buf = readFileSync('./public/data/stars.dat')
  const c = new StarsCatalog()
  c.read(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  c.readNames(readFileSync('./public/data/starnames.dat', 'utf8'))
  return c
}


const cat = catalogue()
const byName = (name) => cat.starByHip.get(cat.hipByName.get(name))
const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
const unit = (a) => a.map((c) => c / Math.hypot(...a))


describe('the luminosity and radius', () => {
  it('the Sun\'s magnitude gives the Sun', () => {
    expect(luminosityFromMagnitude(4.83, SUN_TEFF)).toBeCloseTo(1, 1)
    expect(radiusFromLuminosity(1, SUN_TEFF)).toBe(1)
    // Stefan-Boltzmann: half the temperature at the same luminosity is four times the radius.
    expect(radiusFromLuminosity(1, SUN_TEFF / 2)).toBeCloseTo(4, 9)
  })

  it('the mass-luminosity relation inverts its pieces and is continuous', () => {
    expect(massFromLuminosity(1)).toBeCloseTo(1, 9)
    expect(massFromLuminosity(15.9)).toBeCloseTo(2, 2)
    expect(massFromLuminosity(1.4 * (10 ** 3.5))).toBeCloseTo(10, 6)
    expect(massFromLuminosity(0.23 * (0.2 ** 2.3))).toBeCloseTo(0.2, 6)
    let last = 0
    for (let l = 1e-4; l < 1e7; l *= 1.5) {
      const m = massFromLuminosity(l)
      expect(m).toBeGreaterThan(last)
      last = m
    }
  })

  it('every catalogue star is sized within a factor of 2 of the measured stars with interferometric radii', () => {
    // Catalogue stars, not the measured table's: [name, measured R☉, source]
    const stars = [
      ['Rigel', 78.9, 'Moravveji et al. 2012'],
      ['Arcturus', 25.4, 'Ramírez & Allende Prieto 2011'],
      ['Procyon', 2.05, 'Kervella et al. 2004'],
      ['Tau Ceti', 0.79, 'Teixeira et al. 2009'],
      ['Spica', 7.47, 'Herbison-Evans et al. 1971'],
      ['Canopus', 71, 'Domiciano de Souza et al. 2014'],
      ['Polaris', 46, 'Evans et al. 2018'],
      ['Aldebaran', 44.1, 'Richichi & Roccatagliata 2005'],
    ]
    for (const [name, measured] of stars) {
      const r = cat.starByHip.get(cat.hipByName.get(name)).radius / 6.957e8
      expect(r / measured).toBeGreaterThan(0.5)
      expect(r / measured).toBeLessThan(2)
    }
  })

  it('the catalogue holds the measured stars\' radii and temperatures', () => {
    expect(byName('Betelgeuse').radius / 6.957e8).toBeCloseTo(764, 6)
    expect(byName('Proxima Centauri').radius / 6.957e8).toBeCloseTo(0.1542, 6)
    expect(byName('Sirius').teff).toBe(9845)
    // Vega's: its equator's radius, its mean temperature.
    expect(byName('Vega').radius / 6.957e8).toBeCloseTo(2.818, 6)
    expect(byName('Vega').teff).toBeGreaterThan(8152)
    expect(byName('Vega').teff).toBeLessThan(10060)
  })

  it('every catalogue star has a finite, positive radius and temperature', () => {
    for (const star of cat.starByHip.values()) {
      expect(star.radius).toBeGreaterThan(0)
      expect(Number.isFinite(star.radius)).toBe(true)
      expect(star.teff ?? SUN_TEFF).toBeGreaterThan(500)
    }
  })
})


describe('the luminosity class from the magnitude', () => {
  it('a star at its type\'s dwarf magnitude or fainter is a dwarf', () => {
    expect(inferLuminosityB('G', 2, 5.0)).toBe(5)
    expect(inferLuminosityB('M', 5, 15.5)).toBe(5)
    expect(inferLuminosityB('A', 0, NaN)).toBe(5)
  })

  it('a bright star of its type is a giant or supergiant', () => {
    // Polaris, F7, M_V -3.6: a supergiant (F7 Ib).
    expect(inferLuminosityB('F', 7, -3.64)).toBeLessThan(2.5)
    expect(starParams(byName('Polaris')).lumB).toBeLessThan(2.5)
    // A K giant, M_V 0.
    const b = inferLuminosityB('K', 1, 0)
    expect(b).toBeGreaterThan(2)
    expect(b).toBeLessThan(4)
  })
})


describe('the measured stars', () => {
  it('are named and sourced', () => {
    for (const [hip, star] of MEASURED_STARS) {
      expect(star.sources.length).toBeGreaterThan(10)
      if (hip !== 0) {
        expect(cat.starByHip.get(hip)).toBeDefined()
      }
    }
  })

  it('give the Sun its own parameters, by name or HIP 0', () => {
    for (const props of [{name: 'sun', spectralType: '4'}, {hipId: 0, spectralType: 4, absMag: 4.83}]) {
      const p = starParams(props)
      expect(p.teff).toBe(SUN_TEFF)
      expect(p.radius).toBe(1)
      expect(p.logg).toBeCloseTo(4.438, 9)
      expect(p.spots.prob).toBeGreaterThan(0)
    }
  })

  it('Betelgeuse has a few giant cells and no spots; Proxima many small cells and many spots', () => {
    const b = starParams(byName('Betelgeuse'))
    expect(b.logg).toBeLessThan(0.5)
    expect(granulesPerRadius(b.teffMean, b.logg, b.radiusPole)).toBeLessThan(40)
    expect(b.spots.prob).toBe(0)
    const p = starParams(byName('Proxima Centauri'))
    expect(granulesPerRadius(p.teffMean, p.logg, p.radiusPole)).toBeGreaterThan(535)
    expect(p.spots.prob).toBeGreaterThan(0.5)
    expect(p.spots.belt[1]).toBeGreaterThan(1)
  })

  it('Sirius and the hot stars have no spots', () => {
    expect(starParams(byName('Sirius')).spots.prob).toBe(0)
    expect(spotsByType(9000, 5).prob).toBe(0)
    expect(spotsByType(4000, 1).prob).toBe(0)
  })
})


describe('rotation', () => {
  it('the Roche model reproduces Altair\'s and Vega\'s measured equators', () => {
    // Altair, Monnier et al. 2007: 8,450 K pole, 6,860 K equator, β 0.19.
    const altair = starParams(byName('Altair'))
    const a = altair.rotation
    expect(a.oblate).toBeCloseTo(2.029 / 1.636, 9)
    const tEq = 8450 * (effectiveGravity(a.oblate, 0, a.omega2) ** a.beta)
    expect(Math.abs(tEq - 6860)).toBeLessThan(60)
    // Vega, Yoon et al. 2010: von Zeipel's β = 0.25 from its two temperatures.
    const v = starParams(byName('Vega')).rotation
    expect(v.beta).toBeCloseTo(0.25, 2)
    // Gravity at the pole is GM / R_p²: 1.
    expect(effectiveGravity(0, 1, v.omega2)).toBeCloseTo(1, 9)
    // The mean temperature is between the pole's and the equator's.
    expect(v.teffMean).toBeGreaterThan(8152)
    expect(v.teffMean).toBeLessThan(10060)
  })

  it('a non-rotating star has none', () => {
    expect(starParams(byName('Sirius')).rotation).toBeNull()
    expect(rocheModel({radiusEq: 1, teffEq: 5000}, 5000, 1).omega2).toBe(0)
  })

  it('the catalogue\'s north is the celestial pole: Polaris is within a degree of it', () => {
    const p = byName('Polaris')
    expect(dot(unit([p.x, p.y, p.z]), CATALOGUE_NORTH)).toBeGreaterThan(Math.cos(1 * Math.PI / 180))
  })

  it('the axis is tipped toward the observer by 90° - i, at the position angle east of north', () => {
    const sight = [0, 0, -1]
    const north = [0, 1, 0]
    // Pole-on: toward the observer.
    expect(rotationAxis({inclination: 0, positionAngle: 0}, sight, north)).toEqual([0, 0, 1].map((c) => c + 0))
    // Edge-on at PA 0: north; at PA 90°: east, which is left (-x) seen along -z with y up.
    const n = rotationAxis({inclination: Math.PI / 2, positionAngle: 0}, sight, north)
    expect(n[1]).toBeCloseTo(1, 9)
    const e = rotationAxis({inclination: Math.PI / 2, positionAngle: Math.PI / 2}, sight, north)
    expect(e[0]).toBeCloseTo(-1, 9)
    // Altair from the Sun: i = 57.2° from the line of sight.
    const altair = byName('Altair')
    const los = unit([altair.x, altair.y, altair.z])
    const axis = rotationAxis(starParams(altair).rotation, los, CATALOGUE_NORTH)
    expect(Math.acos(-dot(axis, los)) * 180 / Math.PI).toBeCloseTo(57.2, 6)
  })
})
