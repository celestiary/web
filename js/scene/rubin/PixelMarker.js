import {BufferGeometry, Color, Float32BufferAttribute, LinearSRGBColorSpace, Mesh, ShaderMaterial, Vector2} from 'three'


// Rubin's pixel on the sky (Rubin.md, "The optics"; #339): at the body's
// place, a blunt square the instrument's pixel across, and round it a
// fainter square outline at the resolution it delivers (Rubin's 0.7″
// seeing), drawn in screen pixels on the overlay layer.  From the seat
// zoomed to the pixel limit, 2026 ED138's disc (0.03″) sits well inside
// one square: the marker says what the instrument can tell apart, without
// a number.  Any instrument with a `pixelScaleArcsec` gets the same.

/**
 * The marker's colour, its own (amber: not the path's teal or the orbit
 * line's blue), as the display value it shows: the scene is drawn
 * unencoded, so a hex colour three reads as sRGB would show darker and
 * redder (farPoint.js farPointColor).
 */
export const PIXEL_COLOR = [1, 0.71, 0.33]
/** The pixel's square is this opaque at a full pixel or more; the resolution's outline fainter. */
const PIXEL_ALPHA = 0.9
const RESOLUTION_ALPHA = 0.5


/**
 * The size law: an angle on the sky as a square on the screen.  The angle
 * is `angleArcsec` of the vertical field `fovDeg` over a canvas `heightPx`
 * high, so it spans `angle / field × height` screen pixels.  Under one
 * pixel the square holds one pixel and its opacity falls with the
 * fraction, so it never claims more than the instrument has: at the pixel
 * limit (the field where this is 1) it is one full pixel, wider it fades
 * out, narrower it grows.
 *
 * @param {number} fovDeg The camera's field, vertical
 * @param {number} heightPx The canvas's height, device pixels
 * @param {number} angleArcsec A pixel's, or the delivered resolution's
 * @returns {{sidePx: number, opacity: number}} sidePx at least 1; opacity
 *   0 to 1 (0 for an angle or a field that isn't positive)
 */
export function pixelMarkerSize(fovDeg, heightPx, angleArcsec) {
  if (!(fovDeg > 0 && heightPx > 0 && angleArcsec > 0)) {
    return {sidePx: 1, opacity: 0}
  }
  const raw = angleArcsec / 3600 / fovDeg * heightPx
  return {sidePx: Math.max(raw, 1), opacity: Math.min(raw, 1)}
}


/**
 * Two screen-aligned squares at the origin of the node, each as a quad of
 * four vertices whose `position` is its corner (x, y in -1 to 1) and z the
 * square's kind: 0 the pixel, 1 the resolution.
 *
 * @returns {BufferGeometry}
 */
function newQuads() {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const positions = []
  const index = []
  for (let kind = 0; kind < 2; kind++) {
    const base = kind * 4
    for (const [x, y] of corners) {
      positions.push(x, y, kind)
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  return geometry
}


/**
 * @param {Function} sceneReferred hdr.js's, handed in (a display-valued colour)
 * @returns {ShaderMaterial}
 */
function newMaterial(sceneReferred) {
  return sceneReferred(new ShaderMaterial({
    uniforms: {
      uColor: {value: new Color().setRGB(...PIXEL_COLOR, LinearSRGBColorSpace)},
      uViewport: {value: new Vector2(1, 1)},
      uSidePx: {value: new Vector2(1, 1)},
      uOpacity: {value: new Vector2(0, 0)},
    },
    // The quad's corners are offset from the node's clip position by their
    // side in screen pixels (clip = ndc × w), so the size is exact at any
    // field and never limited by the GPU's point sizes.  The centre is
    // held to a pixel's centre, so a one-pixel square always covers exactly
    // one pixel (on a boundary it could cover none), and the resolution's
    // 3.5 px outline is a ring round it.  Behind the camera (w <= 0) it is
    // sent out of the clip volume.
    vertexShader: `
      uniform vec2 uViewport;
      uniform vec2 uSidePx;
      varying vec2 vUv;
      varying float vKind;
      varying float vSidePx;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float side = position.z < 0.5 ? uSidePx.x : uSidePx.y;
        if (clip.w <= 0.0) {
          clip = vec4(2.0, 2.0, 2.0, 1.0);
        } else {
          vec2 centre = (floor((clip.xy / clip.w * 0.5 + 0.5) * uViewport) + 0.5) / uViewport * 2.0 - 1.0;
          clip.xy = (centre + position.xy * (side / uViewport)) * clip.w;
        }
        vUv = position.xy;
        vKind = position.z;
        vSidePx = side;
        gl_Position = clip;
      }`,
    // The pixel is filled; the resolution is its outline, one screen pixel
    // wide (the whole square once it is under two).
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec2 uOpacity;
      varying vec2 vUv;
      varying float vKind;
      varying float vSidePx;
      void main() {
        float a;
        if (vKind < 0.5) {
          a = ${PIXEL_ALPHA.toFixed(2)} * uOpacity.x;
        } else {
          float edge = (1.0 - max(abs(vUv.x), abs(vUv.y))) * vSidePx * 0.5;
          if (edge > 1.0) {
            discard;
          }
          a = ${RESOLUTION_ALPHA.toFixed(2)} * uOpacity.y;
        }
        if (a <= 0.0) {
          discard;
        }
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }))
}


/** */
export default class PixelMarker extends Mesh {
  /**
   * @param {object} opts
   * @param {() => {instrument: ?object, fovDeg: number, heightPx: number}} opts.view
   *   The camera's field and the canvas's height in device pixels, and
   *   the active instrument (its `pixelScaleArcsec` and `resolutionArcsec`),
   *   read each frame (install.js)
   * @param {object} opts.deps The first load's functions, handed in
   *   (install.js; rubin.js says why): `sceneReferred` (hdr.js) and
   *   `OVERLAY_LAYER` (shared.js)
   * @param {?number} [opts.layer] deps.OVERLAY_LAYER by default
   */
  constructor({view, deps, layer = deps.OVERLAY_LAYER}) {
    super(newQuads(), newMaterial(deps.sceneReferred))
    this.name = 'rubin pixel marker'
    this.view = view
    // The panel's switch; `visible` is also the instrument's having a pixel.
    this.enabled = false
    this.visible = false
    this.frustumCulled = false
    this.raycast = () => undefined
    this.renderOrder = 1000
    if (layer !== null) {
      this.layers.set(layer)
    }
    this.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(this.material.uniforms.uViewport.value)
    }
    this.preAnimCb = () => this.update()
  }


  /**
   * Size the squares to the frame's field and canvas, and hide them if the
   * switch is off or the instrument has no pixel.
   */
  update() {
    const {instrument, fovDeg, heightPx} = this.view()
    const pixelArcsec = instrument?.pixelScaleArcsec
    this.visible = this.enabled && pixelArcsec > 0
    if (!this.visible) {
      return
    }
    // The delivered resolution is the pixel's where the instrument has no other.
    const resolutionArcsec = instrument.resolutionArcsec > 0 ? instrument.resolutionArcsec : pixelArcsec
    const pixel = pixelMarkerSize(fovDeg, heightPx, pixelArcsec)
    const resolution = pixelMarkerSize(fovDeg, heightPx, resolutionArcsec)
    const {uSidePx, uOpacity} = this.material.uniforms
    uSidePx.value.set(pixel.sidePx, resolution.sidePx)
    uOpacity.value.set(pixel.opacity, resolution.opacity)
  }


  /** Out of the scene. */
  dispose() {
    this.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}
