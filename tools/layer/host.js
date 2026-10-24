// A small layer-mode host for checks (tools/layer/serve.mjs; design/LayerMode.md):
// a three.js globe in ECEF metres, with celestiary's layer.html embedded as a
// cross-origin iframe and replayed into this page's context through NetGL.
// It also draws its own references, computed without celestiary's code
// (satellite.js's ECI to ECF, the lat/lng sphere), to check the layer lines
// up: the ISS's ring, the geostationary circle, the DSN complexes' squares.
//
//   host.html?guest=<origin>&t=<ISO>&rate=0&lat=&lng=&altKm=&fov=&nets=S,I,D&sats=1&depth=1&w=&h=
//     &stats=0&anchors=norad:25544,dsn:*,dsn-sc:*&compact=1
//
// `rate` runs the clock from `t` (1 is real time; 0, the default, holds it);
// `stats=1` asks for the guest's `layer:stats`, kept in hostState.guestStats;
// `anchors` is the subscription (`none` for none).

import {
  BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial,
  PerspectiveCamera, Points, Scene, ShaderMaterial, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three'
import {eciToEcf, gstime, json2satrec, propagate} from 'satellite.js'
import {makeNetGLHostReceiver, windowTransport} from '@pablo-mayrgundter/portal-netgl'


const q = new URLSearchParams(location.search)
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d)
const R = 6378137
const DEG = Math.PI / 180
const startMs = q.has('t') ? Date.parse(q.get('t')) : Date.now()
const rate = num('rate', 0)
const startedAt = performance.now()
// The view's time: held at t, or running from it at `rate`.
const viewTimeMs = () => startMs + ((performance.now() - startedAt) * rate)
const timeMs = startMs
const W = num('w', 640)
const H = num('h', 400)
const guestOrigin = q.get('guest') ?? 'http://127.0.0.1:5480'

const ecef = (lat, lng, alt = 0) => {
  const r = R + alt
  return new Vector3(r * Math.cos(lat * DEG) * Math.cos(lng * DEG), r * Math.cos(lat * DEG) * Math.sin(lng * DEG), r * Math.sin(lat * DEG))
}

const canvas = document.createElement('canvas')
canvas.width = W
canvas.height = H
document.body.appendChild(canvas)
const renderer = new WebGLRenderer({canvas, antialias: false, preserveDrawingBuffer: true, alpha: false})
renderer.setPixelRatio(1)
renderer.setSize(W, H, false)
renderer.outputColorSpace = SRGBColorSpace
const gl = renderer.getContext()

// The globe, tessellated in ECEF with its texture's equirectangular UVs.
const scene = new Scene()
scene.background = new Color(0x000000)
const N = 128
const pos = []
const uv = []
const index = []
for (let i = 0; i <= N; i++) {
  const lat = 90 - (180 * i / N)
  for (let j = 0; j <= 2 * N; j++) {
    const lng = -180 + (360 * j / (2 * N))
    pos.push(...ecef(lat, lng).toArray())
    uv.push(j / (2 * N), 1 - (i / N))
  }
}
for (let i = 0; i < N; i++) {
  for (let j = 0; j < 2 * N; j++) {
    const a = (i * ((2 * N) + 1)) + j
    const b = a + (2 * N) + 1
    index.push(a, b, a + 1, b, b + 1, a + 1)
  }
}
const globeGeom = new BufferGeometry()
globeGeom.setAttribute('position', new Float32BufferAttribute(pos, 3))
globeGeom.setAttribute('uv', new Float32BufferAttribute(uv, 2))
globeGeom.setIndex(index)
const texture = new TextureLoader().load('earth.jpg', () => (state.textured = true))
texture.colorSpace = SRGBColorSpace
scene.add(new Mesh(globeGeom, new MeshBasicMaterial({map: texture})))

// The references.
const ring = (color) => new ShaderMaterial({
  uniforms: {uColor: {value: new Color(color)}},
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = 18.0; }',
  fragmentShader: `uniform vec3 uColor; void main() { float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0 || r < 0.75) discard; gl_FragColor = vec4(uColor, 1.0); }`,
  depthTest: false, transparent: true,
})
const marks = new BufferGeometry()
scene.add(new Points(marks, ring(0xff3030)))
const geo = []
for (let k = 0; k < 360; k++) {
  geo.push(42164e3 * Math.cos(k * DEG), 42164e3 * Math.sin(k * DEG), 0)
}
const geoGeom = new BufferGeometry()
geoGeom.setAttribute('position', new Float32BufferAttribute(geo, 3))
scene.add(new LineLoop(geoGeom, new LineBasicMaterial({color: 0x808080, transparent: true, opacity: 0.6})))
const SITES = {gdscc: [35.2443523, -116.8895382], mdscc: [40.2413554, -4.2480085], cdscc: [-35.2209189, 148.9812673]}
const siteGeom = new BufferGeometry()
siteGeom.setAttribute('position', new Float32BufferAttribute(Object.values(SITES).flatMap(([la, ln]) => ecef(la, ln).toArray()), 3))
const siteMat = ring(0xffe040)
siteMat.depthTest = true
scene.add(new Points(siteGeom, siteMat))

