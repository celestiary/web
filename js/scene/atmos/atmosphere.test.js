// Unit tests for atmosphere parameter validation and planet atmosphere data.
import {readFileSync} from 'fs'
import BODY_DIRS from '../../bodyDirs.json'
import {descriptorUrl} from '../../bodyBundle.js'
import {ASTRO_UNIT_METER, DISPLAY_GAIN} from '../../shared.js'
import {PHYSICAL_SKY_GAIN, exposureAt, skyExposure, skyGain} from '../exposure.js'
import {groundAlbedo, mieParams, ozoneParams} from './AtmospherePrecompute.js'
import TEXTURE_MEANS from '../textureMeans.json'
import {GROUND_ALBEDO_REBUILD, groundAlbedoStale, setBuiltAlbedo, setGroundMonth} from './groundLight.js'
import {EARTH, channelCoefficients} from '../../../tools/atmos/bandAverage.mjs'


/**
 * @returns {object}
 */
function loadPlanet(name) {
  return JSON.parse(readFileSync(`./public/${descriptorUrl(name)}`, 'utf8'))
}

// Fields stored as Measure strings ("8e3 m") need scalar extraction in tests,
// since the test reads raw JSON without reification.
const scalar = (v) => typeof v === 'string' ? parseFloat(v) : v


/**
 * Cornette-Shanks, as MIE_PHASE_GLSL's csPhase.
 *
 * @param {number} mu cos(scattering angle)
 * @param {number} g asymmetry
 * @returns {number} per steradian
 */
function csPhase(mu, g) {
  const g2 = g * g
  return 3 / (8 * Math.PI) * ((1 - g2) * (1 + (mu * mu))) / ((2 + g2) * Math.pow(1 + g2 - (2 * g * mu), 1.5))
}


/**
 * A body's three-lobe Mie phase function in one channel (mieParams): the
 * narrow lobe's share f, and the broad lobes the rest.
 *
 * @param {object} atm raw atmosphere JSON
 * @param {number} c channel
 * @param {number} mu
 * @returns {number}
 */
function mars3Lobe(atm, c, mu) {
  const f = atm.miePeakWeight[c]
  const w = atm.mieForwardWeight
  return (f * csPhase(mu, atm.miePeakPolarity[c])) +
    ((1 - f) * ((w * csPhase(mu, atm.miePolarity[c])) + ((1 - w) * csPhase(mu, atm.mieBackPolarity))))
}


/**
 * @param {Function} phase of mu
 * @returns {{norm: number, meanCos: number}} its integral over the sphere,
 *   and its mean cosine; finely in angle near 0, where a narrow lobe is
 */
function integratePhase(phase) {
  let norm = 0
  let meanCos = 0
  const n = 200000
  for (let i = 0; i < n; i++) {
    // theta = pi u², fine at the forward peak
    const u0 = i / n
    const u1 = (i + 1) / n
    const t0 = Math.PI * u0 * u0
    const t1 = Math.PI * u1 * u1
    const t = 0.5 * (t0 + t1)
    const w = 2 * Math.PI * Math.sin(t) * (t1 - t0) * phase(Math.cos(t))
    norm += w
    meanCos += w * Math.cos(t)
  }
  return {norm, meanCos: meanCos / norm}
}

const REQUIRED_FIELDS = [
  'height',
  'rayleigh', 'rayleighScaleHeight',
  'mieCoeff', 'mieScaleHeight', 'miePolarity',
]


