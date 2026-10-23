// The craft the app can fly (Craft.md, drawn), as the panel and the link
// need them before any is flown: code, name, the body each is drawn about
// (`centre`) and the bodies whose panels offer it (`shownAt`).  How each is
// made is in flights.js, loaded the first time one is flown, with the
// integrator behind it: none of it is in the first load.

/** By link code. */
export const FLIGHT_CATALOG = {
  tli: {code: 'tli', name: 'transfer to the Moon', centre: 'earth', shownAt: ['earth', 'moon'], color: 0xffc070},
}


/**
 * @param {string} code
 * @returns {?object} its FLIGHT_CATALOG entry
 */
export function flightOf(code) {
  return FLIGHT_CATALOG[code] ?? null
}
