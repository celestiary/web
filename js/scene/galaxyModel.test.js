import {
  ARMS, BOUNDS, CLOUDS, DUST, FRACTIONS, KPC_METER, L_TOTAL_LSUN, SUN_G, SUN_R_KPC, VALUE_PER_LSUN_KPC2, WARP,
  armOffset, azimuth, bakeMap, bakeMapSteps, barFrame, catalogToGalactic, cloudCenter, density, galaxyGlsl, galaxyModel,
  galaxyNormUniforms, integrateRay, outsideWeight, sampleMap, warpHeight,
} from './galaxyModel.js'
import {equatorialToSceneUnit} from './galacticFrame.js'
import {METER_GAIN_MAX} from './exposure.js'
import {HDR_MAX_VALUE} from './hdr.js'


const model = galaxyModel()
const DEG = Math.PI / 180


/**
 * @param {number} l galactic longitude, degrees
 * @param {number} b galactic latitude, degrees
 * @returns {Array<number>} The direction in G
 */
function dir(l, b) {
  return [Math.cos(b * DEG) * Math.cos(l * DEG), Math.sin(b * DEG), Math.cos(b * DEG) * Math.sin(l * DEG)]
}


/**
 * @param {Array<number>} rgb
 * @returns {number}
 */
function luma(rgb) {
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2])
}


/**
 * V-band surface brightness, mag/arcsec², of a value at Earth's keyed
 * exposure: 1 L_sun/pc² is 26.4 (the Sun's M_V 4.83 + 21.57).
 *
 * @param {number} value
 * @returns {number}
 */
function magPerArcsec2(value) {
  const lsunPerPc2 = value / VALUE_PER_LSUN_KPC2 / 1e6
  return 26.4 - (2.5 * Math.log10(lsunPerPc2))
}


/**
 * Each component's luminosity, by quadrature over BOUNDS: columns on a
 * grid in x and z, and in each a grid in height packed toward the warped
 * mid-plane.
 *
 * @returns {object} L_sun per component, and the total
 */
function integrateLight() {
  const step = 0.2
  // Heights over the mid-plane: sinh-spaced, under a pc at the plane, to ±5 kpc.
  const ys = []
  const n = 60
  for (let k = -n; k <= n; k++) {
    ys.push(Math.sinh((k / n) * 8.3) * 0.0025)
  }
  const sums = {thin: 0, thick: 0, young: 0, hii: 0, bulge: 0, bar: 0}
  for (let x = -BOUNDS.r + (step / 2); x < BOUNDS.r; x += step) {
    for (let z = -BOUNDS.r + (step / 2); z < BOUNDS.r; z += step) {
      const w = warpHeight(x, z)
      for (let k = 0; k < ys.length - 1; k++) {
        const y0 = w + ys[k]
        const y1 = w + ys[k + 1]
        if (Math.abs(y1) > BOUNDS.y && Math.abs(y0) > BOUNDS.y) {
          continue
        }
        const s = density(model, x, (y0 + y1) / 2, z)
        const dv = step * step * (y1 - y0)
        for (const key of Object.keys(sums)) {
          sums[key] += s[key] * dv
        }
      }
    }
  }
  sums.total = Object.values(sums).reduce((a, b) => a + b, 0)
  return sums
}


describe('the galaxy\'s light: normalisation', () => {
  const light = integrateLight()

  it('carries the Milky Way\'s total luminosity', () => {
    expect(light.total / L_TOTAL_LSUN).toBeGreaterThan(0.97)
    expect(light.total / L_TOTAL_LSUN).toBeLessThan(1.03)
  })

  it('splits it between the components as FRACTIONS', () => {
    for (const key of ['thin', 'thick', 'young', 'bulge', 'bar']) {
      expect(light[key] / L_TOTAL_LSUN / FRACTIONS[key]).toBeGreaterThan(0.95)
      expect(light[key] / L_TOTAL_LSUN / FRACTIONS[key]).toBeLessThan(1.05)
    }
    // The knots are tens of pc across, so the 0.2 kpc grid samples them coarsely.
    expect(light.hii / L_TOTAL_LSUN / FRACTIONS.hii).toBeGreaterThan(0.8)
    expect(light.hii / L_TOTAL_LSUN / FRACTIONS.hii).toBeLessThan(1.2)
  })
})


