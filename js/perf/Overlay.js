import {countsLine, fmtCount, fmtMs, tableRows} from './format.js'
import {describePass} from './passes.js'
import {TOGGLES} from './toggles.js'


/** How long a status message ("copied") stays, ms. */
const STATUS_MS = 3000
const COLUMNS = [
  ['pass', 'name'], ['GPU', 'gpuMean'], ['p95', 'gpuP95'], ['CPU', 'cpuMean'], ['p95', 'cpuP95'],
  ['draws', 'draws'], ['rt', 'rt'], ['rb', 'rb'],
]
const COLUMN_TITLES = {
  GPU: 'GPU ms per frame, mean over the window (EXT_disjoint_timer_query_webgl2)',
  CPU: 'CPU ms per frame to issue the pass, mean over the window',
  p95: '95th percentile over the window',
  draws: 'draw calls per frame, including the replayed Cesium calls',
  rt: 'render-target switches per frame',
  rb: 'readbacks into client memory per frame (each waits for the GPU)',
}


/**
 * The `?perf=1` panel, in the DOM, not the scene: it never touches the frame
 * it measures.  Bottom-left, above the settings icons, clear of the top-left
 * info panel, the top-right time controls and the Stats panel (bottom-right,
 * `` ` ``).  Created once, only under `?perf=1` (perf.js); redrawn a couple of
 * times a second.
 */