describe('atmosphere JSON data', () => {
  describe('earth', () => {
    const {atmosphere: atm} = loadPlanet('earth')

    it('has all required fields', () => {
      for (const f of REQUIRED_FIELDS) {
        expect(atm[f]).toBeDefined()
      }
    })

    it('rayleigh is an array of 3 positive numbers', () => {
      expect(atm.rayleigh).toHaveLength(3)
      for (const v of atm.rayleigh) {
        expect(v).toBeGreaterThan(0)
      }
    })

    it('scatters blue more than red (blue sky)', () => {
      // Rayleigh: [R, G, B] — Earth atmosphere scatters short wavelengths most
      expect(atm.rayleigh[2]).toBeGreaterThan(atm.rayleigh[0])
    })

    it('has plausible scale heights', () => {
      expect(scalar(atm.rayleighScaleHeight)).toBeGreaterThan(1000)
      expect(scalar(atm.rayleighScaleHeight)).toBeLessThan(20000)
      expect(scalar(atm.mieScaleHeight)).toBeGreaterThan(100)
      expect(scalar(atm.mieScaleHeight)).toBeLessThan(scalar(atm.rayleighScaleHeight))
    })

    it('atmosphere height is above scale height', () => {
      expect(scalar(atm.height)).toBeGreaterThan(scalar(atm.rayleighScaleHeight))
    })

    it('miePolarity is in valid Henyey-Greenstein range (-1, 1)', () => {
      expect(atm.miePolarity).toBeGreaterThan(-1)
      expect(atm.miePolarity).toBeLessThan(1)
    })

    // The channels' coefficients are each species' spectrum averaged over
    // the linear-sRGB channel's response under sunlight (composition.md,
    // "The channels' coefficients"; tools/atmos/bandAverage.mjs), not its
    // value at 680, 550 and 440 nm.
    const band = channelCoefficients().band

    it('has each channel\'s coefficients from the spectra, averaged over the channel', () => {
      const ozone = atm.ozone.absorption
      for (let c = 0; c < 3; c++) {
        expect(atm.rayleigh[c] / band.rayleigh[c]).toBeCloseTo(1, 3)
        expect(atm.mieCoeff[c] / band.mie[c]).toBeCloseTo(1, 3)
        expect(ozone[c]).toBeCloseTo(band.ozone[c], 9)
      }
    })

    it('has a clear day\'s aerosol: τ 0.12 at 550 nm, Ångström exponent 1.3', () => {
      // composition.md, "Per-body data": MODIS's global means are 0.13 over
      // ocean and 0.19 over land (Remer et al. 2008); OPAC's continental
      // average 0.15, its clean continental 0.06 (Hess et al. 1998).  The
      // spectrum is 1e-4 /m × (λ/550)^−1.3 over the 1.2 km scale height;
      // the channels' averages move a little from it (green 0.121).
      const H = scalar(atm.mieScaleHeight)
      expect(atm.mieCoeff).toHaveLength(3)
      expect(EARTH.mie550 * H).toBeCloseTo(0.12, 4)
      expect(EARTH.angstrom).toBe(1.3)
      const tau = atm.mieCoeff.map((k) => k * H)
      expect(tau[1]).toBeCloseTo(0.12, 2)
      expect(tau[0]).toBeLessThan(tau[1])
      expect(tau[2]).toBeGreaterThan(tau[1])
      expect(H).toBe(1200)
    })

    it('has an aerosol that absorbs a little and scatters forward, as AERONET measures', () => {
      // Single-scattering albedo 0.93 (OPAC continental average 0.925),
      // asymmetry 0.7 at 550 nm.
      expect(atm.mieAlbedo).toBe(0.93)
      expect(atm.miePolarity).toBe(0.7)
      expect(atm.miePeakWeight).toBeUndefined()
    })

    it('has 300 Dobson units of ozone in Bruneton\'s tent, with the Bremen cross-sections', () => {
      // Peak number density 300 DU / 15 km (demo.cc), times the 233 K
      // cross-sections (Serdyuchenko et al. 2014, demo.cc's table) averaged
      // over each channel.
      const o = ozoneParams(atm)
      expect(o.profile.toArray()).toEqual([1e4, 2.5e4, 4e4])
      const DOBSON = 2.687e20 // molecules per m²
      expect(EARTH.ozonePeakDensity).toBe(300 * DOBSON / 15000)
      // The column: the tent's integral is 15 km, so 300 DU, and its
      // optical depth in the green ≈ 0.027 (0.028 at 550 nm alone).
      expect(o.column.y).toBeCloseTo(0.0269, 3)
      // Chappuis: red and green absorbed, blue not; red's response holds
      // the band's 600 nm peak, so red is absorbed more than green.
      expect(o.column.x).toBeGreaterThan(o.column.y)
      expect(o.column.z).toBe(0)
    })
  })


  describe('mars', () => {
    const {atmosphere: atm} = loadPlanet('mars')

    it('has all required fields', () => {
      for (const f of REQUIRED_FIELDS) {
        expect(atm[f]).toBeDefined()
      }
    })

    it('rayleigh is an array of 3 positive numbers', () => {
      expect(atm.rayleigh).toHaveLength(3)
      for (const v of atm.rayleigh) {
        expect(v).toBeGreaterThan(0)
      }
    })

    it('scatters blue more than red, with a hundredth of Earth\'s air', () => {
      // Rayleigh: CO2 at 6 mbar, physical.  Mars's colour is its dust's
      // (mieAlbedo), not its gas's: the first data had a red-heavy
      // Rayleigh standing in for the butterscotch.
      const earth = loadPlanet('earth').atmosphere
      expect(atm.rayleigh[2]).toBeGreaterThan(atm.rayleigh[0])
      expect(atm.rayleigh[2]).toBeLessThan(earth.rayleigh[2] / 50)
    })

    it('has dust of optical depth about 0.5, mixed through the gas scale height', () => {
      // MSL and MER records: 0.3-1 outside storms (Lemmon et al. 2004, 2015).
      const tau = atm.mieCoeff * scalar(atm.mieScaleHeight)
      expect(tau).toBeGreaterThan(0.3)
      expect(tau).toBeLessThan(1)
      expect(scalar(atm.mieScaleHeight)).toBe(scalar(atm.rayleighScaleHeight))
    })

    it('has dust that absorbs blue more than red, and scatters it more sharply forward', () => {
      // Single-scattering albedo 0.83-0.90 in the blue, 0.92-0.96 in the red
      // (Tomasko et al. 1999; Wolff et al. 2009); the forward lobes sharper
      // in the blue, the bluish aureole round the Sun.
      expect(atm.mieAlbedo[0]).toBeGreaterThan(atm.mieAlbedo[2])
      for (const w of atm.mieAlbedo) {
        expect(w).toBeGreaterThan(0.8)
        expect(w).toBeLessThan(1)
      }
      expect(atm.miePeakPolarity[2]).toBeGreaterThan(atm.miePeakPolarity[0])
      expect(atm.miePolarity[2]).toBeGreaterThan(atm.miePolarity[0])
      // A back lobe, kept: the broad lobes are a forward and a backward one.
      expect(atm.mieBackPolarity).toBeLessThan(0)
      expect(atm.mieForwardWeight).toBeGreaterThan(0.5)
      expect(atm.mieForwardWeight).toBeLessThan(1)
    })

    it('has a narrow forward lobe, the diffraction peak of micron grains (#188)', () => {
      // Fitted to Mie scattering for r_eff 1.5 µm (composition.md, "The
      // dust's forward peak"): a lobe a few degrees wide, and about half the
      // extinction, as diffraction is for grains much larger than the
      // wavelength (its share of the scattering times the albedo, 0.5).
      for (let c = 0; c < 3; c++) {
        expect(atm.miePeakPolarity[c]).toBeGreaterThan(0.9)
        expect(atm.miePeakPolarity[c]).toBeLessThan(0.97)
        expect(atm.miePeakPolarity[c]).toBeGreaterThan(atm.miePolarity[c])
        expect(atm.miePeakWeight[c] * atm.mieAlbedo[c]).toBeGreaterThan(0.45)
        expect(atm.miePeakWeight[c] * atm.mieAlbedo[c]).toBeLessThan(0.55)
      }
    })

    it('has the measured mean cosine, 0.6-0.7, per channel, rising to the blue', () => {
      // Tomasko et al. 1999; Pollack et al. 1995.  Spheres of the fitted
      // size give 0.73-0.78; the grains' irregular shapes scatter more to
      // the side.  The phase function integrates to 1.
      const means = [0, 1, 2].map((c) => {
        const {norm, meanCos} = integratePhase((mu) => mars3Lobe(atm, c, mu))
        expect(norm).toBeCloseTo(1, 3)
        expect(meanCos).toBeGreaterThan(0.6)
        expect(meanCos).toBeLessThan(0.7005)
        return meanCos
      })
      expect(means[2]).toBeGreaterThan(means[1])
      expect(means[1]).toBeGreaterThan(means[0])
    })

    it('has a thicker aerosol column than Earth (more dust)', () => {
      const earth = loadPlanet('earth').atmosphere
      expect(atm.mieCoeff * scalar(atm.mieScaleHeight))
          .toBeGreaterThan(Math.max(...earth.mieCoeff) * scalar(earth.mieScaleHeight))
    })

    it('miePolarity is in valid Henyey-Greenstein range (-1, 1), per channel', () => {
      for (const g of atm.miePolarity) {
        expect(g).toBeGreaterThan(-1)
        expect(g).toBeLessThan(1)
      }
    })

    it('takes the physical single-scattering gain', () => {
      // π·DISPLAY_GAIN (HDR.md): the sky's brightness is the dust's, not a
      // gain's.
      expect(skyGain(atm)).toBe(PHYSICAL_SKY_GAIN)
    })
  })
})


