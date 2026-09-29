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
