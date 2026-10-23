import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import {sceneReferred} from './hdr.js'
import {POINT_NAMES, lagrangePoints, placePoints} from './lagrange.js'
import SpriteSheet from './SpriteSheet.js'
import {newWideLineStrip} from './wideLines.js'


// The space around a pair (lagrange.js; Lagrange.md): its five Lagrange
// points, the secondary's Hill sphere and its synchronous orbit, drawn on
// the overlay layer in the orbits group (`o`).  One per pair, made when the
// target first needs it (Scene._syncLagrange) and laid each frame on the
// pair as it is (Animation.layLagrange).
//
// The group hangs beside the secondary's orbitPosition, in its primary's
// unrotated frame, so the secondary's position is the pair's line.  The
// synchronous orbit's ring hangs from the secondary's planetTilt, in its
// equator.


const COLORS = {point: 0x8fe3b0, hill: 0x8fb8e3, sync: 0xe3c88f, unstable: 0x9a9a9a}
const POINT_SIZE_PX = 9
const RING_POINTS = 129
const LINE_WIDTH = 1.25
const HILL_OPACITY = 0.5
const SYNC_OPACITY = 0.7
// A label shows when what it names spans this much of the screen (an L1 or
// L2 its distance from the secondary, the rest the pair's separation, the
// Hill sphere and the synchronous orbit their radii), and the points when
// the pair spans MIN_PAIR_PX: else, from afar, they pile up on the bodies.
const MIN_LABEL_PX = 50
const MIN_PAIR_PX = 12
const noRaycast = () => undefined
const tmpQ = new Quaternion
const tmpV = new Vector3
const tmpRes = new Vector2


/**
 * @param {number} color
 * @returns {string} as a canvas takes it
 */
function cssColor(color) {
  return `#${color.toString(16).padStart(6, '0')}`
}


/**
 * A unit circle in the XZ plane.
 *
 * @returns {Float32Array}
 */
function unitCircle() {
  const out = new Float32Array(RING_POINTS * 3)
  for (let k = 0; k < RING_POINTS; k++) {
    const t = 2 * Math.PI * k / (RING_POINTS - 1)
    out[3 * k] = Math.cos(t)
    out[(3 * k) + 2] = -Math.sin(t)
  }
  return out
}


/**
 * @param {number} color
 * @param {number} n
 * @returns {Points} n screen-sized rings, their places set by the owner
 */
