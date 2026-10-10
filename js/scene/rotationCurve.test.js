import {readFileSync} from 'node:fs'
import {UPSILON_36, baryonicVelocity, rotationCurveSvg} from './rotationCurve.js'


const CURVES = JSON.parse(readFileSync('./public/data/sparc/curves.json', 'utf8')).curves


describe('rotation curves', () => {
  it('adds the baryons in quadrature, signed, the stars at SPARC\'s mass-to-light ratios', () => {
    expect(baryonicVelocity([1, 0, 0, 30, 40, 0])).toBeCloseTo(Math.sqrt((30 * 30) + (UPSILON_36.disc * 1600)), 9)
    // Gas pulling outward (negative V_gas) takes from the stars'.
    expect(baryonicVelocity([1, 0, 0, -10, 40, 0])).toBeCloseTo(Math.sqrt((UPSILON_36.disc * 1600) - 100), 9)
    expect(baryonicVelocity([1, 0, 0, 0, 0, 50])).toBeCloseTo(Math.sqrt(UPSILON_36.bulge) * 50, 9)
  })

  it('needs dark matter in the outer disc: NGC 3198\'s baryons fall well short of its flat curve there', () => {
    const curve = CURVES.NGC3198
    const last = curve[curve.length - 1]
    expect(last[1]).toBeGreaterThan(140)
    expect(baryonicVelocity(last) / last[1]).toBeLessThan(0.6)
  })

  it('draws the observed points and the baryons\' line on one velocity axis', () => {
    const svg = rotationCurveSvg(CURVES.NGC2403)
    expect(svg.startsWith('<svg')).toBe(true)
    expect((svg.match(/<circle/g) ?? []).length).toBe(CURVES.NGC2403.length)
    expect((svg.match(/<path/g) ?? []).length).toBe(1)
    expect(rotationCurveSvg([])).toBe('')
  })
})
