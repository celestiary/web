import {
  AddEquation,
  AdditiveBlending,
  BackSide,
  Color,
  CustomBlending,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  OneFactor,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import {perf} from '../../perf/perf.js'
import {LUMINOUS_DISC_PX, SUN_DISC_RADIANCE} from '../exposure.js'
import {absoluteUniforms, hdrSupported} from '../hdr.js'
import {utcToTtJulianDay} from '../celestialFrame.js'
import {limbDarkening, powerTwo} from '../stellar.js'
import {activeRegionsAt} from './activeRegions.js'
import {EUV_VIEW, RADIAL_FIRST, RADIAL_SAMPLES, VIEWS, VIEW_EUV, VIEW_EYE} from './activityView.js'
import {
  CORONA_GLSL,
  GRAMS_PER_ELECTRON,
  SUN_RADIUS_CM,
  THOMSON_CM2,
  baumbachK,
  dilution,
  radialReference,
  sheetAt,
} from './corona.js'
import {ECLIPSED_DISC, occluderSeen, visibleFraction} from './eclipse.js'
import {balmerPerNm} from './emission.js'
import {glareFieldWeight, glareFunction, glareRadiusDeg} from './glare.js'
import {MS_PER_DAY, activityLevel, cyclesAt, sunspotNumber} from './solarCycle.js'
import {newSolarWind} from './SolarWind.js'
import {cmesAt, flaresAt, prominencesAt} from './solarEvents.js'
import {sunBodyQuaternion} from './sunFrame.js'
import {generator, hash2} from './sunRandom.js'
import {MAX_CMES, MAX_FILAMENTS, MAX_FLARES, MAX_REGIONS} from './limits.js'
import {
  CORONA_FRAGMENT,
  CORONA_RADII,
  CORONA_VERTEX,
  GLARE_FRAGMENT,
  GLARE_VERTEX,
  MAX_PROMINENCES,
} from './sun-shaders.js'
import {ASTRO_UNIT_METER} from '../../shared.js'
import {named} from '../../utils.js'


/**
 * The Sun's layers beyond its photosphere, and its photosphere's activity
 * (js/scene/Sun.md): the active regions and white-light flares on the
 * disc (the photosphere shader's uniforms), the chromosphere, prominences,
 * K-corona and CMEs off it (one shell, sun-shaders.js), and the eye's glare
 * (a full-screen pass).  Everything follows the simulated date, through
 * the solar cycle (solarCycle.js) and the seeded events (solarEvents.js).
 *
 * A star without activity (a catalogue star) gets only the glare.
 */


// The chromosphere at the limb: Hα's equivalent width at its base (nm) and
// its scale height, and the spicules' (a model of the flash spectrum's
// brightest line: optically thick to ~2 Mm, spicules to ~10 Mm, Zirin 1988).
export const CHROMOSPHERE = Object.freeze({baseNm: 0.05, baseMm: 1.0, spiculeNm: 0.006, spiculeMm: 3.0})
// The rays' and plumes' contrast in the corona's density (a model).
export const RAY_CONTRAST = 0.45
// What's under this, in exposure units, isn't drawn: under a screen step
// through the tone map and the encoding (screen.js; a third of one for a
// saturated colour, whose weakest channel alone the toe takes).
export const VISIBLE_FLOOR = 1e-4
// The sheet's tilt turns once round in this many months (a model).
const SHEET_TURN_MONTHS = 132
// The wind's streamlines are rebuilt when the cycle's level moves this much.
const WIND_LEVEL_STEP = 0.15
// Events are recomputed when the date moves by more than this.
const EVENT_STEP_MS = 30e3
const SUN_RADIUS_MM = 695.7
// A CME is drawn while the corona shows out to at least this share of its
// front (its core's place: cme/cmeModel.js), and its chunk is fetched once
// one has been in view this long.
const CME_CORE_SHARE = 0.45
const CME_LOAD_AFTER_MS = 1500
// A filament's width on the disc takes this share of its height (a model).
const FILAMENT_LEAN = 0.25
const J2000_MS = Date.UTC(2000, 0, 1, 12)


/**
 * What the CMEs' chunk (cme/CmeCloud.js, cme/cmeModel.js) shares with the
 * page's first load, handed to it rather than imported by it: a module
 * both imported would be split into a file of its own for the first load
 * to fetch (esbuild/budget.js; the credits dialog's CREDITS_DIALOG_DEPS
 * is the same arrangement).
 */
export const CME_DEPS = Object.freeze({
  three: Object.freeze({
    AddEquation, Color, CustomBlending, DoubleSide, Float32BufferAttribute, HalfFloatType,
    InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, Mesh, OneFactor, Scene, ShaderMaterial,
    Vector2, Vector3, Vector4, WebGLRenderTarget,
  }),
  perf, EUV_VIEW, RADIAL_FIRST, RADIAL_SAMPLES, CORONA_GLSL, CORONA_RADII, GRAMS_PER_ELECTRON, SUN_RADIUS_CM,
  THOMSON_CM2, MAX_CMES, radialReference, dilution, generator, hash2,
})


/**
 * @param {number} rho impact radius, solar radii
 * @returns {number} The brightest the corona and its prominences are there,
 *     over the disc's mean: the K-corona (×4 for streamers and CMEs) or a
 *     bright prominence's Balmer light near the limb
 */
export function offDiscBrightest(rho) {
  return Math.max(4 * baumbachK(rho) * 1.3, rho < 1.15 ? 6e-5 : 0)
}


/**
 * The impact radius out to which the off-disc light is over a floor.
 *
 * @param {number} discValue the disc's radiance at the exposure
 * @param {number} floor exposure units
 * @returns {number} solar radii, from 1 to CORONA_RADII
 */
export function visibleRadius(discValue, floor = VISIBLE_FLOOR) {
  if (!(discValue * offDiscBrightest(1.0001) > floor)) {
    return 1
  }
  // The corona's outer law is near ρ^−2.5 to ^−3 past 3 radii (Saito's
  // outer term); find the radius by bisection on a generous profile.
  const brightest = (rho) => Math.max(offDiscBrightest(rho), 1.6e-10 * ((rho / 5) ** -2.5))
  let lo = 1
  let hi = CORONA_RADII
  if (discValue * brightest(hi) > floor) {
    return hi
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (discValue * brightest(mid) > floor) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return hi
}


/**
 * How much of the activity view's field (the coronagraph's corona, the
 * cool plasma off the limb) is drawn round a disc of a size on screen.
 * The view's levels are over the disc's, so they are a picture only while
 * the frame is exposed for the disc, which the meter does once the disc
 * is resolved (exposure.js luminousDiscGain, over the same pixels): from
 * afar, where the exposure is the scene's and the disc is blown, a field
 * at the disc's level would be a white cloud tens of radii wide, and what
 * the meter read.
 *
 * @param {number} diameterPx The disc's diameter on screen, CSS pixels
 * @param {number} [pixelRatio] The renderer's, scaling the thresholds as
 *     the meter's are
 * @returns {number} 0 to 1
 */
export function viewFieldWeight(diameterPx, pixelRatio = 1) {
  const [lo, hi] = LUMINOUS_DISC_PX.map((px) => px * Math.max(pixelRatio, 1e-6))
  const x = Math.min(Math.max((diameterPx - lo) / (hi - lo), 0), 1)
  return x * x * (3 - (2 * x))
}


export default class SunLayers {
  /**
   * @param {object} star The Star
   * @param {object} opts
   * @param {boolean} opts.activity Whether to draw the activity (the Sun)
   * @param {number} [opts.seed]
   * @param {object} [opts.model] The star's activity against the Sun's
   *     (stellarActivity.js): its flares' and CMEs' rates, its temperature
   * @param {string} [opts.view] The view to start in (setView)
   */
  constructor(star, {activity, seed = 0, model = null, view = VIEW_EYE}) {
    this.star = star
    this.activity = activity
    this.seed = seed
    this.model = model
    // How it is drawn: as the eye sees it, or as an EUV imager and a
    // coronagraph do (setView; activityView.js).
    this.view = VIEW_EYE
    this.visibleFraction = 1
    this.occluders = []
    // A coronagraph's occulting disc, solar radii (setOcculter); 0 for none.
    this.occulter = 0
    // Each layer on or off (the perf overlay's `sun` toggle; probes).
    this.enabled = {glare: true, corona: true, flares: true, cmes: true, prominences: true}
    this._v = [new Vector3, new Vector3, new Vector3, new Vector3, new Vector3]
    this._q = [new Quaternion, new Quaternion]
    this._m4 = new Matrix4
    this._lastEventMs = NaN
    this.state = {regions: [], flares: [], cmes: [], prominences: [], sn: 0, level: 0}
    const limb = limbDarkening(star.teff ?? 5772)
    this._limb = (mu) => powerTwo(mu, limb.c[1], limb.alpha[1])
    this.glare = this._newGlare()
    if (activity) {
      this.corona = this._newCorona()
      this.wind = newSolarWind(0)
      this._windLevel = 0
    }
    this.setView(view)
  }


  /**
   * The view the star's layers are drawn in (activityView.js; Sun.md, "The
   * activity view"): 'eye', white light as an eye or a camera sees it, or
   * 'euv', an EUV imager's disc (He II 304 Å) in a coronagraph's field,
   * where the flares, prominences, streamers and CMEs that white light
   * hides are the picture.
   *
   * @param {string} view
   */
  setView(view) {
    this.view = VIEWS.includes(view) ? view : VIEW_EYE
    const euv = this.view === VIEW_EUV ? 1 : 0
    if (this._disc) {
      this._disc.uEuv.value = euv
    }
    if (this.corona) {
      this.corona.material.uniforms.uView.value.x = euv
    }
  }


  /**
   * The layers' group that goes with the disc, for the Star to add under
   * its LOD: named 'SunLayers' for the perf overlay's `sun` toggle,
   * holding one named 'atmosphere' that AR's sky view hides with the other
   * bright shells (Scene.enterAR).  The meshes' own visibility is the
   * layers' (update).
   *
   * @returns {Group}
   */
  group() {
    const outer = named(new Group, 'SunLayers')
    const inner = named(new Group, 'atmosphere')
    for (const mesh of [this.corona].filter(Boolean)) {
      inner.add(mesh)
    }
    outer.add(inner)
    return outer
  }


  /**
   * The glare's group, for the Star to add beside its LOD, so the veil is
   * drawn from any distance (its own reach decides: _glareView); the same
   * names as group()'s, for the toggle and for AR.
   *
   * @returns {Group}
   */
  glareGroup() {
    const outer = named(new Group, 'SunLayers')
    const inner = named(new Group, 'atmosphere')
    inner.add(this.glare)
    outer.add(inner)
    return outer
  }


  /** @returns {Mesh} The glare: a full-screen pass in the scene, drawn over all */
  _newGlare() {
    const color = new Vector3(...(this.star.color ?? [1, 1, 1]))
    const mesh = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
      uniforms: {
        uProjectionInverse: {value: null},
        uSunDir: {value: new Vector3(0, 0, -1)},
        uAcross1: {value: new Vector3(1, 0, 0)},
        uAcross2: {value: new Vector3(0, 1, 0)},
        uDiscRadius: {value: 0},
        uDiscSolidAngle: {value: 0},
        uVisible: {value: 1},
        uDiscValue: {value: 0},
        uSunColor: {value: color},
        uFieldWeight: {value: 1},
      },
      vertexShader: GLARE_VERTEX,
      fragmentShader: GLARE_FRAGMENT,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }))
    mesh.frustumCulled = false
    // After everything it veils.
    mesh.renderOrder = 10
    mesh.visible = false
    named(mesh, 'sun glare')
    mesh.onBeforeRender = (renderer, scene, camera) => {
      mesh.material.uniforms.uProjectionInverse.value = camera.projectionMatrixInverse
    }
    return mesh
  }


  /** @returns {Mesh} The corona's shell, CORONA_RADII across, drawn from inside or out */
  _newCorona() {
    const vec4s = (n) => Array.from({length: n}, () => new Vector4)
    const mesh = new Mesh(new SphereGeometry(1, 48, 24), new ShaderMaterial({
      uniforms: {
        uSunCentre: {value: new Vector3},
        uViewToBody: {value: new Matrix3},
        uSheetPole: {value: new Vector3(0, 1, 0)},
        uSheetWarp: {value: 0},
        uWarpPhase: {value: new Vector3},
        uRays: {value: RAY_CONTRAST},
        uDiscValue: {value: 0},
        uSunColor: {value: new Vector3(...(this.star.color ?? [1, 1, 1]))},
        uBalmer: {value: new Vector3(...balmerPerNm())},
        uMaxRho: {value: 1},
        uOcculter: {value: 1},
        uChromo: {value: new Vector4(CHROMOSPHERE.baseNm, CHROMOSPHERE.baseMm / SUN_RADIUS_MM,
            CHROMOSPHERE.spiculeNm, CHROMOSPHERE.spiculeMm / SUN_RADIUS_MM)},
        uPromCount: {value: 0},
        uPromCentre: {value: vec4s(MAX_PROMINENCES)},
        uPromTangent: {value: vec4s(MAX_PROMINENCES)},
        uPromShape: {value: vec4s(MAX_PROMINENCES)},
        uCmeColumn: {value: null},
        uCmeFog: {value: null},
        uCmeOn: {value: 0},
        uDays: {value: 0},
        uView: {value: new Vector4(0, EUV_VIEW.corona, EUV_VIEW.coolPerNm, EUV_VIEW.white)},
        uRadialRef: {value: radialReference(RADIAL_SAMPLES, RADIAL_FIRST, CORONA_RADII)},
        uProjectionInverse: {value: null},
        uViewport: {value: new Vector4},
      },
      vertexShader: CORONA_VERTEX,
      fragmentShader: CORONA_FRAGMENT,
      side: BackSide,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }))
    const r = this.star.props.radius.scalar
    mesh.scale.setScalar(r * CORONA_RADII)
    mesh.frustumCulled = false
    mesh.visible = false
    named(mesh, 'sun corona')
    mesh.onBeforeRender = (renderer, scene, camera) => {
      renderer.getCurrentViewport(mesh.material.uniforms.uViewport.value)
      this._pixelRatio = renderer.getPixelRatio()
      mesh.material.uniforms.uProjectionInverse.value = camera.projectionMatrixInverse
      this._coronaView(camera)
      this._cmePass(renderer, camera)
    }
    return mesh
  }


  /**
   * The photosphere's activity uniforms, for the disc's material.
   *
   * @returns {object}
   */
  photosphereUniforms() {
    const vec4s = (n) => Array.from({length: n}, () => new Vector4)
    this._disc = {
      uRegionMode: {value: this.activity ? 1 : 0},
      uRegionCount: {value: 0},
      uSpotL: {value: vec4s(MAX_REGIONS)},
      uSpotF: {value: vec4s(MAX_REGIONS)},
      uFlareCount: {value: 0},
      uFlareKernel: {value: vec4s(2 * MAX_FLARES)},
      uFlareContrast: {value: vec4s(2 * MAX_FLARES)},
      uEuv: {value: this.view === VIEW_EUV ? 1 : 0},
      uEuvLevels: {value: new Vector4(EUV_VIEW.plage, EUV_VIEW.filament, EUV_VIEW.limb, EUV_VIEW.white)},
      uFilamentCount: {value: 0},
      uFilamentCentre: {value: vec4s(MAX_FILAMENTS)},
      uFilamentTangent: {value: vec4s(MAX_FILAMENTS)},
    }
    return this._disc
  }


  /**
   * The disc's regions and flares for this view: the largest regions on
   * the camera's side of the Sun (a little past the limb), and the flares
   * now in white light.
   *
   * @param {object} camera
   */
  discView(camera) {
    const u = this._disc
    if (!u || !this.activity) {
      return
    }
    const [cam, sun] = this._v
    camera.getWorldPosition(cam)
    this.star.getWorldPosition(sun)
    // The camera's direction in the Carrington frame.
    const bodyQ = this.star.surface.getWorldQuaternion(this._q[0])
    const toCam = cam.sub(sun).normalize().applyQuaternion(bodyQ.invert())
    const facing = (v) => (v[0] * toCam.x) + (v[1] * toCam.y) + (v[2] * toCam.z)
    const regions = this.state.regions
        .filter((r) => facing(r.centre) > -0.15)
        .sort((a, b) => b.area - a.area)
        .slice(0, MAX_REGIONS)
    u.uRegionCount.value = regions.length
    regions.forEach((r, i) => {
      u.uSpotL.value[i].set(...r.leading.unit, r.leading.radius)
      u.uSpotF.value[i].set(...r.following.unit, r.following.radius)
    })
    // In white light, the flares that show in it, in their impulsive
    // phase; in the EUV view every flare, by its soft X-ray light curve.
    const euv = this.view === VIEW_EUV
    const now = (f) => (euv ? f.euv * f.sxr : f.contrast * f.phase)
    const flares = this.state.flares
        .filter((f) => this.enabled.flares && (euv ? f.sxr > 1e-3 : f.whiteLight && f.phase > 1e-3))
        .sort((a, b) => now(b) - now(a))
        .slice(0, MAX_FLARES)
    u.uFlareCount.value = 2 * flares.length
    flares.forEach((f, i) => {
      for (let k = 0; k < 2; k++) {
        u.uFlareKernel.value[(2 * i) + k].set(...f.kernels[k], euv ? f.euvRadius : f.radius)
        u.uFlareContrast.value[(2 * i) + k].set(now(f), 0, 0, 0)
      }
    })
    // In the EUV view, the prominences on the camera's side as filaments:
    // the longest, each as wide as its sheet's thickness and a share of its
    // height (it leans from the vertical, and is seen from the side).
    const filaments = !euv || !this.enabled.prominences ? [] : this.state.prominences
        .filter((p) => facing(p.centre) > 0)
        .sort((a, b) => b.halfLength - a.halfLength)
        .slice(0, MAX_FILAMENTS)
    u.uFilamentCount.value = filaments.length
    filaments.forEach((p, i) => {
      u.uFilamentCentre.value[i].set(...p.centre, p.halfLength)
      u.uFilamentTangent.value[i].set(...p.tangent, (0.5 * p.thickness) + (FILAMENT_LEAN * p.height))
    })
  }


  /**
   * Each frame: the date's events, the Sun's frame, and what the camera
   * sees of the disc.
   *
   * @param {object} time The simulation's Time
   * @param {object} camera
   * @param {object} [objects] The scene's objects by name, the occluders
   */
  update(time, camera, objects) {
    const ms = time?.simTime
    if (this.activity && Number.isFinite(ms)) {
      const jde = utcToTtJulianDay((ms / MS_PER_DAY) + 2440587.5)
      this.jde = jde
      sunBodyQuaternion(jde, this.star.surface.quaternion)
      if (!(Math.abs(ms - this._lastEventMs) < EVENT_STEP_MS)) {
        this._events(ms)
        this._lastEventMs = ms
      } else {
        // Flares change in minutes: their phases every frame.
        this.state.flares = flaresAt(ms, this.state.regions, this.seed, this.model)
      }
      this.ms = ms
    }
    if (camera) {
      this._occlusion(camera, objects)
      this._glareView(camera)
    }
    if (this.wind && camera && Number.isFinite(ms)) {
      const u = this.wind.material.uniforms
      // Days from J2000, small enough for float32's dashes.
      u.uDays.value = (ms - J2000_MS) / MS_PER_DAY
      const [cam, sun] = this._v
      camera.getWorldPosition(cam)
      this.star.getWorldPosition(sun)
      u.uCameraAu.value = cam.distanceTo(sun) / ASTRO_UNIT_METER
    }
    if (this.corona) {
      // Nothing to draw where the brightest of it is under the floor at
      // this exposure: the bare disc's stopped-down frames, and from afar.
      // An instrument's view draws it at its own level, whatever the exposure.
      this.corona.visible = this.enabled.corona &&
        (this.view !== VIEW_EYE || this.discValue() * offDiscBrightest(1.0001) > VISIBLE_FLOOR)
    }
  }


  /**
   * The date's events.
   *
   * @param {number} ms
   */
  _events(ms) {
    const regions = activeRegionsAt(ms, this.seed)
    this.state = {
      regions,
      flares: flaresAt(ms, regions, this.seed, this.model),
      cmes: cmesAt(ms, this.seed, this.model),
      prominences: prominencesAt(ms, this.seed),
      sn: sunspotNumber(ms),
      level: activityLevel(ms),
    }
    // The current sheet: tilted toward a longitude that drifts a turn a
    // cycle (a model), warped more as the cycle rises.
    const cycles = cyclesAt(ms)
    const main = cycles.reduce((a, c) => (c.share > a.share ? c : a), cycles[0])
    const phase = (hash2(main?.cycle ?? 0, this.seed) / 4294967296) * 2 * Math.PI
    const lon = phase + ((main?.months ?? 0) * 2 * Math.PI / SHEET_TURN_MONTHS)
    this.sheet = sheetAt(this.state.level, lon, [phase * 3.1, phase * 1.7])
    // The fast wind's latitudes follow the cycle: rebuilt when its level
    // has moved.
    if (this.wind && Math.abs(this.state.level - this._windLevel) > WIND_LEVEL_STEP) {
      const old = this.wind
      this.wind = newSolarWind(this.state.level)
      this.wind.visible = old.visible
      this.wind.material.uniforms.uOpacity.value = old.material.uniforms.uOpacity.value
      old.parent?.add(this.wind)
      old.parent?.remove(old)
      old.geometry.dispose()
      old.material.dispose()
      this._windLevel = this.state.level
    }
  }


  /**
   * The disc's visible share from the camera, past every body in front.
   *
   * @param {object} camera
   * @param {object} [objects]
   */
  _occlusion(camera, objects) {
    const [cam, sun, body] = this._v
    camera.getWorldPosition(cam)
    this.star.getWorldPosition(sun)
    const dist = sun.distanceTo(cam)
    const radius = this.star.props.radius.scalar
    this.discRadius = dist > radius ? Math.asin(radius / dist) : Math.PI / 2
    const dir = sun.clone().sub(cam).normalize().toArray()
    const occluders = []
    // A spacecraft in front (Spacecraft.js sunBlocked): the share of the
    // disc its triangles hide, and whether they hide the centre.
    let craftVisible = 1
    let craftCentre = false
    if (objects && dist > radius) {
      for (const name of Object.keys(objects)) {
        const o = objects[name]
        const type = o?.props?.type
        if (type === 'spacecraft' && o.sunBlocked) {
          const blocked = o.sunBlocked(cam, sun, this.discRadius)
          if (blocked) {
            craftVisible *= 1 - blocked.fraction
            craftCentre ||= blocked.centre
          }
          continue
        }
        if ((type !== 'planet' && type !== 'moon') || !o.props.radius || name.endsWith('.orbitPosition')) {
          continue
        }
        o.getWorldPosition(body)
        if (body.distanceTo(cam) > dist) {
          continue
        }
        const seen = occluderSeen(cam.toArray(), dir, body.toArray(), o.props.radius.scalar)
        if (seen && seen.separation < this.discRadius + seen.radius) {
          occluders.push({...seen, body: o})
        }
      }
    }
    this.occluders = occluders
    this.visibleFraction = this.occulter > 0 ? 0 :
      visibleFraction(this.discRadius, occluders, this._limb) * craftVisible
    this.star.visibleFraction = this.visibleFraction
    if (this.activity) {
      // The point stands for the whole disc at its centre: gone once a body
      // covers the centre (the light left is a crescent's, at the limb, which
      // the disc's mesh draws), else dimmed with what's seen.
      const centreCovered = craftCentre || occluders.some((o) => o.separation < o.radius)
      absoluteUniforms.uSunVisible.value = centreCovered ? 0 : this.visibleFraction
    }
  }


  /**
   * A coronagraph: an occulting disc of a radius over the Sun, as LASCO's
   * (C2's to 2.2 radii, C3's to 3.7): the disc and what's inside it hidden,
   * so no glare and no luminous disc for the meter, which then exposes for
   * the corona, as a coronagraph's camera does.  A probe for the corona and
   * CMEs (Sun.md); 0 takes it away.
   *
   * @param {number} radii
   */
  setOcculter(radii) {
    this.occulter = radii > 0 ? Math.max(radii, 1) : 0
    this.star.surface.visible = !(this.occulter > 0)
    if (this.corona) {
      this.corona.material.uniforms.uOcculter.value = Math.max(this.occulter, 1)
    }
  }


  /**
   * The disc's visible share past every body but one: what lights the sky
   * of that body's air, seen from in it (ThreeUI's atmosphere pass).
   *
   * @param {object} except
   * @returns {number}
   */
  visibleFractionExcept(except) {
    const rest = this.occluders.filter((o) => o.body !== except)
    return rest.length === this.occluders.length ? this.visibleFraction :
      visibleFraction(this.discRadius, rest, this._limb)
  }


  /** @returns {number} The disc's mean radiance at this frame's exposure */
  discValue() {
    return SUN_DISC_RADIANCE * (this.star.discRadianceRelSun ?? 1) * absoluteUniforms.uExposureRelative.value
  }


  /**
   * The glare's uniforms, and whether it can show in the frame.
   *
   * @param {object} camera
   */
  _glareView(camera) {
    const u = this.glare.material.uniforms
    const [cam, sun, , a, b] = this._v
    camera.getWorldPosition(cam)
    this.star.getWorldPosition(sun)
    const value = this.discValue()
    const solid = 2 * Math.PI * (1 - Math.cos(this.discRadius))
    const scale = value * this.visibleFraction * solid
    u.uDiscValue.value = value
    u.uVisible.value = this.visibleFraction
    u.uDiscRadius.value = this.discRadius
    u.uDiscSolidAngle.value = solid
    const dir = sun.sub(cam).normalize().transformDirection(camera.matrixWorldInverse)
    u.uSunDir.value.copy(dir)
    a.set(0, 1, 0)
    if (Math.abs(dir.y) > 0.9) {
      a.set(1, 0, 0)
    }
    u.uAcross1.value.crossVectors(dir, a).normalize()
    u.uAcross2.value.crossVectors(dir, u.uAcross1.value)
    // Shown if its reach, where it falls under the floor, gets into the
    // frame: the angle from the view's axis to the Sun, less the field's
    // half-diagonal.
    const reach = scale > 0 ? glareRadiusDeg(VISIBLE_FLOOR / scale) : 0
    const halfDiag = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.hypot(1, camera.aspect)) * 180 / Math.PI
    b.set(0, 0, -1)
    const offAxis = Math.acos(Math.min(Math.max(dir.dot(b), -1), 1)) * 180 / Math.PI
    // In the eye's field at all: by the source's angle from the gaze, the
    // view axis, fading out from 90° to 100°; a source behind the head
    // veils nothing, though the frame's edge may be 80° from it.
    const field = glareFieldWeight(offAxis)
    u.uFieldWeight.value = field
    // The veil is the eye's: an instrument's view has none.
    this.glare.visible = this.enabled.glare && this.view === VIEW_EYE &&
      field > 0 && reach > 0.1 && offAxis - halfDiag < reach &&
      glareFunction(0.1) * scale > VISIBLE_FLOOR
  }


  /**
   * The corona's uniforms for this view: the Sun's centre and frame from
   * the camera, the events in view space.
   *
   * @param {object} camera
   */
  _coronaView(camera) {
    const u = this.corona.material.uniforms
    const [cam, sun, tmp] = this._v
    const radius = this.star.props.radius.scalar
    camera.getWorldPosition(cam)
    this.star.getWorldPosition(sun)
    u.uSunCentre.value.copy(sun).applyMatrix4(camera.matrixWorldInverse).multiplyScalar(1 / radius)
    // View → world → Carrington: the camera's rotation, then the body's
    // inverse.
    const [bodyQ, viewQ] = this._q
    this.star.surface.getWorldQuaternion(bodyQ)
    camera.getWorldQuaternion(viewQ)
    const bodyWorld = bodyQ.clone()
    const viewToBody = bodyQ.invert().multiply(viewQ)
    u.uViewToBody.value.setFromMatrix4(this._m4.makeRotationFromQuaternion(viewToBody))
    const bodyToView = viewToBody.clone().invert()
    const toView = (v) => tmp.set(...v).applyQuaternion(bodyToView)
    const value = this.discValue()
    u.uDiscValue.value = value
    const instrument = this.view !== VIEW_EYE
    u.uMaxRho.value = instrument ? CORONA_RADII : visibleRadius(value)
    if (instrument) {
      // The view's field comes in as the disc resolves (viewFieldWeight).
      // The viewport is in device pixels; the meter's rule in CSS pixels.
      const ratio = this._pixelRatio || 1
      const pxRad = (camera.fov * Math.PI / 180) / Math.max(u.uViewport.value.w / ratio, 1)
      const weight = viewFieldWeight(2 * this.discRadius / pxRad, ratio)
      u.uView.value.y = EUV_VIEW.corona * weight
      u.uView.value.z = EUV_VIEW.coolPerNm * weight
    }
    u.uDays.value = ((this.ms ?? 0) / MS_PER_DAY) % 1000
    if (this.sheet) {
      u.uSheetPole.value.set(...this.sheet.pole)
      u.uSheetWarp.value = this.sheet.warp
      u.uWarpPhase.value.set(...this.sheet.phase)
    }
    // The CMEs: each one's directions in view space, fixed in space at its
    // launch (the Carrington frame then): outward, and east and north at
    // its source, which its rope's axis lies across (cme/cmeModel.js).
    const cmes = this.enabled.cmes ? this.state.cmes.slice(-MAX_CMES) : []
    const eq = this._q[1]
    const parent = this.star.getWorldQuaternion(new Quaternion)
    this.cmeItems = cmes.map((cme) => {
      const launchJde = this.jde - ((this.ms - cme.launch) / MS_PER_DAY)
      sunBodyQuaternion(launchJde, eq).premultiply(parent)
      const lat = cme.source.lat * Math.PI / 180
      const lon = cme.source.lon * Math.PI / 180
      const launched = (x, y, z) =>
        new Vector3(x, y, z).applyQuaternion(eq).transformDirection(camera.matrixWorldInverse)
      return {
        cme,
        d: launched(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)),
        east: launched(-Math.sin(lon), 0, -Math.cos(lon)),
        north: launched(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon)),
      }
    })
    // The prominences nearest the limb as the camera sees them, the ones
    // that can show off the disc.
    const camFromSun = tmp.copy(cam).sub(sun).normalize().clone()
    const limbward = (this.enabled.prominences ? this.state.prominences : [])
        .map((p) => {
          const c = new Vector3(...p.centre).applyQuaternion(bodyWorld)
          return {p, limb: Math.abs(c.dot(camFromSun))}
        })
        .sort((x, y) => x.limb - y.limb)
        .slice(0, MAX_PROMINENCES)
    u.uPromCount.value = limbward.length
    limbward.forEach(({p}, i) => {
      const c = toView(p.centre)
      u.uPromCentre.value[i].set(c.x, c.y, c.z, p.height)
      const t = toView(p.tangent)
      u.uPromTangent.value[i].set(t.x, t.y, t.z, p.halfLength)
      u.uPromShape.value[i].set(p.thickness, p.halpha, p.seed, 0)
    })
  }


  /**
   * The CMEs' particles, drawn into their own targets for the corona's
   * shader (cme/CmeCloud.js), which is loaded the first time a CME is in view:
   * none are drawn until it is, nor where the renderer can't draw to a
   * half-float target.
   *
   * @param {object} renderer
   * @param {object} camera
   */
  _cmePass(renderer, camera) {
    const u = this.corona.material.uniforms
    u.uCmeOn.value = 0
    this.cmeDrawn = this.cmesInView(camera)
    if (!this.cmeDrawn.length || !hdrSupported(renderer)) {
      this._cmeWantedAt = null
      return
    }
    if (!this.cmeCloud) {
      // Asked for once a CME has been in view a while: a view passing
      // through (the first frames, before the exposure settles; a fly-by)
      // doesn't fetch the chunk.
      const now = performance.now()
      this._cmeWantedAt ??= now
      if (now - this._cmeWantedAt > CME_LOAD_AFTER_MS) {
        this.loadCmeCloud()
      }
      return
    }
    const drawn = this.cmeCloud.render(renderer, camera, this.cmeDrawn, {
      sunCentre: u.uSunCentre.value,
      radius: this.star.props.radius.scalar,
      seed: this.seed,
      ms: this.ms,
    })
    u.uCmeColumn.value = drawn.threads
    u.uCmeFog.value = drawn.puffs
    u.uCmeOn.value = 1
  }


  /**
   * The CMEs that can show in this frame (the corona's uniforms are this
   * frame's: after _coronaView).  Their pass is thousands of particles into
   * two targets, so it isn't run for what can't be seen:
   *
   * - in white light, only with the disc hidden (an eclipse's totality, a
   *   coronagraph's occulter): beside any of the bare disc the eye's glare
   *   is a million times a CME's light;
   * - in the activity view, only round a resolved disc (viewFieldWeight);
   * - a CME whose core is past the radius the corona shows to at this
   *   exposure (the shell draws nothing beyond it);
   * - a CME outside the frame.
   *
   * @param {object} camera
   * @returns {Array<object>} Of cmeItems
   */
  cmesInView(camera) {
    const items = this.cmeItems ?? []
    const u = this.corona.material.uniforms
    const eye = this.view === VIEW_EYE
    if (!items.length || (eye ? this.visibleFraction > ECLIPSED_DISC : u.uView.value.y + u.uView.value.z <= 0)) {
      return []
    }
    const maxRho = u.uMaxRho.value
    const sun = u.uSunCentre.value
    const distance = Math.max(sun.length(), 1e-9)
    const offAxis = Math.acos(Math.min(Math.max(-sun.z / distance, -1), 1))
    const halfDiagonal = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.hypot(1, camera.aspect))
    return items.filter(({cme}) => {
      if (maxRho < CME_CORE_SHARE * cme.front) {
        return false
      }
      const reach = Math.min(cme.front * 1.1, maxRho)
      const radius = distance > reach ? Math.asin(reach / distance) : Math.PI
      return offAxis - radius < halfDiagonal
    })
  }


  /**
   * @returns {Promise} The CMEs' cloud's arrival (once: a failed load isn't
   *     tried again, and the CMEs stay undrawn)
   */
  loadCmeCloud() {
    this._cmeCloudPending ??= import('./cme/CmeCloud.js').then(({cmeCloud}) => {
      const {CmeCloud} = cmeCloud(CME_DEPS)
      this.cmeCloud = new CmeCloud
    }).catch((err) => {
      console.warn('The CMEs could not be loaded', err)
    })
    return this._cmeCloudPending
  }
}