describe('the sky gain', () => {
  // Every body descriptor with an atmosphere.
  const bodies = Object.keys(BODY_DIRS).map(loadPlanet).filter((b) => b.atmosphere)

  it('is the physical single-scattering gain, π·DISPLAY_GAIN', () => {
    expect(PHYSICAL_SKY_GAIN).toBe(Math.PI * DISPLAY_GAIN)
    expect(PHYSICAL_SKY_GAIN).toBeCloseTo(4.71, 2)
  })

  it('is relative to the body\'s own sunlight, so the same at any distance from the Sun', () => {
    // The sky in exposure units is gain × in-scatter × skyExposure, and
    // skyExposure is 1 at a body's keyed exposure from Mercury to Pluto:
    // the distance falloff is the irradiance's, counted once.
    for (const au of [0.39, 1, 1.52, 5.2, 9.5, 19.2, 30.1, 39.5]) {
      const d = au * ASTRO_UNIT_METER
      expect(skyExposure(d, exposureAt(d))).toBeCloseTo(1, 12)
    }
  })

  it('is the physical gain for every body, Earth included', () => {
    // #55's gains fell with distance (Jupiter 6, Saturn 4, Uranus 2.8,
    // Neptune 2.2, Titan 1.0, Pluto 0.7, Triton 0.6), from when the gain was
    // the Sun's light at the body; since the sky took the body's irradiance
    // (#86's PR A) they counted the falloff twice.  Earth's 21 stood in for
    // the aerosols its tables didn't hold, until they held a clear day's
    // (composition.md, "Per-body data").
    expect(bodies.length).toBeGreaterThan(8)
    expect(bodies.some((b) => b.name === 'earth')).toBe(true)
    for (const body of bodies) {
      expect({name: body.name, gain: skyGain(body.atmosphere)})
          .toEqual({name: body.name, gain: PHYSICAL_SKY_GAIN})
      expect(body.atmosphere.sunIntensity).toBeUndefined()
    }
  })

  it('leaves Titan\'s haze to absorb, most in the blue, where its gain of 1 stood in for it', () => {
    // Titan's τ ≈ 8 of conservative haze at the physical gain was a white
    // disc at I/F 0.59; Huygens DISR's haze absorbs (Tomasko et al. 2008),
    // and with it the disc is 0.24 and orange (composition.md, "Per-body
    // data").
    const {atmosphere: atm} = loadPlanet('titan')
    expect(atm.mieAlbedo).toHaveLength(3)
    expect(atm.mieAlbedo[0]).toBeGreaterThan(atm.mieAlbedo[1])
    expect(atm.mieAlbedo[1]).toBeGreaterThan(atm.mieAlbedo[2])
    for (const w of atm.mieAlbedo) {
      expect(w).toBeGreaterThan(0.7)
      expect(w).toBeLessThan(1)
    }
  })
})


