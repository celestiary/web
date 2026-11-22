/**
 * The render panel (DESIGN.md, "Performance panel"): the rendering's
 * controls and what it is set to; the backtick key shows it, with the perf
 * overlay (perf.js show), which has the frame's numbers, graphs and render
 * counts.  Loaded with the panel's first showing (ThreeUi.togglePerfPanel),
 * so it costs the first load nothing.
 *
 * - **Tone map**: the final tone map, in the atmosphere pass
 *   (scene/toneMaps.js), for diagnosing colour.  PBR Neutral is the app's.
 * - **Output colour space** and **sky gain**.
 * - **Observer, exposure and glare**: the eye or a camera (the Settings'
 *   Observer row, `K` in a link), the exposure compensation (`ev=`, the
 *   keys' EV) with Auto, the Sun's glare on or off and a diagnostic
 *   strength; and readouts of the exposure, the meter's gain and the glare's
 *   model.  Each control drives the app's own state (Scene, Celestiary,
 *   SunLayers) and is set back from it at each redraw, so it holds nothing.
 * - **Output**: the renderer's output colour space and tone mapping, and
 *   whether the scene buffer is HDR.
 * - **Capabilities**: three's `renderer.capabilities`, folded.
 */


/** The tone maps the panel offers, in its order (TONE_MAP_IDS for the shader's ids). */
export const TONE_MAPS = [
  {key: 'neutral', label: 'PBR Neutral (default)', what: 'Khronos PBR Neutral: the app\'s own'},
  {key: 'aces', label: 'ACES Filmic', what: 'three\'s ACES fit, with its 1/0.6 pre-scale'},
  {key: 'agx', label: 'AgX', what: 'Blender\'s AgX through Filament, as three has it'},
  {key: 'reinhard', label: 'Reinhard', what: 'c / (1 + c)'},
  {key: 'cineon', label: 'Cineon', what: 'Hejl and Burgess-Dawson\'s filmic fit, linearised by 2.2'},
  {key: 'linear', label: 'Linear', what: 'exposure only, clamped to 1'},
  {key: 'greyscale', label: 'Greyscale', what: 'PBR Neutral\'s output as its Rec. 709 luminance'},
]


/** The output colour spaces the panel offers: three's values. */
export const OUTPUT_COLOR_SPACES = [
  {value: 'srgb', label: 'SRGBColorSpace (default)', title: 'Encoded to sRGB on the way to the screen'},
  {value: 'srgb-linear', label: 'LinearSRGBColorSpace', title: 'Linear values to the screen unencoded: darker, for diagnosis'},
]


/** How often the text is redrawn, ms: it never touches the frame it describes. */
export const UPDATE_MS = 500

// three's constants by value (r187), so this module needn't import three.
const TONE_MAPPING_NAMES = {
  0: 'NoToneMapping', 1: 'LinearToneMapping', 2: 'ReinhardToneMapping', 3: 'CineonToneMapping',
  4: 'ACESFilmicToneMapping', 5: 'CustomToneMapping', 6: 'AgXToneMapping', 7: 'NeutralToneMapping',
}
const COLOR_SPACE_NAMES = {'srgb': 'SRGBColorSpace', 'srgb-linear': 'LinearSRGBColorSpace', '': 'NoColorSpace'}


/**
 * @param {string} space A three colour space, e.g. 'srgb-linear'
 * @returns {string} Its constant's name, e.g. 'LinearSRGBColorSpace'
 */
export function colorSpaceName(space) {
  return COLOR_SPACE_NAMES[space] ?? String(space)
}


/**
 * @param {number} mapping A three tone mapping constant
 * @returns {string} Its name
 */
export function toneMappingName(mapping) {
  return TONE_MAPPING_NAMES[mapping] ?? String(mapping)
}


/**
 * Every capability three reports, functions evaluated where they take no
 * argument the panel can't supply.
 *
 * @param {object} caps renderer.capabilities
 * @returns {Array<Array<string>>} [name, value] pairs
 */
