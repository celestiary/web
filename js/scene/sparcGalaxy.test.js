import {readFileSync} from 'node:fs'
import {
  VALUE_PER_LSUN_KPC2, bulgeUnitVolume, density, galaxyGlsl, galaxyModel, galaxySpecUniforms, gamma, integrateRay, prng,
} from './galaxyModel.js'
import {equatorialToSceneUnit, skyBasis} from './galacticFrame.js'
import {
  ATTENUATION_MU, COMPONENT_BV, V_OVER_36, attenuationTable, barFamily, bulgeHalfLightOverA, bvTemperature, family,
  faceOnLuminosityV, galaxyPlacement, profileRatio, sparcSpec, typeDefaults, youngShare,
} from './sparcGalaxy.js'
import StarsCatalog from './StarsCatalog.js'


const {galaxies: ROWS} = JSON.parse(readFileSync('./public/data/sparc/galaxies.json', 'utf8'))
const DEFAULTS = typeDefaults(ROWS)
const DEG = Math.PI / 180


/**
 * @param {string} name SPARC's
 * @returns {object} Its row
 */
function row(name) {
  return ROWS.find((g) => g.name === name)
}


/**
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {number} Degrees between two directions
 */
function separationDeg(a, b) {
  const la = Math.hypot(...a)
  const lb = Math.hypot(...b)
  const c = ((a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])) / (la * lb)
  return Math.acos(Math.min(Math.max(c, -1), 1)) / DEG
}


/**
 * A galaxy's whole light leaving it toward a direction, by an
 * orthographic grid of rays through its model, L_sun.
 *
 * @param {object} model
 * @param {Array<number>} dir Unit, the galaxy's frame
 * @param {number} n Rays a side
 * @returns {number}
 */
function lightToward(model, dir, n = 48) {
  // The box's outline on the sky, wide enough at these angles; fine enough for the centre's cusp.
  const R = 1.2 * model.spec.bounds.r
  // dir × Y, or X face on.
  let right = [-dir[2], 0, dir[0]]
  if (Math.hypot(...right) < 1e-6) {
    right = [1, 0, 0]
  }
  const rl = Math.hypot(...right)
  right = right.map((v) => v / rl)
  const up = [(right[1] * dir[2]) - (right[2] * dir[1]), (right[2] * dir[0]) - (right[0] * dir[2]),
    (right[0] * dir[1]) - (right[1] * dir[0])]
  let sum = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const s = ((((i + 0.5) / n) * 2) - 1) * R
      const t = ((((j + 0.5) / n) * 2) - 1) * R
      const o = [0, 1, 2].map((k) => (s * right[k]) + (t * up[k]) - (dir[k] * 2 * R))
      const rgb = integrateRay(model, o, dir).rgb
      sum += ((0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2])) * ((2 * R / n) ** 2)
    }
  }
  return sum / VALUE_PER_LSUN_KPC2
}


describe('the catalogue', () => {
  it('has SPARC\'s 175 galaxies, each placed, with a rotation curve', () => {
    expect(ROWS.length).toBe(175)
    const curves = JSON.parse(readFileSync('./public/data/sparc/curves.json', 'utf8')).curves
    for (const g of ROWS) {
      expect(Number.isFinite(g.ra) && Number.isFinite(g.dec)).toBe(true)
      expect(g.D).toBeGreaterThan(0)
      expect(g.Rdisk).toBeGreaterThan(0)
      expect(curves[g.name].length).toBeGreaterThan(0)
    }
  })

  it('is small enough for plain git (under 1 MB together)', () => {
    const size = readFileSync('./public/data/sparc/galaxies.json').length + readFileSync('./public/data/sparc/curves.json').length
    expect(size).toBeLessThan(1e6)
  })
})