describe('the other bodies\' air, unchanged by Earth\'s aerosol and ozone', () => {
  const others = Object.keys(BODY_DIRS).map(loadPlanet).filter((b) => b.atmosphere && b.name !== 'earth')

  it('gives a grey aerosol its one coefficient in every channel, red\'s Mie as before, and no ozone', () => {
    // The shaders then compute what they did with a float uMieCoeff: the
    // same extinction in each channel, the tables' Mie taken as grey
    // (mieColour with uMieChroma 0), and an ozone term of zero.
    expect(others.length).toBeGreaterThan(8)
    for (const {name, atmosphere: atm} of others) {
      const mie = mieParams(atm)
      expect({name, mie: mie.extinction.toArray(), chroma: mie.chroma})
          .toEqual({name, mie: [atm.mieCoeff, atm.mieCoeff, atm.mieCoeff], chroma: 0})
      expect({name, ozone: ozoneParams(atm).absorption.toArray()}).toEqual({name, ozone: [0, 0, 0]})
    }
  })

  it('has the pass take the tables\' Mie as grey without a chromatic aerosol', () => {
    const source = readFileSync('./js/scene/atmos/Atmosphere.js', 'utf8')
    expect(source).toContain('if (uMieChroma < 0.5) return vec3(inS.a);')
  })
})


