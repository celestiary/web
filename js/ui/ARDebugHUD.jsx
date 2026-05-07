import React, {ReactElement, useEffect, useRef, useState} from 'react'
import Box from '@mui/material/Box'
import useStore from '../store/useStore'


/** Number of recent (raw, filtered) alpha samples retained for the graph.
 * At ~60 Hz that's a ~10 s window — long enough to make slow drift and
 * non-monotonic motion during a deliberate slow pan obvious, while
 * still resolving sub-second periodic carriers (heartbeat / tremor). */
const ALPHA_HISTORY_LEN = 600

const GRAPH_W_PX = 240
const GRAPH_H_PX = 70


/**
 * Lightweight debug overlay for the AR sky-view feature.  Mounts when AR
 * is active.  Polls the ARController's debug snapshot via rAF and
 * renders the raw sensor sample (alpha/beta/gamma), sample count,
 * staleness, screen-orientation angle, and the resulting camera
 * quaternion.  Below the text panel a tiny canvas plots the raw and
 * filtered alpha against time so you can eyeball any periodic
 * residual the filter isn't catching.
 *
 * @param {object} props
 * @param {object} props.celestiary  Top-level controller; we read
 *   `celestiary.ar.getDebugSnapshot()` once per animation frame.
 * @returns {ReactElement | null}
 */
