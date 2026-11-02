import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  Group,
  Matrix4,
  OneFactor,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three'
import {ASTRO_UNIT_METER} from '../shared.js'
import {dataUrl} from '../dataUrl.js'
import {CATALOGUE_TILES_DIR, ROOTS_PACK} from '../scene/catalogue/tiers.js'
import {J2000_JD, gmstRad, precessionQuaternion, utcToTtJulianDay} from '../scene/celestialFrame.js'
import {MOON_RADIUS_M} from '../scene/lunarPhotometry.js'
import {decodeCatalogueTile} from '../scene/catalogue/catalogueTile.js'
import {decodePack} from '../scene/points/tileFormat.js'
import {moonEcliptic} from '../scene/lunarTheory.js'
import {planetsApprox} from '../scene/planetsApprox.js'
import {blackbodyColor, SUN_RADIUS} from '../scene/stellar.js'
import {unixMsToJd} from '../scene/satellites/sgp4.js'


// Layer mode's sky (design/LayerMode.md, "The sky"): the celestial sphere
// for a host that draws its own world under it, as exo.cafe's abode does.
// The naked-eye stars (the catalogue's bright tier), the Sun, the Moon in
// its phase, and the planets, seen from a place on Earth at the host's
// time, in the host's frame: the equator of date (+X the equinox, +Z the
// north pole), with no translation.  The host asks for one view a cube
// face and keeps the faces as a texture, so a frame here is one face.
//
// Positions: the stars precessed from J2000; the Sun and planets from
// Standish's mean elements (planetsApprox.js), a few arcminutes; the Moon
// from Meeus' ELP-2000/82 series (lunarTheory.js), topocentric for the
// view's observer, since parallax moves it up to a degree.  The bodies are
// discs at their true angular size, the stars points.
//
// Colours are display values, premultiplied, on the host's transparent
// tile: the stars add up, and the alpha is their coverage, so a host
// composes the sky over its own ground with `c·(1 − a) + rgb`.  Nothing
// clears and nothing tests depth: a sky is behind everything.
//
// Pure three, no DOM, so the tests drive it in bun.


/** Where everything is drawn, in the host's units: anywhere between its near and far. */
const SKY_DISTANCE = 1e6
/** The faintest star drawn, V. */
export const SKY_LIMIT_MAG = 6.5
const DEG = Math.PI / 180
const EARTH_RADIUS_M = 6378137
// What a star's brightness b is at magnitude m: 1 at m = 1.5, compressed
// (half a magnitude's light a magnitude) so the naked eye's limit, 6.5, is
// still a visible 10% on 8 bits.
const MAG_ZERO = 1.5
const MAG_GAMMA = 0.5


/**
 * A point's display brightness for its magnitude: 1 at MAG_ZERO, more for
 * brighter (the point grows), less for fainter.
 *
 * @param {number} mag V
 * @returns {number}
 */
export function magBrightness(mag) {
  return 10 ** (-0.4 * MAG_GAMMA * (mag - MAG_ZERO))
}


/**
 * The mean obliquity of the ecliptic of date (IAU 1980, to 0.01″ within
 * centuries of J2000).
 *
 * @param {number} jde Julian Ephemeris Day
 * @returns {number} radians
 */
export function meanObliquity(jde) {
  const t = (jde - J2000_JD) / 36525
  return (23.439291111 - (0.0130041667 * t) - (1.639e-7 * t * t) + (5.036e-7 * t * t * t)) * DEG
}


/**
 * The mean ecliptic of date (x the equinox, z the ecliptic pole) into the
 * equator of date (x the equinox, z the north pole), in place.
 *
 * @param {Vector3} v
 * @param {number} eps the obliquity, radians
 * @returns {Vector3} v
 */
export function eclipticToEquator(v, eps) {
  const c = Math.cos(eps)
  const s = Math.sin(eps)
  return v.set(v.x, (v.y * c) - (v.z * s), (v.y * s) + (v.z * c))
}


/**
 * The planets' visual magnitudes from their distances and phase angle,
 * Astronomical Almanac 1984's (Meeus, *Astronomical Algorithms*, ch. 41):
 * V = V(1, 0) + 5 log10(r Δ) + the phase law.  Saturn's rings are left out
 * (they add up to a magnitude).
 */