describe('Earth\'s air by its optical depths (a CPU integral, as the transmittance table)', () => {
  const atm = loadPlanet('earth').atmosphere
  const R = 6.371e6
  const top = scalar(atm.height)
  const hR = scalar(atm.rayleighScaleHeight)
  const hM = scalar(atm.mieScaleHeight)
  const oz = ozoneParams(atm)
  const tent = (h) => Math.max(1 - (Math.abs(h - oz.profile.y) /
      (h < oz.profile.y ? oz.profile.y - oz.profile.x : oz.profile.z - oz.profile.y)), 0)

  /**
   * @param {number} h0 start height (m)
   * @param {number} mu the ray's zenith cosine there
   * @param {boolean} [withOzone]
   * @returns {Array<number>} optical depth to the top, per channel
   */
  function depth(h0, mu, withOzone = true) {
    const r0 = R + h0
    const b = r0 * mu
    const tMax = -b + Math.sqrt((b * b) - (r0 * r0) + ((R + top) ** 2))
    const n = 20000
    const dt = tMax / n
    const tau = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * dt
      const h = Math.sqrt((r0 * r0) + (t * t) + (2 * b * t)) - R
      for (let c = 0; c < 3; c++) {
        tau[c] += ((atm.rayleigh[c] * Math.exp(-h / hR)) + (atm.mieCoeff[c] * Math.exp(-h / hM)) +
          (withOzone ? oz.absorption.getComponent(c) * tent(h) : 0)) * dt
      }
    }
    return tau
  }

  it('has a vertical optical depth of 0.25 at 550 nm, 78% transmitted at the zenith in the green', () => {
    // Rayleigh 0.0973 (Bucholtz's standard column), aerosol 0.12, ozone 0.028.
    const tau = depth(0, 1)
    expect(tau[1]).toBeCloseTo(0.0973 + 0.12 + 0.0282, 2)
    expect(Math.exp(-tau[1])).toBeCloseTo(0.782, 2)
  })

  it('leaves the limb blue where the ozone is: green and red absorbed along the tangent', () => {
    // A tangent path at 25 km, the layer's peak, is twice the path from the
    // tangent point out: about 1.1 of ozone's optical depth in the green,
    // 0.05 in the blue.  Over the path without ozone, the light keeps a
    // third of its green and nearly all its blue.
    const ratio = [0, 1, 2].map((c) => Math.exp(-2 * (depth(25e3, 0)[c] - depth(25e3, 0, false)[c])))
    expect(ratio[1]).toBeLessThan(0.4)
    expect(ratio[0]).toBeLessThan(0.75)
    expect(ratio[2]).toBeGreaterThan(0.94)
  })
})


