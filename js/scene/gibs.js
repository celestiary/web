import {setCreditSource} from '../credits.js'


/**
 * NASA GIBS's credit in the credits footer (credits.js), while its imagery
 * is drawn: Earth's clouds from its daily mosaics (clouds/CloudShell.js;
 * Planet.md, "Clouds") and the night lights of Earth's Cesium layer, VIIRS
 * Black Marble (CesiumLayers._creditNightLights; CESIUM.md).  One entry for
 * both (setCreditSource), on arrival then fading: GIBS's documentation asks
 * for the acknowledgement ("Data Use Guidance and Acknowledgements",
 * nasa-gibs/gibs-api-docs docs/index.md, 2026-10-28):
 *
 * > We acknowledge the use of imagery provided by services from NASA's
 * > Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data
 * > and Information System (ESDIS).
 *
 * in a client, as a request under NASA's open data policy, not a licence
 * term.  The footer's line is short, "Imagery: NASA GIBS / ESDIS", linked to
 * GIBS's page; the whole acknowledgement is in the credits dialog
 * (credits/catalog.js, GIBS_ACKNOWLEDGEMENT).
 */


export const GIBS_CREDIT_ID = 'nasa-gibs'

export const GIBS_CREDIT = Object.freeze({
  text: 'Imagery: NASA GIBS / ESDIS',
  href: 'https://earthdata.nasa.gov/gibs',
})


/**
 * @param {string} source 'clouds' or 'night-lights'
 * @param {boolean} drawn Whether that layer draws GIBS's imagery now
 */
export function creditGibs(source, drawn) {
  setCreditSource(GIBS_CREDIT_ID, source, drawn, GIBS_CREDIT, {persistence: 'timed'})
}