export default class Overlay {
  /**
   * @param {object} p
   * @param {Document} p.doc
   * @param {Set<string>} p.off The toggle keys switched off to start with
   * @param {function(string, boolean): void} p.onToggle (key, runs)
   * @param {function(): string} p.onCopy Builds the snapshot's JSON
   * @param {function(): void} p.onReset Clears the rolling windows
   */
  constructor({doc, off, onToggle, onCopy, onReset}) {
    this.doc = doc
    this.onCopy = onCopy
    this.statusTimer = null
    const el = (tag, props = {}, style = {}) => {
      const e = doc.createElement(tag)
      Object.assign(e, props)
      Object.assign(e.style, style)
      return e
    }
    this.root = el('div', {id: 'perf-overlay'}, {
      position: 'fixed', left: '8px', bottom: '56px', zIndex: '1000', font: '10.5px/1.25 ui-monospace, Menlo, monospace',
      color: '#ddd', background: 'rgba(0, 0, 0, 0.78)', padding: '5px 7px', borderRadius: '4px',
      width: 'max-content', maxWidth: 'min(520px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 72px)', overflow: 'auto',
      pointerEvents: 'auto', userSelect: 'text',
    })
    this.root.setAttribute('data-testid', 'perf-overlay')
    const header = el('div', {}, {display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap'})
    this.collapse = el('button', {textContent: '-', title: 'Collapse'}, {width: '20px', cursor: 'pointer'})
    this.title = el('span', {textContent: 'perf'}, {fontWeight: 'bold'})
    this.body = el('div')
    this.note = el('div', {}, {color: '#fc6', margin: '3px 0'})
    this.table = el('table', {}, {borderCollapse: 'collapse'})
    this.counts = el('div', {}, {margin: '3px 0', color: '#aaa'})
    const toggles = el('div', {}, {display: 'flex', flexWrap: 'wrap', gap: '2px 10px', margin: '4px 0'})
    this.boxes = new Map()
    for (const t of TOGGLES) {
      const label = el('label', {title: `Run the ${t.label} pass: ${t.what}`}, {cursor: 'pointer', whiteSpace: 'nowrap'})
      const box = el('input', {type: 'checkbox', checked: !off.has(t.key)}, {verticalAlign: 'middle'})
      box.setAttribute('data-testid', `perf-toggle-${t.key}`)
      box.addEventListener('change', () => {
        onToggle(t.key, box.checked)
        // The app ignores keys while an input has focus (Keys.onKeyDown).
        box.blur()
      })
      label.append(box, ` ${t.label}`)
      toggles.append(label)
      this.boxes.set(t.key, box)
    }
    const copy = el('button', {textContent: 'Copy JSON', title: 'Copy a snapshot to paste back'}, {cursor: 'pointer'})
    copy.setAttribute('data-testid', 'perf-copy')
    copy.addEventListener('click', () => {
      copy.blur()
      return this._copy()
    })
    const reset = el('button', {textContent: 'Reset'}, {cursor: 'pointer'})
    reset.title = 'Forget the rolling window, e.g. after moving to a new view'
    reset.addEventListener('click', () => {
      reset.blur()
      onReset()
    })
    this.status = el('span', {}, {color: '#9f9'})
    header.append(this.collapse, this.title, copy, reset, this.status)
    this.fallback = null
    this.body.append(toggles, this.note, this.table, this.counts)
    this.root.append(header, this.body)
    this.collapse.addEventListener('click', () => {
      const hidden = this.body.style.display !== 'none'
      this.body.style.display = hidden ? 'none' : ''
      this.collapse.textContent = hidden ? '+' : '-'
    })
    doc.body.appendChild(this.root)
  }


  /**
   * @param {object} v
   * @param {object} v.summary PerfStats.summary()
   * @param {boolean} v.gpuTimed
   * @param {string} v.note The line under the title: what GPU timers do here
   */
  update({summary, gpuTimed, note}) {
    const {doc} = this
    this.title.textContent = `perf  ${summary.frame.fps.toFixed(0)} fps  ` +
      `(${summary.frame.intervalMs.mean.toFixed(1)} ms, p95 ${summary.frame.intervalMs.p95.toFixed(1)})`
    this.note.textContent = note
    this.note.style.display = note ? '' : 'none'
    const head = doc.createElement('tr')
    for (const [label] of COLUMNS) {
      const th = doc.createElement('th')
      th.textContent = label
      th.title = COLUMN_TITLES[label] ?? ''
      th.style.cssText = 'text-align: right; font-weight: normal; color: #8ac; padding: 0 4px;'
      head.append(th)
    }
    head.firstChild.style.textAlign = 'left'
    const rows = [head]
    for (const row of tableRows(summary, gpuTimed)) {
      const tr = doc.createElement('tr')
      COLUMNS.forEach(([, key], i) => {
        const td = doc.createElement('td')
        td.textContent = i === 0 ? `${'  '.repeat(row.depth)}${row[key]}` : row[key]
        const total = row.name === 'total' ? ' border-top: 1px solid #555; font-weight: bold;' : ''
        td.style.cssText = `text-align: ${i === 0 ? 'left; white-space: pre' : 'right'}; padding: 0 4px;${total}`
        if (i === 0) {
          td.title = describePass(row.name)
        }
        tr.append(td)
      })
      rows.push(tr)
    }
    for (const [name, s] of Object.entries(summary.contexts)) {
      const tr = doc.createElement('tr')
      COLUMNS.forEach(([, key], i) => {
        const td = doc.createElement('td')
        const text = {
          name: `${name} (own GL context)`,
          gpuMean: gpuTimed && s.gpu ? fmtMs(s.gpu.mean) : 'n/a',
          gpuP95: gpuTimed && s.gpu ? fmtMs(s.gpu.p95) : 'n/a',
          draws: fmtCount(s.counts.draws),
          rb: fmtCount(s.counts.readbacks),
        }[key] ?? ''
        td.textContent = text
        td.style.cssText = `text-align: ${i === 0 ? 'left' : 'right'}; padding: 0 4px; color: #aaa;`
        tr.append(td)
      })
      rows.push(tr)
    }
    this.table.replaceChildren(...rows)
    this.counts.textContent = countsLine(summary)
  }


  /**
   * @param {string} text
   * @param {boolean} [ok]
   */
  setStatus(text, ok = true) {
    this.status.textContent = text
    this.status.style.color = ok ? '#9f9' : '#f99'
    clearTimeout(this.statusTimer)
    this.statusTimer = setTimeout(() => {
      this.status.textContent = ''
    }, STATUS_MS)
  }


  /** Copy the snapshot; where the clipboard isn't allowed, show it to select and copy by hand. */
  async _copy() {
    const text = this.onCopy()
    try {
      await navigator.clipboard.writeText(text)
      this.setStatus('copied')
      return
    } catch {
      // Not allowed (no focus, an insecure page): the old way, then by hand.
    }
    const area = this.doc.createElement('textarea')
    area.value = text
    area.style.cssText = 'width: 100%; height: 8em; font: 10px monospace; margin-top: 4px;'
    this.fallback?.remove()
    this.fallback = area
    this.body.append(area)
    area.select()
    let ok = false
    try {
      ok = this.doc.execCommand('copy')
    } catch {
      ok = false
    }
    this.setStatus(ok ? 'copied' : 'select the text below and copy it', ok)
    if (ok) {
      area.remove()
      this.fallback = null
    }
  }


  /** Take the panel off the page. */
  dispose() {
    clearTimeout(this.statusTimer)
    this.root.remove()
  }
}