describe('the galaxy\'s light: at the Sun', () => {
  it('has the solar neighbourhood\'s luminosity density and surface density', () => {
    const s = density(model, ...SUN_G)
    const perPc3 = (s.thin + s.thick + s.young + s.hii + s.bulge + s.bar) / 1e9
    // About 0.05 L_sun/pc³ in V (Flynn et al. 2006: 0.056).
    expect(perPc3).toBeGreaterThan(0.03)
    expect(perPc3).toBeLessThan(0.09)
    let column = 0
    for (let y = -5; y < 5; y += 0.005) {
      const d = density(model, SUN_G[0], y + 0.0025, SUN_G[2])
      column += (d.thin + d.thick + d.young + d.hii + d.bulge + d.bar) * 0.005
    }
    // About 20-30 L_sun/pc² through the disc.
    expect(column / 1e6).toBeGreaterThan(14)
    expect(column / 1e6).toBeLessThan(35)
  })

  it('makes the sky at the galactic poles as bright as the integrated starlight there', () => {
    // About 23.5-24 mag/arcsec² in V toward the poles (Leinert et al. 1998).
    for (const b of [90, -90]) {
      const mu = magPerArcsec2(luma(integrateRay(model, SUN_G, dir(0, b)).rgb))
      expect(mu).toBeGreaterThan(23)
      expect(mu).toBeLessThan(24.5)
    }
  })

  it('makes a band: the plane brighter than the poles, toward the centre most', () => {
    const pole = luma(integrateRay(model, SUN_G, dir(0, 90)).rgb)
    for (const l of [0, 30, 60, 90, 180, 270, 330]) {
      const band = Math.max(...[-6, -3, 0, 3, 6].map((b) => luma(integrateRay(model, SUN_G, dir(l, b)).rgb)))
      expect(band).toBeGreaterThan(2 * pole)
    }
    // The bulge, seen through Baade's window (l = 1°, b = -4°), against the anticentre.
    const window = luma(integrateRay(model, SUN_G, dir(1, -4)).rgb)
    const anticentre = luma(integrateRay(model, SUN_G, dir(180, -4)).rgb)
    expect(window).toBeGreaterThan(anticentre)
  })

  it('is dark in the plane toward the centre: tens of magnitudes of dust', () => {
    const r = integrateRay(model, SUN_G, dir(0, 0))
    expect(r.transmittance[1]).toBeLessThan(0.01)
    // Reddened: blue is taken more than red.
    expect(r.transmittance[2]).toBeLessThan(r.transmittance[0])
  })

  it('has 1 mag/kpc of dust in the mid-plane round the Sun\'s radius, none in the Local Bubble, little toward the poles', () => {
    let sum = 0
    const n = 720
    for (let i = 0; i < n; i++) {
      const beta = (2 * Math.PI * i) / n
      sum += density(model, -SUN_R_KPC * Math.cos(beta), warpHeight(-SUN_R_KPC * Math.cos(beta), SUN_R_KPC * Math.sin(beta)),
          SUN_R_KPC * Math.sin(beta)).kappa
    }
    // A_V = 1.0857 τ.  The map's quantisation and the ring's sampling move it a little.
    expect(1.0857 * sum / n / DUST.avPerKpc).toBeGreaterThan(0.85)
    expect(1.0857 * sum / n / DUST.avPerKpc).toBeLessThan(1.15)
    expect(density(model, ...SUN_G).kappa).toBe(0)
    const pole = integrateRay(model, SUN_G, dir(0, 90))
    expect(-2.5 * Math.log10(pole.transmittance[1])).toBeLessThan(0.3)
  })

  it('puts the Great Rift\'s clouds in front of the band toward Aquila and Cygnus', () => {
    for (const name of ['Aquila Rift', 'Cygnus Rift']) {
      const cloud = CLOUDS.find((c) => c.name === name)
      const through = integrateRay(model, SUN_G, dir(cloud.l, cloud.b))
      const beside = integrateRay(model, SUN_G, dir(cloud.l, cloud.b + 12))
      expect(through.transmittance[1]).toBeLessThan(0.2 * beside.transmittance[1])
      const c = cloudCenter(cloud)
      expect(Math.hypot(c[0] - SUN_G[0], c[1] - SUN_G[1], c[2] - SUN_G[2])).toBeCloseTo(cloud.d, 9)
    }
  })

  it('stays in range at the dark-adapted gain', () => {
    for (const [l, b] of [[0, 90], [0, 0], [1, -4], [60, 0], [180, 0], [300, -2]]) {
      const v = luma(integrateRay(model, SUN_G, dir(l, b)).rgb) * METER_GAIN_MAX
      expect(v).toBeGreaterThan(1e-3)
      expect(v).toBeLessThan(1)
    }
  })
})


