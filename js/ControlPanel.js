import Measure from '@pablo-mayrgundter/measure.js'
import * as collapsor from './collapsor.js'
import {elementRows, elementsOfDate} from './scene/orbitElements.js'
import {CURVE_COLORS, rotationCurveSvg} from './scene/rotationCurve.js'
import {spectralTypeName} from './scene/stellar.js'
import {LIGHTYEAR_METER} from './shared.js'
import {capitalize} from './utils.js'


/** How often the orbit list's values follow the date, ms. */
const ORBIT_REFRESH_MS = 250

/** The elements' reference planes, as the orbit list names them. */
const PLANE_NAMES = {
  ecliptic: 'the ecliptic and equinox of J2000',
  eclipticOfDate: 'the ecliptic and equinox of the date',
  Laplace: 'the Laplace plane, from its node on the ICRF equator',
  equator: 'the planet\'s equator, from its node on the ICRF equator',
}

/** SPARC's Hubble types, by T (Lelli, McGaugh & Schombert 2016, Table 1). */
const GALAXY_TYPES = ['S0', 'Sa', 'Sab', 'Sb', 'Sbc', 'Sc', 'Scd', 'Sd', 'Sdm', 'Sm', 'Im', 'BCD']


/** */
export default class ControlPanel {
  /**
   * @param {object} containerElt
   * @param {object} loader
   */
  constructor(containerElt, loader) {
    this.containerElt = containerElt
    this.loader = loader
    /**
     * The orbit list's link to the scene (Celestiary sets it): `jde()`, the
     * date, and `select(body, key)`, which lights an element on the body's
     * orbit, or with a null key hides the diagram.
     */
    this.orbitHooks = null
    // The listed body, its pinned element, and when the values last ran.
    this._orbit = null
  }


  /**
   * @param {string} path
   * @returns {object}
   */
  getPathTarget(path) {
    return path[path.length - 1]
  }


  /**
   * Renders the recursive info tree for the target body into `containerElt`.
   * The breadcrumb path itself is now rendered by the React SearchBar component
   * (`js/ui/SearchBar.jsx`) from `store.committedPath`.
   *
   * @param {string[]} path
   */
  showNavDisplay(path) {
    const target = this.loader.loaded[this.getPathTarget(path)]
    if (!target || typeof target !== 'object') {
      return
    }
    const pathPrefix = path.join('/')
    let html = '<ul>\n'
    html += this.showInfoRecursive(target, pathPrefix, false, false)
    html += '</ul>\n'
    this._clearOrbit()
    this.containerElt.innerHTML = html
    collapsor.makeCollapsable(this.containerElt)
    this._wireOrbit(target)
  }


  /**
   * The orbit's six elements, of the date, each lighting its part of the
   * orbit's diagram in the scene when hovered or clicked (orbitDiagram.js;
   * DESIGN.md "Orbital elements").  The other fields of the block follow,
   * as the rest of the panel shows them.
   *
   * @param {object} body the body's props
   * @param {string} pathPrefix
   * @returns {string} the list's HTML, an <li>'s content
   */
  orbitListHtml(body, pathPrefix) {
    const orbit = body.orbit
    const el = elementsOfDate(body.name, orbit, this.orbitHooks?.jde() ?? J2000_JDE)
    if (!el) {
      return `<ul class="collapsed">\n${this.showInfoRecursive(orbit, pathPrefix, false, false)}</ul>\n`
    }
    let html = `<ul class="collapsed orbit-elements" title="Hover or click an element to see it on the orbit">\n`
    for (const row of elementRows(el)) {
      const color = `#${row.color.toString(16).padStart(6, '0')}`
      html += `<li class="orbit-element" data-element="${row.key}" tabindex="0">` +
        `<span class="orbit-swatch" style="color: ${color}">■</span> <b>${row.symbol}</b> ${row.name}: ` +
        `<span class="orbit-value">${row.value}</span></li>\n`
    }
    html += `<li>of the date, in ${PLANE_NAMES[el.plane]}</li>\n`
    const rest = {}
    for (const [key, val] of Object.entries(orbit)) {
      if (!ORBIT_LISTED.has(key)) {
        rest[key] = val
      }
    }
    html += this.showInfoRecursive(rest, pathPrefix, false, false)
    html += '</ul>\n'
    return html
  }


