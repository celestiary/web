import Stats from 'three/examples/jsm/libs/stats.module.js'


/**
 * The performance panel (DESIGN.md, "Performance panel"): controls and
 * render info over three's Stats graph; the backtick key shows it.  Loaded
 * with the panel's first showing (ThreeUi.togglePerfPanel), so it costs the
 * first load nothing.
 *
 * - **Tone map**: the final tone map, in the atmosphere pass
 *   (scene/toneMaps.js), for diagnosing colour.  PBR Neutral is the app's.
 * - **Frame**: FPS and the frame's interval, and the CPU time to issue it.
 * - **Memory** and **Render**: three's `renderer.info`, the render counts
 *   summed over the frame's renders (ThreeUi resets them once a frame while
 *   the panel shows).  Cesium's replayed draws aren't three's and aren't in
 *   them; `?perf=1` counts those.
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
  {value: 'srgb-linear', label: 'LinearSRGBColorSpace (default)', title: 'Stored values to the screen as they are'},
  {value: 'srgb', label: 'SRGBColorSpace', title: 'Encoded to sRGB on the way to the screen'},
]


/** How often the text is redrawn, ms: it never touches the frame it describes. */
export const UPDATE_MS = 500
/** Frames the FPS and interval average over. */
const WINDOW = 60

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
 * The panel's sections, from the renderer and the frame's timings.  Pure, for
 * tests.
 *
 * @param {object} p
 * @param {object} p.renderer A three WebGLRenderer, or its shape
 * @param {{calls: number, triangles: number, points: number, lines: number}} p.render The frame's render counts
 * @param {number} p.fps
 * @param {number} p.intervalMs The mean frame interval
 * @param {number} p.cpuMs The mean CPU time to issue a frame
 * @param {boolean} p.hdr Whether the scene buffer is half-float HDR
 * @param {string} p.toneMap The final tone map's key
 * @returns {Array<{title: string, rows: Array<Array<string>>}>}
 */