describe('the sky: positions in the stars\' frame', () => {
  it('puts a direction where the star catalogue puts a star at that RA and Dec', () => {
    // Polaris (HIP 11767) and Vega (HIP 91262), J2000 positions (Hipparcos).
    const catalog = new StarsCatalog()
    catalog.read(readFileSync('./public/data/stars.dat').buffer)
    for (const [hip, ra, dec] of [[11767, 37.95456, 89.26411], [91262, 279.23473, 38.78369], [32349, 101.28716, -16.71612]]) {
      const s = catalog.starByHip.get(hip)
      expect(separationDeg([s.x, s.y, s.z], skyBasis(ra, dec).toward)).toBeLessThan(0.05)
      expect(separationDeg(equatorialToSceneUnit(ra, dec).toArray(), skyBasis(ra, dec).toward)).toBeLessThan(1e-5)
    }
  })

  it('has north and east on the sky square to the line of sight, east toward growing RA', () => {
    const {toward, north, east} = skyBasis(114.2, 65.6)
    const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
    expect(Math.abs(dot(toward, north))).toBeLessThan(1e-12)
    expect(Math.abs(dot(toward, east))).toBeLessThan(1e-12)
    const ahead = skyBasis(114.3, 65.6).toward
    expect(dot(ahead.map((v, i) => v - toward[i]), east)).toBeGreaterThan(0)
    const up = skyBasis(114.2, 65.7).toward
    expect(dot(up.map((v, i) => v - toward[i]), north)).toBeGreaterThan(0)
  })

  it('places NGC 2403 at its distance, its disc inclined as SPARC measures, its major axis at its position angle', () => {
    const g = row('NGC2403')
    const p = galaxyPlacement(g, prng(1))
    const {toward, north, east} = skyBasis(g.ra, g.dec)
    expect(Math.hypot(...p.position) / 3.0857e22).toBeCloseTo(g.D, 2)
    // The pole is the inclination from the line of sight.
    expect(separationDeg(p.basis[1], toward.map((v) => -v))).toBeCloseTo(g.inc, 6)
    // The major axis on the sky, at the position angle from north through east.
    const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])
    expect(Math.atan2(dot(p.basis[0], east), dot(p.basis[0], north)) / DEG).toBeCloseTo(g.pa, 6)
    expect(p.paMeasured).toBe(true)
  })

  it('draws the position angle where none was measured, the same each time', () => {
    const g = ROWS.find((x) => x.pa === null)
    const a = galaxyPlacement(g, prng(7))
    const b = galaxyPlacement(g, prng(7))
    expect(a.paMeasured).toBe(false)
    expect(a.pa).toBe(b.pa)
  })
})


