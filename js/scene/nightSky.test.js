import {DARK_SKY_MAG, magPerArcsec2, s10Value, surfaceBrightnessValue} from './eye.js'
import {AIRGLOW_COLOR, ZODIACAL, airglowOf, airglowPath, zodiacalS10, zodiacalScale} from './nightSky.js'
import earth from '../../public/data/earth.json'


const DEG = Math.PI / 180
const R = 6.37101e6
const H = 9e4
const TH = 1e4


describe('the zodiacal light', () => {
  const mag = (s10) => magPerArcsec2(s10Value(s10))

  it('is 23.3 mag/arcsec² at the ecliptic\'s poles and 21.9 along it 90° from the Sun (Leinert et al. 1998)', () => {
    expect(mag(zodiacalS10(90 * DEG, 90 * DEG))).toBeCloseTo(23.3, 1)
    for (const e of [30, 90, 150]) {
      expect(zodiacalS10(e * DEG, 90 * DEG)).toBeCloseTo(ZODIACAL.pole, 9)
    }
    expect(mag(zodiacalS10(90 * DEG, 0))).toBeGreaterThan(21.7)
    expect(mag(zodiacalS10(90 * DEG, 0))).toBeLessThan(22.1)
  })

  it('brightens toward the Sun about as ε^−2.7, dims to 150° and rises in the gegenschein', () => {
    const ecl = (e) => zodiacalS10(e * DEG, 0)
    expect(ecl(30)).toBeGreaterThan(1500)
    expect(ecl(30)).toBeLessThan(2500)
    expect(ecl(45)).toBeGreaterThan(600)
    expect(ecl(60)).toBeGreaterThan(ecl(90))
    expect(ecl(150)).toBeLessThan(ecl(120))
    expect(ecl(180)).toBeGreaterThan(1.1 * ecl(150))
    // Held inside 3° of the Sun.
    expect(ecl(2)).toBe(ecl(ZODIACAL.minElongationDeg))
    // Falls away from the ecliptic.
    let last = Infinity
    for (let b = 0; b <= 90; b += 5) {
      const v = zodiacalS10(90 * DEG, b * DEG)
      expect(v).toBeLessThanOrEqual(last)
      last = v
    }
  })

  it('goes as r^−2.3 from the Sun, is gone past the asteroid belt and fades out of the ecliptic', () => {
    expect(zodiacalScale(1, 0)).toBeCloseTo(s10Value(1), 20)
    expect(zodiacalScale(0.5, 0) / zodiacalScale(1, 0)).toBeCloseTo(2 ** 2.3, 6)
    expect(zodiacalScale(4.7, 0)).toBe(0)
    expect(zodiacalScale(1, 1) / zodiacalScale(1, 0)).toBeLessThan(0.2)
    // Finite at the Sun.
    expect(Number.isFinite(zodiacalScale(0, 0))).toBe(true)
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
    const zodiacal = s10Value(zodiacalS10(120 * DEG, 60 * DEG))
    const starlight = surfaceBrightnessValue(23.5)
    const total = magPerArcsec2(airglow + zodiacal + starlight)
    // 21.7: a dark site between solar minimum (21.9-22.0) and maximum (21.3-21.5).
    expect(total).toBeGreaterThan(21.6)
    expect(total).toBeLessThan(22.0)
    expect(Math.abs(total - DARK_SKY_MAG)).toBeLessThan(0.4)
  })
})