export function capabilityRows(caps) {
  const rows = []
  for (const [name, v] of Object.entries(caps ?? {})) {
    if (typeof v === 'function') {
      if (name === 'getMaxAnisotropy') {
        rows.push(['maxAnisotropy', String(v())])
      } else if (name === 'getMaxPrecision') {
        rows.push(['maxPrecision (highp asked)', String(v('highp'))])
      }
      // textureFormatReadable and textureTypeReadable take a texture.
      continue
    }
    rows.push([name, String(v)])
  }
  return rows
}


/**
 * The panel's sections, from the renderer.  Pure, for tests.  The frame's
 * numbers, memory and render counts are the perf overlay's (PerfInfo.js).
 *
 * @param {object} p
 * @param {object} p.renderer A three WebGLRenderer, or its shape
 * @param {boolean} p.hdr Whether the scene buffer is half-float HDR
 * @param {string} p.toneMap The final tone map's key
 * @returns {Array<{title: string, rows: Array<Array<string>>}>}
 */
export function infoSections({renderer, hdr, toneMap}) {
  const label = TONE_MAPS.find((t) => t.key === toneMap)?.label ?? toneMap
  return [
    {title: 'Output', rows: [
      ['outputColorSpace', colorSpaceName(renderer.outputColorSpace)],
      ['final tone map', label],
      ['scene pass toneMapping', toneMappingName(renderer.toneMapping)],
      ['toneMappingExposure', Number(renderer.toneMappingExposure).toPrecision(4)],
      ['scene buffer', hdr ? 'RGBA16F, linear HDR' : 'RGBA8 (LDR fallback)'],
    ]},
  ]
}


/** The glare models' names, by an instrument's psf.glareModel (glare.js GLARE_MODEL_*). */
const GLARE_MODELS = ['the eye\'s (disability glare)', 'a camera\'s (a lens\'s veil)']


/**
 * The observer's, the exposure's and the glare's readouts.  Pure, for tests.
 *
 * @param {object} ui ThreeUi: `instrument`, `observer`, `_appInstrument`,
 *   `renderer.toneMappingExposure`, `_exposureGoal`, `_meterGain`,
 *   `_meterGainGoal`, `_renderedGain`, `exposureCompensation()`
 * @param {object|null} sun The Sun's SunLayers: `enabled.glare`, `glare.visible`, `glareGain`
 * @returns {Array<Array<string>>} [name, value] pairs
 */
export function cameraRows(ui, sun) {
  const g = (v) => (Number.isFinite(v) ? Number(v).toPrecision(4) : 'n/a')
  const instrument = ui.instrument ?? {}
  const app = ui._appInstrument ? ' (an app\'s)' : ''
  const ev = ui.exposureCompensation?.() ?? 0
  const model = GLARE_MODELS[instrument.psf?.glareModel ?? 0] ?? String(instrument.psf?.glareModel)
  return [
    ['instrument', `${instrument.name ?? 'n/a'}${app}`],
    ['exposure', g(ui.renderer?.toneMappingExposure)],
    ['keyed exposure', g(ui._exposureGoal)],
    ['metered gain', `${g(ui._meterGain)} (goal ${g(ui._meterGainGoal)})`],
    ['rendered gain', g(ui._renderedGain)],
    ['EV', `${ev > 0 ? '+' : ''}${Number(ev.toFixed(2))}${ev === 0 ? ' (auto)' : ''}`],
    ['glare model', model],
    ['glare', sun ? `${sun.enabled.glare ? 'on' : 'off'}, ${sun.glare?.visible ? 'drawn' : 'not drawn'}` +
      `${sun.glareGain === 1 ? '' : `, x${sun.glareGain} (diagnostic)`}` : 'no Sun'],
  ]
}


