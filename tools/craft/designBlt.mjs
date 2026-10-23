#!/usr/bin/env bun
// Designs the ballistic lunar transfers the app offers (Craft.md, the
// ballistic lunar transfer): one arriving each week over the span below,
// each from a 185 km parking orbit to a 100 km perilune, nearly parabolic
// at the Moon (C3 −0.02 km²/s²), in the full force model on VSOP87C and the
// lunar theory (blt.js designBlt).  A design takes about 2 s, so the app
// flies these from their departure states rather than designing them.
//
//   bun tools/craft/designBlt.mjs > public/data/blt.json
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {designBlt} from '../../js/scene/craft/blt.js'
import {appBodies} from '../../js/scene/craft/bodies.js'
import {geocentricTracks} from '../../js/scene/craft/ephemeris.js'


// Arrivals, JDE (TT): 2026 Nov 1 to 2028 Dec 31, every 7 days.
const FIRST = 2461345.5
const LAST = 2462137.5
const EVERY = 7
const PARAMS = {height: 100e3, parking: 185e3, c3: -2e4}
// The departure and its state as computed: the arc grows an error ten
// thousand-fold over its months, and a departure rounded to a microday
// (0.09 s, a kilometre along the path at perigee) arrived 16,000 km off.
const round = (x, digits) => Number(x.toFixed(digits))

const vsop = await vsop87cLoader
const tracks = geocentricTracks(appBodies(vsop))
const designs = []
for (let arrival = FIRST; arrival <= LAST; arrival += EVERY) {
  const d = designBlt(tracks, arrival, PARAMS)
  if (d) {
    designs.push({arrival, departure: d.departure, days: d.days, state: d.state, dv: round(d.dv, 1),
      c3: round(d.c3, 0), apogee: Math.round(d.apogee)})
  }
  console.error(arrival, d ? `${d.days.toFixed(1)} d` : 'none')
}
process.stdout.write(`${JSON.stringify({
  source: 'tools/craft/designBlt.mjs: blt.js designBlt on VSOP87C and the lunar theory',
  params: {...PARAMS, first: FIRST, last: LAST, every: EVERY},
  designs,
})}\n`)
