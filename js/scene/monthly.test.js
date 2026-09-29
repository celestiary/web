import {monthOfJulianDay, monthlyPath} from './monthly.js'


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
