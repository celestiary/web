import {SRGBColorSpace, WebGLRenderer} from 'three'
import {makeNetGLGuestContext, parentTransport} from '@pablo-mayrgundter/portal-netgl/core'
import OrbitsLayer from './OrbitsLayer.js'
import {hostOrigin} from './origins.js'
import {meteredTransport} from './wire.js'
import {serveLayer} from './protocol.js'


// Layer mode's page (public/layer.html; design/LayerMode.md): celestiary's
// satellites and space networks as a NetGL guest, embedded by a host app as
// a cross-origin iframe.  The host's view and clock drive it; it draws into
// the host's context with no clears, testing the host's depth.
//
//   layer.html?nets=S,I,D&sats=1[&host=<origin>][&wire=1]
//
// The host's origin comes from location.ancestorOrigins, else the
// referrer, else `host`, and must be on the allow-list (origins.js), a
// constant of the build; nothing is sent or taken otherwise.
//
// The wire is portal-netgl 0.6.0's, negotiated in NetGL's handshake: the
// guest offers wire 2 and a MessageChannel port in `netgl:ready`, and a
// host whose ack says 2 gets a frame as one `netgl:batch`, on the port when
// it hands one over.  A 0.5 host's ack doesn't, and it gets wire 1, a
// message a call.  `wire=1` offers only 1, to compare.
//
// The guest never reads its own pixels, so its shadow context (which
// answers three's queries) doesn't run the draws: portal-netgl 0.6.2's
// `shadowDraws: false`, and the host's replay is the only one that draws.
// The shadow's canvas then stays 1×1, as three never reads its size back.
// `shadowDraws=1` draws on a full-size shadow as before, to compare.


const params = new URLSearchParams(location.search)
const origin = hostOrigin({search: location.search, referrer: document.referrer, ancestors: location.ancestorOrigins})
if (!origin || window.parent === window) {
  document.body.textContent = 'celestiary layer mode: embed this page in an allowed host (design/LayerMode.md).'
} else {
  // Pinned to the host's one origin both ways, and metered (layer:stats),
  // the port included (wire.js).
  const meter = meteredTransport(parentTransport({hostOrigins: [origin]}))
  // With checkpoints (the default): each frame replays from the guest's own
  // GL state, whatever the host left.  The port carries the guest's stream
  // and its own messages ('stream'); the host's come on the window.
  const shadowDraws = params.get('shadowDraws') === '1'
  const guest = makeNetGLGuestContext({transport: meter.transport, messageChannel: 'stream',
    wire: params.get('wire') === '1' ? 1 : 2, shadowDraws})
  // The app's messages go the stream's way, so a frame's anchors follow
  // its batch on the port.
  const {transport} = guest
  const renderer = new WebGLRenderer({context: guest.gl, canvas: guest.shadow.canvas, antialias: false, alpha: true})
  renderer.autoClear = false
  renderer.sortObjects = false
  // The host blends stored sRGB bytes straight to its screen: display
  // referred, as celestiary's overlay pass.
  renderer.outputColorSpace = SRGBColorSpace
  const nets = (params.get('nets') ?? 'S,I,D').split(',').map((k) => k.trim()).filter((k) => ['S', 'I', 'D'].includes(k))
  const layer = new OrbitsLayer()
  const loaded = layer.load({satellites: params.get('sats') !== '0', networks: nets})
  let size = ''
  const served = serveLayer({
    transport, layer, loaded, meter,
    render: () => layer.render(renderer),
    endFrame: () => guest.endFrame(),
    // NetGL's handshake, which portal-netgl's hosts wait on, and where the
    // wire is agreed; an overlay has no door, so the anchor is nominal.
    announce: () => guest.announce({position: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0]}),
    resize: ([x, y, w, h], pixelRatio) => {
      const key = `${x},${y},${w},${h},${pixelRatio}`
      if (key !== size) {
        size = key
        renderer.setPixelRatio(pixelRatio)
        renderer.setSize((x + w) / pixelRatio, (y + h) / pixelRatio, false)
        if (!shadowDraws) {
          // three keeps the size it was given (its viewport, its pixel
          // ratio); only the undrawn shadow's buffer goes back to 1×1.
          guest.shadow.canvas.width = 1
          guest.shadow.canvas.height = 1
        }
        renderer.setViewport(x / pixelRatio, y / pixelRatio, w / pixelRatio, h / pixelRatio)
      }
    },
  })
  window.celestiaryLayer = {layer, renderer, guest, origin, meter, served, shadowDraws}
}
