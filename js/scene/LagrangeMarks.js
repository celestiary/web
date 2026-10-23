import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import {sceneReferred} from './hdr.js'
import {POINT_NAMES, lagrangePoints, placePoints} from './lagrange.js'
import {faceOutline, newLabels, pixelsPerMetre, unitCircle} from './overlayMarks.js'
import {FAMILIES, inertialSweep, placeAt} from './periodicOrbits.js'
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
const LINE_WIDTH = 1.25
const HILL_OPACITY = 0.5
const SYNC_OPACITY = 0.7
// A label shows when what it names spans this much of the screen (an L1 or
// L2 its distance from the secondary, the rest the pair's separation, the
// Hill sphere and the synchronous orbit their radii), and the points when
// the pair spans MIN_PAIR_PX: else, from afar, they pile up on the bodies.
const MIN_LABEL_PX = 50
const MIN_PAIR_PX = 12
// The three-body orbits (setFamily): fixed in space, swept out over one turn
// of the pair in this many points.
const SWEEP_POINTS = 721
const FAMILY_WIDTH = 1.5
const FAMILY_OPACITY = 0.85
const FAMILY_KEYS = Object.keys(FAMILIES)
// The manifolds' tubes (setManifolds): stable green, unstable red, as Koon,
// Lo, Marsden and Ross draw them; thin and faint, since they're dense.
const MANIFOLD_COLORS = {stable: 0x60e080, unstable: 0xff7060}
const MANIFOLD_OPACITY = 0.35
const noRaycast = () => undefined
const tmpV = new Vector3
const tmpX = new Vector3
const tmpY = new Vector3
const tmpZ = new Vector3
const tmpP = [0, 0, 0]


/**
 * @param {number} color
 * @param {number} n
 * @returns {Points} n screen-sized rings, their places set by the owner
 */
