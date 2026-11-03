import {iframeTransport, makeNetGLHostReceiver} from '@pablo-mayrgundter/portal-netgl/core'
import {gmstRad} from '../../js/scene/celestialFrame.js'
import {unixMsToJd} from '../../js/scene/satellites/sgp4.js'


// A check host for the sky guest (design/SkyGuest.md), on another origin
// than the guest's, as tools/layer/host.js is for layer mode's orbits: it
// embeds sky.html, sends a camera at a place on Earth looking at an azimuth
// and altitude, as a rotation in the equator of date with a perspective,
// and replays each frame onto its own canvas.  No three: the frame is the
// guest's alone.
//
//   host.html?guest=<origin>[&lat=55.62&lon=0][&az=180&alt=20][&fov=60]
//     [&t=<ISO>][&rate=0][&w=640&h=400]
//
// window.hostState: the hello, the status, frames, errors, the last view;
// window.look(az, alt) turns the camera, window.at(iso) sets the time.


const q = new URLSearchParams(location.search)
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d)
const W = num('w', 640)
const H = num('h', 400)
const guestOrigin = new URL(q.get('guest') ?? 'http://127.0.0.1:5482').origin
const meterParam = (q.has('meter') ? `&meter=${q.get('meter')}` : '') + (q.has('output') ? `&output=${q.get('output')}` : '')
const look = {az: num('az', 180), alt: num('alt', 20), fov: num('fov', 60)}
const site = {lat: num('lat', 55.62), lon: num('lon', 0)}
const clock = {t0: q.has('t') ? Date.parse(q.get('t')) : Date.now(), at: performance.now(), rate: num('rate', 0)}
const state = {hello: null, status: [], frames: 0, errors: [], viewId: 0, lastView: null, ready: null}
window.hostState = state

const canvas = document.body.appendChild(document.createElement('canvas'))
canvas.width = W
canvas.height = H
const gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true, antialias: false})

/** @returns {number} Unix ms */
const nowMs = () => clock.t0 + ((performance.now() - clock.at) * clock.rate)

/**
 * The camera at the site, looking at (az, alt), as a view matrix from the
 * equator of date (column-major).
 *
 * @param {number} timeMs
 * @returns {Array<number>}
 */
function viewMatrix(timeMs) {
  const th = gmstRad(unixMsToJd(timeMs)) + (site.lon * Math.PI / 180)
  const phi = site.lat * Math.PI / 180
  const up = [Math.cos(phi) * Math.cos(th), Math.cos(phi) * Math.sin(th), Math.sin(phi)]
  const east = [-Math.sin(th), Math.cos(th), 0]
  const north = [-Math.sin(phi) * Math.cos(th), -Math.sin(phi) * Math.sin(th), Math.cos(phi)]
  const a = look.az * Math.PI / 180
  const e = look.alt * Math.PI / 180
  const f = [0, 1, 2].map((i) => (Math.cos(e) * ((Math.cos(a) * north[i]) + (Math.sin(a) * east[i]))) + (Math.sin(e) * up[i]))
  const z = f.map((v) => -v)
  const cross = (u, v) => [(u[1] * v[2]) - (u[2] * v[1]), (u[2] * v[0]) - (u[0] * v[2]), (u[0] * v[1]) - (u[1] * v[0])]
  const norm = (v) => v.map((x) => x / Math.hypot(...v))
  const x = norm(cross(up, z))
  const y = cross(z, x)
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1]
}

/** @returns {Array<number>} the perspective, column-major */
function projection() {
  const f = 1 / Math.tan(look.fov * Math.PI / 360)
  const n = 1
  const far = 1e8
  return [f * H / W, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + n) / (n - far), -1, 0, 0, (2 * far * n) / (n - far), 0]
}

const view = () => {
  const timeMs = nowMs()
  state.lastView = {timeMs, ...look, ...site}
  return {type: 'layer:view', viewId: ++state.viewId, view: {frame: 'equator-of-date', viewMatrix: viewMatrix(timeMs),
    projectionMatrix: projection(), viewport: [0, 0, W, H], pixelRatio: 1, timeMs, observer: {...site, alt: 0}}}
}

const iframe = document.createElement('iframe')
Object.assign(iframe.style, {position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0',
  opacity: '0'})
iframe.src = `${guestOrigin}/sky.html?host=${encodeURIComponent(location.origin)}${meterParam}`
document.body.appendChild(iframe)
const receiver = makeNetGLHostReceiver({
  gl, transport: iframeTransport(iframe, {origin: guestOrigin}),
  onError: (err) => state.errors.push(String(err)),
  onReady: (msg) => (state.ready = {...msg}),
  onControl: (msg) => {
    if (msg.type === 'layer:hello' && !state.hello) {
      state.hello = msg
      receiver.post({type: 'layer:hello-ack', accepted: true})
      receiver.post(view())
    } else if (msg.type === 'layer:status') {
      state.status.push(msg)
    }
  },
})
// One view in flight: replay a frame onto the canvas, then ask for the next.
receiver.onFrame(() => {
  setTimeout(() => {
    receiver.drain()
    state.frames++
    receiver.post(view())
  }, 50)
})
window.look = (az, alt, fov = look.fov) => Object.assign(look, {az, alt, fov})
window.at = (iso, rate = 0) => Object.assign(clock, {t0: Date.parse(iso), at: performance.now(), rate})
