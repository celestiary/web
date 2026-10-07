import {DARK_SKY_MAG, magPerArcsec2, s10Value, surfaceBrightnessValue} from './eye.js'
import {
  AIRGLOW_COLOR, LEINERT, ZODIACAL_CLOUD, airglowOf, airglowPath, cloudNormal, fanProfile, hongPhase, leinertS10,
  zodiacalAlong, zodiacalBrightest,
} from './nightSky.js'
import earth from '../../public/data/earth.json'


const DEG = Math.PI / 180
const R = 6.37101e6
const H = 9e4
const TH = 1e4


describe('the zodiacal light: Leinert et al. (1998)\'s table, the reference', () => {
  const mag = (s10) => magPerArcsec2(s10Value(s10))

  it('is 23.3 mag/arcsec² at the ecliptic\'s poles and 21.95 along it 90° from the Sun', () => {
    expect(mag(leinertS10(90 * DEG, 90 * DEG))).toBeCloseTo(23.3, 1)
    for (const e of [30, 90, 150]) {
      expect(leinertS10(e * DEG, 90 * DEG)).toBeCloseTo(LEINERT.pole, 9)
    }
    expect(mag(leinertS10(90 * DEG, 0))).toBeCloseTo(21.95, 1)
  })

  it('brightens toward the Sun about as ε^−2.7, dims to 150° and rises in the gegenschein', () => {
    const ecl = (e) => leinertS10(e * DEG, 0)
    expect(ecl(30)).toBeGreaterThan(1500)
    expect(ecl(30)).toBeLessThan(2500)
    expect(ecl(60)).toBeGreaterThan(ecl(90))
    expect(ecl(150)).toBeLessThan(ecl(120))
    expect(ecl(180)).toBeGreaterThan(1.1 * ecl(150))
  })
})


describe('the zodiacal light: the dust cloud (Kelsall et al. 1998, Hong 1985)', () => {
  // From (1, 0, 0) AU in the scene's ecliptic axes, Y north: the Sun is −X.
  const at1AU = (dl, b) => zodiacalAlong([1, 0, 0],
      [-Math.cos(dl * DEG) * Math.cos(b * DEG), Math.sin(b * DEG), Math.sin(dl * DEG) * Math.cos(b * DEG)])
  const leinert = (dl, b) => leinertS10(Math.acos(Math.cos(dl * DEG) * Math.cos(b * DEG)), b * DEG)
  const mag = (s10) => magPerArcsec2(s10Value(s10))

  it('reproduces Leinert\'s table from 1 AU within a third, normalised 90° from the Sun', () => {
    expect(at1AU(90, 0)).toBeCloseTo(leinert(90, 0), 6)
    for (const [dl, b] of [[15, 0], [20, 0], [30, 0], [45, 0], [60, 0], [120, 0], [150, 0], [180, 0], [90, 30], [90, 60],
      [90, 90], [30, 30], [180, 30]]) {
      const ratio = at1AU(dl, b) / leinert(dl, b)
      expect(ratio).toBeGreaterThan(0.75)
      expect(ratio).toBeLessThan(1.35)
    }
    // The gegenschein: brighter at the antisolar point than 30° from it.
    expect(at1AU(180, 0)).toBeGreaterThan(1.1 * at1AU(150, 0))
  })

  it('is a lens round the Sun from anywhere, smooth, fainter and smaller with distance and height', () => {
    const profile = (o, ang) => {
      const r = Math.hypot(...o)
      const toSun = o.map((v) => -v / r)
      // ang degrees from the Sun, toward +Z, perpendicular to toSun for these o.
      return zodiacalAlong(o, toSun.map((v, i) => (v * Math.cos(ang * DEG)) + ([0, 0, 1][i] * Math.sin(ang * DEG))))
    }
    for (const o of [[0.8, 0, 0], [1, 0, 0], [2, 0, 0], [5, 0, 0], [0.9, 0.4, 0], [1.8, 0.9, 0]]) {
      // No rims: the profile falls from 2° to 60° from the Sun, and on a log-log
      // plot it bends gently, at steps of 10% in angle (a rim, or the first
      // cut's plateau at 3° is a kink of 0.26 there; the most here, 0.11, is
      // the cloud's outer edge seen from 5 AU).
      const logs = []
      for (let ang = 2; ang <= 60; ang *= 1.1) {
        logs.push(Math.log(profile(o, ang)))
      }
      for (let k = 1; k < logs.length - 1; k++) {
        expect(logs[k]).toBeLessThan(logs[k - 1])
        expect(Math.abs(logs[k + 1] - (2 * logs[k]) + logs[k - 1])).toBeLessThan(0.15)
      }
    }
    // From 2 AU, 10° from the Sun, about 5× fainter than from 1 AU; from 5 AU,
    // away from the Sun, nothing (Pioneer 10).
    expect(profile([2, 0, 0], 10) / profile([1, 0, 0], 10)).toBeLessThan(0.3)
    expect(mag(zodiacalAlong([5, 0, 0], [1, 0, 0]))).toBeGreaterThan(30)
    // From over the ecliptic, the lens is fainter.
    expect(profile([1.8, 0.9, 0], 20)).toBeLessThan(profile([2, 0, 0], 20))
  })

  it('is brightest toward the Sun, held at minImpactAU', () => {
    for (const o of [[1, 0, 0], [2, 0.5, 0.3]]) {
      const top = zodiacalBrightest(o)
      expect(top).toBeGreaterThan(at1AU(10, 0))
      expect(Number.isFinite(top)).toBe(true)
    }
    expect(Number.isFinite(zodiacalBrightest([0, 0, 0]))).toBe(true)
    expect(ZODIACAL_CLOUD.minImpactAU).toBeGreaterThan(0)
  })

  it('has a plane inclined 2° to the ecliptic, a fan profile and a forward-scattering phase', () => {
    const n = cloudNormal()
    expect(Math.acos(n[1]) / DEG).toBeCloseTo(2.03, 6)
    expect(fanProfile(0)).toBe(1)
    expect(fanProfile(0.5)).toBeLessThan(fanProfile(0.1))
    expect(hongPhase(1)).toBeGreaterThan(10 * hongPhase(0))
    expect(hongPhase(-1)).toBeGreaterThan(hongPhase(-0.9))
  })
})


