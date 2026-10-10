import {
  BODY_CLOUDS,
  CLOUD_TYPES,
  DIRECT_SHARE,
  EARTH_LAYER,
  cloudParams,
  deltaEddington,
  deltaScaled,
  deltaScaledAsymmetry,
  eddingtonSlab,
  eddingtonSource,
  extinctionCoefficient,
  groundUnderCloud,
  phaseAt,
  phaseTable,
  slabRadiance,
} from './cloudPhysics.js'
import phase from './cloudPhase.earth.json'


describe('extinctionCoefficient', () => {
  it('gives a stratocumulus about 45 per km, a cumulus about 90', () => {
    // 3·Q·LWC / (4·ρ·r): 0.3 g/m³ at 10 µm, Q 2, is 0.045 /m.
    expect(extinctionCoefficient(0.3, 10)).toBeCloseTo(0.045, 4)
    const {stratocumulus, cumulus} = CLOUD_TYPES
    const sc = extinctionCoefficient(stratocumulus.lwc, stratocumulus.rEff, phase.qExt)
    const cu = extinctionCoefficient(cumulus.lwc, cumulus.rEff, phase.qExt)
    expect(sc * 1000).toBeGreaterThan(40)
    expect(sc * 1000).toBeLessThan(55)
    expect(cu * 1000).toBeGreaterThan(80)
    expect(cu * 1000).toBeLessThan(100)
    // A 500 m deck is an optical depth of 20-30.
    expect(sc * 500).toBeGreaterThan(20)
    expect(sc * 500).toBeLessThan(30)
  })
})


describe('the Mie fixture', () => {
  it('is water droplets of 10 µm at 550 nm, with the extinction paradox and no absorption', () => {
    expect(phase.rEffUm).toBe(10)
    expect(phase.wavelengthUm).toBe(0.55)
    expect(phase.qExt).toBeGreaterThan(2)
    expect(phase.qExt).toBeLessThan(2.2)
    expect(phase.singleScatteringAlbedo).toBeGreaterThan(0.9999)
    // Cloud droplets' asymmetry parameter is about 0.86 in the visible.
    expect(phase.asymmetry).toBeGreaterThan(0.84)
    expect(phase.asymmetry).toBeLessThan(0.88)
    // Diffraction is half the extinction of a large sphere; the peak within
    // a few degrees holds most of it.
    expect(phase.peak.share).toBeGreaterThan(0.4)
    expect(phase.peak.share).toBeLessThan(0.5)
  })

  it('has every scattering order normalised over the sphere, with the asymmetry of its power', () => {
    const step = (phase.tableStepDeg * Math.PI) / 180
    for (let k = 1; k <= phase.orders.length; k++) {
      let integral = 0
      let g = 0
      const row = phase.orders[k - 1]
      for (let i = 0; i < row.length; i++) {
        const theta = i * step
        const w = (i === 0 || i === row.length - 1 ? 0.5 : 1) * 2 * Math.PI * Math.sin(theta) * step
        integral += row[i] * w
        g += row[i] * Math.cos(theta) * w
      }
      expect(integral).toBeCloseTo(1, 2)
      expect(g).toBeCloseTo(Math.pow(phase.legendre[1], k), 2)
    }
  })

  it('is forward-peaked: the first order falls by about a thousand from 5° to 90°, with a glory', () => {
    expect(phaseAt(phase, 1, 5) / phaseAt(phase, 1, 90)).toBeGreaterThan(300)
    expect(phaseAt(phase, 1, 5) / phaseAt(phase, 1, 90)).toBeLessThan(1500)
    // The glory and the fogbow stand over the side scattering.
    expect(phaseAt(phase, 1, 180)).toBeGreaterThan(5 * phaseAt(phase, 1, 90))
    expect(phaseAt(phase, 1, 139)).toBeGreaterThan(3 * phaseAt(phase, 1, 110))
    // Interpolation between the table's angles.
    expect(phaseAt(phase, 1, 90.25)).toBeCloseTo((phaseAt(phase, 1, 90) + phaseAt(phase, 1, 90.5)) / 2, 8)
  })

  it('packs the first order for a texture', () => {
    const {data, width} = phaseTable(phase)
    expect(width).toBe(361)
    expect(data.length).toBe(361)
    expect(data[180]).toBeCloseTo(phaseAt(phase, 1, 90), 6)
  })
})


describe('delta scaling', () => {
  it('scales the extinction by the peak\'s share and the asymmetry with it', () => {
    expect(deltaScaled(0.045, 1, 0.44)).toBeCloseTo(0.0252, 5)
    expect(deltaScaled(0.045, 0, 0.44)).toBe(0.045)
    // The peak-less asymmetry the fixture measured.
    expect(deltaScaledAsymmetry(phase.asymmetry, phase.peak.share)).toBeCloseTo(phase.peak.asymmetryOutside, 2)
    // Delta-Eddington: g' = g / (1 + g) is at most 1/2.
    expect(deltaEddington(10, 0.8).g).toBeCloseTo(0.4444, 3)
    expect(deltaEddington(10, 0.8).tau).toBeCloseTo(3.6, 6)
  })
})