describe('the galaxy\'s light: from outside', () => {
  const faceOn = (x, z = 0.05) => luma(integrateRay(model, [x, 40, z], [0, -1, 0]).rgb)

  it('is brightest at the centre, and falls off through the disc', () => {
    const centre = faceOn(0)
    expect(magPerArcsec2(centre)).toBeLessThan(20.5)
    expect(magPerArcsec2(faceOn(-SUN_R_KPC))).toBeGreaterThan(magPerArcsec2(centre) + 2.5)
    expect(magPerArcsec2(faceOn(-16))).toBeGreaterThan(magPerArcsec2(faceOn(-SUN_R_KPC)) + 1.5)
  })

  it('is warm in the bulge and blue in the arms', () => {
    const bulge = integrateRay(model, [0, 40, 0.3], [0, -1, 0]).rgb
    expect(bulge[0]).toBeGreaterThan(bulge[2] * 1.3)
    // Along an arm's crest at 7 kpc, against the bulge.
    const arm = ARMS.find((a) => a.name === 'Perseus')
    const r = 7
    const beta = -Math.log(r / arm.r0) / Math.tan(arm.pitchDeg * DEG)
    const crest = integrateRay(model, [-r * Math.cos(beta), 40, r * Math.sin(beta)], [0, -1, 0]).rgb
    expect(crest[2] / crest[0]).toBeGreaterThan(1.3 * bulge[2] / bulge[0])
  })

  it('is a thin disc edge-on, with a dust lane along its mid-plane through the bulge', () => {
    const at = (y, x = 0) => luma(integrateRay(model, [x, y, 40], [0, 0, -1]).rgb)
    // Through the centre and either side of it: the lane, under half the light 0.5 kpc above and below.
    for (const x of [-2, 0, 2]) {
      const lane = Math.min(...[-0.2, -0.1, 0, 0.1, 0.2].map((y) => at(y, x)))
      expect(lane).toBeLessThan(0.5 * at(0.5, x))
      expect(lane).toBeLessThan(0.5 * at(-0.5, x))
    }
    // The light falls off over the scale heights, at the centre and at the Sun's radius.
    expect(at(2)).toBeLessThan(0.15 * at(0.5))
    expect(at(1.5, -SUN_R_KPC)).toBeLessThan(0.15 * at(0.2, -SUN_R_KPC))
  })
})


describe('the model\'s geometry', () => {
  it('places the four major arms where Reid et al. (2019) cross the Sun → centre line', () => {
    for (const arm of ARMS) {
      expect(armOffset(arm, arm.r0, 0)).toBeCloseTo(0, 9)
      // Positive outward of the arm, negative inward.
      expect(armOffset(arm, arm.r0 + 0.2, 0)).toBeGreaterThan(0)
      expect(armOffset(arm, arm.r0 - 0.2, 0)).toBeLessThan(0)
    }
    // Trailing: one turn on in the sense of rotation, the arm is further in.
    const per = ARMS.find((a) => a.name === 'Perseus')
    const r1 = per.r0 * Math.exp(-(Math.PI / 2) * Math.tan(per.pitchDeg * DEG))
    expect(armOffset(per, r1, Math.PI / 2)).toBeCloseTo(0, 9)
    // The Sun between the Sagittarius-Carina and Perseus arms.
    const sgr = ARMS.find((a) => a.name === 'Sagittarius-Carina')
    expect(sgr.r0).toBeLessThan(SUN_R_KPC)
    expect(per.r0).toBeGreaterThan(SUN_R_KPC)
  })

  it('turns the bar 27° from the Sun → centre line, its near end at positive longitudes', () => {
    const along = barFrame(-3 * Math.cos(27 * DEG), 3 * Math.sin(27 * DEG))
    expect(along.xb).toBeCloseTo(3, 9)
    expect(along.zb).toBeCloseTo(0, 9)
    const onBar = density(model, -3 * Math.cos(27 * DEG), 0, 3 * Math.sin(27 * DEG))
    const across = density(model, -3 * Math.cos(117 * DEG), 0, 3 * Math.sin(117 * DEG))
    expect(onBar.bar).toBeGreaterThan(10 * across.bar)
    // The near end seen from the Sun: l > 0.
    const near = [(-3 * Math.cos(27 * DEG)) - SUN_G[0], (3 * Math.sin(27 * DEG)) - SUN_G[2]]
    expect(Math.atan2(near[1], near[0])).toBeGreaterThan(0)
    expect(azimuth(-1, 0)).toBeCloseTo(0, 12)
  })

  it('warps the outer disc north toward l = 90° and south opposite, none inside the onset', () => {
    expect(warpHeight(-WARP.R + 0.5, 0)).toBe(0)
    expect(warpHeight(0, 16)).toBeGreaterThan(0.5)
    expect(warpHeight(0, -16)).toBeLessThan(-0.5)
  })

  it('puts the Sun at R0 over the mid-plane, and the centre toward Sgr A*', () => {
    expect(catalogToGalactic(0, 0, 0)).toEqual([...SUN_G])
    const gc = equatorialToSceneUnit(266.40499, -28.93617).multiplyScalar(SUN_R_KPC * KPC_METER)
    const g = catalogToGalactic(gc.x, gc.y, gc.z)
    expect(Math.hypot(g[0], g[2])).toBeLessThan(0.01)
    expect(g[1]).toBeCloseTo(SUN_G[1], 2)
    // The north galactic pole, up.
    const ngp = equatorialToSceneUnit(192.85948, 27.12825).multiplyScalar(KPC_METER)
    expect(catalogToGalactic(ngp.x, ngp.y, ngp.z)[1] - SUN_G[1]).toBeCloseTo(1, 6)
    // l = 90° (RA 318.004°, Dec +48.330°), toward Cygnus, the way the Sun moves: +Z.
    const l90 = equatorialToSceneUnit(318.004, 48.33).multiplyScalar(KPC_METER)
    const g90 = catalogToGalactic(l90.x, l90.y, l90.z)
    expect(g90[2] - SUN_G[2]).toBeCloseTo(1, 3)
    // And the clouds where their longitudes say: the Aquila Rift at l = 28°, east of the centre.
    const aquila = cloudCenter(CLOUDS.find((c) => c.name === 'Aquila Rift'))
    expect(aquila[2]).toBeGreaterThan(0)
  })

  it('weighs the camera as outside only well out of the disc', () => {
    expect(outsideWeight(SUN_G)).toBe(0)
    expect(outsideWeight([0, 2, 0])).toBe(0)
    expect(outsideWeight([0, 60, 0])).toBe(1)
    expect(outsideWeight([0, 0, 80])).toBe(1)
  })
})