describe('the light', () => {
  it('fits V over [3.6] to the colour as Bell et al. 2003\'s slope and SPARC\'s mass-to-light ratio say', () => {
    // The fit's slope is the V band's log Υ against B-V (Bell et al. 2003: 1.305) ...
    expect(-V_OVER_36.b).toBeCloseTo(1.305, 1)
    // ... and its intercept puts Υ[3.6] at about 0.5 for Bell's V-band zero point (-0.628).
    expect(Math.pow(10, V_OVER_36.a - 0.628)).toBeGreaterThan(0.45)
    expect(Math.pow(10, V_OVER_36.a - 0.628)).toBeLessThan(0.6)
    // Recomputed from the catalogue, the fit holds.
    const pts = ROWS.filter((g) => Number.isFinite(g.rc3?.BT0) && Number.isFinite(g.rc3?.BV0)).map((g) => {
      const v0 = g.rc3.BT0 - g.rc3.BV0
      const lv = Math.pow(10, -0.4 * (v0 - (5 * Math.log10(g.D * 1e5)) - 4.83))
      return [g.rc3.BV0, Math.log10(lv / (g.L36 * 1e9))]
    })
    expect(pts.length).toBe(97)
    const resid = pts.map(([bv, y]) => y - (V_OVER_36.a + (V_OVER_36.b * bv)))
    expect(Math.abs(resid.reduce((a, b) => a + b, 0) / resid.length)).toBeLessThan(0.01)
  })

  it('takes the face-on V luminosity from RC3 where it has it, else from L[3.6]', () => {
    const n2403 = faceOnLuminosityV(row('NGC2403'), row('NGC2403').rc3.BV0)
    expect(n2403.source).toBe('RC3')
    // M_V^0 about -19.0 at 3.16 Mpc.
    expect(n2403.L).toBeGreaterThan(4e9)
    expect(n2403.L).toBeLessThan(7e9)
    const noRc3 = ROWS.find((g) => !Number.isFinite(g.rc3?.BT0))
    expect(faceOnLuminosityV(noRc3, 0.5).source).toBe('L[3.6]')
  })

  it('sets the young population\'s share by the colour: none for a red galaxy, more for a bluer', () => {
    expect(youngShare(COMPONENT_BV.old, 0)).toBe(0)
    expect(youngShare(0.9, 0.2)).toBe(0)
    expect(youngShare(0.6, 0)).toBeGreaterThan(0.05)
    expect(youngShare(0.4, 0)).toBeGreaterThan(youngShare(0.6, 0))
    expect(youngShare(-0.5, 0)).toBeLessThanOrEqual(0.5)
  })

  it('finds colour temperatures for B-V as Ballesteros (2012): the Sun\'s 0.65 near 5800 K', () => {
    expect(bvTemperature(0.65)).toBeGreaterThan(5600)
    expect(bvTemperature(0.65)).toBeLessThan(6000)
  })
})


