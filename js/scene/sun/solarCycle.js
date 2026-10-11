import data from './sunspots.json'


/**
 * The Sun's activity by date (js/scene/Sun.md, "Activity by date"): the
 * monthly sunspot number, observed where NOAA SWPC has it, SWPC's forecast
 * after that, and a published cycle model past both and before 1997;
 * which cycles are running and where their spots emerge (Spörer's law); and
 * the surface's differential rotation.  Pure functions, no three.js.
 *
 * Time is in UTC milliseconds since 1970, as `Time.simTime` has it.
 */


const MS_PER_DAY = 86400e3
// The mean Gregorian month, so a month's index and its middle are a
// division away from the clock's milliseconds (within 1.5 days of the
// calendar's).
export const DAYS_PER_MONTH = 365.2425 / 12
const MS_PER_MONTH = DAYS_PER_MONTH * MS_PER_DAY
const MONTHS_PER_YEAR = 12
const EPOCH_YEAR = 1970


/**
 * @param {string} tag 'YYYY-MM'
 * @returns {number} The month's index from January 1970
 */
export function monthIndex(tag) {
  const [y, m] = tag.split('-').map(Number)
  return ((y - EPOCH_YEAR) * MONTHS_PER_YEAR) + (m - 1)
}


/**
 * @param {number} ms UTC
 * @returns {number} Months from the start of January 1970, fractional: a
 *     month's middle is its index + 0.5
 */
export function monthsAt(ms) {
  return ms / MS_PER_MONTH
}


/**
 * @param {number} months as monthsAt gives
 * @returns {number} UTC ms
 */
export function msAtMonths(months) {
  return months * MS_PER_MONTH
}


// The cycle's shape: Hathaway, Wilson & Reichmann (1994, Sol. Phys. 151,
// 177), F(t) = A·x³ / (exp(x²) − c), x = (t − t0)/b, with the average
// cycle's asymmetry c = 0.8 and t0 four months before the minimum
// (Hathaway 2015, Living Rev. Sol. Phys. 12, 4).  Each cycle's b is
// set from its observed rise to maximum, and F is normalised to its
// smoothed maximum.
export const SHAPE_C = 0.8
export const T0_BEFORE_MINIMUM_MONTHS = 4


/**
 * @param {number} x (t − t0)/b
 * @returns {number} The unnormalised shape, 0 before the cycle starts
 */
export function cycleShape(x) {
  if (!(x > 0)) {
    return 0
  }
  const x2 = x * x
  // exp(x²) overflows past x ≈ 26: the shape is long gone there.
  return x2 > 600 ? 0 : (x2 * x) / (Math.exp(x2) - SHAPE_C)
}


// Where the shape peaks, x* (3(e^{x²} − c) = 2x² e^{x²}), by bisection.
const SHAPE_PEAK_X = (() => {
  let lo = 0.5
  let hi = 2
  for (let i = 0; i < 60; i++) {
    const x = (lo + hi) / 2
    const e = Math.exp(x * x)
    if ((3 * (e - SHAPE_C)) - (2 * x * x * e) > 0) {
      lo = x
    } else {
      hi = x
    }
  }
  return (lo + hi) / 2
})()
const SHAPE_PEAK = cycleShape(SHAPE_PEAK_X)
export {SHAPE_PEAK_X}


/**
 * The smoothed series' lowest and highest months between two tags.
 *
 * @param {string} from
 * @param {string} to
 * @returns {{minimum: number, maximum: number, peak: number}} month
 *     indices, and the highest value
 */
function smoothedExtremes(from, to) {
  const s0 = monthIndex(data.smoothed.start)
  let min = null
  let max = null
  for (let i = 0; i < data.smoothed.ssn.length; i++) {
    const m = s0 + i
    const v = data.smoothed.ssn[i]
    if (v === null || m < monthIndex(from) || m > monthIndex(to)) {
      continue
    }
    if (min === null || v < min.v) {
      min = {m, v}
    }
    if (max === null || v > max.v) {
      max = {m, v}
    }
  }
  return {minimum: min.m, maximum: max.m, peak: max.v}
}


