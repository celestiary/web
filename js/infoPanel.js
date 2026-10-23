import Measure from '@pablo-mayrgundter/measure.js'
import {capitalize} from './utils.js'


/**
 * The info panel's parts as HTML (design/UI.md, "The info panel, in tiers"):
 * a head (name, kind, one fact), rows of label and value, and sections that
 * open on request.  Pure strings, so the panel's structure is tested without
 * a DOM; ControlPanel puts them in the page and wires them.
 */


/** The fold control's chevron, and the phone sheet's grabber. */
const CHEVRON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
  '<path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>'


/**
 * @param {string} s
 * @returns {string} s with HTML's specials escaped, for text from data
 */
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}


/**
 * The panel around its parts.  `data-prop="info"` names it for the link's
 * `info:` token, whose `closed` folds it to its head.
 *
 * @param {{name: string, kind?: string, fact?: string}} head
 * @param {string} body the rows and sections, HTML
 * @returns {string}
 */
export function panelHtml(head, body) {
  const kind = head.kind ? `<span class="info-badge">${esc(head.kind)}</span>` : ''
  const fact = head.fact ? `<span class="info-fact">${esc(head.fact)}</span>` : ''
  return '<section class="info" data-prop="info">\n' +
    '<div class="info-grabber" aria-hidden="true"></div>\n' +
    '<header class="info-head">' +
    `<div class="info-id"><h2 class="info-name">${esc(head.name)}</h2>` +
    `${kind || fact ? `<div class="info-kind">${kind}${fact}</div>` : ''}</div>` +
    `<button class="info-fold" type="button" aria-expanded="true" aria-label="Fold the panel">${CHEVRON}</button>` +
    '</header>\n' +
    `<div class="info-body">\n${body}</div>\n` +
    '</section>\n'
}


/**
 * One fact: its label in words, its value in mono, the unit quiet.
 *
 * @param {string} label
 * @param {string} value already formatted
 * @param {string} [unit]
 * @returns {string} a `<div>` for a `<dl class="info-rows">`
 */
export function rowHtml(label, value, unit = '') {
  const u = unit ? `<span class="info-unit">${esc(unit)}</span>` : ''
  return `<div class="info-row"><dt>${esc(label)}</dt><dd>${esc(value)}${u}</dd></div>\n`
}


/**
 * @param {string} rows rowHtml's, joined
 * @param {string} [extraClass]
 * @returns {string} the rows as a list, or '' for none
 */
export function rowsHtml(rows, extraClass = '') {
  return rows ? `<dl class="info-rows${extraClass ? ` ${extraClass}` : ''}">\n${rows}</dl>\n` : ''
}


/**
 * A section that opens on request: its title, what it holds while shut, and
 * its content.  Named by `key` for the link's `info:` token.
 *
 * @param {string} key its place in the props (`orbit`, `atmosphere`), or a
 *     panel name (`physical`, `space`, `more`)
 * @param {string} title
 * @param {string} peek what it holds, shown beside the title
 * @param {string} content HTML
 * @param {boolean} [open] whether it starts open
 * @returns {string} '' for no content
 */
export function sectionHtml(key, title, peek, content, open = false) {
  if (!content) {
    return ''
  }
  return `<details class="info-section" data-prop="${esc(key)}" data-default-open="${open}"${open ? ' open' : ''}>` +
    `<summary><span class="info-section-title">${esc(title)}</span>` +
    `${peek ? `<span class="info-peek">${esc(peek)}</span>` : ''}</summary>\n` +
    `<div class="info-section-body">\n${content}</div></details>\n`
}


/**
 * Descriptor fields shown elsewhere, or that are for the renderer: a
 * spacecraft's model, attitude and trajectory are drawing instructions
 * (js/scene/models.md), not facts about it.
 */
const NOT_SHOWN = new Set(['name', 'parent', 'type', 'apparentMagnitude', 'colorIndex', 'has_locations', 'system',
  'model', 'attitude', 'trajectory'])


/** Words for the descriptors' field names. */
const LABELS = {
  axialInclination: 'Axial tilt',
  siderealRotationPeriod: 'Day (sidereal)',
  siderealOrbitPeriod: 'Year (sidereal)',
  equatorialGravity: 'Surface gravity',
  escapeVelocity: 'Escape velocity',
  spectralType: 'Class',
  innerRadius: 'Inner radius',
  outerRadius: 'Outer radius',
  rayleighScaleHeight: 'Rayleigh scale height',
  mieScaleHeight: 'Mie scale height',
  mieCoeff: 'Mie coefficient',
  miePolarity: 'Mie polarity',
  sunIntensity: 'Sun intensity',
  zenithMag: 'Zenith magnitude',
  referencePlane: 'Reference plane',
  referencePole: 'Reference pole',
  apsidalPeriod: 'Apsidal period',
  nodalPeriod: 'Nodal period',
  periodOf: 'Period of',
}


/**
 * @param {string} key a descriptor field, camelCase or snake_case
 * @returns {string} it in words, sentence case
 */