describe('a galaxy\'s spec', () => {
  const specs = ROWS.map((g) => sparcSpec(g, DEFAULTS))

  it('splits each galaxy\'s light among its components, adding to all of it', () => {
    for (const {spec} of specs) {
      const fr = spec.fractions
      const sum = fr.bulge + fr.bar + fr.thin + fr.thick + fr.young + fr.hii
      expect(sum).toBeGreaterThan(0.99)
      expect(sum).toBeLessThan(1.03)
      for (const v of Object.values(fr)) {
        expect(v).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('is the same on every load (seeded by the name)', () => {
    const g = row('NGC3198')
    const a = sparcSpec(g, DEFAULTS).spec
    const b = sparcSpec(g, DEFAULTS).spec
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('has a family by type: S0s lenticular, spirals with arms, Im and BCD in clumps', () => {
    expect(family(0)).toBe('lenticular')
    expect(family(4)).toBe('spiral')
    expect(family(9)).toBe('magellanic')
    expect(family(10)).toBe('irregular')
    expect(family(11)).toBe('bcd')
    const s0 = sparcSpec(row('UGC02487'), DEFAULTS)
    expect(s0.meta.family).toBe('lenticular')
    expect(s0.spec.arms.length).toBe(0)
    expect(s0.spec.fractions.young).toBe(0)
    const sc = sparcSpec(row('NGC2403'), DEFAULTS)
    expect(sc.spec.arms.length).toBeGreaterThanOrEqual(2)
    const im = sparcSpec(row('DDO154'), DEFAULTS)
    expect(im.spec.arms.length).toBe(0)
    expect(im.spec.clumpsSF.count).toBeGreaterThan(0)
  })

  it('takes the bar family RC3 (or SIMBAD) gives', () => {
    expect(barFamily(row('NGC3992'))).toBe('B')
    expect(barFamily(row('NGC2403'))).toBe('X')
    expect(barFamily(row('NGC7331'))).toBe('A')
    expect(sparcSpec(row('NGC3992'), DEFAULTS).spec.fractions.bar).toBeGreaterThan(0)
    expect(sparcSpec(row('NGC7331'), DEFAULTS).spec.fractions.bar).toBe(0)
  })

  it('gives the bulge SPARC\'s half-light radius', () => {
    for (const name of ['NGC2841', 'NGC7331', 'UGC02487']) {
      const g = row(name)
      const {spec} = sparcSpec(g, DEFAULTS)
      expect(spec.bar.x0 * bulgeHalfLightOverA(spec.bar.n)).toBeCloseTo(g.bulgeRe, 6)
    }
  })

  it('normalises an ellipsoidal bulge by 4π·n·Γ(3n), and the boxy one by quadrature', () => {
    expect(gamma(5)).toBeCloseTo(24, 10)
    expect(gamma(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 10)
    expect(bulgeUnitVolume(2) / bulgeUnitVolume(1)).toBeCloseTo(gamma(6), 6)
  })

  it('follows the measured disc profile where it departs from the exponential', () => {
    const g = row('NGC2403')
    const f = profileRatio(g.disc, g.Rdisk)
    expect(f(g.Rdisk)).toBeCloseTo(1, 6)
    for (const [r, sb] of g.disc) {
      const a = g.disc[Math.floor(g.disc.length / 3)]
      // The ratio times the exponential is the profile, up to its normalisation.
      const want = sb / a[1]
      const got = f(r) * Math.exp(-r / g.Rdisk) / (f(a[0]) * Math.exp(-a[0] / g.Rdisk))
      if (want > 0.01) {
        expect(got / want).toBeCloseTo(1, 2)
      }
    }
  })
})


describe('a galaxy\'s model', () => {
  it('carries its luminosity: face on, all of it but what its dust takes', () => {
    for (const name of ['NGC2403', 'UGC02487']) {
      const {spec} = sparcSpec(row(name), DEFAULTS)
      const model = galaxyModel(spec, 128)
      // Without dust, the whole light (a ray grid's sampling of the centre's cusp aside).
      const clear = {...model, norms: {...model.norms, dust: 0}}
      const all = lightToward(clear, [0, -1, 0])
      expect(all / spec.L).toBeGreaterThan(0.94)
      expect(all / spec.L).toBeLessThan(1.05)
    }
  })

  it('dims with inclination as its far point says (attenuationTable), within 20%', () => {
    for (const name of ['NGC3198']) {
      const {spec} = sparcSpec(row(name), DEFAULTS)
      const model = galaxyModel(spec, 128)
      const clear = lightToward({...model, norms: {...model.norms, dust: 0}}, [0, -1, 0])
      const table = attenuationTable(spec)
      for (const [k, mu] of [[0, 1], [2, 0.5], [3, 0.25]]) {
        const dir = [Math.sqrt(1 - (mu * mu)), -mu, 0]
        const seen = lightToward(model, dir)
        expect(table[k] / (seen / clear)).toBeGreaterThan(0.8)
        expect(table[k] / (seen / clear)).toBeLessThan(1.2)
      }
      expect(ATTENUATION_MU[0]).toBe(1)
    }
  })

  it('is brighter in the middle than its outskirts, and its bulge is warmer than its arms', () => {
    const {spec} = sparcSpec(row('NGC2841'), DEFAULTS)
    const model = galaxyModel(spec, 128)
    const centre = density(model, 0, 0, 0)
    const out = density(model, 3 * spec.thin.hR, 0, 0)
    expect(centre.rgb[1]).toBeGreaterThan(10 * out.rgb[1])
    expect(spec.colors.bulge[0] / spec.colors.bulge[2]).toBeGreaterThan(spec.colors.young[0] / spec.colors.young[2])
  })

  it('has the uniforms the shared march reads', () => {
    const {spec} = sparcSpec(row('NGC2403'), DEFAULTS)
    const u = galaxySpecUniforms(spec)
    expect(u.uGalP.length).toBe(8)
    expect(u.uGalC.length).toBe(4)
    for (const v of u.uGalP.flat()) {
      expect(Number.isFinite(v)).toBe(true)
    }
    const glsl = galaxyGlsl(null, {uniforms: true})
    expect(glsl).toContain('uniform vec4 uGalP[8]')
    expect(glsl).toContain('vec3 galaxyMarch(vec3 o, vec3 d, float jitter)')
  })
})
