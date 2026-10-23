import {SRGBColorSpace, WebGLRenderer} from 'three'
import {makeNetGLGuestContext} from '@pablo-mayrgundter/portal-netgl'
import OrbitsLayer from './OrbitsLayer.js'
import {hostOrigin, originTransport} from './origins.js'
import {serveLayer} from './protocol.js'


// Layer mode's page (public/layer.html; design/LayerMode.md): celestiary's
// satellites and space networks as a NetGL guest, embedded by a host app as
// a cross-origin iframe.  The host's view and clock drive it; it draws into
// the host's context with no clears, testing the host's depth.
//
//   layer.html?host=<origin>&nets=S,I,D&sats=1
//
// `host` names the host's origin (else the referrer's), which must be on the
// allow-list (origins.js); nothing is sent or taken otherwise.


const params = new URLSearchParams(location.search)
const origin = hostOrigin({search: location.search, referrer: document.referrer})
if (!origin || window.parent === window) {
  document.body.textContent = 'celestiary layer mode: embed this page in an allowed host (design/LayerMode.md).'
} else {
  const transport = originTransport({target: window.parent, origin})
  // With checkpoints (the default): each frame replays from the guest's own
  // GL state, whatever the host left.
  const guest = makeNetGLGuestContext({transport})
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
  serveLayer({
    transport, layer, loaded,
    render: () => layer.render(renderer),
    endFrame: () => guest.endFrame(),
    resize: ([x, y, w, h], pixelRatio) => {
      const key = `${x},${y},${w},${h},${pixelRatio}`
      if (key !== size) {
        size = key
        renderer.setPixelRatio(pixelRatio)
        renderer.setSize((x + w) / pixelRatio, (y + h) / pixelRatio, false)
        renderer.setViewport(x / pixelRatio, y / pixelRatio, w / pixelRatio, h / pixelRatio)
      }
    },
  })
  window.celestiaryLayer = {layer, renderer, guest, origin}
}