describe('the ground under the air', () => {
  it('is Earth\'s drawn ground for its tables, not its geometric albedo, which holds its air and clouds', () => {
    const earth = loadPlanet('earth')
    // The decoded Blue Marble's mean, per channel and month (tools/textureMeans.py).
    expect(earth.atmosphere.groundAlbedo).toEqual(TEXTURE_MEANS.monthly.earth)
    expect(TEXTURE_MEANS.monthly.earth[0]).toEqual(TEXTURE_MEANS.earth)
    const atmos = {...earth.atmosphere}
    expect(groundAlbedo(atmos, earth.albedo).toArray()).toEqual(TEXTURE_MEANS.earth)
    setGroundMonth(atmos, 7)
    expect(groundAlbedo(atmos, earth.albedo).toArray()).toEqual(TEXTURE_MEANS.monthly.earth[6])
  })

  it('blends the months\' albedos as the surface blends their maps, and is made again only past the threshold', () => {
    const months = TEXTURE_MEANS.monthly.earth
    const atmos = {groundAlbedo: months}
    setGroundMonth(atmos, {a: 10, b: 11, w: 0.25})
    const mixed = groundAlbedo(atmos, 0.3).toArray()
    mixed.forEach((v, c) => expect(v).toBeCloseTo((0.75 * months[9][c]) + (0.25 * months[10][c]), 12))
    // Through October into November by quarter days: a rebuild only each time it moves past the threshold.
    setGroundMonth(atmos, 10)
    setBuiltAlbedo(atmos, groundAlbedo(atmos, 0.3).toArray())
    let rebuilds = 0
    for (let w = 0; w <= 1; w += 1 / 120) {
      setGroundMonth(atmos, {a: 10, b: 11, w})
      const now = groundAlbedo(atmos, 0.3).toArray()
      if (groundAlbedoStale(atmos, now)) {
        rebuilds++
        setBuiltAlbedo(atmos, now)
      }
    }
    const step = Math.max(...months[9].map((v, c) => Math.abs(v - months[10][c])))
    expect(rebuilds).toBe(Math.floor(step / GROUND_ALBEDO_REBUILD))
  })

  it('makes the tables again only when the month moves it past the threshold', () => {
    const months = TEXTURE_MEANS.monthly.earth
    const atmos = {}
    setBuiltAlbedo(atmos, months[6])
    // July to August moves under 0.001: kept; July to November, 0.026: made again.
    expect(groundAlbedoStale(atmos, months[7])).toBe(false)
    expect(groundAlbedoStale(atmos, months[10])).toBe(true)
    expect(groundAlbedoStale({}, months[10])).toBe(false)
    const steps = months.map((m, i) => Math.max(...m.map((v, c) => Math.abs(v - months[(i + 1) % 12][c]))))
    expect(Math.max(...steps)).toBeGreaterThan(GROUND_ALBEDO_REBUILD)
    expect(Math.min(...steps)).toBeLessThan(GROUND_ALBEDO_REBUILD)
  })

  it('falls back to the body\'s albedo, one number in every channel', () => {
    expect(groundAlbedo({}, 0.15).toArray()).toEqual([0.15, 0.15, 0.15])
    expect(groundAlbedo({groundAlbedo: 0.2}, 0.5).toArray()).toEqual([0.2, 0.2, 0.2])
    expect(groundAlbedo(undefined, undefined).toArray()).toEqual([0, 0, 0])
  })
})


describe('the Mie\'s colour (a CPU single scattering of Earth\'s data)', () => {
  const atm = loadPlanet('earth').atmosphere
  const R = 6.371e6
  const top = R + scalar(atm.height)
  const hR = scalar(atm.rayleighScaleHeight)
  const hM = scalar(atm.mieScaleHeight)
  const oz = ozoneParams(atm)
  const tent = (h) => Math.max(1 - (Math.abs(h - oz.profile.y) /
      (h < oz.profile.y ? oz.profile.y - oz.profile.x : oz.profile.z - oz.profile.y)), 0)
  const ext = (h, c) => (atm.rayleigh[c] * Math.exp(-h / hR)) + (atm.mieCoeff[c] * Math.exp(-h / hM)) +
    (oz.absorption.getComponent(c) * tent(h))
  const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
  const at = (p, d, t) => [p[0] + (d[0] * t), p[1] + (d[1] * t), p[2] + (d[2] * t)]
  const unit = (a) => a.map((v) => v / Math.hypot(...a))
  // The far and near crossings of a sphere at the origin (NaN: none).
  const hits = (p, d, r) => {
    const b = dot(p, d)
    const q = Math.sqrt((b * b) - dot(p, p) + (r * r))
    return [-b - q, -b + q]
  }
  const sunDepth = (p, s, c) => {
    const [g0] = hits(p, s, R)
    if (g0 > 0) {
      return Infinity
    }
    const t1 = hits(p, s, top)[1]
    let tau = 0
    for (let i = 0; i < 60; i++) {
      tau += ext(Math.hypot(...at(p, s, (i + 0.5) * t1 / 60)) - R, c) * t1 / 60
    }
    return tau
  }
  /**
   * The Rayleigh's and the Mie's single scattering along a ray, without
   * their phase functions, per channel, as the in-scatter table holds them.
   *
   * @returns {{rayleigh: Array<number>, mie: Array<number>}}
   */
  function single(eye, dir, sun) {
    const d = unit(dir)
    const s = unit(sun)
    const [a0, a1] = hits(eye, d, top)
    const [g0] = hits(eye, d, R)
    const t0 = Math.max(a0, 0)
    const t1 = g0 > 0 ? g0 : a1
    const n = 300
    const dt = (t1 - t0) / n
    const out = {rayleigh: [0, 0, 0], mie: [0, 0, 0]}
    for (let c = 0; c < 3; c++) {
      let tau = 0
      for (let i = 0; i < n; i++) {
        const p = at(eye, d, t0 + ((i + 0.5) * dt))
        const h = Math.hypot(...p) - R
        const e = ext(h, c) * dt
        const w = Math.exp(-(tau + (e / 2)) - sunDepth(p, s, c)) * dt
        out.rayleigh[c] += atm.rayleigh[c] * Math.exp(-h / hR) * w
        out.mie[c] += atm.mieCoeff[c] * Math.exp(-h / hM) * w
        tau += e
      }
    }
    return out
  }
  // Bruneton 2017's reconstruction (the pass's mieColour), over the Mie.
  const reconstructionOverTrue = ({rayleigh: r, mie: m}) => [0, 1, 2].map((c) =>
    m[0] * (r[c] / r[0]) * (atm.rayleigh[0] / atm.rayleigh[c]) * (atm.mieCoeff[c] / atm.mieCoeff[0]) / m[c])
  const elevated = (deg) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180), 0]

  it('is bluer by the reconstruction than it is through the disc from orbit, the aerosol being under the gas', () => {
    // The Aydar Lake view's centre (composition.md, "The disc from low
    // orbit"): from 400 km, 67° from the zenith at the ground, the Sun 22° up.
    const ratio = reconstructionOverTrue(single([-19460, 5861000, 3391000], [0.001559, 0, -1],
        [-0.5973, 0.6238, -0.5042]))
    expect(ratio[1]).toBeCloseTo(1.15, 1)
    expect(ratio[2]).toBeCloseTo(1.65, 1)
  })

  it('is redder by the reconstruction than it is by the setting Sun', () => {
    // From the ground, 2° up toward the Sun 5.5° up.
    const ratio = reconstructionOverTrue(single([0, R + 2, 0], elevated(2), elevated(5.5)))
    expect(ratio[1]).toBeCloseTo(0.82, 1)
    expect(ratio[2]).toBeCloseTo(0.60, 1)
  })

  it('is the tables\' own for a chromatic aerosol, and marched along a segment', () => {
    const pass = readFileSync('./js/scene/atmos/Atmosphere.js', 'utf8')
    const pre = readFileSync('./js/scene/atmos/AtmospherePrecompute.js', 'utf8')
    expect(pre).toContain('#if MIE_COLOUR')
    expect(pre).toContain('rt.texture.userData.mieColour = mie.texture')
    expect(pass).toContain('u.tInScatter.value?.userData?.mieColour')
    expect(pass).toContain('mie = uMieChroma > 0.5 ? uMieCoeff * totalMrgb : vec3(inS.a);')
    expect(pass).toContain('uSunIntensity * (pRlh * inS.rgb + pMie * inSMie')
    expect(pass).not.toContain('pMie * mieColour(')
  })
})


