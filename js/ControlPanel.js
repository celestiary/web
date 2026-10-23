import InfoSheet from './infoSheet.js'
import {
  esc, fieldRowsHtml, grouped, kindOf, panelHtml, rowHtml, rowsHtml, sectionHtml, systemHtml, valueOf,
} from './infoPanel.js'
import {ORBIT_FADE_DEFAULT, encodeGuideOrbitToken} from './permalink.js'
import {CODES, ELEMENT_CODES, elementRows, elementsOfDate, formatDistance} from './scene/orbitElements.js'
import {CURVE_COLORS, rotationCurveSvg} from './scene/rotationCurve.js'
import {satelliteFacts} from './scene/satellites/names.js'
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
     * `jd()`, the moment, for the link to the guide; `fade()` and
     * `setFade(f)`, the diagrams' opacity at the far side of their orbits;
     * `elements(body)`, the body's lit element codes, `toggle(body,
     * code)`, `set(body, codes)`, `clearAll()` and `count()`, the bodies lit
     * (Scene's orbit element state); and `preview(body, code)`, a hover's.
     */
    this.orbitHooks = null
    /** Scene.spaceAround, for spaceAround; set by Celestiary. */
    this.spaceHook = null
    /**
     * The three-body orbits' switches (periodicHtml): {pairs, toggle, frame,
     * setFrame, manifolds, setManifolds}.
     */
    this.periodicHooks = null
    // The listed body and its list, and when the values last ran.
    this._orbit = null
    /**
     * Which of the panel's sections are open, as the user left them, for
     * every body alike, and in the link as the `info:` token
     * (design/URLs.md): `closed`, the whole panel folded to its head; `open`
     * and `shut`, the sections (by their place in the props, `orbit`,
     * `atmosphere`, or their panel name, `physical`) opened or folded
     * against their defaults.
     */
    this.uiState = {closed: false, open: new Set, shut: new Set}
    /** Called when the user opens or folds a section. */
    this.onUiChange = null
    if (containerElt?.addEventListener) {
      containerElt.addEventListener('click', (ev) => this._onClick(ev))
      // A <details>' toggle doesn't bubble: hear it on the way down.
      containerElt.addEventListener('toggle', (ev) => this._onToggle(ev), true)
      /** On a phone, the panel is a sheet from the bottom (infoSheet.js). */
      this.sheet = new InfoSheet(containerElt)
    }
  }


  /**
   * Put a link's open and folded sections back (the `info:` token).
   *
   * @param {{closed: boolean, open: Set<string>, shut: Set<string>}} state
   */
  restoreUiState(state) {
    this.uiState = {closed: Boolean(state?.closed), open: new Set(state?.open ?? []), shut: new Set(state?.shut ?? [])}
    this._applyUiState()
  }


  /** Fold the panel, and open and shut its sections, as uiState has them. */
  _applyUiState() {
    const panel = this.containerElt?.querySelector?.('.info')
    if (!panel) {
      return
    }
    panel.classList.toggle('folded', this.uiState.closed)
    panel.querySelector('.info-fold')?.setAttribute('aria-expanded', String(!this.uiState.closed))
    for (const section of panel.querySelectorAll('details[data-prop]')) {
      const open = this._sectionOpen(section.dataset.prop, section.dataset.defaultOpen === 'true')
      if (section.open !== open) {
        section.open = open
      }
    }
  }


  /**
   * @param {string} key a section's
   * @param {boolean} byDefault whether it starts open
   * @returns {boolean} whether it's open, as the user left it
   */
  _sectionOpen(key, byDefault) {
    if (this.uiState.open.has(key)) {
      return true
    }
    if (this.uiState.shut.has(key)) {
      return false
    }
    return byDefault
  }


  /**
   * The head's fold control folds the panel to its head, or opens it.
   *
   * @param {Event} ev
   */
  _onClick(ev) {
    if (!ev.target?.closest?.('.info-fold')) {
      return
    }
    this.uiState.closed = !this.uiState.closed
    this._applyUiState()
    this.onUiChange?.()
  }


  /**
   * After a section opens or shuts: keep how it was left, and say so, for
   * the link.  Also heard for the opens and shuts _applyUiState makes,
   * which change nothing.
   *
   * @param {Event} ev
   */
  _onToggle(ev) {
    const section = ev.target
    const key = section?.dataset?.prop
    if (!key || section.tagName !== 'DETAILS') {
      return
    }
    const byDefault = section.dataset.defaultOpen === 'true'
    if (section.open === this._sectionOpen(key, byDefault)) {
      return
    }
    const state = this.uiState
    state.open.delete(key)
    state.shut.delete(key)
    if (section.open !== byDefault) {
      (section.open ? state.open : state.shut).add(key)
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
   * Show the target body's panel in `containerElt`.  The breadcrumb path is
   * rendered by the React SearchBar component (`js/ui/SearchBar.jsx`) from
   * `store.committedPath`.
   *
   * @param {string[]} path
   */
  showNavDisplay(path) {
    const target = this.loader.loaded[this.getPathTarget(path)]
    if (!target || typeof target !== 'object') {
      return
    }
    this._endPreview()
    this._show(this.bodyPanelHtml(target, path.join('/')))
    this._wireOrbit(target)
    this._wirePeriodic()
  }


  /** @param {string} html the panel, into the page, as the user left it */
  _show(html) {
    this.containerElt.innerHTML = html
    this._applyUiState()
    this.sheet?.shown()
  }


  /**
   * A body's panel (design/UI.md): its head, its key rows, and its sections.
   *
   * @param {object} body the body's props
   * @param {string} pathPrefix its path, for its system's links
   * @returns {string}
   */
  bodyPanelHtml(body, pathPrefix) {
    const isStar = body.type === 'star'
    const v = (key) => valueOf(key, body[key], secsToYDHMS, sci)
    const row = (label, key) => {
      const x = v(key)
      return x ? rowHtml(label, x.value, x.unit) : ''
    }
    const system = Array.isArray(body.system) ? body.system : []
    const orbitPeriod = body.orbit?.siderealOrbitPeriod
    // The summary: what a visitor asks first.
    let summary = isStar ? rowHtml('Class', spectralTypeName(body)) : ''
    summary += row('Radius', 'radius')
    if (isStar) {
      summary += row('Mass', 'mass')
    } else {
      if (body.siderealRotationPeriod !== undefined) {
        summary += rowHtml('Day', periodText(scalar(body.siderealRotationPeriod)))
      }
      if (orbitPeriod !== undefined) {
        summary += rowHtml(body.type === 'planet' ? 'Year' : 'Orbit period', periodText(scalar(orbitPeriod)))
      }
    }
    if (system.length > 0) {
      summary += rowHtml(isStar ? 'Planets' : 'Moons', String(system.length))
    }
    // Physical: the rest of what the body is.
    const physical = (isStar ? row('Day (sidereal)', 'siderealRotationPeriod') : row('Mass', 'mass')) +
      row('Density', 'density') + row('Axial tilt', 'axialInclination') + row('Albedo', 'albedo') +
      row('Surface gravity', 'equatorialGravity') + row('Escape velocity', 'escapeVelocity')
    const more = fieldRowsHtml(body, secsToYDHMS, sci, BODY_LISTED)
    const space = this.spaceAround(body.name)
    let html = rowsHtml(summary)
    if (body.orbit && typeof body.orbit === 'object') {
      const el = this._elementsOf(body)
      html += sectionHtml('orbit', 'Orbit', el ? `${elementRows(el).length} elements` : '',
          this.orbitListHtml(body))
    }
    html += sectionHtml('physical', 'Physical', 'mass, density, gravity', rowsHtml(physical))
    html += sectionHtml('space', 'Space around', space.peek, space.html)
    if (body.rings) {
      html += sectionHtml('rings', 'Rings', '', rowsHtml(fieldRowsHtml(body.rings, secsToYDHMS, sci)))
    }
    if (body.atmosphere) {
      html += sectionHtml('atmosphere', 'Atmosphere', '', rowsHtml(fieldRowsHtml(body.atmosphere, secsToYDHMS, sci)))
    }
    html += sectionHtml('system', isStar ? 'Planets' : 'Moons', String(system.length),
        systemHtml(system, pathPrefix), true)
    html += sectionHtml('more', 'More data', '', rowsHtml(more))
    return panelHtml({name: capitalize(body.name), kind: kindOf(body.type, body.name), fact: this._factOf(body)}, html)
  }


  /**
   * @param {object} body the body's props
   * @returns {string} the head's one fact: how far out it orbits, or a
   *     star's class
   */
  _factOf(body) {
    if (body.type === 'star') {
      return spectralTypeName(body)
    }
    const el = body.orbit ? this._elementsOf(body) : null
    if (!el || !body.parent) {
      return ''
    }
    return `${formatDistance(el.a)} from ${body.parent === 'sun' ? 'the Sun' : capitalize(body.parent)}`
  }


  /**
   * The space around the body (Scene.spaceAround; lagrange.js): its Hill
   * sphere, the collinear Lagrange points it shares with its primary, its
   * synchronous orbit, or why it can't hold one, its orbital regimes
   * (regimes.js) and its three-body orbits (periodicHtml).  The scene draws
   * them for the target, with the orbits.
   *
   * @param {string} name a body's
   * @returns {{html: string, peek: string}} the Space around section's
   *     content ('' for a body with none of them), and what it holds
   */
  spaceAround(name) {
    const s = this.spaceHook?.(name)
    if (!s) {
      return {html: '', peek: ''}
    }
    const pair = s.name ? rowsHtml(this.spaceRowsHtml(s)) : ''
    const regimes = s.regimes?.length ?
      `<div class="info-subhead">Orbital regimes</div>\n${rowsHtml(s.regimes.map(regimeRowHtml).join(''))}` : ''
    const periodic = this.periodicHtml(name)
    const peek = [s.name ? 'Hill sphere, Lagrange points' : '', regimes ? 'regimes' : '',
      periodic ? 'three-body orbits' : ''].filter(Boolean).join(', ')
    return {html: pair + regimes + periodic, peek}
  }


  /**
   * @param {object} s Scene.spaceAround's facts for a body with a pair
   * @returns {string} rows: its Hill sphere, its Lagrange points with its
   *     primary, and its synchronous orbit, or why it can't hold one
   */
  spaceRowsHtml(s) {
    const primary = s.name.split('–')[0]
    const sync = s.sync
    let syncText = 'none: no rotation period'
    if (sync && !sync.why) {
      syncText = `${formatDistance(sync.radius)} from the centre${s.syncName ? ` (${s.syncName})` : ''}`
    } else if (sync?.why === 'inside') {
      syncText = `none: at ${formatDistance(sync.radius)} it would be inside the body`
    } else if (sync?.why === 'beyondHill') {
      syncText = `none: at ${formatDistance(sync.radius)} it would be past the Hill sphere, where ` +
        `the ${primary}'s pull takes it away`
    }
    const note = `<div class="info-row is-note"><dd>Where ${esc(s.secondary)}'s gravity rules.</dd></div>\n`
    return [
      rowHtml('Hill sphere', formatDistance(s.hill)),
      note,
      rowHtml(`${s.name} L1`, formatDistance(s.l1), `toward the ${primary}`),
      rowHtml(`${s.name} L2`, formatDistance(s.l2), 'beyond'),
      rowHtml(`${s.name} L4, L5`, '60°', 'ahead, behind; L3 opposite'),
      rowLongHtml('Synchronous orbit', syncText),
    ].join('')
  }


  /**
   * The three-body orbits at the body's pairs (Scene.periodicPairsOf;
   * periodicOrbits.js), each family a switch, and how they're drawn:
   * turning with the pair, where their shapes read, or fixed in space; and
   * a switch for their invariant manifolds (manifolds.js).  Part of the
   * Space around section, under its own subhead.
   *
   * @param {string} name a body's
   * @returns {string} HTML, or '' for a body with no pairs
   */
  periodicHtml(name) {
    const hooks = this.periodicHooks
    const pairs = hooks?.pairs?.(name) ?? []
    if (pairs.length === 0) {
      return ''
    }
    const sw = (cls, on, data, text, role = 'switch') =>
      `<span class="${cls}${on ? ' on' : ''}" ${data} role="${role}" aria-checked="${on}" tabindex="0">` +
      `${esc(text)}</span>`
    const row = (label, chips) =>
      `<div class="info-row is-long"><dt>${esc(label)}</dt><dd class="info-switches">${chips}</dd></div>\n`
    let rows = pairs.map((p) => row(p.name, p.families.map((f) =>
      sw('periodic-family', f.on, `data-body="${esc(p.body)}" data-code="${esc(f.code)}"`, f.name)).join(''))).join('')
    const frame = hooks.frame?.() ?? 'rotating'
    rows += row('Drawn', sw('periodic-frame', frame === 'rotating', 'data-frame="rotating"', 'turning with the pair',
        'radio') + sw('periodic-frame', frame === 'inertial', 'data-frame="inertial"', 'fixed in space', 'radio'))
    if (hooks.manifolds) {
      // The halos' and Lyapunov orbits' tubes: stable green, unstable red,
      // turning with the pair.
      rows += row('Manifolds', sw('periodic-manifolds', hooks.manifolds(), '', 'stable and unstable tubes'))
    }
    return `<div class="info-subhead">Three-body orbits</div>\n${rowsHtml(rows)}`
  }


  /** Wire the three-body orbits' switches (periodicHtml) to the scene. */
  _wirePeriodic() {
    const hooks = this.periodicHooks
    if (!hooks || !this.containerElt?.querySelectorAll) {
      return
    }
    const mark = (el, on) => {
      el.classList.toggle('on', on)
      el.setAttribute('aria-checked', String(on))
    }
    const act = (el, fn) => {
      el.addEventListener('click', fn)
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          fn()
        }
      })
    }
    for (const el of this.containerElt.querySelectorAll('.periodic-family')) {
      act(el, () => {
        hooks.toggle(el.dataset.body, el.dataset.code)
        mark(el, !el.classList.contains('on'))
      })
    }
    for (const el of this.containerElt.querySelectorAll('.periodic-manifolds')) {
      act(el, () => {
        const on = !el.classList.contains('on')
        hooks.setManifolds?.(on)
        mark(el, on)
      })
    }
    const frames = [...this.containerElt.querySelectorAll('.periodic-frame')]
    for (const el of frames) {
      act(el, () => {
        hooks.setFrame(el.dataset.frame)
        frames.forEach((f) => mark(f, f === el))
      })
    }
  }


  /**
   * The orbit's six elements, of the date, each lighting its part of the
   * orbit's diagram in the scene (orbitDiagram.js; DESIGN.md "Orbital
   * elements"): a click turns one on or off, and a hover previews it.  The
   * other fields of the block follow as rows.
   *
   * @param {object} body the body's props
   * @returns {string} the orbit section's content
   */
  orbitListHtml(body) {
    const orbit = body.orbit
    const el = this._elementsOf(body)
    if (!el) {
      return rowsHtml(fieldRowsHtml(orbit, secsToYDHMS, sci))
    }
    const on = this.orbitHooks?.elements?.(body.name) ?? new Set
    // The lead: what the elements are, and the switches for them all.
    let html = `<p class="info-note"><span class="orbit-kind">${kindText(el)}</span>.</p>\n` +
      '<div class="info-actions">Show ' +
      '<button class="orbit-action" type="button" data-action="all">all</button>' +
      '<button class="orbit-action" type="button" data-action="none">none</button>' +
      '<span class="orbit-clear" hidden><button class="orbit-action" type="button" data-action="clear">' +
      'clear every orbit</button></span>' +
      `<a class="orbit-guide" href="${this._guideHref(body, el)}">See it in the guide</a></div>\n` +
      '<label class="orbit-fade">Far side <input type="range" min="0" max="100" step="5" ' +
      `value="${Math.round((this.orbitHooks?.fade?.() ?? ORBIT_FADE_DEFAULT) * 100)}" ` +
      'aria-label="the orbit diagrams\' opacity at the far side of the orbit"> ' +
      '<span class="orbit-fade-value"></span></label>\n'
    let rows = ''
    if (orbit.siderealOrbitPeriod !== undefined) {
      rows += rowHtml('Orbit period (sidereal)', secsToYDHMS(scalar(orbit.siderealOrbitPeriod)))
    }
    for (const row of elementRows(el)) {
      const color = `#${row.color.toString(16).padStart(6, '0')}`
      const code = ELEMENT_CODES[row.key]
      const truePlace = row.trueValue ? `<dd class="info-true"><span class="info-sym">${row.trueSymbol}</span>` +
        `${row.trueName} <span class="orbit-true">${row.trueValue}</span></dd>` : ''
      rows += `<div class="info-row orbit-element${on.has(code) ? ' on' : ''}" data-element="${row.key}" ` +
        `data-code="${code}" tabindex="0" role="switch" aria-checked="${on.has(code)}" ` +
        `title="Show ${row.name} on the orbit">` +
        `<span class="info-swatch" style="color: ${color}"></span>` +
        `<dt><span class="info-sym">${row.symbol}</span>${row.name}</dt>` +
        `<dd><span class="orbit-value">${row.value}</span></dd>${truePlace}</div>\n`
    }
    html += rowsHtml(rows, 'is-compact orbit-elements')
    const rest = {}
    for (const [key, val] of Object.entries(orbit)) {
      if (!ORBIT_LISTED.has(key)) {
        rest[key] = val
      }
    }
    const restRows = fieldRowsHtml(rest, secsToYDHMS, sci)
    if (restRows) {
      html += `<div class="info-subhead">The source's elements</div>\n${rowsHtml(restRows, 'is-compact')}`
    }
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
    const section = this.containerElt.querySelector?.('details[data-prop="orbit"]')
    const list = section?.querySelector('.orbit-elements')
    if (!list || !this.orbitHooks) {
      this._orbit = null
      return
    }
    const hooks = this.orbitHooks
    this._orbit = {body, list: section, ranMs: 0}
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
    // The diagrams' opacity at the far side of their orbits, for all.
    const fade = section.querySelector('.orbit-fade input')
    fade?.addEventListener('input', () => {
      hooks.setFade?.(Number(fade.value) / 100)
      this._showOrbitState()
    })
    for (const button of section.querySelectorAll('.orbit-action')) {
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
    const fade = state.list.querySelector('.orbit-fade input')
    if (fade && this.orbitHooks.fade && document.activeElement !== fade) {
      fade.value = String(Math.round(this.orbitHooks.fade() * 100))
    }
    const fadeValue = state.list.querySelector('.orbit-fade-value')
    if (fade && fadeValue) {
      fadeValue.textContent = `${fade.value}%`
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


  /**
   * The guide's orbit page on this orbit, at this moment, with the same
   * elements lit (the guide's `orbit:` token; design/URLs.md).  Relative,
   * so the page's base (a PR preview's) holds.
   *
   * @param {object} body the body's props
   * @param {object} el its elements now
   * @returns {string}
   */
  _guideHref(body, el) {
    const on = this.orbitHooks?.elements?.(body.name) ?? new Set
    return `guide/orbit#${encodeGuideOrbitToken(body.name, el, on, this.orbitHooks?.jd?.())}`
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
    if (!state.list.isConnected || !state.list.open || state.list.closest('.info')?.classList.contains('folded')) {
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
    state.list.querySelector('.orbit-guide')?.setAttribute('href', this._guideHref(state.body, el))
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
   * A catalog star's panel (no JSON descriptor), for the search's preview
   * and a committed star.
   *
   * @param {object} preview {hipId, displayName, star}
   */
  showStarPreview(preview) {
    if (!preview || !preview.star) {
      return
    }
    this._endPreview()
    this._orbit = null
    this._show(this.starPanelHtml(preview))
  }


  /**
   * An Earth satellite's panel (js/scene/satellites/Satellites.md): its
   * orbit from its mean elements, and their age at the date.
   *
   * @param {object} rec Its record (satellites/sgp4.js)
   * @param {number} jd The date, Julian Day (UTC)
   * @param {?string} [fetched] When the snapshot was fetched
   */
  showSatellite(rec, jd, fetched = null) {
    if (!rec) {
      return
    }
    this._endPreview()
    this._orbit = null
    const f = satelliteFacts(rec, jd, fetched)
    const rows = f.rows.map(([label, value, unit]) => rowHtml(label, value, unit)).join('')
    const notes = f.notes.map((n) => `<p class="info-note">${esc(n)}</p>\n`).join('')
    this._show(panelHtml({name: f.name, kind: f.kind, fact: f.fact}, rowsHtml(rows) + notes))
  }


  /**
   * @param {object} preview {hipId, displayName, star}
   * @returns {string}
   */
  starPanelHtml(preview) {
    const {hipId, star} = preview
    const specClass = spectralTypeName(star)
    const distanceLy = Math.sqrt((star.x * star.x) + (star.y * star.y) + (star.z * star.z)) / LIGHTYEAR_METER
    const distance = `${grouped(distanceLy, distanceLy < 100 ? 2 : 0)} ly`
    const rows = rowHtml('Class', specClass) +
      rowHtml('Distance', grouped(distanceLy, distanceLy < 100 ? 2 : 0), 'ly') +
      rowHtml('Absolute magnitude', star.absMag.toFixed(2)) +
      rowHtml('Hipparcos', String(hipId))
    return panelHtml({name: preview.displayName || `HIP ${hipId}`, kind: 'Star', fact: distance}, rowsHtml(rows))
  }


  /**
   * A SPARC galaxy's panel (js/scene/Galaxies.md), and its rotation curve
   * against its baryons' once the curves are in (rotationCurve.js).
   *
   * @param {object} galaxy Its record (Galaxies.js)
   * @param {?object} galaxies Galaxies, for its curve
   */
  showGalaxyPreview(galaxy, galaxies) {
    if (!galaxy?.row) {
      return
    }
    this._endPreview()
    this._orbit = null
    this._show(this.galaxyPanelHtml(galaxy))
    galaxies?.curve?.(galaxy.id).then((curve) => {
      const slot = this.containerElt.querySelector('.galaxy-curve')
      if (slot && curve) {
        slot.innerHTML = `<p class="info-note"><span style="color: ${CURVE_COLORS.observed}">●</span> observed, ` +
          `<span style="color: ${CURVE_COLORS.baryons}">━</span> stars and gas alone</p>${rotationCurveSvg(curve)}`
      }
    }).catch(() => {/* No curve: the summary stands. */})
  }


  /**
   * @param {object} galaxy Its record (Galaxies.js)
   * @returns {string}
   */
  galaxyPanelHtml(galaxy) {
    const g = galaxy.row
    const m = galaxy.meta
    const type = `${GALAXY_TYPES[g.T] ?? g.T}${g.rc3?.type ? ` (RC3 ${g.rc3.type.trim()})` : ''}`
    let summary = rowHtml('Type', type) +
      rowHtml('Distance', `${g.D} ± ${g.eD}`, 'Mpc')
    if (g.Vflat > 0) {
      summary += rowHtml('Rotation speed', `${g.Vflat} ± ${g.eVflat}`, 'km/s')
    }
    const detail = rowHtml('Inclination', `${g.inc}°`) +
      rowHtml('Position angle', galaxy.place.paMeasured ? `${galaxy.place.pa}°` : 'not measured') +
      rowHtml('Luminosity, V', (galaxy.spec.L / 1e9).toPrecision(3), `× 10⁹ L☉ (${m.luminositySource})`) +
      rowHtml('Luminosity, 3.6 µm', String(g.L36), '× 10⁹ L☉') +
      rowHtml('Disc scale length', String(g.Rdisk), 'kpc') +
      rowHtml('Neutral hydrogen', String(g.MHI), '× 10⁹ M☉')
    const body = rowsHtml(summary) +
      sectionHtml('galaxy', 'Structure', 'luminosity, disc, gas', rowsHtml(detail)) +
      sectionHtml('curve', 'Rotation curve', 'observed and baryons', '<div class="galaxy-curve"></div>\n')
    return panelHtml({name: galaxy.label ?? galaxy.name, kind: 'Galaxy', fact: `${g.D} Mpc`}, body)
  }
}


/**
 * A row whose value is a sentence, set as words, below its label.
 *
 * @param {string} label
 * @param {string} text
 * @returns {string}
 */
function rowLongHtml(label, text) {
  return `<div class="info-row is-long"><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>
`
}


/**
 * An orbital regime (Scene.regimesOf) as a row: its name, then the rest in
 * words, split at its first colon or comma (`GPS: 6 planes at 55°, 20,200
 * km up`).
 *
 * @param {string} text
 * @returns {string}
 */
function regimeRowHtml(text) {
  const m = /^(.+?)(?:: |, )(.+)$/.exec(text)
  return m ? rowLongHtml(capitalize(m[1]), m[2]) : rowLongHtml(capitalize(text), '')
}


/** The body's fields its summary and sections show; the rest go in More data. */
const BODY_LISTED = new Set(['radius', 'mass', 'density', 'siderealRotationPeriod', 'axialInclination', 'albedo',
  'equatorialGravity', 'escapeVelocity', 'spectralType', 'orbit', 'rings', 'atmosphere'])


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
 * A period as the summary gives it, to a glance's precision: hours and
 * minutes under two days, days under two years, then years.
 *
 * @param {number} s seconds
 * @returns {string}
 */
export function periodText(s) {
  const day = 86400
  const year = 365.25 * day
  if (s >= 2 * year) {
    return `${grouped(s / year, 1)} years`
  }
  if (s >= 2 * day) {
    return `${grouped(s / day, 2)} days`
  }
  const h = Math.floor(s / 3600)
  const m = Math.round((s - (h * 3600)) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
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
