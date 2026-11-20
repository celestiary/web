#!/usr/bin/env bun
// A HiPS survey's coverage for its manifest (js/scene/sky/Sky.md, "Coverage"),
// as a MOC in JSON (order → NESTED cells), written into the manifest.
//
//   bun tools/hips/coverage.mjs footprints <manifest.json> [--order 8] [--pad 0.05]
//     From the manifest's `footprints` (each image's centre, field and the
//     position angle of its up, from the press image's AVM): Rubin's First
//     Look, while CDS's MocServer answers no MOC from the sandbox.
//   bun tools/hips/coverage.mjs fits <manifest.json> <Moc.fits URL or file> [--order 8]
//     From the survey's own Moc.fits (NUNIQ), degraded to the order: ESASky's.
//
// Prints the cell count and the sky fraction, to set against the survey's
// moc_sky_fraction.

import fs from 'node:fs'
import {footprintCells} from '../../js/scene/sky/footprint.js'
import {mocFromCells} from '../../js/scene/sky/hips.js'


const args = process.argv.slice(2)
const flag = (name, d) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : d
}
const [mode, manifestPath, source] = args
const order = flag('--order', 8)


/**
 * The NUNIQ cells of a MOC FITS file, at their own orders.
 *
 * @param {Buffer} buf
 * @returns {Array<{order: number, pix: number}>}
 */
function readMocFits(buf) {
  let at = 0
  const header = () => {
    const cards = {}
    for (;;) {
      const block = buf.toString('ascii', at, at + 2880)
      at += 2880
      for (let k = 0; k < 2880; k += 80) {
        const card = block.slice(k, k + 80)
        if (card.startsWith('END')) {
          return cards
        }
        if (card[8] === '=') {
          cards[card.slice(0, 8).trim()] = card.slice(10).split('/')[0].trim().replace(/'/g, '').trim()
        }
      }
    }
  }
  header()
  const table = header()
  const width = Number(table.NAXIS1)
  const rows = Number(table.NAXIS2)
  const out = []
  for (let r = 0; r < rows; r++) {
    const u = width === 8 ? Number(buf.readBigInt64BE(at + (r * 8))) : buf.readInt32BE(at + (r * 4))
    const o = Math.floor((Math.log2(u / 4)) / 2)
    out.push({order: o, pix: u - (4 * (4 ** o))})
  }
  return out
}


const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const cells = new Set
if (mode === 'footprints') {
  const pad = flag('--pad', 0.05)
  for (const f of manifest.footprints) {
    for (const pix of footprintCells(order, f, pad)) {
      cells.add(pix)
    }
  }
} else if (mode === 'fits') {
  const buf = /^https?:/.test(source) ? Buffer.from(await (await fetch(source)).arrayBuffer()) : fs.readFileSync(source)
  for (const {order: o, pix} of readMocFits(buf)) {
    if (o <= order) {
      const n = 4 ** (order - o)
      for (let p = pix * n; p < (pix + 1) * n; p++) {
        cells.add(p)
      }
    } else {
      cells.add(Math.floor(pix / (4 ** (o - order))))
    }
  }
} else {
  console.error('usage: coverage.mjs footprints|fits <manifest.json> [Moc.fits] [--order 8]')
  process.exit(1)
}
manifest.coverage = mocFromCells(order, cells)
// Arrays of numbers on one line each.
const json = JSON.stringify(manifest, null, 2)
    .replace(/\[\s+([-\d.e,\s]+?)\s+\]/g, (m, inner) => `[${inner.split(/,\s*/).join(', ')}]`)
fs.writeFileSync(manifestPath, `${json}\n`)
console.log(`${cells.size} cells at order ${order}: ${(cells.size / (12 * (4 ** order))).toExponential(3)} of the sky`)