describe('airglow', () => {
  const ground = [0, R + 2200, 0]
  const vanRhijn = (z) => 1 / Math.sqrt(1 - (((R / (R + H)) * Math.sin(z)) ** 2))

  it('is the layer once at the zenith, and the van Rhijn factor toward the horizon', () => {
    const up = airglowPath(ground, [0, 1, 0], H, TH, R)
    expect(up.near).toBe(0)
    expect(up.far).toBeCloseTo(1, 6)
    for (const z of [30, 60, 75, 85]) {
      const p = airglowPath(ground, [Math.sin(z * DEG), Math.cos(z * DEG), 0], H, TH, R)
      expect(p.far / vanRhijn(z * DEG)).toBeGreaterThan(0.97)
      expect(p.far / vanRhijn(z * DEG)).toBeLessThan(1.03)
    }
    const horizon = airglowPath(ground, [1, 0, 0], H, TH, R).far
    expect(horizon).toBeGreaterThan(5)
    expect(horizon).toBeLessThan(7)
  })

  it('is none on a ray that ends on the ground, and finite at the layer\'s limb from orbit', () => {
    expect(airglowPath(ground, [1, -0.01, 0], H, TH, R, 3e5).far).toBe(0)
    const orbit = [0, R + 4e5, 0]
    // Straight down: through the layer once, in front of the air.
    const down = airglowPath(orbit, [0, -1, 0], H, TH, R, 4e5)
    expect(down.near).toBeCloseTo(1, 6)
    expect(down.far).toBe(0)
    // Tangent to the layer's middle: a long, finite path, near and far halves.
    const rMid = R + H
    const d = Math.sqrt(((R + 4e5) ** 2) - (rMid * rMid))
    const dir = [rMid / (R + 4e5), -d / (R + 4e5), 0]
    const n = Math.hypot(...dir)
    const limb = airglowPath(orbit, dir.map((v) => v / n), H, TH, R)
    expect(limb.near + limb.far).toBeGreaterThan(40)
    expect(limb.near + limb.far).toBeLessThan(120)
    expect(limb.near).toBeCloseTo(limb.far, 3)
  })

  it('reads Earth\'s from earth.json', () => {
    const atmosphere = {...earth.atmosphere, airglow: {...earth.atmosphere.airglow, height: {scalar: H}, thickness: {scalar: TH}}}
    const glow = airglowOf(atmosphere)
    expect(magPerArcsec2(glow.zenithValue)).toBeCloseTo(22.4, 9)
    expect(glow.height).toBe(H)
    expect(glow.thickness).toBe(TH)
    expect(airglowOf({})).toBeNull()
    expect((0.2126 * AIRGLOW_COLOR[0]) + (0.7152 * AIRGLOW_COLOR[1]) + (0.0722 * AIRGLOW_COLOR[2])).toBeCloseTo(1, 9)
  })
})


describe('the dark site\'s sky', () => {
  it('makes the natural zenith sky, 21.6-22.0, with the integrated starlight: the star calibration\'s sky', () => {
    // At the zenith, away from the ecliptic (β 60°, 120° from the Sun) and
    // the Milky Way (the integrated starlight, diffuse and resolved, 23.5).
    const airglow = surfaceBrightnessValue(earth.atmosphere.airglow.zenithMag)
    const zodiacal = s10Value(leinertS10(120 * DEG, 60 * DEG))
    const starlight = surfaceBrightnessValue(23.5)
    const total = magPerArcsec2(airglow + zodiacal + starlight)
    // 21.7: a dark site between solar minimum (21.9-22.0) and maximum (21.3-21.5).
    expect(total).toBeGreaterThan(21.6)
    expect(total).toBeLessThan(22.0)
    expect(Math.abs(total - DARK_SKY_MAG)).toBeLessThan(0.4)
  })
})
