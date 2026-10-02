#!/usr/bin/env node
// Builds js/scene/iauRotation.json, the IAU WGCCRE rotation models of the
// bodies celestiary draws, from NAIF's text PCK pck00011.tpc, which
// transcribes the WGCCRE 2015 report (Archinal et al. 2018, Celest. Mech.
// Dyn. Astr. 130:22) and its published correction (Phobos), with the 2009
// report's Earth and Moon (the 2015 report gives neither).
//
//   curl -O https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc
//   node tools/iau/pckRotation.mjs pck00011.tpc > js/scene/iauRotation.json
//
// The PCK's form, kept here: for T Julian centuries and d days from J2000
// TDB,
//   α0 = ra[0] + ra[1]·T + ra[2]·T² + Σ raTerms: c·sin(θ_i)
//   δ0 = dec[0] + dec[1]·T + dec[2]·T² + Σ decTerms: c·cos(θ_i)
//   W  = w[0] + w[1]·d + w[2]·d² + Σ wTerms: c·sin(θ_i)
// with θ_i = a + b·T + c·T², the system's i-th "nutation precession" angle
// (`systems`, degrees and degrees per century).  The terms are kept sparse,
// as [coefficient, i].
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'


// celestiary's names, with NAIF ids, and the report each model is from
// where it isn't the 2015 report's own (pck00011.tpc's notes).
const BODIES = {
  mercury: [199],
  venus: [299],
  earth: [399, 'WGCCRE 2009 (Archinal et al. 2011); the 2015 report gives no Earth model'],
  moon: [301, 'WGCCRE 2009 (Archinal et al. 2011); the 2015 report gives no Moon model'],
  mars: [499],
  phobos: [401, 'WGCCRE 2015 as corrected (Archinal et al., "Correction to: Report of the IAU WGCCRE: 2015")'],
  deimos: [402],
  jupiter: [599],
  io: [501],
  europa: [502],
  ganymede: [503],
  callisto: [504],
  saturn: [699],
  tethys: [603],
  dione: [604],
  rhea: [605],
  titan: [606],
  iapetus: [608],
  janus: [610],
  uranus: [799],
  titania: [703],
  oberon: [704],
  neptune: [899],
  triton: [801],
  proteus: [808],
  pluto: [999],
  charon: [901],
}
const SYSTEM_NAMES = {1: 'mercury', 3: 'earth', 4: 'mars', 5: 'jupiter', 6: 'saturn', 7: 'uranus', 8: 'neptune', 9: 'pluto'}


/**
 * @param {string} text a text PCK
 * @returns {object} kernel variable name → array of numbers
 */
function parsePck(text) {
  const vars = {}
  const data = []
  const re = /\\begindata([\s\S]*?)(?:\\begintext|$)/g
  let m
  while ((m = re.exec(text)) !== null) {
    data.push(m[1])
  }
  const assign = /([A-Z0-9_]+)\s*=\s*(\([^)]*\)|[^\s]+)/g
  for (const block of data) {
    while ((m = assign.exec(block)) !== null) {
      const raw = m[2].replace(/[()]/g, ' ').trim()
      vars[m[1]] = raw.split(/[\s,]+/).filter(Boolean).map((s) => {
        if (s.startsWith('\'')) {
          return s
        }
        return Number(s.replace(/[dD]/, 'e'))
      })
    }
  }
  return vars
}


/**
 * @param {Array<number>} coeffs
 * @returns {Array<Array<number>>} [coefficient, index] for each non-zero one
 */
function sparse(coeffs) {
  return (coeffs || []).map((c, i) => [c, i]).filter(([c]) => c !== 0)
}


const pckPath = process.argv[2]
const text = readFileSync(pckPath, 'utf8')
const vars = parsePck(text)
const out = {
  source: 'IAU WGCCRE 2015 (Archinal et al. 2018, Celest. Mech. Dyn. Astr. 130:22, doi:10.1007/s10569-017-9805-5), ' +
    'as transcribed in NAIF\'s pck00011.tpc (2022-12-27); exceptions per body',
  generatedBy: `tools/iau/pckRotation.mjs from pck00011.tpc, md5 ${createHash('md5').update(text).digest('hex')}`,
  form: 'α0 = ra[0] + ra[1]·T + ra[2]·T² + Σ c·sin(θ_i); δ0 = dec[0] + dec[1]·T + dec[2]·T² + Σ c·cos(θ_i); ' +
    'W = w[0] + w[1]·d + w[2]·d² + Σ c·sin(θ_i); terms are [c, i]; θ_i = a + b·T + c·T² from systems; ' +
    'T Julian centuries and d days from J2000 TDB; degrees',
  systems: {},
  bodies: {},
}
const usedSystems = new Set
for (const [name, [id, source]] of Object.entries(BODIES)) {
  const pre = `BODY${id}_`
  const body = {
    naif: id,
    source: source || 'WGCCRE 2015 (Archinal et al. 2018)',
    ra: vars[`${pre}POLE_RA`],
    dec: vars[`${pre}POLE_DEC`],
    w: vars[`${pre}PM`],
  }
  if (!body.ra || !body.dec || !body.w) {
    throw new Error(`no model for ${name} (${id})`)
  }
  const raTerms = sparse(vars[`${pre}NUT_PREC_RA`])
  const decTerms = sparse(vars[`${pre}NUT_PREC_DEC`])
  const wTerms = sparse(vars[`${pre}NUT_PREC_PM`])
  if (raTerms.length + decTerms.length + wTerms.length > 0) {
    const sys = id < 10 ? id : Math.floor(id / 100)
    body.system = SYSTEM_NAMES[sys]
    usedSystems.add(sys)
    body.raTerms = raTerms
    body.decTerms = decTerms
    body.wTerms = wTerms
  }
  out.bodies[name] = body
}
for (const sys of [...usedSystems].sort()) {
  const angles = vars[`BODY${sys}_NUT_PREC_ANGLES`]
  const degree = (vars[`BODY${sys}_MAX_PHASE_DEGREE`] || [1])[0]
  const per = degree + 1
  const list = []
  for (let i = 0; i < angles.length; i += per) {
    const a = angles.slice(i, i + per)
    while (a.length < 3) {
      a.push(0)
    }
    list.push(a)
  }
  out.systems[SYSTEM_NAMES[sys]] = list
}
process.stdout.write(`${JSON.stringify(out, (k, v) => v, 1)
    .replace(/\[\s+([^[\]]*?)\s+\]/g, (s, inner) => `[${inner.replace(/\s+/g, ' ')}]`)}\n`)