export function infoSections({renderer, render, fps, intervalMs, cpuMs, hdr, toneMap}) {
  const mem = renderer.info?.memory ?? {}
  const label = TONE_MAPS.find((t) => t.key === toneMap)?.label ?? toneMap
  return [
    {title: 'Frame', rows: [
      ['FPS', fps.toFixed(1)],
      ['frame time', `${intervalMs.toFixed(2)} ms`],
      ['CPU to issue', `${cpuMs.toFixed(2)} ms`],
    ]},
    {title: 'Memory', rows: [
      ['geometries', String(mem.geometries ?? 0)],
      ['textures', String(mem.textures ?? 0)],
    ]},
    {title: 'Render (per frame, three\'s draws)', rows: [
      ['calls', String(render.calls)],
      ['triangles', String(render.triangles)],
      ['points', String(render.points)],
      ['lines', String(render.lines)],
    ]},
    {title: 'Output', rows: [
      ['outputColorSpace', colorSpaceName(renderer.outputColorSpace)],
      ['final tone map', label],
      ['scene pass toneMapping', toneMappingName(renderer.toneMapping)],
      ['toneMappingExposure', Number(renderer.toneMappingExposure).toPrecision(4)],
      ['scene buffer', hdr ? 'RGBA16F, linear HDR' : 'RGBA8 (LDR fallback)'],
    ]},
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
   * @param {boolean} [p.decode] Whether the colour textures are decoded to start with
   * @param {function(boolean): void} [p.onDecode] Called on a change
   * @param {number|null} [p.skyGain] The sky gain in place of the body's, or null
   * @param {function(string): void} [p.onSkyGain] Called with the field's text on a change ('' for the body's)
   * @param {function(): number} [p.now] Milliseconds
   */
  constructor({
    doc, renderer, hdr, toneMap, onToneMap, onColorSpace = () => undefined, decode = false,
    onDecode = () => undefined, skyGain = null, onSkyGain = () => undefined, now = () => performance.now(),
  }) {
    this.doc = doc
    this.renderer = renderer
    this.hdr = hdr
    this.toneMap = toneMap
    this.now = now
    this.intervals = []
    this.cpu = []
    this.lastFrameAt = null
    this.frameStartAt = null
    this.lastDrawAt = -Infinity
    this.render = {calls: 0, triangles: 0, points: 0, lines: 0}
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
      title: 'The renderer\'s output colour space.  Linear (the app\'s): stored values to the screen as they ' +
        'are.  sRGB: the atmosphere pass and three\'s materials drawn to the screen encode to sRGB; textures ' +
        'are still not decoded (HDR.md, "Colour spaces")',
      options: OUTPUT_COLOR_SPACES,
      onChange: (space) => onColorSpace(space),
    })
    this.info = el('div')
    const caps = el('details')
    caps.append(el('summary', {textContent: 'Capabilities'}, {color: '#8ac', cursor: 'pointer'}))
    caps.append(this._table(capabilityRows(renderer.capabilities)))
    const decodeRow = el('label', {
      title: 'Decode the bodies\' colour maps from sRGB (texture.colorSpace = SRGBColorSpace), so surfaces are lit ' +
        'in linear light, and Cesium\'s imagery by gamma 1/2.2; with Output at sRGB, the colour-managed ' +
        'pipeline (js/perf/textureDecode.js)',
    }, {display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', cursor: 'pointer'})
    const decodeBox = el('input', {type: 'checkbox', checked: decode}, {margin: '0'})
    decodeBox.setAttribute('data-testid', 'render-info-decode')
    decodeBox.addEventListener('change', () => {
      onDecode(decodeBox.checked)
      decodeBox.blur()
    })
    decodeRow.append(decodeBox, el('span', {textContent: 'decode colour textures (sRGB)'}))
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
    this.root.append(toneMapRow, spaceRow, decodeRow, gainRow, this.info, caps)
  }


  /** Mark a frame's start: its interval from the last. */
  frameBegin() {
    const t = this.now()
    if (this.lastFrameAt !== null) {
      push(this.intervals, t - this.lastFrameAt)
    }
    this.lastFrameAt = t
    this.frameStartAt = t
  }


  /**
   * Mark a frame's end: its CPU time, and the render counts it summed.
   * Redraws the text every UPDATE_MS.
   */
  frameEnd() {
    const t = this.now()
    if (this.frameStartAt !== null) {
      push(this.cpu, t - this.frameStartAt)
    }
    const r = this.renderer.info?.render
    if (r) {
      this.render = {calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines}
    }
    if (t - this.lastDrawAt >= UPDATE_MS) {
      this.lastDrawAt = t
      this.draw()
    }
  }


  /** Rewrite the info from the latest numbers. */
  draw() {
    const intervalMs = mean(this.intervals)
    const sections = infoSections({
      renderer: this.renderer, render: this.render, hdr: this.hdr, toneMap: this.toneMap,
      fps: intervalMs > 0 ? 1000 / intervalMs : 0, intervalMs, cpuMs: mean(this.cpu),
    })
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


/** Keep the last WINDOW values. */
function push(list, v) {
  list.push(v)
  if (list.length > WINDOW) {
    list.shift()
  }
}


/** @returns {number} 0 for none */
function mean(list) {
  return list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length
}


/**
 * The whole performance panel: the render info over three's Stats graph, in
 * an element on the page, hidden until the caller shows it.  Bottom-right,
 * above the fullscreen control; only the boxes take pointer events.
 *
 * @param {object} p RenderPanel's constructor's
 * @returns {{root: HTMLElement, stats: Stats, panel: RenderPanel}}
 */
export function createPerfPanel(p) {
  const {doc} = p
  const root = doc.createElement('div')
  root.id = 'perf-panel-root'
  Object.assign(root.style, {
    position: 'fixed', bottom: '3.5em', right: '0.5em', zIndex: '1000', display: 'none',
    flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none',
  })
  const stats = new Stats
  Object.assign(stats.dom.style, {position: 'relative', top: 'auto', left: 'auto', pointerEvents: 'auto'})
  stats.dom.id = 'perf-panel'
  const panel = new RenderPanel(p)
  panel.root.style.pointerEvents = 'auto'
  root.append(panel.root, stats.dom)
  doc.body.appendChild(root)
  return {root, stats, panel}
}
