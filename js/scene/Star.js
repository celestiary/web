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
import {newAtmosphere} from './atmos/Atmosphere'
import {SUN_DISC_RADIANCE} from './exposure.js'
import {absoluteUniforms} from './hdr.js'
import {seedUniforms, starSeed} from './starSeed.js'
import {
  PENUMBRA_FRACTION,
  SUN_GRANULES_PER_RADIUS,
  SUN_LOGG,
  SUN_RADIUS,
  SUN_TEFF,
  blackbodyColor,
  blackbodyLuminance,
  granulationContrast,
  granulesPerRadius,
  limbDarkening,
  luminanceSlope,
  sharedBlackbodyLut,
  starTeff,
  umbraDeltaT,
} from './stellar.js'
import * as Shared from '../shared.js'
import {named} from '../utils.js'


/**
 * A star: its light (a point light for the planets), its disc and its limb
 * glow.  The disc is its photosphere from its physical parameters
 * (js/scene/Stars.md; stellar.js, star-shaders.js): the Sun is the
 * reference case, not a special one.
 */


// The Sun's sunspots: a lattice of 40 cells across the radius (17 Mm
// cells), half of the cells in an active region holding a spot of up to
// 0.45 cells' radius (a large sunspot's 8 Mm), in the belts 5° to 35°
// from the equator (as sin latitude), where sunspots form.
const SUN_SPOTS = {freq: 40, prob: 0.5, radius: 0.45, belt: [Math.sin(5 * Math.PI / 180), Math.sin(35 * Math.PI / 180)]}
// Above this a star's envelope is radiative: no convection, so no granules,
// spots or faculae (Stars.md).
const CONVECTIVE_TEFF_MAX = 7000
// The Sun's faculae: 15% over the photosphere at mu = 0.2, nothing at
// disc centre, as a temperature rise times (1 - mu)^2.
const FACULA_CONTRAST_NEAR_LIMB = 0.15
const NEAR_LIMB_FACTOR = 0.64


/**
 * The photosphere's parameters for the shader (star-shaders.js), from the
 * star's own where it has them (teff, logg, radius) and its class where not
 * (stellar.js starTeff).
 *
 * @param {object} props A star's props: a body file's (the Sun) or a catalogue entry's
 * @returns {object}
 */
export function photosphere(props) {
  const teff = starTeff(props)
  const radiusScalar = props.radius?.scalar ?? props.radius
  const hasGravity = Number.isFinite(props.logg) && radiusScalar > 0
  const logg = hasGravity ? props.logg : SUN_LOGG
  const contrast = granulationContrast(teff, logg)
  const slope = luminanceSlope(teff)
  const granuleDT = contrast / slope
  // Large cells matter more at low gravity: a supergiant's few giant cells.
  const lowG = Math.min(Math.max((SUN_LOGG - logg) / SUN_LOGG, 0), 1)
  const convective = teff < CONVECTIVE_TEFF_MAX ? Math.min(contrast / granulationContrast(SUN_TEFF), 1) : 0
  const faculaDT = convective * FACULA_CONTRAST_NEAR_LIMB / (slope * NEAR_LIMB_FACTOR)
  const umbraDT = umbraDeltaT(teff)
  return {
    teff,
    color: blackbodyColor(teff),
    radianceRelSun: blackbodyLuminance(teff),
    limb: limbDarkening(teff),
    granulesPerRadius: hasGravity ? granulesPerRadius(teff, logg, radiusScalar / SUN_RADIUS) : SUN_GRANULES_PER_RADIUS,
    granuleDT,
    mesoDT: 0.3 * granuleDT,
    superDT: granuleDT * (0.15 + (0.6 * lowG)),
    networkDT: 0.3 * faculaDT,
    faculaDT,
    spots: {
      ...SUN_SPOTS,
      prob: convective > 0 ? SUN_SPOTS.prob : 0,
      umbraDT,
      penumbraDT: PENUMBRA_FRACTION * umbraDT,
    },
  }
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


export default class Star extends Object {
  /** */
  constructor(props, sceneObjects, ui, shadowProps = {}) {
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

    // As of r155 three switches to physically based lighting.  This is just kludged for now
    // See https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733
    // Falloff 1/d^1.01 rather than the physical 1/d² (see shared.js); the
    // renderer's exposure follows the targeted body (exposure.js), so each
    // shows at its albedo whatever its distance.
    const sunlight = new PointLight(0xffffff, Shared.SUN_LUMINOUS_INTENSITY, 0, Shared.SUN_LIGHT_DECAY)
    // https://discourse.threejs.org/t/ringed-mesh-shadow-quality-worsens-with-distance-to-light-source/30211/2
    sunlight.castShadow = true
    sunlight.shadow.mapSize.width = shadowProps.width || 512 // default: 512
    sunlight.shadow.mapSize.height = shadowProps.height || 512 // default: 512
    sunlight.shadow.camera.near = shadowProps.near || 0.5 // default: 0.5
    sunlight.shadow.camera.far = shadowProps.far || 500 // default: 500
    sunlight.shadow.bias = shadowProps.bias || -0.01
    this.add(sunlight)

    const lod = new LOD

    // Inside the star: nothing.  The debug axes and wireframe that were here
    // showed at extreme zooms; a debug mode can bring them back.
    lod.addLevel(new Group, 0)

    const surfaceGroup = new Group
    surfaceGroup.add(this.newSurface(props))
    // Name the halo so Scene.enterAR's `'atmosphere'` traversal can hide it
    // — the additive BackSide shell flashes orange across the AR sky-view
    // when the camera sweeps through the Sun direction.  Its colour and
    // radiance are the disc's.
    const glow = newAtmosphere(props.radius.scalar * 1.07, {color: this.color, radiance: this.discRadianceRelSun})
    surfaceGroup.add(named(glow, 'atmosphere'))
    lod.addLevel(surfaceGroup, props.radius.scalar)

    lod.addLevel(Shared.FAR_OBJ, props.radius.scalar * 1e3)

    this.add(lod)
  }


  /** @returns {Mesh} */
  newSurface(props) {
    const photo = photosphere(props)
    // What the meter reads of its disc (ThreeUI._luminousDiscs), and its glow.
    this.discRadianceRelSun = photo.radianceRelSun
    this.teff = photo.teff
    this.color = photo.color
    const seed = seedUniforms(starSeed(props))
    const v3 = (a) => new Vector3(...a)
    // The surface's radiance is physical (HDR.md, "Physical stars"): the
    // Sun's disc is 1/θ² of a white surface facing it, θ its angular
    // radius from 1 AU, times this star's surface brightness over the Sun's,
    // scaled by the exposure over Earth's keyed one (absoluteUniforms).
    this.shaderMaterial = new ShaderMaterial({
      uniforms: {
        uExposureRelative: absoluteUniforms.uExposureRelative,
        uBlackbody: blackbodyUniform(),
        uTeff: {value: photo.teff},
        uRadiance: {value: SUN_DISC_RADIANCE * photo.radianceRelSun},
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
        uSpotBias: {value: seed.spotBias},
        iTime: {value: 1.0},
      },
      vertexShader: Shaders.VERTEX_SHADER,
      fragmentShader: Shaders.FRAGMENT_SHADER,
      toneMapped: false,
    })
    const surface = sphere({matr: this.shaderMaterial})
    surface.scale.setScalar(props.radius.scalar)
    this.setupAnim()
    return surface
  }


  /** */
  setupAnim() {
    this.preAnimCb = (time) => {
      if (Shared.targets.pos) {
        this.shaderMaterial.uniforms.iTime.value = noiseTime(time.simTimeElapsed)
      }
    }
  }
}
