#!/usr/bin/env bun
// Designs the Aldrin cyclers the app offers (Craft.md, cyclers): one
// started in each synodic period over the span below, three cycles each
// (6.4 years), on VSOP87C (cycler.js aldrinCycler).  Keeps each cycler's
// dates, from which the app makes its arcs again (Lambert's, a few
// milliseconds), and its flybys for the panel.
//
//   bun tools/craft/designCyclers.mjs > public/data/aldrin.json
import vsop87cLoader from 'vsop87/dist/vsop87c-wasm'
import {SYNODIC_DAYS, aldrinCycler, idealOnCircles} from '../../js/scene/craft/cycler.js'
import {appBodies} from '../../js/scene/craft/bodies.js'
import {heliocentricTracks} from '../../js/scene/craft/ephemeris.js'


// Starts, JDE (TT): 2026 Oct 1 on, a synodic period apart, through 2040.
const FIRST = 2461314.5
const COUNT = 7
const CYCLES = 3
const round = (x, digits) => Number(x.toFixed(digits))

const vsop = await vsop87cLoader
const tracks = heliocentricTracks(appBodies(vsop), ['earth', 'mars'])
const ideal = idealOnCircles()
const cyclers = []
for (let i = 0; i < COUNT; i++) {
  const c = aldrinCycler(tracks, FIRST + (i * SYNODIC_DAYS), CYCLES, ideal)
  if (c) {
    cyclers.push({x: c.x.map((v) => round(v, 4)), cost: Math.round(c.cost),
      flybys: c.flybys.map((f) => ({body: f.body, jde: round(f.jde, 3), vInfIn: Math.round(f.vInfIn),
        vInfOut: Math.round(f.vInfOut), dv: Math.round(f.dv)}))})
  }
  console.error(i, c ? `${Math.round(c.cost)} m/s` : 'none')
}
process.stdout.write(`${JSON.stringify({
  source: 'tools/craft/designCyclers.mjs: cycler.js aldrinCycler on VSOP87C',
  params: {first: FIRST, count: COUNT, cycles: CYCLES},
  ideal: {t: ideal.t, legDays: round(ideal.mars.jde - ideal.t, 2), vInfEarth: Math.round(ideal.vInfEarth),
    vInfMars: Math.round(ideal.mars.vInf), aphelionAU: round(ideal.a * (1 + ideal.e) / 149597870700, 4),
    periodDays: round(ideal.period, 2)},
  cyclers,
})}\n`)