  /**
   * Hook the orbit list's elements to the scene: hover lights one, a click
   * pins it (and a second unpins), and leaving goes back to the pinned one.
   *
   * @param {object} body the body's props
   */
  _wireOrbit(body) {
    const list = this.containerElt.querySelector?.('.orbit-elements')
    if (!list || !this.orbitHooks) {
      return
    }
    const state = {body, list, pinned: null, lit: null, ranMs: 0}
    this._orbit = state
    const light = (key) => {
      state.lit = key
      for (const li of list.querySelectorAll('.orbit-element')) {
        li.classList.toggle('lit', li.dataset.element === key)
        li.classList.toggle('pinned', li.dataset.element === state.pinned)
      }
      this.orbitHooks.select(body.name, key)
    }
    for (const li of list.querySelectorAll('.orbit-element')) {
      const key = li.dataset.element
      const toggle = () => {
        state.pinned = state.pinned === key ? null : key
        light(state.pinned ?? key)
      }
      li.addEventListener('pointerenter', () => light(key))
      li.addEventListener('pointerleave', () => light(state.pinned))
      li.addEventListener('focus', () => light(key))
      li.addEventListener('blur', () => light(state.pinned))
      li.addEventListener('click', toggle)
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          toggle()
        }
      })
    }
    // Folding the list away puts the diagram away.
    list.previousSibling?.addEventListener?.('click', () => {
      if (list.classList.contains('collapsed')) {
        state.pinned = null
        light(null)
      }
    })
  }


  /** Put away the last body's diagram, as the panel moves on. */
  _clearOrbit() {
    if (this._orbit) {
      this.orbitHooks?.select(this._orbit.body.name, null)
      this._orbit = null
    }
  }


  /**
   * Each frame: the orbit list's values follow the date, a few times a
   * second while it's open.
   *
   * @param {number} nowMs
   */
  frame(nowMs) {
    const state = this._orbit
    if (!state || !this.orbitHooks || nowMs - state.ranMs < ORBIT_REFRESH_MS) {
      return
    }
    state.ranMs = nowMs
    if (!state.list.isConnected || state.list.classList.contains('collapsed')) {
      return
    }
    const el = elementsOfDate(state.body.name, state.body.orbit, this.orbitHooks.jde())
    if (!el) {
      return
    }
    const values = Object.fromEntries(elementRows(el).map((r) => [r.key, r.value]))
    for (const li of state.list.querySelectorAll('.orbit-element')) {
      const span = li.querySelector('.orbit-value')
      const value = values[li.dataset.element]
      if (span && value !== undefined && span.textContent !== value) {
        span.textContent = value
      }
    }
  }


  /**
   * Renders a compact info summary for a catalog star (no JSON descriptor).
   * Used by the search-preview mechanism when the highlighted/selected entry
   * is a star rather than a body in `loader.loaded`.
   *
   * @param {object} preview {hipId, displayName, star}
   */
  showStarPreview(preview) {
    if (!preview || !preview.star) {
      return
    }
    const {hipId, star} = preview
    const specClass = spectralTypeName(star)
    const distanceLy = Math.sqrt(
        (star.x * star.x) + (star.y * star.y) + (star.z * star.z)) /
        LIGHTYEAR_METER
    const parts = []
    parts.push('<ul>')
    parts.push(`<li>HIP: ${hipId}</li>`)
    parts.push(`<li>star class: ${specClass}</li>`)
    parts.push(`<li>absolute magnitude: ${star.absMag.toFixed(2)}</li>`)
    parts.push(`<li>distance: ${distanceLy.toFixed(2)} ly</li>`)
    parts.push('</ul>')
    this.containerElt.innerHTML = parts.join('\n')
  }


  /**
   * A SPARC galaxy's summary (js/scene/Galaxies.md), and its rotation curve
   * against its baryons' once the curves are in (rotationCurve.js).
   *
   * @param {object} galaxy Its record (Galaxies.js)
   * @param {?object} galaxies Galaxies, for its curve
   */
  showGalaxyPreview(galaxy, galaxies) {
    if (!galaxy?.row) {
      return
    }
    const g = galaxy.row
    const m = galaxy.meta
    const parts = ['<ul>']
    parts.push(`<li>type: ${GALAXY_TYPES[g.T] ?? g.T}${g.rc3?.type ? ` (RC3 ${g.rc3.type.trim()})` : ''}</li>`)
    parts.push(`<li>distance: ${g.D} ± ${g.eD} Mpc</li>`)
    parts.push(`<li>inclination: ${g.inc}°, position angle: ${galaxy.place.paMeasured ? `${galaxy.place.pa}°` :
      'not measured'}</li>`)
    parts.push(`<li>luminosity: ${(galaxy.spec.L / 1e9).toPrecision(3)}e9 L☉ in V (${m.luminositySource}), ` +
      `${g.L36}e9 L☉ at 3.6 µm</li>`)
    parts.push(`<li>disc scale length: ${g.Rdisk} kpc</li>`)
    if (g.Vflat > 0) {
      parts.push(`<li>V<sub>flat</sub>: ${g.Vflat} ± ${g.eVflat} km/s</li>`)
    }
    parts.push(`<li>HI: ${g.MHI}e9 M☉</li>`)
    parts.push('</ul>')
    parts.push('<div class="galaxy-curve"></div>')
    this.containerElt.innerHTML = parts.join('\n')
    galaxies?.curve?.(galaxy.id).then((curve) => {
      const slot = this.containerElt.querySelector('.galaxy-curve')
      if (slot && curve) {
        slot.innerHTML = `<div>rotation curve: <span style="color: ${CURVE_COLORS.observed}">●</span> observed, ` +
          `<span style="color: ${CURVE_COLORS.baryons}">━</span> stars and gas alone</div>${rotationCurveSvg(curve)}`
      }
    }).catch(() => {/* No curve: the summary stands. */})
  }


  /**
   * @param {object} obj
   * @param {string} pathPrefix
   * @param {boolean} isArray
   * @param {boolean} isSystem
   * @returns {string}
   */
  showInfoRecursive(obj, pathPrefix, isArray, isSystem) {
    /**
     * @param {number} num
     * @returns {string}
     */
    function cleanZeros(num) {
      const str = `${num}`
      return str.replace(/0000+\d+/, ' ')
    }
    let html = ''
    for (const prop in obj) {
      if (prop === 'name' || prop === 'parent' || prop.startsWith('texture_') ||
         prop === 'apparentMagnitude' || prop === 'colorIndex') {
        continue
      }
      if (Object.prototype.hasOwnProperty.call(obj, prop)) {
        let val = obj[prop]
        if (prop === 'system' && typeof val === 'object' && Array.isArray(val) && val.length === 0) {
          continue
        }
        html += '<li>'
        if (!isArray) {
          let prettyName = prop
          switch (prop) {
            case 'axialInclination': prettyName = 'tilt'; break
            case 'siderealRotationPeriod': prettyName = 'rotation period'; break
            case 'spectralType': prettyName = 'star class'; break
            default:
          }
          html += `${prettyName }: `
        }
        if (val instanceof Measure) {
          switch (prop) {
            case 'radius': val = val.convertTo(Measure.Magnitude.KILO); break
            case 'mass': val = `${sci(val.convertTo(Measure.Magnitude.KILO).scalar)} kg`; break
            case 'semiMajorAxis':
              // TODO
              if (typeof val.scalar === 'string') {
                val.scalar = parseFloat(val.scalar)
              }
              val.scalar = val.scalar.toExponential(4)
              val = val.toString()
              break
            case 'siderealOrbitPeriod':
              val = secsToYDHMS(val.scalar)
              break
            case 'siderealRotationPeriod':
              val = secsToYDHMS(val.scalar)
              break
            default:
          }
          html += cleanZeros(val)
        } else if (val instanceof Array) {
          if (prop === 'system') {
            html += '<ol>\n'
          } else {
            html += '<ol class="collapsed">\n'
          }
          html += this.showInfoRecursive(val, pathPrefix, true, prop === 'system')
          html += '</ol>\n'
        } else if (prop === 'orbit' && obj.name && val instanceof Object) {
          html += this.orbitListHtml(obj, pathPrefix)
        } else if (val instanceof Object) {
          html += '<ul class="collapsed">\n'
          html += this.showInfoRecursive(val, pathPrefix, false, false)
          html += '</ul>\n'
        } else {
          if (isSystem) {
            let path = pathPrefix
            if (pathPrefix.length > 0) {
              path += '/'
            }
            path += val
            html += `<a href="#${ path }">`
            html += capitalize(val)
          } else {
            switch (prop) {
              case 'spectralType': {
                val = spectralTypeName(obj)
                break
              }
              case 'equatorialGravity': val = `${val} m/s^2`; break
              case 'escapeVelocity': val = `${val} km/s`; break
              // The descriptors give densities in g/cm³.
              case 'density': val = typeof val === 'number' ? `${val} g/cm^3` : val; break
              case 'axialInclination': val = `${val }°`; break
              default:
            }
            html += val
          }
          if (isSystem) {
            html += '</a>'
          }
        }
        html += '</li>\n'
      }
    }
    html = html.replaceAll('^2', '²')
    html = html.replaceAll('^3', '³')
    return html
  }
}


