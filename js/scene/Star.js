import {
  Group,
  LOD,
  PointLight,
  ShaderMaterial,
  Mesh,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import Object from './object.js'
import * as Shaders from './star-shaders.js'
import {sphere} from './shapes.js'
import {SUN_DISC_RADIANCE} from './exposure.js'
import {absoluteUniforms} from './hdr.js'
import {seedUniforms, starSeed} from './starSeed.js'
import {CATALOGUE_NORTH, rotationAxis, starParams} from './starParams.js'
import {
  PENUMBRA_FRACTION,
  SUN_LOGG,
  SUN_TEFF,
  blackbodyColor,
  blackbodyLuminance,
  granulationContrast,
  granulesPerRadius,
  limbDarkening,
  luminanceSlope,
  sharedBlackbodyLut,
  umbraDeltaT,
} from './stellar.js'
import * as Shared from '../shared.js'
import SunLayers from './sun/SunLayers.js'


/**
 * A star: its light (a point light for the planets), its disc and its limb
 * glow.  The disc is its photosphere from its physical parameters
 * (js/scene/Stars.md; stellar.js, star-shaders.js): the Sun is the
 * reference case, not a special one.
 */


// Above this a star's envelope is radiative: no convection, so no granules,
// spots or faculae (Stars.md).
const CONVECTIVE_TEFF_MAX = 7000
// The Sun's faculae: 15% over the photosphere at mu = 0.2, nothing at
// disc centre, as a temperature rise times (1 - mu)^2.
const FACULA_CONTRAST_NEAR_LIMB = 0.15
const NEAR_LIMB_FACTOR = 0.64


/**
 * The photosphere's parameters for the shader (star-shaders.js), from the
 * star's physical parameters (starParams.js): measured where published,
 * else from its class and magnitude.  The Sun's spots are a lattice of 25
 * cells across the radius (28 Mm cells), a third of an active region's
 * cells holding a spot of up to 0.45 cells' radius (a large sunspot's 12
 * Mm, penumbra included), in the belts 5° to 35° from the equator, where
 * sunspots form; other stars' by type (starParams.js spotsByType).
 *
 * @param {object} props A star's props: a body file's (the Sun) or a catalogue entry's
 * @returns {object}
 */
export function photosphere(props) {
  const params = starParams(props)
  // The pole's, for a rotator: the shader darkens the rest by gravity.
  const teff = params.teff
  const mean = params.teffMean
  const logg = params.logg
  const contrast = granulationContrast(mean, logg)
  const slope = luminanceSlope(mean)
  const granuleDT = contrast / slope
  // Large cells matter more at low gravity: a supergiant's few giant cells.
  const lowG = Math.min(Math.max((SUN_LOGG - logg) / SUN_LOGG, 0), 1)
  const convective = mean < CONVECTIVE_TEFF_MAX ? Math.min(contrast / granulationContrast(SUN_TEFF), 1) : 0
  const faculaDT = convective * FACULA_CONTRAST_NEAR_LIMB / (slope * NEAR_LIMB_FACTOR)
  const umbraDT = umbraDeltaT(mean)
  return {
    params,
    teff,
    teffMean: mean,
    color: blackbodyColor(mean),
    // The disc's mean surface brightness over the Sun's, for the meter and
    // the glow; and the pole's, the shader's reference.
    radianceRelSun: blackbodyLuminance(mean),
    poleRadianceRelSun: blackbodyLuminance(teff),
    limb: limbDarkening(mean),
    granulesPerRadius: granulesPerRadius(mean, logg, params.radiusPole),
    granuleDT,
    mesoDT: 0.3 * granuleDT,
    superDT: granuleDT * (0.03 + (0.8 * lowG)),
    networkDT: 0.3 * faculaDT,
    faculaDT,
    spots: {
      ...params.spots,
      prob: convective > 0 ? params.spots.prob : 0,
      umbraDT,
      penumbraDT: PENUMBRA_FRACTION * umbraDT,
    },
    rotation: params.rotation,
  }
}


/**
 * The direction of a rotating star's axis in its parent's frame: from its
 * catalogue position (the line of sight from the Sun, near enough Earth's,
 * in the catalogue's frame, with its north) where it has one, else as the
 * guide shows it, seen from the camera on +z with north up.
 *
 * @param {object} props
 * @param {object} rotation starParams' rotation
 * @returns {Vector3}
 */
export function starAxis(props, rotation) {
  const pos = [props.x, props.y, props.z].map((c) => (Number.isFinite(c) ? c : 0))
  const placed = Math.hypot(...pos) > 0
  const axis = placed ? rotationAxis(rotation, pos, CATALOGUE_NORTH) : rotationAxis(rotation, [0, 0, -1], [0, 1, 0])
  return new Vector3(...axis)
}


let blackbodyValues = null
/** @returns {{value: Array<Vector4>}} The blackbody table as a uniform, shared by every star */
export function blackbodyUniform() {
  if (!blackbodyValues) {
    const lut = sharedBlackbodyLut()
    blackbodyValues = []
    for (let i = 0; i < lut.length; i += 4) {
      blackbodyValues.push(new Vector4(lut[i], lut[i + 1], lut[i + 2], lut[i + 3]))
    }
  }
  return {value: blackbodyValues}
}


/**
 * The surface noise's time from the simulated time elapsed since the app
 * started, in ms: slow (the Sun looks bad changing quickly), the log of
 * it, and finite for any elapsed time.  It was log(1 + elapsed × 8e-7),
 * which is NaN once the simulated time is 21 minutes before the start,
 * every permalink with a past `t=`: the whole disc NaN, black through the
 * tone map, inside its limb glow (the user's black Sun; and every
 * SwiftShader render of the disc, which was taken for a SwiftShader
 * limitation).
 *
 * @param {number} simTimeElapsedMs
 * @returns {number}
 */
export function noiseTime(simTimeElapsedMs) {
  const elapsed = Number.isFinite(simTimeElapsedMs) ? Math.abs(simTimeElapsedMs) : 0
  return 4 * Math.log1p(elapsed * 8e-7)
}


/**
 * @param {object} props
 * @returns {boolean} Whether these are the Sun's props: its body file's
 *     (name 'sun') or the catalogue's entry for it (HIP 0)
 */
export function isTheSun(props) {
  return props?.name === 'sun' || props?.hipId === 0
}


export default class Star extends Object {
  /**
   * @param {object} props
   * @param {object} [sceneObjects] Registered in, by name
   * @param {object} [ui]
   * @param {object} [shadowProps]
   * @param {object} [opts]
   * @param {boolean} [opts.light] Whether it lights the scene: the Sun does, a
   *   catalogue star drawn on approach (Scene.goTo) doesn't
   */
  constructor(props, sceneObjects, ui, shadowProps = {}, {light = true} = {}) {
    super(props.name, props)
    if (!this.props || !(this.props.radius)) {
      throw new Error(`Props undefined: props(${props}), radius(${props.radius})`)
    }
    this.initialCameraDistance = this.props.radius.scalar * 35
    this.ui = ui
    if (sceneObjects) {
      sceneObjects[this.name] = this
      sceneObjects[`${this.name }.orbitPosition`] = this
    }
    this.orbitPosition = this

    // three's physically based lighting (r155+): the Sun's luminous
    // intensity in candela, falling off as 1/d² (shared.js), so three's
    // units are lux and cd/m².  The renderer's exposure follows the
    // targeted body (exposure.js), so it shows at its albedo, and the rest
    // keep their true brightness against it.
    if (light) {
      const sunlight = new PointLight(0xffffff, Shared.SUN_LUMINOUS_INTENSITY, 0, Shared.SUN_LIGHT_DECAY)
      // https://discourse.threejs.org/t/ringed-mesh-shadow-quality-worsens-with-distance-to-light-source/30211/2
      sunlight.castShadow = true
      sunlight.shadow.mapSize.width = shadowProps.width || 512 // default: 512
      sunlight.shadow.mapSize.height = shadowProps.height || 512 // default: 512
      sunlight.shadow.camera.near = shadowProps.near || 0.5 // default: 0.5
      sunlight.shadow.camera.far = shadowProps.far || 500 // default: 500
      sunlight.shadow.bias = shadowProps.bias || -0.01
      this.add(sunlight)
    }

    const lod = new LOD

    // Inside the star: nothing.  The debug axes and wireframe that were here
    // showed at extreme zooms; a debug mode can bring them back.
    lod.addLevel(new Group, 0)

    const surfaceGroup = new Group
    surfaceGroup.add(this.newSurface(props))
    // Its light off the disc (sun/SunLayers.js, Sun.md): the eye's glare
    // for every star, and the Sun's chromosphere, prominences, corona and
    // CMEs.  The glare replaced the limb glow shell (newAtmosphere), a
    // ring of the disc's own radiance to 1.07 radii that no eye or camera
    // sees, which would have shown past the Moon's limb in totality.
    surfaceGroup.add(this.sunLayers.group())
    lod.addLevel(surfaceGroup, props.radius.scalar)

    lod.addLevel(Shared.FAR_OBJ, props.radius.scalar * 1e3)

    this.add(lod)
    // The solar wind, a diagram drawn from afar too (the orbits' toggle).
    if (this.sunLayers.wind) {
      this.add(this.sunLayers.wind)
    }
  }


  /** @returns {Mesh} */
  newSurface(props) {
    const photo = photosphere(props)
    // What the meter reads of its disc (ThreeUI._luminousDiscs), and its glow.
    this.discRadianceRelSun = photo.radianceRelSun
    this.teff = photo.teffMean
    this.color = photo.color
    this.params = photo.params
    const rotation = photo.rotation
    // A rotator is an oblate spheroid, its radius the equator's.
    this.oblate = rotation?.oblate ?? 1
    const seed = seedUniforms(starSeed(props))
    const v3 = (a) => new Vector3(...a)
    // The Sun's activity by date; every star's glare.
    this.sunLayers = new SunLayers(this, {activity: isTheSun(props)})
    // The surface's radiance is physical (HDR.md, "Physical stars"): the
    // Sun's disc is 1/θ² of a white surface facing it, θ its angular
    // radius from 1 AU, times this star's surface brightness over the Sun's,
    // scaled by the exposure over Earth's keyed one (absoluteUniforms).
    this.shaderMaterial = new ShaderMaterial({
      uniforms: {
        uExposureRelative: absoluteUniforms.uExposureRelative,
        uBlackbody: blackbodyUniform(),
        uTeff: {value: photo.teff},
        uRadiance: {value: SUN_DISC_RADIANCE * photo.poleRadianceRelSun},
        // Its rotation (none: 0): the equator over the pole, Ω² and β (starParams.js rocheModel).
        uOblate: {value: this.oblate},
        uOmega2: {value: rotation?.omega2 ?? 0},
        uBeta: {value: rotation?.beta ?? 0},
        uLimbC: {value: v3(photo.limb.c)},
        uLimbAlpha: {value: v3(photo.limb.alpha)},
        uLimbMean: {value: v3(photo.limb.mean)},
        uGranuleFreq: {value: photo.granulesPerRadius},
        uGranuleDT: {value: photo.granuleDT},
        uMesoDT: {value: photo.mesoDT},
        uSuperDT: {value: photo.superDT},
        uNetworkDT: {value: photo.networkDT},
        uSpotFreq: {value: photo.spots.freq},
        uSpotProb: {value: photo.spots.prob},
        uSpotRadius: {value: photo.spots.radius},
        uUmbraDT: {value: photo.spots.umbraDT},
        uPenumbraDT: {value: photo.spots.penumbraDT},
        uFaculaDT: {value: photo.faculaDT},
        uSpotBelt: {value: new Vector2(...photo.spots.belt)},
        // Its own spots and granules, from its id (starSeed.js).
        uSeedOffset: {value: v3(seed.offset)},
        uSpotBias: {value: seed.spotBias + (photo.spots.bias ?? 0)},
        iTime: {value: 1.0},
        ...this.sunLayers.photosphereUniforms(),
      },
      vertexShader: Shaders.VERTEX_SHADER,
      fragmentShader: Shaders.FRAGMENT_SHADER,
      toneMapped: false,
    })
    const surface = sphere({matr: this.shaderMaterial})
    const r = props.radius.scalar
    surface.scale.set(r, r / this.oblate, r)
    if (rotation) {
      surface.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), starAxis(props, rotation))
    }
    // The Sun turns in its Carrington frame (SunLayers.update), so its
    // regions and granulation turn with it.
    this.surface = surface
    surface.onBeforeRender = (renderer, scene, camera) => this.sunLayers.discView(camera)
    this.setupAnim()
    return surface
  }


  /** */
  setupAnim() {
    this.preAnimCb = (time) => {
      if (Shared.targets.pos) {
        this.shaderMaterial.uniforms.iTime.value = noiseTime(time.simTimeElapsed)
      }
      this.sunLayers.update(time, this.ui?.camera, this.ui?.sceneManager?.objects)
    }
  }
}