const PLANET_PHOTOMETRY = {
  mercury: {v0: -0.42, phase: (a) => (0.0380 * a) - (0.000273 * a * a) + (0.000002 * a * a * a), rgb: [0.85, 0.8, 0.74]},
  venus: {v0: -4.40, phase: (a) => (0.0009 * a) + (0.000239 * a * a) - (0.00000065 * a * a * a), rgb: [1, 0.97, 0.88]},
  mars: {v0: -1.52, phase: (a) => 0.016 * a, rgb: [1, 0.62, 0.45]},
  jupiter: {v0: -9.40, phase: (a) => 0.005 * a, rgb: [1, 0.92, 0.8]},
  saturn: {v0: -8.88, phase: () => 0, rgb: [1, 0.88, 0.64]},
  uranus: {v0: -7.19, phase: () => 0, rgb: [0.8, 0.95, 1]},
  neptune: {v0: -6.87, phase: () => 0, rgb: [0.68, 0.8, 1]},
}
/** The planets drawn, in drawing order. */
export const SKY_PLANETS = Object.keys(PLANET_PHOTOMETRY)


/**
 * A planet's visual magnitude.
 *
 * @param {string} name
 * @param {number} r its distance from the Sun, AU
 * @param {number} delta its distance from the observer, AU
 * @param {number} sunDist the observer's from the Sun, AU
 * @returns {number} V
 */
export function planetMagnitude(name, r, delta, sunDist) {
  const p = PLANET_PHOTOMETRY[name]
  const cosA = ((r * r) + (delta * delta) - (sunDist * sunDist)) / (2 * r * delta)
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosA))) / DEG
  return p.v0 + (5 * Math.log10(r * delta)) + p.phase(alpha)
}


