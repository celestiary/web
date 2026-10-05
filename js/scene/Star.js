import {
  AxesHelper,
  Group,
  LOD,
  PointLight,
  ShaderMaterial,
  Mesh,
  Vector2,
  Vector3,
} from 'three'
import Object from './object.js'
import * as Shaders from './star-shaders.js'
import {sphere} from './shapes.js'
import {newAtmosphere} from './atmos/Atmosphere'
import {absoluteUniforms} from './hdr.js'
import * as Shared from '../shared.js'
import {named} from '../utils.js'


/**
 * The star uses a Perlin noise for a naturalistic rough noise
 * process.  However, solar surface dynamics are better described by
 * Benard convection cells:
 *   https://en.wikipedia.org/wiki/Granule_(solar_physics)
 *   https://en.wikipedia.org/wiki/Rayleigh%E2%80%93B%C3%A9nard_convection
 * Some example implementations:
 *   https://www.shadertoy.com/view/llScRy
 *   https://www.shadertoy.com/view/XlsfWM
 *
 * Current approach uses:
 *   https://bpodgursky.com/2017/02/01/procedural-star-rendering-with-three-js-and-webgl-shaders/
 * Which derives from:
 *   https://www.seedofandromeda.com/blogs/51-procedural-star-rendering
 *
 * A next level up is to include a magnetic field model for the entire
 * star and use it to mix in a representation of differential plasma
 * flows along the field lines.
 */
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

    const guideGroup = new Group
    const internalGuidesRadius = props.radius.scalar * 0.999
    guideGroup.add(new AxesHelper(internalGuidesRadius))
    guideGroup.add(sphere({radius: internalGuidesRadius, wireframe: true}))
    lod.addLevel(guideGroup, 0)

    const surfaceGroup = new Group
    surfaceGroup.add(this.newSurface(props))
    // Name the halo so Scene.enterAR's `'atmosphere'` traversal can hide it
    // — the additive BackSide shell flashes orange across the AR sky-view
    // when the camera sweeps through the Sun direction.
    surfaceGroup.add(named(newAtmosphere(props.radius.scalar * 1.07), 'atmosphere'))
    lod.addLevel(surfaceGroup, props.radius.scalar)

    lod.addLevel(Shared.FAR_OBJ, props.radius.scalar * 1e3)

    this.add(lod)
  }


  /** @returns {Mesh} */
  newSurface(props) {
    const tempRanges = [
      [8152, 10060], // 0, O
      [11950, 12250], // 1, B  Rigel
      [8152, 10060], // 2, A  Vega
      [6000, 7600], // 3, F  Procyon
      [5778, 5778 / 4], // 4, G  Sun
      [4256, 4316], // 5, K  Arcturus
      [3400, 3800], // 6, M  Betelgeuse
      [3400, 3800], // 7, R, like M
      [3400, 3800], // 8, S, like M
      [3400, 3800], // 9, N, like M
      [8152, 10060], // 10, WC, like O
      [8152, 10060], // 11, WN, like O
      [8152, 10060], // 12, Unknown, like O?
      [8152, 10060], // 13, L
      [8152, 10060], // 14, T
      [8152, 10060]]// 15, Carbon star?
    const temp = tempRanges[props.spectralType]
    // The surface's radiance is physical (HDR.md, "Physical stars"): the
    // Sun's disc is 1/θ² of a white surface facing it, θ its angular
    // radius from 1 AU, scaled by the exposure over Earth's keyed one
    // (absoluteUniforms); the shader's texture is its granulation, ~1.
    this.shaderMaterial = new ShaderMaterial({
      uniforms: {
        uExposureRelative: absoluteUniforms.uExposureRelative,
        uColor: {value: new Vector3(1.0, 1.0, 1.0)},
        uLowTemp: {value: parseFloat(temp[0])},
        uHighTemp: {value: parseFloat(temp[1])},
        iTime: {value: 1.0},
        iResolution: {value: new Vector2},
        iScale: {value: 100.0},
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