function newRings(color, n) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3))
  const material = sceneReferred(new ShaderMaterial({
    uniforms: {uColor: {value: new Color(color)}, uSize: {value: POINT_SIZE_PX}, uPixelRatio: {value: 1}},
    vertexShader: `
      uniform float uSize;
      uniform float uPixelRatio;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * uPixelRatio;
      }`,
    // A ring: symmetric, so SwiftShader's flipped gl_PointCoord in shaders
    // that discard (AGENTS.md) doesn't show.
    fragmentShader: `
      uniform vec3 uColor;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(0.55, 0.7, r) * (1.0 - smoothstep(0.85, 1.0, r));
        if (a <= 0.0) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  }))
  const points = new Points(geometry, material)
  points.frustumCulled = false
  points.raycast = noRaycast
  points.onBeforeRender = (renderer) => {
    material.uniforms.uPixelRatio.value = renderer.getPixelRatio()
  }
  return points
}


/**
 * @param {Array<{text: string, color: number, at: ?Array<number>}>} entries
 * @returns {{sheet: SpriteSheet, sprites: Points}}
 */
function newLabels(entries) {
  const sheet = new SpriteSheet(entries.length, entries.map((l) => l.text))
  for (const l of entries) {
    sheet.add(...(l.at ?? [0, 0, 0]), l.text, cssColor(l.color))
  }
  const sprites = sheet.compile()
  sprites.frustumCulled = false
  sprites.raycast = noRaycast
  return {sheet, sprites}
}


/**
 * @param {object} renderer
 * @param {object} camera a perspective camera
 * @param {Vector3} at a world position
 * @returns {number} how many pixels a metre across at `at` spans
 */
function pixelsPerMetre(renderer, camera, at) {
  const target = renderer.getRenderTarget()
  const height = target ? target.height / renderer.getPixelRatio() : renderer.getSize(tmpRes).y
  const dist = camera.getWorldPosition(tmpCam).distanceTo(at)
  return height / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(dist, 1))
}
const tmpCam = new Vector3


/** */
export default class LagrangeMarks extends Group {
  /**
   * @param {object} pair
   * @param {string} pair.name e.g. 'Earth-Moon', for the labels
   * @param {number} pair.mu the secondary's share of the mass
   * @param {number} pair.hill the secondary's Hill radius, metres
   * @param {?object} pair.sync lagrange.js synchronousOrbit, or null
   * @param {string} pair.secondary the secondary's display name
   * @param {string} [pair.syncName] e.g. 'geostationary orbit'
   * @param {number} [layer] Put every part on this layer
   */
  constructor({name, mu, hill, sync, secondary, syncName = 'synchronous orbit'}, layer = null) {
    super()
    this.name = `${name} Lagrange`
    this.mu = mu
    this.hillRadius = hill
    this.sync = sync
    this.lagrange = lagrangePoints(mu)
    /** The points' places, metres from the primary: set by place(). */
    this.places = POINT_NAMES.map(() => new Vector3)
    this.points = newRings(COLORS.point, POINT_NAMES.length)
    this.points.name = 'lagrange.points'
    this.add(this.points)
    this.labels = newLabels([
      ...POINT_NAMES.map((p) => ({text: `${name} ${p}`, color: COLORS.point})),
      {text: `${secondary}'s Hill sphere`, color: COLORS.hill},
    ])
    this.labels.sprites.name = 'lagrange.labels'
    // The labels always draw (each shown or not by its attribute), so they
    // can switch the points back on: _declutter.
    const labelsDrawn = this.labels.sprites.onBeforeRender
    this.labels.sprites.onBeforeRender = (renderer, scene, camera, ...rest) => {
      this._declutter(renderer, camera)
      labelsDrawn?.call(this.labels.sprites, renderer, scene, camera, ...rest)
    }
    this.add(this.labels.sprites)
    // The Hill sphere's outline: a unit circle turned to face the camera,
    // at the secondary, scaled to the radius.
    this.hill = new Group
    this.hill.name = 'lagrange.hill'
    this.hillRing = newWideLineStrip(unitCircle(), {name: 'lagrange.hillRing', color: COLORS.hill,
      width: LINE_WIDTH, opacity: HILL_OPACITY})
    const drawn = this.hillRing.onBeforeRender
    this.hillRing.onBeforeRender = (renderer, scene, camera, ...rest) => {
      this._faceCamera(camera)
      drawn.call(this.hillRing, renderer, scene, camera, ...rest)
    }
    this.hill.add(this.hillRing)
    this.add(this.hill)
    // The synchronous orbit, where the secondary can hold one; hung from
    // its planetTilt by the owner (syncRing.parent).
    this.syncRing = null
    if (sync && !sync.why) {
      this.syncRing = new Group
      this.syncRing.name = 'lagrange.sync'
      const ring = newWideLineStrip(unitCircle(), {name: 'lagrange.syncRing', color: COLORS.sync,
        width: LINE_WIDTH, opacity: SYNC_OPACITY})
      ring.scale.setScalar(sync.radius)
      this.syncRing.add(ring)
      // By its radius: an altitude over the descriptors' mean radius isn't
      // the usual one, over the equator (GEO's 35,786 km).
      const km = Math.round(sync.radius / 1e3).toLocaleString('en-US')
      this.syncLabels = newLabels([{text: `${syncName}, ${km} km radius`, color: COLORS.sync,
        at: [sync.radius, 0, 0]}])
      const ringDrawn = ring.onBeforeRender
      ring.onBeforeRender = (renderer, scene, camera, ...rest) => {
        const px = pixelsPerMetre(renderer, camera, this.syncRing.getWorldPosition(tmpV)) * sync.radius
        this.syncLabels.sheet.setShown?.(0, px >= MIN_LABEL_PX)
        ringDrawn.call(ring, renderer, scene, camera, ...rest)
      }
      this.syncRing.add(this.syncLabels.sprites)
    }
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
      this.syncRing?.traverse((o) => o.layers.set(layer))
    }
  }


  /**
   * Lay the marks on the pair as it is.
   *
   * @param {Vector3} r the secondary's place (for Earth, the Earth-Moon
   *     barycentre's) relative to the primary, metres, in this group's frame
   * @param {Vector3} pole the pair's orbit pole, r × v
   * @param {Vector3} [body] the secondary's own place, where it isn't r:
   *     the Hill sphere is centred on it
   */
  place(r, pole, body = r) {
    placePoints(this.lagrange, r, pole, this.places)
    this._separation = r.length()
    const attr = this.points.geometry.getAttribute('position')
    this.places.forEach((p, k) => attr.setXYZ(k, p.x, p.y, p.z))
    attr.needsUpdate = true
    this.hill.position.copy(body)
    this.hill.scale.setScalar(this.hillRadius)
    const labels = this.labels.sheet.positionAttribute
    if (labels) {
      this.places.forEach((p, k) => labels.setXYZ(k, p.x, p.y, p.z))
      // The Hill sphere's name, at its edge on the pole's side.
      tmpV.copy(pole).normalize().multiplyScalar(this.hillRadius).add(body)
      labels.setXYZ(POINT_NAMES.length, tmpV.x, tmpV.y, tmpV.z)
      labels.needsUpdate = true
    }
  }


  /**
   * Show the labels whose features are big enough on screen to tell apart,
   * and the points only when the pair is (MIN_LABEL_PX, MIN_PAIR_PX).  For
   * the next frame: the frame's draw list and attributes are made before
   * this runs.
   *
   * @param {object} renderer
   * @param {object} camera
   */
  _declutter(renderer, camera) {
    const perMetre = pixelsPerMetre(renderer, camera, this.hill.getWorldPosition(tmpV))
    const d = this._separation ?? 0
    const pair = perMetre * d
    this.points.visible = pair >= MIN_PAIR_PX
    const sheet = this.labels.sheet
    if (!sheet.setShown) {
      return
    }
    this.lagrange.forEach((p, k) => {
      const span = k < 2 ? Math.abs(p.x - 1) * pair : pair
      sheet.setShown(k, this.points.visible && span >= MIN_LABEL_PX)
    })
    sheet.setShown(POINT_NAMES.length, perMetre * this.hillRadius >= MIN_LABEL_PX)
  }


  /**
   * Turn the Hill sphere's circle to face the camera: the outline of the
   * sphere from any side.
   *
   * @param {object} camera
   */
  _faceCamera(camera) {
    const hill = this.hill
    hill.parent?.getWorldQuaternion(tmpQ).invert()
    camera.getWorldQuaternion(hill.quaternion).premultiply(tmpQ)
    // The circle is in XZ; the camera looks down its -Z: tip it to XY.
    hill.quaternion.multiply(tmpQ.setFromAxisAngle(tmpV.set(1, 0, 0), Math.PI / 2))
    // The renderer takes the ring's model-view matrix after this call.
    hill.updateMatrixWorld(true)
  }


  /** Free the GPU buffers. */
  dispose() {
    for (const root of [this, this.syncRing]) {
      root?.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
      root?.removeFromParent()
    }
  }
}