export default function ARDebugHUD({celestiary}) {
  const ar = useStore((s) => s.ar)
  const visible = useStore((s) => s.arDebugVisible)
  const [snap, setSnap] = useState(null)
  const canvasRef = useRef(null)
  // Pre-allocated circular ring buffer of recent (raw, post-notch,
  // filtered) alpha samples.  Lives outside React state because we
  // mutate it every animation frame and don't want to trigger renders
  // beyond what `setSnap` already does.  `head` is the index where the
  // *next* write goes; iteration walks forward from `head` (the
  // oldest slot) so the most recent sample lands at the right edge of
  // the graph.
  const historyRef = useRef({buf: makeHistoryBuffer(), head: 0})
  // Track the most recent ARController sampleCount so we can skip the
  // pushAlpha + canvas-redraw work when no new event has arrived since
  // the last rAF tick (DeviceOrientation is variable rate, often below
  // 60 Hz).  Avoids ~60 wasted redraws per second when the user holds
  // the phone perfectly still.
  const lastSampleCountRef = useRef(-1)

  useEffect(() => {
    if (!visible || !ar || !celestiary?.ar) {
      setSnap(null)
      historyRef.current = {buf: makeHistoryBuffer(), head: 0}
      lastSampleCountRef.current = -1
      return undefined
    }
    let raf = 0
    const tick = () => {
      const s = celestiary.ar.getDebugSnapshot()
      setSnap(s)
      const sampleCount = s?.poseSrc?.sampleCount ?? 0
      if (sampleCount !== lastSampleCountRef.current) {
        pushAlpha(historyRef.current, s)
        drawAlphaGraph(canvasRef.current, historyRef.current)
        lastSampleCountRef.current = sampleCount
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ar, celestiary, visible])

  if (!visible || !snap || !snap.active) {
    return null
  }

  const ps = snap.poseSrc ?? {}
  const ls = ps.lastSample
  const lr = ps.lastRawSample
  return (
    <Box
      data-testid='ar-debug-hud'
      sx={{
        position: 'fixed',
        top: '4em',
        right: '0.5em',
        maxWidth: '20em',
        p: '0.5em 0.75em',
        bgcolor: 'rgba(0, 0, 0, 0.55)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '0.72rem',
        lineHeight: 1.35,
        borderRadius: '0.4em',
        pointerEvents: 'none',
        zIndex: 1300,
      }}
    >
      <Box sx={{whiteSpace: 'pre'}}>
        {`kind:    ${ps.kind ?? 'n/a'}`}{'\n'}
        {`absolute:${ps.isAbsolute === true ? ' yes' : ' no '}`}{'\n'}
        {`event:   ${ps.lastEventType ?? '—'}`}{'\n'}
        {`samples: ${ps.sampleCount ?? 0}`}{'\n'}
        {`age(ms): ${ps.msSinceLastSample ?? '—'}`}{'\n'}
        {ls ? `α/β/γ:   ${fmt(ls.alpha)} / ${fmt(ls.beta)} / ${fmt(ls.gamma)}` : 'α/β/γ:   —'}{'\n'}
        {lr ? `raw:     ${fmt(lr.alpha)} / ${fmt(lr.beta)} / ${fmt(lr.gamma)}` : 'raw:     —'}{'\n'}
        {`screen:  ${snap.screenAngle}°`}{'\n'}
        {snap.camQuat ?
          `camQ:    (${snap.camQuat.x}, ${snap.camQuat.y}, ${snap.camQuat.z}, ${snap.camQuat.w})` :
          'camQ:    —'}{'\n'}
        {`arMode:  ${snap.arMode ? 'true' : 'FALSE'}`}{'\n'}
        {`uAtmEn:  ${snap.uAtmEnabled ?? '—'}`}{'\n'}
        {`@ lat ${fmt(snap.lat)} lng ${fmt(snap.lng)}`}
      </Box>
      <Box sx={{mt: '0.4em', fontSize: '0.6rem', opacity: 0.8}}>α (raw=grey, notch=orange, filt=green)</Box>
      <canvas
        ref={canvasRef}
        width={GRAPH_W_PX}
        height={GRAPH_H_PX}
        style={{display: 'block', width: '100%', height: `${GRAPH_H_PX}px`}}
      />
    </Box>
  )
}


/** @returns {Array<?object>} Pre-allocated history slots, all empty. */
function makeHistoryBuffer() {
  return new Array(ALPHA_HISTORY_LEN).fill(null)
}


/**
 * Append the current sample to the ring buffer.  O(1) per push (no
 * `shift()`).  Slots not yet written are `null` and `drawSeries`
 * skips them.
 *
 * @param {{buf: Array, head: number}} ring  Mutated in place
 * @param {object} snap  Latest debug snapshot
 */
function pushAlpha(ring, snap) {
  const ps = snap?.poseSrc
  const ls = ps?.lastSample
  const lr = ps?.lastRawSample
  if (!ls && !lr) {
    return
  }
  ring.buf[ring.head] = {
    f: typeof ls?.alpha === 'number' ? ls.alpha : null,
    n: typeof ps?.lastNotchedAlpha === 'number' ? ps.lastNotchedAlpha : null,
    r: typeof lr?.alpha === 'number' ? lr.alpha : null,
  }
  ring.head = (ring.head + 1) % ring.buf.length
}


/**
 * Plot raw + filtered alpha in the ring buffer onto the given canvas.
 * Y axis auto-scales to the visible value range with a 5° minimum span
 * (so the trace doesn't extreme-zoom and turn into a fuzz when both
 * series are nearly flat).
 *
 * @param {HTMLCanvasElement | null} canvas
 * @param {{buf: Array, head: number}} ring
 */
function drawAlphaGraph(canvas, ring) {
  if (!canvas) {
    return
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }
  const w = canvas.width
  const h = canvas.height
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
  ctx.fillRect(0, 0, w, h)
  let min = Infinity
  let max = -Infinity
  let count = 0
  for (const s of ring.buf) {
    if (s === null) {
      continue
    }
    count++
    for (const k of ['f', 'n', 'r']) {
      const v = s[k]
      if (typeof v === 'number') {
        if (v < min) {
          min = v
        }
        if (v > max) {
          max = v
        }
      }
    }
  }
  if (count < 2 || !isFinite(min) || !isFinite(max)) {
    return
  }
  const minSpan = 5 // degrees
  let span = max - min
  if (span < minSpan) {
    const mid = (min + max) / 2
    min = mid - (minSpan / 2)
    max = mid + (minSpan / 2)
    span = minSpan
  } else {
    const pad = span * 0.1
    min -= pad
    max += pad
    span = max - min
  }
  // Center reference line (mid of visible range).
  ctx.strokeStyle = 'rgba(0, 255, 0, 0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()
  drawSeries(ctx, ring, w, h, min, span, 'r', 'rgba(180, 180, 180, 0.85)', 1)
  drawSeries(ctx, ring, w, h, min, span, 'n', 'rgba(255, 165, 0, 0.85)', 1)
  drawSeries(ctx, ring, w, h, min, span, 'f', '#0f0', 1.5)
  // Y-axis labels (top = max, bottom = min).
  ctx.fillStyle = '#0f0'
  ctx.font = '9px monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`${max.toFixed(1)}°`, 2, 1)
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${min.toFixed(1)}°`, 2, h - 1)
}


/**
 * Stroke one series ('r' / 'n' / 'f') as a polyline.  Walks the ring
 * buffer in oldest-first order (starting at `ring.head`, the slot the
 * next write will overwrite, which is also the oldest current entry).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{buf: Array, head: number}} ring
 * @param {number} w
 * @param {number} h
 * @param {number} min
 * @param {number} span
 * @param {string} key  'r' for raw, 'n' for post-notch, 'f' for filtered
 * @param {string} color
 * @param {number} lineWidth
 */
function drawSeries(ctx, ring, w, h, min, span, key, color, lineWidth) {
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  let started = false
  const n = ring.buf.length
  for (let i = 0; i < n; i++) {
    const slot = ring.buf[(ring.head + i) % n]
    if (slot === null) {
      // Pre-fill not yet reached — break so a partial buffer renders
      // its written portion at the right edge of the graph instead of
      // creating phantom gaps in the middle.  Once the buffer wraps
      // around once, no slots are null and this branch never fires.
      started = false
      continue
    }
    const v = slot[key]
    if (typeof v !== 'number') {
      continue
    }
    const x = (i / (n - 1)) * w
    const y = h - (((v - min) / span) * h)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}


/** @param {number | null | undefined} v */
function fmt(v) {
  if (typeof v !== 'number') {
    return '—'
  }
  return v.toFixed(1)
}