// Points: a direction, a colour (display, at full brightness), a brightness
// and a size in pixels; drawn as a Gaussian of that brightness, premultiplied.
const POINT_VERT = `
  attribute vec3 color;
  attribute float bright;
  uniform float pixelScale;
  varying vec3 vColor;
  varying float vPeak;
  varying float vSize;
  void main() {
    // Brighter than 1, a point grows rather than saturates.
    float grow = clamp(sqrt(bright), 1.0, 3.0);
    vPeak = min(bright, 1.0);
    vColor = color;
    vSize = 6.0 * grow * pixelScale;
    gl_PointSize = vSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const POINT_FRAG = `
  varying vec3 vColor;
  varying float vPeak;
  varying float vSize;
  void main() {
    // A Gaussian of σ an eighth of the sprite: 0.75 px for the faintest.
    float d = length(gl_PointCoord - 0.5) * 8.0;
    float a = vPeak * exp(-0.5 * d * d);
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`

// Discs, the Sun and the Moon: a sphere of angular radius `radius` (rad)
// lit from `light` (a direction, view space), with a glow round it.
const DISC_VERT = `
  uniform float radius;
  uniform float pxPerRad;
  uniform float glow;
  varying vec3 vRight;
  varying vec3 vUp;
  varying vec3 vToEye;
  varying float vSize;
  void main() {
    vec4 eye = modelViewMatrix * vec4(position, 1.0);
    vToEye = normalize(-eye.xyz);
    vRight = normalize(cross(vec3(0.0, 1.0, 0.0), vToEye));
    vUp = cross(vToEye, vRight);
    // The disc and a pixel to soften its edge, or the glow's reach.
    vSize = 2.0 * max(radius * pxPerRad * glow, radius * pxPerRad + 1.5);
    gl_PointSize = vSize;
    gl_Position = projectionMatrix * eye;
  }`
const DISC_FRAG = `
  uniform vec3 color;
  uniform vec3 light;
  uniform float lit;
  uniform float radius;
  uniform float pxPerRad;
  uniform float glow;
  uniform float glowBright;
  varying vec3 vRight;
  varying vec3 vUp;
  varying vec3 vToEye;
  varying float vSize;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * vec2(1.0, -1.0) * vSize; // pixels from the centre, y up
    float rPx = radius * pxPerRad;
    float r = length(p) / rPx; // in radii
    float edge = clamp((1.0 - r) * rPx + 0.5, 0.0, 1.0); // antialiased limb
    vec4 c = vec4(0.0);
    if (edge > 0.0) {
      // The sphere's normal there, lit by the Sun (the Moon), or all lit (the Sun).
      vec2 q = p / rPx;
      vec3 n = normalize(q.x * vRight + q.y * vUp + sqrt(max(0.0, 1.0 - dot(q, q))) * vToEye);
      float day = lit > 0.5 ? smoothstep(-0.04, 0.08, dot(n, light)) : 1.0;
      // A little earthshine on the Moon's night side; the Sun's limb darkens.
      float shade = lit > 0.5 ? mix(0.035, 1.0, day) : mix(0.55, 1.0, sqrt(max(0.0, 1.0 - r * r)));
      c = vec4(color * shade, 1.0) * edge;
    }
    if (glow > 1.0) {
      float g = glowBright / (1.0 + 2.0 * max(0.0, r - 1.0) * max(0.0, r - 1.0));
      g *= smoothstep(glow, glow * 0.6, r);
      c += vec4(color * g, g) * (1.0 - c.a);
    }
    if (c.a < 0.002) discard;
    gl_FragColor = c;
  }`


/**
 * Additive and premultiplied, colour and alpha alike: a sky adds up on a transparent tile.
 *
 * @param {object} params ShaderMaterial's
 * @returns {ShaderMaterial}
 */
function skyMaterial(params) {
  return new ShaderMaterial({
    ...params,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendEquationAlpha: AddEquation,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  })
}


/** */
export default class SkyLayer {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.fetchFn]
   */
  constructor({fetchFn = (...a) => globalThis.fetch(...a)} = {}) {
    this.fetchFn = fetchFn
    this.scene = new Scene
    this.scene.matrixWorldAutoUpdate = true
    this.camera = new PerspectiveCamera
    this.camera.matrixAutoUpdate = false
    // The stars, in the catalogue's frame (J2000 ecliptic, scene axes),
    // turned to the equator of date by their group's matrix.
    this.stars = new Group
    this.stars.name = 'stars (J2000 ecliptic)'
    this.stars.matrixAutoUpdate = false
    this.scene.add(this.stars)
    this.starCount = 0
    // The planets: a point each, placed each view.
    const n = SKY_PLANETS.length
    const pg = new BufferGeometry
    pg.setAttribute('position', new BufferAttribute(new Float32Array(3 * n), 3))
    pg.setAttribute('color', new BufferAttribute(new Float32Array(SKY_PLANETS.flatMap((k) => PLANET_PHOTOMETRY[k].rgb)), 3))
    pg.setAttribute('bright', new BufferAttribute(new Float32Array(n), 1))
    this.pointUniforms = {pixelScale: {value: 1}}
    this.planets = new Points(pg, skyMaterial({vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      uniforms: this.pointUniforms}))
    this.planets.name = 'planets'
    this.planets.frustumCulled = false
    this.scene.add(this.planets)
    this.pxPerRad = {value: 512}
    this.sun = this._disc('sun', [1, 0.97, 0.9], {lit: 0, glow: 14, glowBright: 0.9})
    this.moon = this._disc('moon', [0.92, 0.9, 0.86], {lit: 1, glow: 0, glowBright: 0})
    this.timeMs = NaN
    this.viewId = null
    this.observer = {lat: 0, lon: 0, alt: 0}
    // Where each body is, unit vectors in the equator of date, and the
    // planets' magnitudes: for the tests, and a host that asks.
    this.dirs = {}
    this.mags = {}
    this.subscribed = false
    this.onInvalidate = null
    this._m = new Matrix4
    this._v = new Vector3
  }


  /**
   * @param {string} name
   * @param {Array<number>} rgb display colour
   * @param {object} o lit (1: phased by `light`), glow (its reach in radii), glowBright
   * @returns {Points}
   */
  _disc(name, rgb, {lit, glow, glowBright}) {
    const g = new BufferGeometry
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
    const uniforms = {
      color: {value: new Vector3(...rgb)}, light: {value: new Vector3(0, 0, 1)}, lit: {value: lit},
      radius: {value: 0.0046}, pxPerRad: this.pxPerRad, glow: {value: glow}, glowBright: {value: glowBright},
    }
    const disc = new Points(g, skyMaterial({vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, uniforms}))
    disc.name = name
    disc.frustumCulled = false
    this.scene.add(disc)
    return disc
  }


  /**
   * Load the naked-eye stars: the catalogue's bright tier, one request.
   * The bodies need nothing.
   *
   * @returns {Promise<Array<string>>} what failed, by name
   */
  async load() {
    try {
      const rsp = await this.fetchFn(dataUrl(`${CATALOGUE_TILES_DIR}/packs/${ROOTS_PACK}.bin`))
      if (!rsp?.ok) {
        throw new Error(`HTTP ${rsp?.status}`)
      }
      this.setStars(decodePack(await rsp.arrayBuffer()).map((t) => decodeCatalogueTile(t.buf)))
      return []
    } catch (err) {
      return [`stars: ${err.message ?? err}`]
    }
  }


  /**
   * The stars to draw, from catalogue tiles: those to SKY_LIMIT_MAG, as
   * directions.
   *
   * @param {Array<object>} tiles decodeCatalogueTile's
   */
  setStars(tiles) {
    const pos = []
    const col = []
    const bright = []
    for (const t of tiles) {
      for (let i = 0; i < t.count; i++) {
        const mag = t.mags[i]
        const s = t.stars[i]
        const d = Math.hypot(s.x, s.y, s.z)
        if (!(mag <= SKY_LIMIT_MAG) || !(d > 0)) {
          continue
        }
        pos.push((s.x / d) * SKY_DISTANCE, (s.y / d) * SKY_DISTANCE, (s.z / d) * SKY_DISTANCE)
        col.push(...starColor(s.teff))
        bright.push(magBrightness(mag))
      }
    }
    const g = new BufferGeometry
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
    g.setAttribute('bright', new BufferAttribute(new Float32Array(bright), 1))
    const points = new Points(g, skyMaterial({vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      uniforms: this.pointUniforms}))
    points.frustumCulled = false
    this.stars.clear()
    this.stars.add(points)
    this.starCount = bright.length
  }


  /**
   * A host's `layer:view`: the face's camera, the time and the place.
   *
   * @param {object} view {viewMatrix, projectionMatrix, viewport, pixelRatio, timeMs, observer?}
   * @param {?number} viewId
   */
  applyView({viewMatrix, projectionMatrix, viewport, pixelRatio = 1, timeMs, observer}, viewId = null) {
    this.viewId = viewId
    this.camera.matrix.fromArray(viewMatrix).invert()
    this.camera.matrixWorldNeedsUpdate = true
    this.camera.projectionMatrix.fromArray(projectionMatrix)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    // Pixels per radian at the view's centre: the bodies' discs at their size.
    const h = Array.isArray(viewport) ? viewport[3] : 1024
    this.pxPerRad.value = (h / 2) * projectionMatrix[5]
    // Points by the viewport's share of a 1024 face: a smaller tile, smaller points.
    this.pointUniforms.pixelScale.value = Math.max(0.5, Math.min(2, h / 1024))
    if (observer && Number.isFinite(observer.lat) && Number.isFinite(observer.lon)) {
      this.observer = {lat: observer.lat, lon: observer.lon, alt: Number(observer.alt) || 0}
    }
    this.setTime(timeMs)
    this.camera.updateMatrixWorld()
    // The Moon's light, in view space.
    const toView = this.camera.matrixWorldInverse
    this.moon.material.uniforms.light.value.copy(this.dirs.sun).transformDirection(toView)
  }


  /**
   * Put everything where it is at a time, seen from the observer.
   *
   * @param {number} timeMs Unix ms, UTC
   */
  setTime(timeMs) {
    if (!Number.isFinite(timeMs)) {
      timeMs = Number.isFinite(this.timeMs) ? this.timeMs : Date.now()
    }
    this.timeMs = timeMs
    const jd = unixMsToJd(timeMs)
    const jde = utcToTtJulianDay(jd)
    const eps = meanObliquity(jde)
    // The stars: J2000 ecliptic in scene axes, precessed to date, to the
    // ecliptic's own axes, to the equator.
    const prec = precessionQuaternion(J2000_JD, jde)
    const c = Math.cos(eps)
    const s = Math.sin(eps)
    // Scene (X, Y, Z) is ecliptic (x, z, −y); then the obliquity about x.
    const eclToEq = new Matrix4().set(
        1, 0, 0, 0,
        0, c, -s, 0,
        0, s, c, 0,
        0, 0, 0, 1)
    const sceneToEcl = new Matrix4().set(
        1, 0, 0, 0,
        0, 0, -1, 0,
        0, 1, 0, 0,
        0, 0, 0, 1)
    this.stars.matrix.copy(eclToEq).multiply(sceneToEcl).multiply(this._m.makeRotationFromQuaternion(prec))
    this.stars.matrixWorldNeedsUpdate = true

    // The observer, geocentric, in the equator of date (m).
    const lst = gmstRad(jd) + (this.observer.lon * DEG)
    const phi = this.observer.lat * DEG
    const rObs = EARTH_RADIUS_M + this.observer.alt
    const obs = new Vector3(Math.cos(phi) * Math.cos(lst), Math.cos(phi) * Math.sin(lst), Math.sin(phi))
        .multiplyScalar(rObs)

    // The Sun and planets: heliocentric ecliptic of date, AU.
    const helio = planetsApprox(jd)
    const earth = helio.earth
    const sunAu = Math.hypot(earth.x, earth.y, earth.z)
    const sun = eclipticToEquator(new Vector3(-earth.x, -earth.y, -earth.z), eps).multiplyScalar(ASTRO_UNIT_METER)
    sun.sub(obs)
    this._place(this.sun, 'sun', sun)
    this.sun.material.uniforms.radius.value = Math.asin(SUN_RADIUS / sun.length())

    const planetPos = this.planets.geometry.attributes.position
    const planetBright = this.planets.geometry.attributes.bright
    SKY_PLANETS.forEach((name, i) => {
      const p = helio[name]
      const r = Math.hypot(p.x, p.y, p.z)
      const geo = eclipticToEquator(new Vector3(p.x - earth.x, p.y - earth.y, p.z - earth.z), eps)
      const delta = geo.length()
      const mag = planetMagnitude(name, r, delta, sunAu)
      this.mags[name] = mag
      geo.multiplyScalar(ASTRO_UNIT_METER).sub(obs).normalize()
      this.dirs[name] = geo.clone()
      planetPos.setXYZ(i, geo.x * SKY_DISTANCE, geo.y * SKY_DISTANCE, geo.z * SKY_DISTANCE)
      planetBright.setX(i, magBrightness(mag))
    })
    planetPos.needsUpdate = true
    planetBright.needsUpdate = true

    // The Moon: geocentric ecliptic of date, then topocentric.
    const {lambda, beta, distanceKm} = moonEcliptic(jde)
    const l = lambda * DEG
    const b = beta * DEG
    const moon = eclipticToEquator(new Vector3(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)), eps)
        .multiplyScalar(distanceKm * 1000).sub(obs)
    this._place(this.moon, 'moon', moon)
    this.moon.material.uniforms.radius.value = Math.asin(MOON_RADIUS_M / moon.length())
    this.scene.updateMatrixWorld()
  }


  /**
   * @param {Points} disc
   * @param {string} name
   * @param {Vector3} p where it is from the observer, m (equator of date)
   */
  _place(disc, name, p) {
    const d = p.clone().normalize()
    this.dirs[name] = d
    disc.geometry.attributes.position.setXYZ(0, d.x * SKY_DISTANCE, d.y * SKY_DISTANCE, d.z * SKY_DISTANCE)
    disc.geometry.attributes.position.needsUpdate = true
  }


  /**
   * @param {object} renderer a three WebGLRenderer on the guest's context
   */
  render(renderer) {
    renderer.render(this.scene, this.camera)
  }


  /** A sky publishes no anchors (yet): a subscription is kept and not served. */
  subscribe() {
    this.subscribed = false
  }


  /** @returns {Array} none */
  anchors() {
    return []
  }


  /** */
  dispose() {
    this.scene.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
  }
}


/**
 * A star's display colour: its blackbody's, the brightest channel at 1,
 * halfway to white (the eye sees star colours pale).
 *
 * @param {number} teff K
 * @returns {Array<number>} r, g, b
 */
export function starColor(teff) {
  const rgb = blackbodyColor(Number.isFinite(teff) && teff > 0 ? teff : 5800)
  const max = Math.max(...rgb)
  return rgb.map((v) => 0.5 + (0.5 * (v / max)))
}