/**
 * The cycles the model knows, each with its starting minimum and its
 * smoothed maximum (month indices) and the maximum's value.  Cycles 21 and
 * 22 from published tables (the international sunspot number, version 2):
 * 21 began in March 1976 and peaked at 232.9 in December 1979 (WDC-SILSO's
 * smoothed series as tabulated by the Australian Bureau of Meteorology's
 * Space Weather Services, "Solar cycle 21"); 22 began in September 1986
 * and peaked at 212.5 in November 1989 (the same table; Wilson 1993 dates
 * the maximum to July 1989).  Cycle 23's minimum is May 1996, the NOAA/ISES
 * Solar Cycle 23 panel's (1997).  Cycles 23 to 25's maxima, and 24's and
 * 25's minima, are found in SWPC's smoothed series (sunspots.json), on
 * SWPC's own scale, which runs a few percent over SILSO's at a maximum
 * (124.9 against 116.4 in April 2014).
 */
export const KNOWN_CYCLES = (() => {
  const c23 = smoothedExtremes('1997-01', '2007-12')
  const c24 = smoothedExtremes('2007-01', '2019-06')
  const c25min = smoothedExtremes('2018-01', '2021-01')
  const c25 = smoothedExtremes('2020-01', '2030-12')
  return Object.freeze([
    {cycle: 21, minimum: monthIndex('1976-03'), maximum: monthIndex('1979-12'), peak: 232.9},
    {cycle: 22, minimum: monthIndex('1986-09'), maximum: monthIndex('1989-11'), peak: 212.5},
    {cycle: 23, minimum: monthIndex('1996-05'), maximum: c23.maximum, peak: c23.peak},
    {cycle: 24, minimum: c24.minimum, maximum: c24.maximum, peak: c24.peak},
    {cycle: 25, minimum: c25min.minimum, maximum: c25.maximum, peak: c25.peak},
  ].map(Object.freeze))
})()


// The mean cycle, for the cycles before 21 and after 25: 11.0 years
// minimum to minimum (the mean length of cycles 1-24 is 11.0 years,
// Hathaway 2015), the known cycles' mean rise and peak.
export const MEAN_CYCLE_MONTHS = 11.0 * MONTHS_PER_YEAR
const mean = (f) => KNOWN_CYCLES.reduce((s, c) => s + f(c), 0) / KNOWN_CYCLES.length
export const MEAN_RISE_MONTHS = mean((c) => c.maximum - c.minimum)
export const MEAN_PEAK = mean((c) => c.peak)


/**
 * Cycle n: a known one, or the mean cycle at the mean spacing from the
 * nearest known one (a model, not history).
 *
 * @param {number} n
 * @returns {{cycle: number, minimum: number, maximum: number, peak: number, modelled: boolean}}
 */
export function cycle(n) {
  const first = KNOWN_CYCLES[0]
  const last = KNOWN_CYCLES[KNOWN_CYCLES.length - 1]
  const known = KNOWN_CYCLES.find((c) => c.cycle === n)
  if (known) {
    return {...known, modelled: false}
  }
  const anchor = n < first.cycle ? first : last
  const minimum = anchor.minimum + ((n - anchor.cycle) * MEAN_CYCLE_MONTHS)
  return {cycle: n, minimum, maximum: minimum + MEAN_RISE_MONTHS, peak: MEAN_PEAK, modelled: true}
}


/**
 * @param {object} c from cycle()
 * @returns {{t0: number, b: number}} The shape's start (months) and width
 */
export function cycleFit(c) {
  const t0 = c.minimum - T0_BEFORE_MINIMUM_MONTHS
  return {t0, b: (c.maximum - t0) / SHAPE_PEAK_X}
}


/**
 * One cycle's own sunspot number at a time, by the model.
 *
 * @param {object} c from cycle()
 * @param {number} months as monthsAt gives
 * @returns {number}
 */
export function cycleNumber(c, months) {
  const {t0, b} = cycleFit(c)
  return c.peak * cycleShape((months - t0) / b) / SHAPE_PEAK
}