export function newRings(color, n) {
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
 * Trajectories as line segments' vertex pairs, each step a segment.
 *
 * @param {Array<{xyz: Float32Array}>} trajectories
 * @returns {Float32Array} packed xyz, two vertices a segment
 */
export function segmentPairs(trajectories) {
  const n = trajectories.reduce((sum, t) => sum + Math.max(0, (t.xyz.length / 3) - 1), 0)
  const out = new Float32Array(n * 6)
  let k = 0
  for (const {xyz} of trajectories) {
    for (let i = 3; i < xyz.length; i += 3) {
      out.set(xyz.subarray(i - 3, i + 3), k)
      k += 6
    }
  }
  return out
}


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
   * @param {{primary: number, secondary: number}} [pair.radii] the bodies'
   *     radii in units of the separation, where the manifolds stop
   * @param {number} [layer] Put every part on this layer
   */
  constructor({name, mu, hill, sync, secondary, syncName = 'synchronous orbit', radii}, layer = null) {
    super()
    this.name = `${name} Lagrange`
    this.mu = mu
    this.radii = radii ?? {primary: 0, secondary: 0}
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
      ...FAMILY_KEYS.map((k) => ({text: FAMILIES[k].name, color: FAMILIES[k].color})),
    ])
    this._familyLabel0 = POINT_NAMES.length + 1
    this.labels.sprites.name = 'lagrange.labels'
    // The labels always draw (each shown or not by its attribute), so they
    // can switch the points back on: _declutter.
    const labelsDrawn = this.labels.sprites.onBeforeRender
    this.labels.sprites.onBeforeRender = (renderer, scene, camera, ...rest) => {
      this._declutter(renderer, camera)
      labelsDrawn?.call(this.labels.sprites, renderer, scene, camera, ...rest)
    }
    this.add(this.labels.sprites)
    // The Hill sphere's outline as the camera sees it (faceOutline), about
    // the secondary.
    this.hill = new Group
    this.hill.name = 'lagrange.hill'
    this.hillRing = newWideLineStrip(unitCircle(), {name: 'lagrange.hillRing', color: COLORS.hill,
      width: LINE_WIDTH, opacity: HILL_OPACITY})
    const drawn = this.hillRing.onBeforeRender
    this.hillRing.onBeforeRender = (renderer, scene, camera, ...rest) => {
      const seen = faceOutline(this.hillRing, this.hill, this.hillRadius, camera)
      this.hillRing.material.uniforms.uOpacity.value = seen ? HILL_OPACITY : 0
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
      // Short: a label stands above its point by half its width
      // (SpriteSheet).  The radius is in the info panel.
      this.syncLabels = newLabels([{text: syncName, color: COLORS.sync, at: [sync.radius, 0, 0]}])
      const ringDrawn = ring.onBeforeRender
      ring.onBeforeRender = (renderer, scene, camera, ...rest) => {
        const px = pixelsPerMetre(renderer, camera, this.syncRing.getWorldPosition(tmpV)) * sync.radius
        this.syncLabels.sheet.setShown?.(0, px >= MIN_LABEL_PX)
        ringDrawn.call(ring, renderer, scene, camera, ...rest)
      }
      this.syncRing.add(this.syncLabels.sprites)
    }
    // The three-body orbits (setFamily), in the pair's frame: the primary
    // at the origin, +X to the secondary scaled by their distance, +Y its
    // way, +Z the pole (place).
    this.periodic = new Group
    this.periodic.name = 'lagrange.periodic'
    this.periodic.matrixAutoUpdate = false
    this.add(this.periodic)
    /** The families shown, by FAMILIES key: {samples, rotating, sweep, marker}. */
    this.families = new Map
    /** 'rotating', turning with the pair, or 'inertial', fixed in space. */
    this.frame = 'rotating'
    this._layer = layer
    if (layer !== null) {
      this.traverse((o) => o.layers.set(layer))
      this.syncRing?.traverse((o) => o.layers.set(layer))
    }
    this._hideFamilyLabels()
  }


  /** Hide the families' labels until their families are on. */
  _hideFamilyLabels() {
    FAMILY_KEYS.forEach((k, i) => this.labels.sheet.setShown?.(this._familyLabel0 + i, false))
  }


  /**
   * Show a family's orbit (periodicOrbits.js), or take it away.
   *
   * @param {string} key a FAMILIES key
   * @param {?object} samples sampleMember's, in the pair's units; null to remove
   * @returns {?Group} the family's node, for the owner to fade
   */
  setFamily(key, samples) {
    const had = this.families.get(key)
    if (had) {
      had.node.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
      had.node.removeFromParent()
      this.families.delete(key)
    }
    if (!samples) {
      return null
    }
    const f = FAMILIES[key]
    const node = new Group
    node.name = `lagrange.periodic.${key}`
    const options = {color: f.color, width: FAMILY_WIDTH, opacity: FAMILY_OPACITY}
    const rotating = newWideLineStrip(Float32Array.from(samples.xyz), {name: `periodic.${key}`, ...options})
    const sweep = newWideLineStrip(new Float32Array(SWEEP_POINTS * 3), {name: `periodic.${key}.inertial`, ...options})
    const marker = newRings(f.color, 1)
    marker.name = `periodic.${key}.now`
    node.add(rotating, sweep, marker)
    if (this._layer !== null) {
      node.traverse((o) => o.layers.set(this._layer))
    }
    this.periodic.add(node)
    const family = {samples, node, rotating, sweep, marker, sweptAt: null, manifolds: null}
    this.families.set(key, family)
    this._showFrame(family)
    return node
  }


  /**
   * Show a family's invariant manifolds (manifolds.js), or take them away:
   * the tubes, stable and unstable, each one set of thin lines.  Drawn
   * turning with the pair only: a tube is a set of trajectories leaving
   * the orbit at every phase, which has no single picture fixed in space.
   *
   * @param {string} key a FAMILIES key whose family is shown (setFamily)
   * @param {?object} tubes manifolds.js manifolds', in the pair's units,
   *     primary-centred; null to remove
   * @returns {?Group} the tubes' node, for the owner to fade
   */
  setManifolds(key, tubes) {
    const family = this.families.get(key)
    if (!family) {
      return null
    }
    if (family.manifolds) {
      family.manifolds.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
      family.manifolds.removeFromParent()
      family.manifolds = null
    }
    if (!tubes) {
      return null
    }
    const node = new Group
    node.name = `lagrange.periodic.${key}.manifolds`
    for (const kind of ['stable', 'unstable']) {
      const geometry = new BufferGeometry
      const trajectories = tubes.branches.filter((b) => b.kind === kind).flatMap((b) => b.trajectories)
      geometry.setAttribute('position', new Float32BufferAttribute(segmentPairs(trajectories), 3))
      const material = sceneReferred(new LineBasicMaterial({color: MANIFOLD_COLORS[kind], transparent: true,
        opacity: MANIFOLD_OPACITY, depthWrite: false, toneMapped: false}))
      const lines = new LineSegments(geometry, material)
      lines.name = `periodic.${key}.${kind}`
      lines.frustumCulled = false
      lines.raycast = noRaycast
      node.add(lines)
    }
    if (this._layer !== null) {
      node.traverse((o) => o.layers.set(this._layer))
    }
    family.node.add(node)
    family.manifolds = node
    this._showFrame(family)
    return node
  }


  /**
   * @param {string} frame 'rotating' or 'inertial'
   */
  setFrame(frame) {
    this.frame = frame === 'inertial' ? 'inertial' : 'rotating'
    for (const family of this.families.values()) {
      this._showFrame(family)
    }
  }


  /** @param {object} family */
  _showFrame(family) {
    family.rotating.visible = this.frame === 'rotating'
    family.sweep.visible = this.frame === 'inertial'
    if (family.manifolds) {
      family.manifolds.visible = this.frame === 'rotating'
    }
    family.sweptAt = null
  }


  /**
   * Lay the marks on the pair as it is.
   *
   * @param {Vector3} r the secondary's place (for Earth, the Earth-Moon
   *     barycentre's) relative to the primary, metres, in this group's frame
   * @param {Vector3} pole the pair's orbit pole, r × v
   * @param {Vector3} [body] the secondary's own place, where it isn't r:
   *     the Hill sphere is centred on it
   * @param {number} [tau] the pair's turn now, radians since J2000 (its
   *     mean motion times the time): where the three-body orbits' bodies are
   */
  place(r, pole, body = r, tau = 0) {
    placePoints(this.lagrange, r, pole, this.places)
    this._separation = r.length()
    const attr = this.points.geometry.getAttribute('position')
    this.places.forEach((p, k) => attr.setXYZ(k, p.x, p.y, p.z))
    attr.needsUpdate = true
    this.hill.position.copy(body)
    const labels = this.labels.sheet.positionAttribute
    if (labels) {
      this.places.forEach((p, k) => labels.setXYZ(k, p.x, p.y, p.z))
      // The Hill sphere's name, at its edge on the pole's side.
      tmpV.copy(pole).normalize().multiplyScalar(this.hillRadius).add(body)
      labels.setXYZ(POINT_NAMES.length, tmpV.x, tmpV.y, tmpV.z)
      labels.needsUpdate = true
    }
    if (this.families.size > 0) {
      this._placeFamilies(r, pole, tau)
    }
  }


  /**
   * Lay the three-body orbits on the pair: the pair's frame from r and the
   * pole, scaled by the distance (the pulsating frame), and each family's
   * body where it is at tau; fixed in space, its orbit swept out from there
   * over one turn of the pair (inertialSweep).
   *
   * @param {Vector3} r
   * @param {Vector3} pole
   * @param {number} tau
   */
  _placeFamilies(r, pole, tau) {
    const d = r.length()
    tmpX.copy(r).divideScalar(d)
    tmpY.crossVectors(pole, tmpX).normalize()
    tmpZ.crossVectors(tmpX, tmpY)
    this.periodic.matrix.makeBasis(tmpX.multiplyScalar(d), tmpY.multiplyScalar(d), tmpZ.multiplyScalar(d))
    this.periodic.matrixWorldNeedsUpdate = true
    const labels = this.labels.sheet.positionAttribute
    for (const [key, family] of this.families) {
      placeAt(family.samples, tau, tmpP)
      const marker = family.marker.geometry.getAttribute('position')
      marker.setXYZ(0, ...tmpP)
      marker.needsUpdate = true
      if (labels) {
        tmpV.set(...tmpP).applyMatrix4(this.periodic.matrix)
        labels.setXYZ(this._familyLabel0 + FAMILY_KEYS.indexOf(key), tmpV.x, tmpV.y, tmpV.z)
        labels.needsUpdate = true
      }
      if (this.frame === 'inertial' && family.sweptAt !== tau) {
        const attr = family.sweep.geometry.getAttribute('position')
        inertialSweep(family.samples, tau, SWEEP_POINTS, attr.array)
        attr.needsUpdate = true
        family.sweptAt = tau
      }
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
    FAMILY_KEYS.forEach((k, i) => {
      sheet.setShown(this._familyLabel0 + i, this.families.has(k) && pair >= MIN_LABEL_PX)
    })
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