/** The panel's DOM: the tone map control, the info and the capabilities. */
export default class RenderPanel {
  /**
   * @param {object} p
   * @param {Document} p.doc
   * @param {object} p.renderer
   * @param {boolean} p.hdr
   * @param {string} p.toneMap The final tone map's key to start with
   * @param {function(string): void} p.onToneMap Called with a key on a change
   * @param {function(string): void} [p.onColorSpace] Called with 'srgb' or 'srgb-linear' on a change
   * @param {number|null} [p.skyGain] The sky gain in place of the body's, or null
   * @param {function(string): void} [p.onSkyGain] Called with the field's text on a change ('' for the body's)
   * @param {object} [p.ui] ThreeUi, for the observer, exposure and glare (cameraRows, _cameraControls)
   * @param {function(): number} [p.now] Milliseconds
   */
  constructor({
    doc, renderer, hdr, toneMap, onToneMap, onColorSpace = () => undefined,
    skyGain = null, onSkyGain = () => undefined, ui = null, now = () => performance.now(),
  }) {
    this.doc = doc
    this.ui = ui
    this.renderer = renderer
    this.hdr = hdr
    this.toneMap = toneMap
    this.now = now
    this.lastDrawAt = -Infinity
    const el = (tag, props = {}, style = {}) => {
      const e = doc.createElement(tag)
      Object.assign(e, props)
      Object.assign(e.style, style)
      return e
    }
    this.el = el
    this.root = el('div', {id: 'render-info'}, {
      font: '10.5px/1.3 ui-monospace, Menlo, monospace', color: '#ddd', background: 'rgba(0, 0, 0, 0.78)',
      padding: '5px 7px', borderRadius: '4px', marginBottom: '4px', width: 'min(320px, calc(100vw - 16px))',
      maxHeight: 'calc(100vh - 9em)', overflow: 'auto', userSelect: 'text', boxSizing: 'border-box',
    })
    this.root.setAttribute('data-testid', 'render-info')
    const toneMapRow = this._select({
      text: 'Tone map', testId: 'render-info-tonemap', value: toneMap,
      title: 'The final tone map, in the atmosphere pass (js/scene/toneMaps.js)',
      options: TONE_MAPS.map((t) => ({value: t.key, label: t.label, title: t.what})),
      onChange: (key) => {
        this.toneMap = key
        onToneMap(key)
      },
    })
    const spaceRow = this._select({
      text: 'Output', testId: 'render-info-colorspace', value: renderer.outputColorSpace,
      title: 'The renderer\'s output colour space.  sRGB (the app\'s): the atmosphere pass and three\'s ' +
        'materials drawn to the screen encode to sRGB, as the colour maps are decoded from it.  Linear, for ' +
        'diagnosis: the frame unencoded (HDR.md, "Colour spaces")',
      options: OUTPUT_COLOR_SPACES,
      onChange: (space) => onColorSpace(space),
    })
    this.info = el('div')
    const caps = el('details')
    caps.append(el('summary', {textContent: 'Capabilities'}, {color: '#8ac', cursor: 'pointer'}))
    caps.append(this._table(capabilityRows(renderer.capabilities)))
    const gainRow = el('label', {
      title: 'The sky\'s gain in place of its body\'s data (Earth\'s 21, about 4.5 times the physical 4.71, ' +
        'standing in for aerosols; js/scene/atmos/composition.md, "Per-body data").  Empty: the body\'s.',
    }, {display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px'})
    const gainBox = el('input', {type: 'number', min: '0', step: '0.1', placeholder: 'body\'s',
      value: skyGain === null ? '' : String(skyGain)}, {width: '6em', font: 'inherit'})
    gainBox.setAttribute('data-testid', 'render-info-skygain')
    gainBox.addEventListener('change', () => onSkyGain(gainBox.value))
    const physical = el('button', {textContent: '4.71', title: 'The physical gain, π × DISPLAY_GAIN'},
        {font: 'inherit', cursor: 'pointer'})
    physical.addEventListener('click', () => {
      gainBox.value = '4.71'
      onSkyGain('4.71')
      physical.blur()
    })
    const reset = el('button', {textContent: 'body\'s', title: 'The body\'s own gain'}, {font: 'inherit', cursor: 'pointer'})
    reset.addEventListener('click', () => {
      gainBox.value = ''
      onSkyGain('')
      reset.blur()
    })
    gainRow.append(el('span', {textContent: 'Sky gain'}, {color: '#8ac', width: '4.5em'}), gainBox, physical, reset)
    this.root.append(toneMapRow, spaceRow, gainRow)
    if (ui) {
      this.root.append(this._cameraControls(ui))
    }
    this.root.append(this.info, caps)
  }


  /**
   * The observer's, the exposure's and the glare's controls.
   *
   * @param {object} ui ThreeUi
   * @returns {HTMLElement}
   */
  _cameraControls(ui) {
    const {el} = this
    const box = el('div', {}, {borderTop: '1px solid #444', paddingTop: '4px', marginBottom: '2px'})
    const row = (text, title) => {
      const label = el('label', {title}, {display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px'})
      label.append(el('span', {textContent: text}, {color: '#8ac', width: '4.5em'}))
      box.append(label)
      return label
    }
    const button = (text, title, onClick) => {
      const b = el('button', {textContent: text, title}, {font: 'inherit', cursor: 'pointer'})
      b.addEventListener('click', () => {
        onClick()
        b.blur()
        this.draw()
      })
      return b
    }
    const scene = () => ui.sceneManager
    const observer = el('select', {}, {flex: '1', font: 'inherit'})
    observer.setAttribute('data-testid', 'render-info-observer')
    for (const [value, label] of [['eye', 'Eye (naked, dark adapted)'], ['camera', 'Camera (a lens\'s glare)']]) {
      observer.append(el('option', {value, textContent: label}))
    }
    observer.addEventListener('change', () => {
      if ((observer.value === 'camera') !== Boolean(scene()?.observerIsCamera())) {
        scene()?.toggleObserverCamera()
      }
      observer.blur()
      this.draw()
    })
    row('Observer', 'The user\'s observer: the Settings\' Observer row, `K` in a link\'s s= (Sun.md, "Glare").  ' +
      'An app\'s instrument (Rubin\'s) overrides it while the app runs').append(observer)
    const ev = el('input', {type: 'number', min: '-10', max: '10', step: String(1 / 3)}, {width: '6em', font: 'inherit'})
    ev.setAttribute('data-testid', 'render-info-ev')
    const setEv = (v) => (ui.onEv ?? ((x) => ui.setExposureCompensation(x)))(v)
    ev.addEventListener('change', () => {
      setEv(Number(ev.value))
      ev.blur()
      this.draw()
    })
    row('EV', 'Exposure compensation, stops over the metered exposure: the EV keys\' and `ev=` in a link ' +
      '(HDR.md, "User exposure compensation")').append(ev, button('Auto', 'The metered exposure: EV 0', () => setEv(0)))
    const sun = () => scene()?.objects?.sun?.sunLayers ?? null
    const glare = el('input', {type: 'checkbox'}, {verticalAlign: 'middle'})
    glare.setAttribute('data-testid', 'render-info-glare')
    glare.addEventListener('change', () => {
      if (sun()) {
        sun().enabled.glare = glare.checked
      }
      glare.blur()
    })
    const strength = el('input', {type: 'number', min: '0', step: '0.1'}, {width: '5em', font: 'inherit'})
    strength.setAttribute('data-testid', 'render-info-glare-gain')
    strength.title = 'Diagnostic: a multiplier on the veil, 1 as the model has it.  Not kept in a link'
    strength.addEventListener('change', () => {
      const g = Number(strength.value)
      if (sun() && Number.isFinite(g) && g >= 0) {
        sun().glareGain = g
      }
      strength.blur()
    })
    row('Glare', 'The Sun\'s glare, the observer\'s veil round it (Sun.md, "Glare")').append(glare,
        el('span', {textContent: 'x'}, {color: '#aaa'}), strength,
        button('1', 'The model\'s own strength', () => sun() && (sun().glareGain = 1)))
    this.cameraInfo = el('div')
    box.append(this.cameraInfo)
    this._syncCamera = () => {
      observer.value = scene()?.observerIsCamera() ? 'camera' : 'eye'
      if (this.doc.activeElement !== ev) {
        ev.value = String(Number((ui.exposureCompensation?.() ?? 0).toFixed(2)))
      }
      const s = sun()
      glare.checked = s?.enabled.glare ?? false
      glare.disabled = !s
      if (this.doc.activeElement !== strength) {
        strength.value = String(s?.glareGain ?? 1)
      }
      this.cameraInfo.replaceChildren(this._table(cameraRows(ui, s)))
    }
    return box
  }


  /** Mark a frame's end: redraws the text every UPDATE_MS (the exposure moves). */
  frameEnd() {
    const t = this.now()
    if (t - this.lastDrawAt >= UPDATE_MS) {
      this.lastDrawAt = t
      this.draw()
    }
  }


  /** Rewrite the info from the latest numbers. */
  draw() {
    this._syncCamera?.()
    const sections = infoSections({renderer: this.renderer, hdr: this.hdr, toneMap: this.toneMap})
    const parts = []
    for (const s of sections) {
      parts.push(this.el('div', {textContent: s.title}, {color: '#8ac', marginTop: '3px'}), this._table(s.rows))
    }
    this.info.replaceChildren(...parts)
  }


  /**
   * A labelled select; on a change it calls back, blurs (the app ignores
   * keys while an input has focus, Keys.onKeyDown) and redraws.
   *
   * @returns {HTMLLabelElement}
   */
  _select({text, testId, title, options, value, onChange}) {
    const {el} = this
    const label = el('label', {title}, {display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px'})
    const select = el('select', {}, {flex: '1', font: 'inherit'})
    select.setAttribute('data-testid', testId)
    for (const o of options) {
      select.append(el('option', {value: o.value, textContent: o.label, title: o.title ?? ''}))
    }
    select.value = value
    select.addEventListener('change', () => {
      onChange(select.value)
      select.blur()
      this.draw()
    })
    label.append(el('span', {textContent: text}, {color: '#8ac', width: '4.5em'}), select)
    return label
  }


  /** @returns {HTMLTableElement} Two columns: name, value */
  _table(rows) {
    const table = this.el('table', {}, {borderCollapse: 'collapse', width: '100%'})
    for (const [name, value] of rows) {
      const tr = this.el('tr')
      tr.append(this.el('td', {textContent: name}, {paddingRight: '8px', color: '#aaa', whiteSpace: 'nowrap'}),
          this.el('td', {textContent: value}, {textAlign: 'right', wordBreak: 'break-word'}))
      table.append(tr)
    }
    return table
  }
}


/**
 * The render panel, in an element on the page, hidden until the caller shows
 * it.  Bottom-right, above the fullscreen control; only its box takes pointer
 * events.
 *
 * @param {object} p RenderPanel's constructor's
 * @returns {{root: HTMLElement, panel: RenderPanel}}
 */
export function createPerfPanel(p) {
  const {doc} = p
  const root = doc.createElement('div')
  root.id = 'perf-panel-root'
  Object.assign(root.style, {
    position: 'fixed', bottom: '3.5em', right: '0.5em', zIndex: '1000', display: 'none',
    flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none',
  })
  const panel = new RenderPanel(p)
  panel.root.style.pointerEvents = 'auto'
  root.append(panel.root)
  doc.body.appendChild(root)
  return {root, panel}
}