/**
 * The number of the cycle whose minimum is the latest at or before a time.
 *
 * @param {number} months
 * @returns {number}
 */
export function cycleNumberAt(months) {
  let n = KNOWN_CYCLES[0].cycle + Math.floor((months - KNOWN_CYCLES[0].minimum) / MEAN_CYCLE_MONTHS) - 1
  while (cycle(n + 1).minimum <= months) {
    n++
  }
  while (cycle(n).minimum > months) {
    n--
  }
  return n
}


// A cycle's tail outlasts the next minimum by years (the shape's Gaussian
// decline); two before and one after the current cycle cover it.
const CYCLES_BEFORE = 2


/**
 * The cycles running at a time and each one's share of the model's
 * sunspot number there, its months since its start (t0) and its spot zone.
 *
 * @param {number} ms UTC
 * @returns {Array<{cycle: number, number: number, share: number, months: number, latitude: number, width: number}>}
 */
export function cyclesAt(ms) {
  const months = monthsAt(ms)
  const n = cycleNumberAt(months)
  const out = []
  let total = 0
  for (let k = n - CYCLES_BEFORE; k <= n + 1; k++) {
    const c = cycle(k)
    const number = cycleNumber(c, months)
    if (number > 0) {
      const t = months - cycleFit(c).t0
      out.push({cycle: k, number, share: 0, months: t, ...spotZone(t, number / c.peak)})
      total += number
    }
  }
  for (const c of out) {
    c.share = total > 0 ? c.number / total : 0
  }
  return out
}


// Spörer's law as Hathaway (2011, Sol. Phys. 273, 221) standardised it:
// the centroid of each hemisphere's sunspot zone is at 28° exp(−t/90
// months), t from the cycle's fitted start, whatever the cycle's size.
// The zone is narrow at the start, widest near maximum and narrow again
// as it ends (Hathaway 2015): a Gaussian of σ from 4° to 8° with
// the cycle's own share of its maximum (a model of that description).
export const ZONE_START_DEG = 28
export const ZONE_DECAY_MONTHS = 90
export const ZONE_SIGMA_DEG = [4, 8]


/**
 * @param {number} months since the cycle's t0
 * @param {number} strength the cycle's number over its peak, 0 to 1
 * @returns {{latitude: number, width: number}} degrees: the zone's centre
 *     and σ
 */
export function spotZone(months, strength) {
  const latitude = ZONE_START_DEG * Math.exp(-Math.max(months, 0) / ZONE_DECAY_MONTHS)
  const s = Math.min(Math.max(strength, 0), 1)
  return {latitude, width: ZONE_SIGMA_DEG[0] + ((ZONE_SIGMA_DEG[1] - ZONE_SIGMA_DEG[0]) * s)}
}


/**
 * The model's sunspot number: the sum of the cycles running.
 *
 * @param {number} ms UTC
 * @returns {number}
 */
export function modelSunspotNumber(ms) {
  return cyclesAt(ms).reduce((s, c) => s + c.number, 0)
}


/**
 * A monthly series' value at a time, linear between months' middles,
 * or null outside it or in a gap.
 *
 * @param {{start: string, ssn: Array<number|null>}} s
 * @param {number} months
 * @returns {number|null}
 */
function seriesAt(s, months) {
  if (!s) {
    return null
  }
  const x = months - monthIndex(s.start) - 0.5
  const n = s.ssn.length
  if (x < -0.5 || x > n - 0.5) {
    return null
  }
  const i = Math.min(Math.max(Math.floor(x), 0), n - 1)
  const j = Math.min(i + 1, n - 1)
  const a = s.ssn[i]
  const b = s.ssn[j]
  if (a === null || b === null) {
    return a ?? b
  }
  const f = Math.min(Math.max(x - i, 0), 1)
  return a + ((b - a) * f)
}


let observed = data.observed
const predicted = data.predicted
// Past the forecast the model takes over within this many months, blended
// linearly, so there is no step.
export const HANDOVER_MONTHS = 12


