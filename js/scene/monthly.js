import {fromJulianDay} from '../Time.js'


/**
 * Imagery that changes with the season: one image per calendar month,
 * named by a pattern with `{MM}` for the month (01–12).  Earth's surface
 * is NASA's Blue Marble Next Generation, a cloud-free mosaic for each
 * month of 2004 (snow cover, vegetation, sea ice); celestiary's texture
 * and Cesium's base layer both follow the simulation date's month.
 */


/**
 * @param {number} jd Julian day
 * @returns {number} Its UTC calendar month, 1–12
 */
export function monthOfJulianDay(jd) {
  return new Date(fromJulianDay(jd)).getUTCMonth() + 1
}


/**
 * @param {string} pattern With `{MM}` for the month
 * @param {number} month 1–12
 * @returns {string}
 */
export function monthlyPath(pattern, month) {
  return pattern.replace('{MM}', String(month).padStart(2, '0'))
}


/**
 * The two months whose maps a date shows, and how much of the second: each
 * month's map is its middle's, so a date at a month's middle shows that
 * month alone, and between two middles a mix of the two weighted by the
 * time between them (Planet.md, "The months blended by day").  A timelapse
 * then turns through the seasons smoothly where the map stepped at each
 * month's first.  The weight crosses one half within half a day of the
 * turn of the month (where the two months' lengths differ), so the calendar
 * month is the heavier but for those hours.
 *
 * @param {number} jd Julian day
 * @returns {{a: number, b: number, w: number}} Months 1-12, b the one after
 *   a, and w in [0, 1): the share of b
 */
export function monthBlendOfJulianDay(jd) {
  const ms = fromJulianDay(jd)
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  // Date.UTC carries months past 11 and under 0 into the next year and the last.
  const middle = (month) => (Date.UTC(y, month, 1) + Date.UTC(y, month + 1, 1)) / 2
  const first = ms >= middle(m) ? m : m - 1
  const from = middle(first)
  const w = (ms - from) / (middle(first + 1) - from)
  const a = (((first % 12) + 12) % 12) + 1
  return {a, b: (a % 12) + 1, w: Math.min(Math.max(w, 0), 1)}
}


/**
 * A month's share of a blend.
 *
 * @param {{a: number, b: number, w: number}} blend monthBlendOfJulianDay's
 * @param {number} month 1-12
 * @returns {number} 0 for a month not in it
 */
export function monthWeight({a, b, w}, month) {
  return (month === a ? 1 - w : 0) + (month === b ? w : 0)
}


/**
 * How fast a month's shown share may move, per second, when it can't follow
 * its blend's at once: its map arriving (from 0), or one leaving after a
 * jump in date.  Half a second for the whole way, so a map coming in fades,
 * and a timelapse slower than two months a second tracks the blend exactly.
 */
export const MONTH_FADE_PER_S = 2


/**
 * Move each shown month's share toward its share of the blend, by at most
 * MONTH_FADE_PER_S × dt: a month whose map isn't ready is wanted at 0, so
 * its share grows from 0 once it is (but the first to be shown, over
 * nothing, show at once).  Shares of months no longer in the
 * blend fall to 0, and their maps can then go, but only once a month of
 * the blend is ready to take their place.
 *
 * @param {Array<{month: number, ready: boolean, shown: number}>} entries
 *   Changed in place
 * @param {{a: number, b: number, w: number}} blend
 * @param {number} dtS Seconds since the last step
 * @returns {Array<number>} The entries' shares, normalised to sum 1; all 0
 *   while none has any
 */
export function stepMonthShares(entries, blend, dtS) {
  // Until a month of the blend is ready, what is shown stays (after a jump in
  // date, the old months, rather than nothing).
  const anyReady = entries.some((e) => e.ready && monthWeight(blend, e.month) > 0)
  // Nothing shown yet (a stand-in): the first maps in show at their shares.
  const first = entries.every((e) => e.shown === 0)
  const step = first ? 1 : (anyReady ? MONTH_FADE_PER_S * Math.max(dtS, 0) : 0)
  for (const e of entries) {
    const target = e.ready ? monthWeight(blend, e.month) : 0
    e.shown += Math.min(Math.max(target - e.shown, -step), step)
  }
  const sum = entries.reduce((s, e) => s + e.shown, 0)
  return entries.map((e) => (sum > 0 ? e.shown / sum : 0))
}


/**
 * The alphas that compose layers drawn one over another, bottom first, into
 * the mix of them by the given shares: each layer's alpha is its share over
 * the shares up to and including it (the bottom's 1).  Cesium's imagery
 * layers blend this way.
 *
 * @param {Array<number>} shares Summing to 1, or all 0
 * @returns {Array<number>}
 */
export function overAlphas(shares) {
  let below = 0
  return shares.map((s) => {
    below += s
    return below > 0 ? s / below : 0
  })
}