export function labelOf(key) {
  if (LABELS[key]) {
    return LABELS[key]
  }
  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return capitalize(words)
}


/**
 * @param {number} x
 * @param {number} [maxDigits] after the point
 * @returns {string} grouped by thousands
 */
export function grouped(x, maxDigits = 2) {
  return Number(x).toLocaleString('en-US', {maximumFractionDigits: maxDigits})
}


/**
 * @param {*} v a number, a numeric string or a Measure
 * @returns {number} its scalar in its own unit
 */
function scalarOf(v) {
  return Number(v instanceof Measure ? v.scalar : v)
}


/**
 * @param {*} v a length, a Measure in metres
 * @returns {{value: string, unit: string}} in km
 */
export function km(v) {
  const m = v instanceof Measure ? Number(v.convertTo(Measure.Magnitude.UNIT).scalar) : Number(v)
  return {value: grouped(m / 1000, m < 1e7 ? 1 : 0), unit: 'km'}
}


/**
 * A value as the panel shows it.  Lengths and periods come as Measures
 * (reify.js); the descriptors give densities in g/cm³, gravity in m/s²,
 * velocities in km/s and angles in degrees.
 *
 * @param {string} key the field
 * @param {*} val
 * @param {(s: number) => string} duration seconds as `1d 18h 27m`
 * @param {(x: number) => string} sci mass as `5.9722 × 10²⁴`
 * @returns {{value: string, unit?: string}|null} null for an object or list
 */
export function valueOf(key, val, duration, sci) {
  if (val === null || val === undefined) {
    return null
  }
  if (val instanceof Measure) {
    switch (key) {
      case 'mass': return {value: sci(Number(val.convertTo(Measure.Magnitude.KILO).scalar)), unit: 'kg'}
      case 'siderealOrbitPeriod':
      case 'siderealRotationPeriod': return {value: duration(scalarOf(val))}
      default:
        if (val.unit === Measure.Unit.METER) {
          return km(val)
        }
        return {value: String(val)}
    }
  }
  if (typeof val === 'object') {
    return null
  }
  switch (key) {
    case 'siderealOrbitPeriod':
    case 'siderealRotationPeriod': return {value: duration(Number(val))}
    case 'density': return typeof val === 'number' ? {value: String(val), unit: 'g/cm³'} : {value: String(val)}
    case 'equatorialGravity': return {value: String(val), unit: 'm/s²'}
    case 'escapeVelocity': return {value: String(val), unit: 'km/s'}
    case 'axialInclination': return {value: `${val}°`}
    default: return {value: String(val)}
  }
}


/**
 * The rows of an object's plain fields, with its nested objects and lists
 * flattened to one line each (`ra 268.1, dec 64.5`).
 *
 * @param {object} obj
 * @param {(s: number) => string} duration
 * @param {(x: number) => string} sci
 * @param {Set<string>} [skip] fields not to list
 * @returns {string} rowHtml's, joined
 */
export function fieldRowsHtml(obj, duration, sci, skip = new Set) {
  let html = ''
  for (const [key, val] of Object.entries(obj ?? {})) {
    if (skip.has(key) || NOT_SHOWN.has(key) || key.startsWith('texture_')) {
      continue
    }
    const v = valueOf(key, val, duration, sci)
    if (v) {
      html += rowHtml(labelOf(key), v.value, v.unit)
    } else if (val && typeof val === 'object') {
      const line = flatLine(val, duration, sci)
      if (line) {
        html += rowHtml(labelOf(key), line)
      }
    }
  }
  return html
}


/**
 * @param {object|Array} val
 * @param {(s: number) => string} duration
 * @param {(x: number) => string} sci
 * @returns {string} its fields on one line
 */
function flatLine(val, duration, sci) {
  if (Array.isArray(val)) {
    return val.map((x) => (x && typeof x === 'object' ? flatLine(x, duration, sci) : String(x))).join(', ')
  }
  return Object.entries(val).map(([k, x]) => {
    const v = valueOf(k, x, duration, sci)
    const text = v ? `${v.value}${v.unit ? ` ${v.unit}` : ''}` : flatLine(x, duration, sci)
    return `${labelOf(k).toLowerCase()} ${text}`
  }).join(', ')
}


/**
 * @param {string} type the descriptor's (`planet`, `moon`, `star`)
 * @param {string} name
 * @returns {string} the kind, as the badge says it
 */
export function kindOf(type, name) {
  if (name === 'pluto') {
    return 'Dwarf planet'
  }
  return type ? capitalize(type) : ''
}


/**
 * The links to a body's system (its moons, a star's planets).
 *
 * @param {string[]} names
 * @param {string} pathPrefix the body's path, for the links
 * @returns {string} HTML
 */
export function systemHtml(names, pathPrefix) {
  const links = names.map((n) => `<li><a class="info-chip" href="#${esc(pathPrefix ? `${pathPrefix}/` : '')}${esc(n)}">` +
    `${esc(capitalize(n))}</a></li>`).join('')
  return links ? `<ul class="info-chips">${links}</ul>\n` : ''
}
