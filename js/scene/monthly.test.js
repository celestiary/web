import {
  MONTH_FADE_PER_S, monthBlendOfJulianDay, monthOfJulianDay, monthWeight, monthlyPath, overAlphas, stepMonthShares,
} from './monthly.js'


describe('monthOfJulianDay', () => {
  it('is the UTC calendar month', () => {
    expect(monthOfJulianDay(2451545.0)).toBe(1) // J2000: 2000-01-01 12:00 UTC
    expect(monthOfJulianDay(2461313.14)).toBe(9) // 2026-09-29
    expect(monthOfJulianDay(2461314.51)).toBe(10) // 2026-10-01, a quarter-hour in
    expect(monthOfJulianDay(2461314.49)).toBe(9) // a quarter-hour before
  })
})


describe('monthlyPath', () => {
  it('fills in the two-digit month', () => {
    expect(monthlyPath('earth/blue-marble/2004-{MM}', 3)).toBe('earth/blue-marble/2004-03')
    expect(monthlyPath('t/2004-{MM}/{z}/{x}/{y}.jpg', 12)).toBe('t/2004-12/{z}/{x}/{y}.jpg')
  })
})


describe('monthBlendOfJulianDay', () => {
  const jd = (iso) => (Date.parse(iso) / 864e5) + 2440587.5

  it('is the month alone at its middle', () => {
    // July: 31 days, its middle the 16th at 12:00.
    expect(monthBlendOfJulianDay(jd('2026-07-16T12:00:00Z'))).toEqual({a: 7, b: 8, w: 0})
    // February 2026: 28 days, its middle the 15th at 00:00.
    expect(monthBlendOfJulianDay(jd('2026-02-15T00:00:00Z'))).toEqual({a: 2, b: 3, w: 0})
  })

  it('mixes the two months whose middles a date is between, by the time between them', () => {
    const b = monthBlendOfJulianDay(jd('2026-07-01T00:00:00Z'))
    expect([b.a, b.b]).toEqual([6, 7])
    // June's middle the 16th at 00:00, July's the 16th at 12:00: 30.5 days.
    expect(b.w).toBeCloseTo(15 / 30.5, 12)
    const late = monthBlendOfJulianDay(jd('2026-07-30T00:00:00Z'))
    expect([late.a, late.b]).toEqual([7, 8])
    expect(late.w).toBeCloseTo(13.5 / 31, 12)
  })

  it('turns over the year', () => {
    const dec = monthBlendOfJulianDay(jd('2026-12-31T00:00:00Z'))
    expect([dec.a, dec.b]).toEqual([12, 1])
    const jan = monthBlendOfJulianDay(jd('2027-01-01T00:00:00Z'))
    expect([jan.a, jan.b]).toEqual([12, 1])
    expect(jan.w).toBeGreaterThan(dec.w)
    expect(monthBlendOfJulianDay(jd('2027-01-10T00:00:00Z')).a).toBe(12)
  })

  it('moves without a step: the share of each month is continuous across the middles', () => {
    let prev = null
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2027-01-01T00:00:00Z'); t += 36e5) {
      const b = monthBlendOfJulianDay((t / 864e5) + 2440587.5)
      if (prev) {
        for (let m = 1; m <= 12; m++) {
          expect(Math.abs(monthWeight(b, m) - monthWeight(prev, m))).toBeLessThan(0.0015)
        }
      }
      prev = b
    }
  })

  it('has the calendar month the heavier, but for the hours round its first', () => {
    for (let t = Date.parse('2026-01-02T00:00:00Z'); t < Date.parse('2027-01-01T00:00:00Z'); t += 864e5) {
      const day = new Date(t).getUTCDate()
      const b = monthBlendOfJulianDay((t / 864e5) + 2440587.5)
      const heavier = b.w > 0.5 ? b.b : b.a
      if (day > 1) {
        expect(heavier).toBe(new Date(t).getUTCMonth() + 1)
      }
    }
  })
})


describe('stepMonthShares', () => {
  const blend = {a: 7, b: 8, w: 0.25}

  it('follows the blend at once when the months are in and it moves slowly', () => {
    const e = [{month: 7, ready: true, shown: 0.75}, {month: 8, ready: true, shown: 0.25}]
    expect(stepMonthShares(e, {a: 7, b: 8, w: 0.26}, 0.016)).toEqual([0.74, 0.26])
  })

  it('grows a month from 0 once its map is ready, at MONTH_FADE_PER_S', () => {
    const e = [{month: 7, ready: true, shown: 1}, {month: 8, ready: false, shown: 0}]
    expect(stepMonthShares(e, blend, 0.1)).toEqual([1, 0])
    expect(e[1].shown).toBe(0)
    e[1].ready = true
    stepMonthShares(e, blend, 0.05)
    expect(e[1].shown).toBeCloseTo(MONTH_FADE_PER_S * 0.05, 12)
  })

  it('keeps what is shown until a month of the blend is ready', () => {
    const e = [{month: 3, ready: true, shown: 1}, {month: 7, ready: false, shown: 0}]
    expect(stepMonthShares(e, blend, 1)).toEqual([1, 0])
    e[1].ready = true
    stepMonthShares(e, blend, 0.1)
    expect(e[0].shown).toBeCloseTo(0.8, 12)
  })

  it('is all 0 while nothing is shown', () => {
    expect(stepMonthShares([{month: 7, ready: false, shown: 0}], blend, 1)).toEqual([0])
  })
})


describe('overAlphas', () => {
  it('composes layers drawn bottom up into the mix by their shares', () => {
    const shares = [0.2, 0.3, 0.5]
    const alphas = overAlphas(shares)
    expect(alphas[0]).toBe(1)
    // Over-compose: each layer mixes itself in at its alpha.
    const mixOf = (colours) => colours.reduce((acc, c, i) => acc + ((c - acc) * alphas[i]), 0)
    expect(mixOf([1, 0, 0])).toBeCloseTo(0.2, 12)
    expect(mixOf([0, 1, 0])).toBeCloseTo(0.3, 12)
    expect(mixOf([0, 0, 1])).toBeCloseTo(0.5, 12)
  })

  it('puts detail over a base by its strength: the base first, at 1 − strength', () => {
    const s = 0.4
    const w = 0.3
    const [, a1, a2] = overAlphas([1 - s, s * (1 - w), s * w])
    expect(a2).toBeCloseTo(s * w, 12)
    expect(a1).toBeCloseTo(s * (1 - w) / (1 - (s * w)), 12)
  })

  it('is 0 for a layer under which nothing is shown', () => {
    expect(overAlphas([0, 0, 1])).toEqual([0, 0, 1])
  })
})
