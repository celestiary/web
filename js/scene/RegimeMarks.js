import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import {sceneReferred} from './hdr.js'
import {RING_POINTS, faceOutline, newLabels, pixelsPerMetre, silhouette, unitCircle, unitEllipse} from './overlayMarks.js'
import {nodeForLocalTime, semiMajorAxisOf, sunSyncInclination} from './regimes.js'
import {newWideLineStrip} from './wideLines.js'


// A body's orbital regimes (regimes.js; Lagrange.md, orbital regimes), drawn on the overlay
// layer in the orbits group (`o`): its shells as bands between their
// outlines as the camera sees them, its boundaries as outlines, and its
// orbit families as orbits.  Hung from the body's planetTilt, so +Y is its
// pole and XZ its equator; made when the body is first the target
// (Scene._syncRegimes), its sun-synchronous orbits turned to the Sun each
// frame (Animation.layRegimes).


const LINE_WIDTH = 1.25
const OPACITY = {outline: 0.55, orbit: 0.7, band: 0.07}
// A label shows when what it names spans this much of the screen: a
// shell's or a boundary's outer radius, an orbit's semi-major axis.
const MIN_LABEL_PX = 50
// An orbit that keeps within this many of the body's radii is labelled at
// its point nearest the eye, not at its apocentre, which the body hides
// from half the views (the Moon's low orbits).
const LOW_ORBIT_RADII = 1.5
// Their labels crowd the body's disc until it's large: they show when
// their semi-major axis spans this much.
const MIN_LOW_LABEL_PX = 150
const DEG = Math.PI / 180
const Y_AXIS = new Vector3(0, 1, 0)
const X_AXIS = new Vector3(1, 0, 0)
const noRaycast = () => undefined
const tmpQ = new Quaternion
const tmpCamQ = new Quaternion
const tmpV = new Vector3
const tmpUp = new Vector3
const tmpEye = new Vector3
const tmpCamPos = new Vector3


/**
 * The band between two outlines: a ring of quads, the inner vertices on
 * one outline and the outer on the other, laid by the uniforms
 * uInner/uOuter (offset toward the eye, radius) in a frame whose +Y is the
 * eye's direction.
 *
 * @param {number} color
 * @returns {Mesh}
 */