// The camera: over lat, lng at altKm, looking at Earth's centre, north up.
const camera = new PerspectiveCamera(num('fov', 45), W / H, num('near', 1e4), num('far', 1e9))
camera.up.set(0, 0, 1)
camera.position.copy(ecef(num('lat', 20), num('lng', 0), num('altKm', 30000) * 1e3))
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld()

const state = {frames: 0, anchors: [], status: [], hello: null, iss: null, issErrorKm: null, textured: false, viewId: 0,
  errors: []}
window.hostState = state

// The ISS by satellite.js on its own: ECI (TEME) to ECF by its gstime, at
// the view's start, and again at each anchors message's time.
let issRec = null
const issAt = (ms) => {
  const date = new Date(ms)
  const f = eciToEcf(propagate(issRec, date).position, gstime(date))
  return [f.x * 1e3, f.y * 1e3, f.z * 1e3]
}
fetch('satellites.json').then((r) => r.json()).then(({columns, rows}) => {
  const row = rows.find((x) => x[0] === 25544)
  issRec = json2satrec(Object.fromEntries(columns.map((c, i) => [c, row[i]])))
  state.iss = issAt(timeMs)
  marks.setAttribute('position', new Float32BufferAttribute(state.iss, 3))
})

// The guest.
const iframe = document.createElement('iframe')
iframe.style.display = 'none'
iframe.src = `${guestOrigin}/layer.html?host=${encodeURIComponent(location.origin)}&nets=${q.get('nets') ?? 'S,I,D'}` +
  `&sats=${q.get('sats') ?? '1'}${q.has('compact') ? `&compact=${q.get('compact')}` : ''}`
document.body.appendChild(iframe)
const transport = windowTransport({output: iframe.contentWindow, outputOrigin: guestOrigin, inputFilter: iframe.contentWindow})
// portal-netgl 0.4.0's envelope (NetGLLayerViewMessage), as its deck.gl host sends it.
const view = () => ({
  type: 'layer:view', viewId: ++state.viewId, view: {
    frame: 'ecef', viewMatrix: camera.matrixWorldInverse.toArray(), projectionMatrix: camera.projectionMatrix.toArray(),
    viewport: [0, 0, W, H], pixelRatio: 1, timeMs: viewTimeMs(), earth: {model: 'sphere', radius: R},
  },
})
// What the guest's frames hold: it mustn't clear the host's buffers.
state.calls = 0
state.clears = 0
state.byName = {}
// Per frame, as received: GL calls and their buffers' bytes, the last 120.
state.perFrame = []
state.guestStats = []
let frameIn = {calls: 0, bytes: 0}
const bufferBytes = (v) => {
  if (!v || typeof v !== 'object') {
    return 0
  }
  if (v instanceof ArrayBuffer) {
    return v.byteLength
  }
  return (Array.isArray(v) ? v : Object.values(v)).reduce((n, x) => n + bufferBytes(x), 0)
}
transport.onMessage((m) => {
  // The frame's receipt, as 0.4.0's host takes it (receiver.onFrame): its
  // frame-end.  Draw it, then send the next view (one in flight).
  if (m.type === 'netgl:frame-end') {
    state.perFrame.push(frameIn)
    if (state.perFrame.length > 120) {
      state.perFrame.shift()
    }
    frameIn = {calls: 0, bytes: 0}
    setTimeout(() => {
      frame()
      state.frames++
      transport.post(view())
    }, 100)
  }
  if (typeof m.name === 'string') {
    state.calls++
    state.byName[m.name] = (state.byName[m.name] ?? 0) + 1
    frameIn.calls++
    frameIn.bytes += bufferBytes(m.args)
    if (m.name === 'clear') {
      state.clears++
    }
  }
})
const receiver = makeNetGLHostReceiver({
  gl, transport,
  onError: (err) => state.errors.push(String(err)),
  onControl: (msg) => {
    if (msg.type === 'layer:hello') {
      if (!state.hello) {
        state.hello = msg
        transport.post({type: 'layer:hello-ack', accepted: true})
        const patterns = (q.get('anchors') ?? 'norad:25544,dsn:*,dsn-sc:*').split(',').filter((p) => p && p !== 'none')
        transport.post({type: 'layer:anchors-subscribe', patterns})
        if (q.get('stats') === '1') {
          transport.post({type: 'layer:stats-subscribe', intervalMs: 1000})
        }
        transport.post(view())
      }
    } else if (msg.type === 'layer:stats') {
      state.guestStats.push(msg)
    } else if (msg.type === 'layer:status') {
      state.status.push(msg)
    } else if (msg.type === 'layer:anchors') {
      state.anchors = msg.anchors
      const a = msg.anchors.find((x) => x.id === 'norad:25544')
      if (a && issRec) {
        const iss = issAt(msg.timeMs)
        state.issErrorKm = Math.hypot(...a.p.map((v, k) => v - iss[k])) / 1e3
      }
    }
  },
})

/** The globe, then the guest's frame over it, in the same depth. */
function frame() {
  renderer.render(scene, camera)
  if (q.get('depth') === '0') {
    gl.clear(gl.DEPTH_BUFFER_BIT)
  }
  receiver.drain()
  renderer.resetState()
}
window.hostFrame = frame
