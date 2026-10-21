import Measure from '@pablo-mayrgundter/measure.js'
import * as collapsor from './collapsor.js'
import {CODES, ELEMENT_CODES, elementRows, elementsOfDate} from './scene/orbitElements.js'
import {CURVE_COLORS, rotationCurveSvg} from './scene/rotationCurve.js'
import {spectralTypeName} from './scene/stellar.js'
import {LIGHTYEAR_METER} from './shared.js'
import {capitalize} from './utils.js'


/** How often the orbit list's values follow the date, ms. */
const ORBIT_REFRESH_MS = 250

/** What the elements are, as the orbit list says (orbitElements.js `kind`). */
const KIND_NAMES = {
  osculating: 'Osculating elements, of the moment',
  mean: 'Mean elements, of the date',
}

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
     * The orbit list's link to the scene (Celestiary sets it):
     * `elementsOf(body, orbit)`, its elements now (Animation.orbitElements);
     * `elements(body)`, the body's lit element codes, `toggle(body,
     * code)`, `set(body, codes)`, `clearAll()` and `count()`, the bodies lit
     * (Scene's orbit element state); and `preview(body, code)`, a hover's.
     */
    this.orbitHooks = null
    // The listed body and its list, and when the values last ran.
    this._orbit = null
    /**
     * Which of the panel's lists are open, as the user left them, for every
     * body alike, and in the link as the `info:` token (design/URLs.md):
     * `closed`, the whole panel folded; `open` and `shut`, the lists (by
     * their place in the props, `orbit`, `location.coord`) opened or folded
     * against their defaults.
     */
    this.uiState = {closed: false, open: new Set, shut: new Set}
    /** Called when the user opens or folds a list. */
    this.onUiChange = null
    containerElt?.addEventListener?.('click', (ev) => this._onToggle(ev))
  }


  /**
   * Put a link's open and folded lists back (the `info:` token).
   *
   * @param {{closed: boolean, open: Set<string>, shut: Set<string>}} state
   */
  restoreUiState(state) {
    this.uiState = {closed: Boolean(state?.closed), open: new Set(state?.open ?? []), shut: new Set(state?.shut ?? [])}
    this._applyUiState()
  }


  /** Open and fold the drawn lists as uiState has them. */
  _applyUiState() {
    const lists = this.containerElt?.querySelectorAll?.('[data-prop]') ?? []
    for (const list of lists) {
      const key = list.dataset.prop
      list.dataset.collapsedByDefault ??= String(list.classList.contains('collapsed'))
      const byDefault = list.dataset.collapsedByDefault === 'true'
      let collapsed = byDefault
      if (key === 'info') {
        collapsed = this.uiState.closed
      } else if (this.uiState.open.has(key)) {
        collapsed = false
      } else if (this.uiState.shut.has(key)) {
        collapsed = true
      }
      list.classList.toggle('collapsed', collapsed)
      const ctrl = list.previousSibling
      if (ctrl?.classList?.contains('collapsor')) {
        ctrl.innerHTML = collapsed ? '[+]' : '[-]'
      }
    }
  }


  /**
   * After a list's [+] or [-] (collapsor.js has toggled it): keep how it was
   * left, and say so, for the link.
   *
   * @param {Event} ev
   */
  _onToggle(ev) {
    const ctrl = ev.target
    const list = ctrl?.classList?.contains('collapsor') ? ctrl.nextSibling : null
    const key = list?.dataset?.prop
    if (!key) {
      return
    }
    const collapsed = list.classList.contains('collapsed')
    const state = this.uiState
    if (key === 'info') {
      state.closed = collapsed
    } else {
      const byDefault = list.dataset.collapsedByDefault === 'true'
      state.open.delete(key)
      state.shut.delete(key)
      if (collapsed !== byDefault) {
        (collapsed ? state.shut : state.open).add(key)
      }
    }
    this.onUiChange?.()
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
    let html = '<ul data-prop="info">\n'
    html += this.showInfoRecursive(target, pathPrefix, false, false)
    html += '</ul>\n'
    this._endPreview()
    this.containerElt.innerHTML = html
    collapsor.makeCollapsable(this.containerElt)
    this._applyUiState()
    this._wireOrbit(target)
  }


  /**
   * The orbit's six elements, of the date, each lighting its part of the
   * orbit's diagram in the scene (orbitDiagram.js; DESIGN.md "Orbital
   * elements"): a click turns one on or off, and a hover previews it.  The
   * other fields of the block follow, as the rest of the panel shows them.
   *
   * @param {object} body the body's props
   * @param {string} pathPrefix
   * @returns {string} the list's HTML, an <li>'s content
   */
  orbitListHtml(body, pathPrefix) {
    const orbit = body.orbit
    const el = this._elementsOf(body)
    if (!el) {
      return `<ul class="collapsed" data-prop="orbit">\n` +
        `${this.showInfoRecursive(orbit, pathPrefix, false, false, 'orbit')}</ul>\n`
    }
    let html
    const on = this.orbitHooks?.elements?.(body.name) ?? new Set
    html = `<ul class="collapsed orbit-elements" data-prop="orbit" ` +
      `title="Click elements to show them on the orbit, on as many bodies as you like">\n`
    // The lead: what the elements are, and the switches for them all.
    html += `<li class="orbit-lead"><span class="orbit-kind">${kindText(el)}</span>.  Show ` +
      '<button class="orbit-action" data-action="all">all</button> · ' +
      '<button class="orbit-action" data-action="none">none</button>' +
      '<span class="orbit-clear" hidden> · <button class="orbit-action" data-action="clear">' +
      'clear every orbit</button></span></li>\n'
    if (orbit.siderealOrbitPeriod !== undefined) {
      html += `<li>orbit period (sidereal): ${secsToYDHMS(scalar(orbit.siderealOrbitPeriod))}</li>\n`
    }
    for (const row of elementRows(el)) {
      const color = `#${row.color.toString(16).padStart(6, '0')}`
      const code = ELEMENT_CODES[row.key]
      const truePlace = row.trueValue ? ` · <span class="orbit-swatch" style="color: #fff">■</span> ` +
        `<b>${row.trueSymbol}</b> ${row.trueName}: <span class="orbit-true">${row.trueValue}</span>` : ''
      html += `<li class="orbit-element${on.has(code) ? ' on' : ''}" data-element="${row.key}" ` +
        `data-code="${code}" tabindex="0" role="switch" aria-checked="${on.has(code)}">` +
        `<span class="orbit-swatch" style="color: ${color}">■</span> <b>${row.symbol}</b> ${row.name}: ` +
        `<span class="orbit-value">${row.value}</span>${truePlace}</li>\n`
    }
    const rest = {}
    for (const [key, val] of Object.entries(orbit)) {
      if (!ORBIT_LISTED.has(key)) {
        rest[key] = val
      }
    }
    html += this.showInfoRecursive(rest, pathPrefix, false, false, 'orbit')
    html += '</ul>\n'
    return html
  }


  /**
   * Hook the orbit list's elements to the scene: a click (or Enter, or
   * Space) turns one on or off on this body's orbit, and stays so as the
   * panel moves to other bodies, to compare them; a hover or focus previews
   * one.  `all` and `none` set this body's; `clear every orbit`, shown
   * while other bodies have some on, puts them all away.
   *
   * @param {object} body the body's props
   */
  _wireOrbit(body) {
    const list = this.containerElt.querySelector?.('.orbit-elements')
    if (!list || !this.orbitHooks) {
      this._orbit = null
      return
    }
    const hooks = this.orbitHooks
    this._orbit = {body, list, ranMs: 0}
    for (const li of list.querySelectorAll('.orbit-element')) {
      const code = li.dataset.code
      const toggle = () => {
        hooks.toggle(body.name, code)
        this._showOrbitState()
      }
      li.addEventListener('pointerenter', () => hooks.preview(body.name, code))
      li.addEventListener('pointerleave', () => hooks.preview(null, null))
      li.addEventListener('focus', () => hooks.preview(body.name, code))
      li.addEventListener('blur', () => hooks.preview(null, null))
      li.addEventListener('click', toggle)
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          toggle()
        }
      })
    }
    for (const button of list.querySelectorAll('.orbit-action')) {
      button.addEventListener('click', () => {
        const action = button.dataset.action
        if (action === 'clear') {
          hooks.clearAll()
        } else {
          hooks.set(body.name, action === 'all' ? CODES : [])
        }
        this._showOrbitState()
      })
    }
    this._showOrbitState()
  }


  /** Mark the list's elements as the scene has them on. */
  _showOrbitState() {
    const state = this._orbit
    if (!state || !this.orbitHooks) {
      return
    }
    const on = this.orbitHooks.elements(state.body.name)
    for (const li of state.list.querySelectorAll('.orbit-element')) {
      const isOn = on.has(li.dataset.code)
      li.classList.toggle('on', isOn)
      li.setAttribute('aria-checked', String(isOn))
    }
    const clear = state.list.querySelector('.orbit-clear')
    if (clear) {
      clear.hidden = this.orbitHooks.count() - (on.size > 0 ? 1 : 0) <= 0
    }
  }


  /**
   * @param {object} body the body's props
   * @returns {object|null} its elements now: the scene's (osculating for the
   *     planets and the Moon), or its mean elements of J2000 with no scene
   */
  _elementsOf(body) {
    return this.orbitHooks?.elementsOf?.(body.name, body.orbit) ?? elementsOfDate(body.name, body.orbit, J2000_JDE)
  }


  /** End a hover's preview, as the panel moves on. */
  _endPreview() {
    if (this._orbit) {
      this.orbitHooks?.preview(null, null)
    }
  }


  /**
   * Each frame: the orbit list's values follow the date, and its marks the
   * scene's state, a few times a second while it's open.
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
    this._showOrbitState()
    const el = this._elementsOf(state.body)
    if (!el) {
      return
    }
    const kind = state.list.querySelector('.orbit-kind')
    if (kind && kind.textContent !== kindText(el)) {
      kind.textContent = kindText(el)
    }
    const rows = Object.fromEntries(elementRows(el).map((r) => [r.key, r]))
    for (const li of state.list.querySelectorAll('.orbit-element')) {
      const row = rows[li.dataset.element]
      for (const [selector, value] of [['.orbit-value', row?.value], ['.orbit-true', row?.trueValue]]) {
        const span = li.querySelector(selector)
        if (span && value !== undefined && span.textContent !== value) {
          span.textContent = value
        }
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
   * @param {string} [keyPath] obj's place in the body's props, dotted (e.g.
   *     `orbit`), which names its sub-lists for the link's `info:` token
   * @returns {string}
   */
  showInfoRecursive(obj, pathPrefix, isArray, isSystem, keyPath = '') {
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
          const key = subKey(keyPath, prop)
          if (prop === 'system') {
            html += `<ol data-prop="${key}">\n`
          } else {
            html += `<ol class="collapsed" data-prop="${key}">\n`
          }
          html += this.showInfoRecursive(val, pathPrefix, true, prop === 'system', key)
          html += '</ol>\n'
        } else if (prop === 'orbit' && obj.name && val instanceof Object) {
          html += this.orbitListHtml(obj, pathPrefix)
        } else if (val instanceof Object) {
          const key = subKey(keyPath, prop)
          html += `<ul class="collapsed" data-prop="${key}">\n`
          html += this.showInfoRecursive(val, pathPrefix, false, false, key)
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


/**
 * @param {string} keyPath
 * @param {string} prop
 * @returns {string} the dotted path of prop under keyPath
 */
function subKey(keyPath, prop) {
  return keyPath ? `${keyPath}.${prop}` : prop
}


/** The orbit block's fields the element list shows itself. */
const ORBIT_LISTED = new Set(['semiMajorAxis', 'eccentricity', 'inclination', 'longitudeOfAscendingNode',
  'longitudeOfPericenter', 'argumentOfPericenter', 'meanLongitude', 'meanAnomaly', 'siderealOrbitPeriod'])


/**
 * @param {object} el orbitElements.js's form
 * @returns {string} what the elements are and in which frame, the list's lead
 */
function kindText(el) {
  return `${KIND_NAMES[el.kind]}, in ${PLANE_NAMES[el.plane]}`
}


/**
 * @param {number|{scalar: number}} v a number, or a reified Measure
 * @returns {number}
 */
function scalar(v) {
  return Number(v?.scalar ?? v)
}

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
  return str.trim()
}