/** The orbit block's fields the element list shows itself. */
const ORBIT_LISTED = new Set(['semiMajorAxis', 'eccentricity', 'inclination', 'longitudeOfAscendingNode',
  'longitudeOfPericenter', 'argumentOfPericenter', 'meanLongitude', 'meanAnomaly'])

/** J2000 as a Julian Ephemeris Day: the orbit list's date with no clock. */
const J2000_JDE = 2451545.0

const SUPERSCRIPTS = {'0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸',
  '9': '⁹', '-': '⁻'}


/**
 * @param {number} x
 * @param {number} [digits] significant
 * @returns {string} e.g. 5.9722 × 10²⁴
 */
export function sci(x, digits = 5) {
  const [mantissa, exp] = x.toExponential(digits - 1).split('e')
  const power = String(Number(exp)).split('').map((c) => SUPERSCRIPTS[c]).join('')
  return `${mantissa} × 10${power}`
}


/**
 * @param {number|string} s
 * @returns {string}
 */
function secsToYDHMS(s) {
  const secsPerYear = 86400 * 365
  let str = ''
  const years = parseInt(s / secsPerYear)
  if (years > 0) {
    s -= years * secsPerYear
    str += `${years}y`
  }
  const days = parseInt(s / 86400)
  if (days > 0) {
    s -= days * 86400
    str += ` ${days}d`
  }
  const hours = parseInt(s / 3600)
  if (hours > 0) {
    s -= hours * 3600
    str += ` ${hours}h`
  }
  const minutes = parseInt(s / 60)
  if (minutes > 0) {
    s -= minutes * 60
    str += ` ${minutes}m`
  }
  const seconds = parseInt(s)
  if (seconds > 0) {
    str += ` ${seconds}s`
  }
  return str
}