describe('the map', () => {
  it('bakes the same map every time, in slices or at once', () => {
    const a = bakeMap(64)
    const steps = bakeMapSteps(64)
    let next = steps.next()
    let yields = 0
    while (!next.done) {
      yields++
      next = steps.next()
    }
    expect(yields).toBeGreaterThan(0)
    expect(next.value.data).toEqual(a.data)
    expect(next.value.scale).toEqual(a.scale)
  })

  it('samples as the GPU does: a texel at its centre, bilinear between', () => {
    const {map} = model
    const texel = 2 * map.halfKpc / map.size
    const i = 700
    const j = 300
    const x = ((i + 0.5) * texel) - map.halfKpc
    const z = ((j + 0.5) * texel) - map.halfKpc
    const at = sampleMap(map, x, z)
    for (let c = 0; c < 4; c++) {
      const v = map.data[(((j * map.size) + i) * 4) + c] / 255
      expect(at[c]).toBeCloseTo(v * v * map.scale[c], 9)
    }
    const mid = sampleMap(map, x + (texel / 2), z)
    const right = sampleMap(map, x + texel, z)
    for (let c = 0; c < 4; c++) {
      const halfway = (Math.sqrt(at[c] / map.scale[c]) + Math.sqrt(right[c] / map.scale[c])) / 2
      expect(mid[c]).toBeCloseTo(halfway * halfway * map.scale[c], 9)
    }
  })
})


describe('the march\'s GLSL', () => {
  it('declares the march and its uniforms, with the model\'s constants', () => {
    const glsl = galaxyGlsl()
    expect(glsl).toContain('vec3 galaxyMarch(vec3 o, vec3 d, float jitter)')
    for (const u of ['uGalaxyMap', 'uGalaxyMapScale', 'uGalaxyNorm0', 'uGalaxyNorm1']) {
      expect(glsl).toContain(`uniform ${u === 'uGalaxyMap' ? 'sampler2D' : 'vec4'} ${u};`)
    }
    expect(Number(glsl.match(/GAL_BOUNDS_R = ([0-9.e+-]+);/)[1])).toBe(BOUNDS.r)
    expect(Number(glsl.match(/GAL_CLOUDS = (\d+);/)[1])).toBe(CLOUDS.length)
    const u = galaxyNormUniforms(model.norms)
    expect(u.uGalaxyNorm0.every(Number.isFinite)).toBe(true)
    expect(u.uGalaxyNorm1[2]).toBe(model.norms.dust)
  })

  it('stores the light in a half float: the bulge face-on from 40 kpc, at Earth\'s keyed exposure, times the store scale', () => {
    const v = luma(integrateRay(model, [0, 40, 0.05], [0, -1, 0]).rgb) * 1e8
    expect(v).toBeGreaterThan(2 ** -14)
    expect(v).toBeLessThan(HDR_MAX_VALUE)
  })
})