function newBand(color) {
  const circle = unitCircle()
  const positions = new Float32Array(RING_POINTS * 2 * 3)
  const index = []
  for (let k = 0; k < RING_POINTS; k++) {
    for (const side of [0, 1]) {
      const o = 3 * ((2 * k) + side)
      positions[o] = circle[3 * k]
      positions[o + 1] = side
      positions[o + 2] = circle[(3 * k) + 2]
    }
    if (k > 0) {
      const a = 2 * (k - 1)
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  const material = sceneReferred(new ShaderMaterial({
    uniforms: {
      uColor: {value: new Color(color)}, uOpacity: {value: OPACITY.band},
      uInner: {value: new Vector2}, uOuter: {value: new Vector2},
    },
    vertexShader: `
      uniform vec2 uInner;
      uniform vec2 uOuter;
      void main() {
        vec2 s = position.y < 0.5 ? uInner : uOuter;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x * s.y, s.x, position.z * s.y, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false,
  }))
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.raycast = noRaycast
  return mesh
}


/** */
export default class RegimeMarks extends Group {
  /**
   * @param {object} body REGIMES' entry
   * @param {object} opts
   * @param {string} opts.name the body's, for its node's name
   * @param {number} opts.yearSecs its sidereal orbit period, for the
   *     sun-synchronous orbits
   * @param {object} [opts.radii] the spheres' radii given by the scene, by
   *     their `beyond` (metres from the centre)
   * @param {?number} [layer] Put every part on this layer
   */
  constructor(body, {name, yearSecs, radii = {}}, layer = null) {
    super()
    this.name = `${name}.regimes`
    this.body = body
    const re = body.equatorialRadius
    /** The outlines, each {radius, strip, label}: shells' edges and spheres. */
    this.outlines = []
    /** The shells' bands, each {inner, outer, mesh, label}. */
    this.bands = []
    /** The orbits, each {spec, a, frames: [Group], label}. */
    this.orbits = []
    const entries = []
    const label = (text, color) => entries.push({text, color}) - 1
    for (const shell of body.shells) {
      const band = {inner: re + shell.from, outer: re + shell.to, mesh: newBand(shell.color),
        label: label(shell.label, shell.color)}
      band.mesh.name = `regimes.band.${shell.name}`
      band.mesh.onBeforeRender = (renderer, scene, camera) => this._layBand(band, camera)
      this.bands.push(band)
      this.add(band.mesh)
      for (const radius of [band.inner, band.outer]) {
        this._addOutline(radius, shell.color, null)
      }
    }
    for (const sphere of body.spheres) {
      const radius = sphere.beyond ? radii[sphere.beyond] : re + sphere.altitude
      if (radius > 0) {
        this._addOutline(radius, sphere.color, label(sphere.label, sphere.color))
      }
    }
    for (const spec of body.orbits) {
      const a = semiMajorAxisOf(body, spec)
      const i = spec.sunSync ? sunSyncInclination(body, yearSecs, a) : (spec.i ?? 0)
      if (i === null) {
        continue
      }
      const e = spec.e ?? 0
      const points = unitEllipse(e)
      const frames = []
      for (let p = 0; p < (spec.planes ?? 1); p++) {
        const frame = new Group
        const strip = newWideLineStrip(points, {name: 'regimes.orbit', color: spec.color,
          width: LINE_WIDTH, opacity: OPACITY.orbit})
        strip.scale.setScalar(a)
        frame.add(strip)
        this.add(frame)
        frames.push(frame)
      }
      const orbit = {spec, a, e, i, frames, points, low: a * (1 + e) < LOW_ORBIT_RADII * re, label: label(spec.sunSync ?
        `${spec.label}, ${i.toFixed(1)}°` : spec.label, spec.color)}
      this.orbits.push(orbit)
      this._turn(orbit, spec.node ?? 0)
    }
    this.labels = newLabels(entries)
    this.labels.sprites.name = 'regimes.labels'
    const labelsDrawn = this.labels.sprites.onBeforeRender
    this.labels.sprites.onBeforeRender = (renderer, scene, camera, ...rest) => {
      this._labelLowOrbits(camera)
      this._declutter(renderer, camera)
      labelsDrawn?.call(this.labels.sprites, renderer, scene, camera, ...rest)
    }
    this.add(this.labels.sprites)
    // The orbits' labels, now there are labels.
    for (const orbit of this.orbits) {
      this._turn(orbit, orbit.node)
    }
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
    }
  }


  /**
   * @param {number} radius metres
   * @param {number} color
   * @param {?number} label its label's index, if it has one
   */
  _addOutline(radius, color, label) {
    const strip = newWideLineStrip(unitCircle(), {name: 'regimes.outline', color, width: LINE_WIDTH,
      opacity: OPACITY.outline})
    const outline = {radius, strip, label}
    const drawn = strip.onBeforeRender
    strip.onBeforeRender = (renderer, scene, camera, ...rest) => {
      const seen = faceOutline(strip, this, radius, camera)
      strip.material.uniforms.uOpacity.value = seen ? OPACITY.outline : 0
      outline.seen = seen
      if (seen && label !== null) {
        this._labelAtTop(label, strip.position, seen.radius, camera)
      }
      drawn.call(strip, renderer, scene, camera, ...rest)
    }
    this.outlines.push(outline)
    this.add(strip)
  }


  /**
   * Turn an orbit's planes: Ry(Ω) Rx(i) Ry(ω), as the orbit diagram's, the
   * planes spaced evenly in Ω; and put its label at its apocentre, unless
   * it's a low one.
   *
   * @param {object} orbit
   * @param {number} node Ω of the first plane, degrees
   */
  _turn(orbit, node) {
    const {spec, frames} = orbit
    frames.forEach((frame, p) => {
      frame.quaternion.setFromAxisAngle(Y_AXIS, (node + (360 * p / frames.length)) * DEG)
      frame.quaternion.multiply(tmpQ.setFromAxisAngle(X_AXIS, orbit.i * DEG))
      frame.quaternion.multiply(tmpQ.setFromAxisAngle(Y_AXIS, (spec.w ?? 0) * DEG))
    })
    orbit.node = node
    const attr = this.labels?.sheet.positionAttribute
    // A low orbit's label follows the eye (_labelLowOrbits).
    if (attr && !orbit.low) {
      tmpV.set(-orbit.a * (1 + orbit.e), 0, 0).applyQuaternion(frames[0].quaternion)
      attr.setXYZ(orbit.label, tmpV.x, tmpV.y, tmpV.z)
      attr.needsUpdate = true
    }
  }


  /**
   * Lay the band between a shell's outlines, facing the camera.
   *
   * @param {object} band
   * @param {object} camera
   */
  _layBand(band, camera) {
    const centre = this.getWorldPosition(tmpV)
    const toEye = camera.getWorldPosition(tmpEye).sub(centre)
    const d = toEye.length()
    const inner = silhouette(band.inner, d)
    const outer = silhouette(band.outer, d)
    const u = band.mesh.material.uniforms
    // From inside the shell there is no band to see.
    u.uOpacity.value = inner && outer ? OPACITY.band : 0
    band.seen = outer
    if (!inner || !outer) {
      return
    }
    u.uInner.value.set(inner.offset, inner.radius)
    u.uOuter.value.set(outer.offset, outer.radius)
    toEye.normalize().applyQuaternion(this.getWorldQuaternion(tmpQ).invert())
    band.mesh.quaternion.setFromUnitVectors(Y_AXIS, toEye)
    band.mesh.updateMatrixWorld(true)
    this._labelAtTop(band.label, tmpV.copy(toEye).multiplyScalar(outer.offset), outer.radius, camera)
  }


  /**
   * Put a label at the top of an outline as the camera sees it.
   *
   * @param {number} label its index
   * @param {Vector3} centre the outline's centre, in this group's frame
   * @param {number} radius its radius
   * @param {object} camera
   */
  _labelAtTop(label, centre, radius, camera) {
    const attr = this.labels?.sheet.positionAttribute
    if (!attr) {
      return
    }
    const toLocal = this.getWorldQuaternion(tmpQ).invert()
    const eye = camera.getWorldPosition(tmpEye).sub(this.getWorldPosition(tmpUp)).normalize().applyQuaternion(toLocal)
    const up = tmpUp.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(tmpCamQ)).applyQuaternion(toLocal)
    up.addScaledVector(eye, -up.dot(eye)).normalize().multiplyScalar(radius).add(centre)
    attr.setXYZ(label, up.x, up.y, up.z)
    attr.needsUpdate = true
  }


  /**
   * Put the low orbits' labels at their points nearest the eye, where the
   * body can't hide them, and a body's radius nearer the eye along the line
   * of sight: on screen they're where they were, but the body's bulge no
   * longer cuts the text standing above them.
   *
   * @param {object} camera
   */
  _labelLowOrbits(camera) {
    const attr = this.labels.sheet.positionAttribute
    if (!attr || !this.orbits.some((o) => o.low)) {
      return
    }
    const camLocal = this.worldToLocal(camera.getWorldPosition(tmpCamPos))
    const eye = tmpEye.copy(camLocal).normalize()
    for (const orbit of this.orbits) {
      if (!orbit.low) {
        continue
      }
      // The eye in the orbit's own plane's frame, against the unit ellipse.
      const local = tmpUp.copy(eye).applyQuaternion(tmpCamQ.copy(orbit.frames[0].quaternion).invert())
      const pts = orbit.points
      let best = 0
      let bestDot = -Infinity
      for (let k = 0; k < pts.length; k += 3) {
        const dot = (pts[k] * local.x) + (pts[k + 2] * local.z)
        if (dot > bestDot) {
          bestDot = dot
          best = k
        }
      }
      tmpV.set(pts[best], 0, pts[best + 2]).multiplyScalar(orbit.a).applyQuaternion(orbit.frames[0].quaternion)
      const toCam = tmpUp.copy(camLocal).sub(tmpV)
      const d = toCam.length()
      tmpV.addScaledVector(toCam, Math.min(this.body.equatorialRadius, d / 2) / d)
      attr.setXYZ(orbit.label, tmpV.x, tmpV.y, tmpV.z)
    }
    attr.needsUpdate = true
  }


  /**
   * Turn the sun-synchronous orbits to the Sun.
   *
   * @param {Vector3} sun the Sun's direction in this group's frame (the
   *     body's equator)
   */
  place(sun) {
    for (const orbit of this.orbits) {
      if (orbit.spec.sunSync) {
        this._turn(orbit, nodeForLocalTime(sun, orbit.spec.ltan))
      }
    }
  }


  /**
   * Show the labels whose features are big enough on screen, and for the
   * shells and spheres only when the camera is outside them.  For the next
   * frame, as LagrangeMarks's.
   *
   * @param {object} renderer
   * @param {object} camera
   */
  _declutter(renderer, camera) {
    const sheet = this.labels.sheet
    if (!sheet.setShown) {
      return
    }
    const perMetre = pixelsPerMetre(renderer, camera, this.getWorldPosition(tmpV))
    for (const band of this.bands) {
      sheet.setShown(band.label, Boolean(band.seen) && perMetre * band.outer >= MIN_LABEL_PX)
    }
    for (const o of this.outlines) {
      if (o.label !== null) {
        sheet.setShown(o.label, Boolean(o.seen) && perMetre * o.radius >= MIN_LABEL_PX)
      }
    }
    for (const orbit of this.orbits) {
      sheet.setShown(orbit.label, perMetre * orbit.a >= (orbit.low ? MIN_LOW_LABEL_PX : MIN_LABEL_PX))
    }
  }


  /** Free the GPU buffers. */
  dispose() {
    this.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    this.removeFromParent()
  }
}