/**
 * Replaces the observed series: the hook for another monthly record, e.g.
 * the international sunspot number, where its licence allows (Sun.md).
 * Months not in it fall back as before: the forecast after it, the model
 * before it and past the forecast.
 *
 * @param {{start: string, ssn: Array<number|null>}|null} series null
 *     restores SWPC's
 */
export function setObservedSeries(series) {
  observed = series ?? data.observed
}


/**
 * Where a time's sunspot number comes from.
 *
 * @param {number} ms UTC
 * @returns {'observed'|'predicted'|'model'}
 */
export function sunspotSource(ms) {
  const months = monthsAt(ms)
  if (seriesAt(observed, months) !== null) {
    return 'observed'
  }
  if (seriesAt(predicted, months) !== null) {
    return 'predicted'
  }
  return 'model'
}


/**
 * The monthly sunspot number at a time: SWPC's observed count from 1997,
 * SWPC's forecast after its record (to December 2030), and the cycle
 * model before 1997 and past the forecast (Sun.md, "Activity by date").
 *
 * @param {number} ms UTC
 * @returns {number}
 */
export function sunspotNumber(ms) {
  const months = monthsAt(ms)
  const obs = seriesAt(observed, months)
  if (obs !== null) {
    return obs
  }
  const pred = seriesAt(predicted, months)
  if (pred !== null) {
    return pred
  }
  const model = modelSunspotNumber(ms)
  const end = monthIndex(predicted.start) + predicted.ssn.length
  const past = months - end
  if (past > 0 && past < HANDOVER_MONTHS) {
    const last = predicted.ssn[predicted.ssn.length - 1]
    const f = past / HANDOVER_MONTHS
    return (last * (1 - f)) + (model * f)
  }
  return model
}


// A 13-month running mean, as the smoothed sunspot number is, in month steps.
const SMOOTH_HALF_MONTHS = 6


/**
 * The sunspot number's 13-month running mean at a time: the cycle's level,
 * without the months' scatter (the corona's shape and the prominences
 * follow it).
 *
 * @param {number} ms UTC
 * @returns {number}
 */
export function smoothedSunspotNumber(ms) {
  let sum = 0
  for (let k = -SMOOTH_HALF_MONTHS; k <= SMOOTH_HALF_MONTHS; k++) {
    const w = Math.abs(k) === SMOOTH_HALF_MONTHS ? 0.5 : 1
    sum += w * sunspotNumber(ms + (k * MS_PER_MONTH))
  }
  return sum / (2 * SMOOTH_HALF_MONTHS)
}


// The activity's scale: a strong maximum's smoothed number (cycle 23's).
export const ACTIVITY_REFERENCE = KNOWN_CYCLES.find((c) => c.cycle === 23).peak


/**
 * The cycle's level, 0 at a deep minimum to 1 at a strong maximum (cycle
 * 23's), from the smoothed number; beyond 1 for a stronger cycle.
 *
 * @param {number} ms UTC
 * @returns {number}
 */
export function activityLevel(ms) {
  return Math.max(smoothedSunspotNumber(ms), 0) / ACTIVITY_REFERENCE
}


// The surface's differential rotation, sidereal, from the Doppler and
// magnetic-feature fits of Snodgrass & Ulrich (1990, ApJ 351, 309):
// Ω = A + B sin²φ + C sin⁴φ, degrees a day.  The Carrington frame turns at
// 14.1844° a day (the IAU's W for the Sun: Archinal et al. 2018): this
// fit's rate at 26° latitude, so a region in the spot zones drifts east
// in it by up to half a degree a day, one at 60° west by two.
export const ROTATION_DEG_PER_DAY = Object.freeze([14.713, -2.396, -1.787])
export const CARRINGTON_DEG_PER_DAY = 14.1844


/**
 * @param {number} latDeg heliographic latitude
 * @returns {number} sidereal rotation, degrees a day
 */
export function rotationRate(latDeg) {
  const s2 = Math.sin(latDeg * Math.PI / 180) ** 2
  const [a, b, c] = ROTATION_DEG_PER_DAY
  return a + (b * s2) + (c * s2 * s2)
}


export {MS_PER_DAY, MS_PER_MONTH}