describe('eddingtonSlab', () => {
  it('is conservative, and passes everything of a thin slab', () => {
    for (const tau of [0, 0.1, 1, 10, 100]) {
      const {reflectance, transmittance} = eddingtonSlab(tau, 0.86)
      expect(reflectance + transmittance).toBeCloseTo(1, 10)
      expect(reflectance).toBeGreaterThanOrEqual(0)
      expect(transmittance).toBeLessThanOrEqual(1)
    }
    expect(eddingtonSlab(0, 0.86).transmittance).toBe(1)
  })

  it('reflects about two thirds of a stratocumulus of optical depth 20, as observed', () => {
    const {reflectance} = eddingtonSlab(20, phase.asymmetry)
    expect(reflectance).toBeGreaterThan(0.55)
    expect(reflectance).toBeLessThan(0.7)
    expect(eddingtonSlab(50, phase.asymmetry).reflectance).toBeGreaterThan(reflectance)
    // A low Sun's slant path thickens the slab.
    expect(eddingtonSlab(5, phase.asymmetry, 0.3).reflectance).toBeGreaterThan(eddingtonSlab(5, phase.asymmetry).reflectance)
  })
})


describe('groundUnderCloud', () => {
  it('leaves the sky\'s share, and takes the direct beam by the cloud\'s transmittance', () => {
    expect(groundUnderCloud(0, 0.86)).toBe(1)
    const thick = groundUnderCloud(50, 0.86)
    expect(thick).toBeGreaterThan(1 - DIRECT_SHARE)
    expect(thick).toBeLessThan(0.4)
    expect(groundUnderCloud(5, 0.86)).toBeGreaterThan(thick)
  })
})


describe('the march\'s model over a slab', () => {
  const g = deltaScaledAsymmetry(phase.asymmetry, phase.peak.share)
  const scaled = (tau) => tau * (1 - phase.peak.share)

  it('reflects what the slab does from above, for thick slabs', () => {
    for (const tau of [10, 20, 50]) {
      const {albedo} = slabRadiance(tau, phase, {steps: 400})
      const {reflectance} = eddingtonSlab(scaled(tau), g)
      expect(albedo / reflectance).toBeGreaterThan(0.95)
      expect(albedo / reflectance).toBeLessThan(1.1)
    }
  })

  it('passes what the slab does to an eye below, for thick slabs', () => {
    for (const tau of [20, 50]) {
      const {albedo} = slabRadiance(tau, phase, {fromBelow: true, steps: 400})
      const {transmittance} = eddingtonSlab(scaled(tau), g)
      expect(albedo / transmittance).toBeGreaterThan(0.9)
      expect(albedo / transmittance).toBeLessThan(1.05)
    }
  })

  it('is single scattering for a wisp, which single scattering alone has nearly black', () => {
    // A slab of τ 0.5 from above: its reflectance is the exact single
    // scattering of the delta-scaled beam, within the Eddington diffuse
    // field's second-order addition.
    const tau = 0.5
    const single = Math.PI * phaseAt(phase, 1, 180) * (1 - Math.exp(-2 * scaled(tau))) / 2
    const {albedo} = slabRadiance(tau, phase, {steps: 400})
    expect(albedo / single).toBeGreaterThan(1)
    expect(albedo / single).toBeLessThan(1.3)
    // And a thick slab by single scattering alone is a tenth of its albedo.
    const thickSingle = Math.PI * phaseAt(phase, 1, 180) / 2
    expect(thickSingle / eddingtonSlab(scaled(20), g).reflectance).toBeLessThan(0.2)
  })

  it('has a diffuse source that is zero at a thin slab\'s top and brighter toward the lit side', () => {
    expect(eddingtonSource(0, 0, g, 1)).toBeCloseTo(0, 6)
    const top = eddingtonSource(0.01, 20, g, 1)
    const base = eddingtonSource(19.99, 20, g, -1)
    expect(top).toBeGreaterThan(base)
    // The tilt: at the top the field goes up, so a ray up is brighter than one down.
    expect(eddingtonSource(0.01, 20, g, 1)).toBeGreaterThan(eddingtonSource(0.01, 20, g, -1))
    expect(eddingtonSource(19.99, 20, g, -1)).toBeGreaterThan(eddingtonSource(19.99, 20, g, 1))
  })
})


describe('the bodies', () => {
  it('draws Earth, seeded by the map, and records the others with their data', () => {
    expect(cloudParams('earth')).toBe(BODY_CLOUDS.earth)
    expect(cloudParams('venus')).toBeNull()
    expect(cloudParams('mars')).toBeNull()
    expect(BODY_CLOUDS.earth.layer).toBe(EARTH_LAYER)
    expect(EARTH_LAYER.base).toBeLessThan(EARTH_LAYER.top)
    expect(EARTH_LAYER.top).toBeLessThan(EARTH_LAYER.towerTop)
    expect(BODY_CLOUDS.earth.extinction[1]).toBeGreaterThan(BODY_CLOUDS.earth.extinction[0])
    for (const name of ['venus', 'titan', 'jupiter']) {
      const body = BODY_CLOUDS[name]
      expect(body.enabled).toBe(false)
      expect(body.layers.length).toBeGreaterThan(0)
      expect(body.seed.length).toBeGreaterThan(10)
    }
    // Venus's deck: about 29 in optical depth over its three layers.
    const venus = BODY_CLOUDS.venus.layers.reduce((sum, l) => sum + (l.extinction * (l.top - l.base)), 0)
    expect(venus).toBeGreaterThan(20)
    expect(venus).toBeLessThan(35)
  })
})