describe('mieParams', () => {
  it('gives a body with no narrow lobe none, so its delta-M scaling is 1 (Earth unchanged)', () => {
    const mie = mieParams(loadPlanet('earth').atmosphere)
    expect(mie.peakWeight.toArray()).toEqual([0, 0, 0])
    expect(mie.peakPolarity.toArray()).toEqual([0, 0, 0])
    expect(mie.forwardWeight).toBe(1)
  })

  it('reads Mars\'s narrow lobe per channel', () => {
    const atm = loadPlanet('mars').atmosphere
    const mie = mieParams(atm)
    expect(mie.peakWeight.toArray()).toEqual(atm.miePeakWeight)
    expect(mie.peakPolarity.toArray()).toEqual(atm.miePeakPolarity)
  })
})


describe('the blocked Sun', () => {
  // The "Sun behind the planet" sentinel is a density-weighted path in
  // metres; it must drive exp(-k·path) to nothing for the smallest
  // coefficient, Earth's Rayleigh red (5.12e-6 /m).  At 1e6 m, 0.3% of the
  // Sun came through every blocked step and the metered exposure showed a
  // red sky with the Sun 35° under the horizon (HDR.md).
  for (const file of ['AtmospherePrecompute.js', 'Atmosphere.js']) {
    it(`${file} blocks the Sun for any coefficient over 1e-8 /m`, () => {
      const source = readFileSync(`./js/scene/atmos/${file}`, 'utf8')
      const sentinels = [...source.matchAll(/jOd = vec[23]\(([0-9.e]+)/g)].map((m) => Number(m[1]))
      expect(sentinels.length).toBeGreaterThan(0)
      for (const path of sentinels) {
        expect(Math.exp(-1e-8 * path)).toBeLessThan(1e-40)
      }
    })
  }
})
