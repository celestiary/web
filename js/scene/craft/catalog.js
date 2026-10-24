// The craft the app can fly (Craft.md, drawn), as the panel and the link
// need them before any is flown: code, name, the body each is drawn about
// (`centre`) and the bodies whose panels offer it (`shownAt`).  How each is
// made is in flights.js, loaded the first time one is flown, with the
// integrator behind it: none of it is in the first load.  One with `data`
// is made from that file, loaded the first time it's flown; one that
// `needsVsop` waits for VSOP87C itself, not its stand-in (a long arc is
// chaotic enough that the stand-in's Sun, 0.007° off, moves its arrival).

/** The ballistic lunar transfers designed (tools/craft/designBlt.mjs). */
export const BLT_DATA_URL = 'data/blt.json'

/** By link code. */
export const FLIGHT_CATALOG = {
  tli: {code: 'tli', name: 'transfer to the Moon', centre: 'earth', shownAt: ['earth', 'moon'], color: 0xffc070},
  blt: {code: 'blt', name: 'ballistic lunar transfer', centre: 'earth', shownAt: ['earth', 'moon'], color: 0x9fe870,
    data: BLT_DATA_URL, needsVsop: true},
}


/**
 * @param {string} code
 * @returns {?object} its FLIGHT_CATALOG entry
 */
export function flightOf(code) {
  return FLIGHT_CATALOG[code] ?? null
}
