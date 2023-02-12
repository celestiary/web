import {
  LOD,
  PointLight,
  ShaderMaterial,
  Mesh,
  Vector2,
  Vector3,
} from 'three'

import Object from './object.js'
import * as Shaders from './star-shaders.js'
import * as Shapes from './shapes.js'
import * as Shared from './shared.js'


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
export default class Star extends Object {
  /** */
  constructor(props, sceneObjects, ui, shadowProps = {}) {
    super(props.name, props)
    if (!this.props || !(this.props.radius)) {
      console.error('props', this.props)
      throw new Error(`Props undefined: props(${props}), radius(${props.radius})`)
    }
    this.ui = ui
    if (sceneObjects) {
      sceneObjects[this.name] = this
      sceneObjects[`${this.name }.orbitPosition`] = this
    }
    this.orbitPosition = this

    // https://discourse.threejs.org/t/ringed-mesh-shadow-quality-worsens-with-distance-to-light-source/30211/2
    const sunlight = new PointLight(0xffffff, 1, 0, 0)
    sunlight.castShadow = true
    sunlight.shadow.mapSize.width = shadowProps.width || 512 // default: 512
    sunlight.shadow.mapSize.height = shadowProps.height || 512 // default: 512
    sunlight.shadow.camera.near = shadowProps.near || 0.5 // default: 0.5
    sunlight.shadow.camera.far = shadowProps.far || 500 // default: 500
    sunlight.shadow.bias = shadowProps.bias || -0.01
    sunlight.decay = shadowProps.decay || 1 // default: 1
    this.add(sunlight)

    const lod = new LOD
    lod.addLevel(this.createSurface(props), 1)
    const farLod = props.radius.scalar * Shared.LENGTH_SCALE * 1.1e2
    lod.addLevel(Shared.FAR_OBJ, farLod)
    this.add(lod)
  }


  /** @returns {Mesh} */
  createSurface(props) {
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
    /*
      const surface = new Mesh(
          new SphereGeometry(1, 16, 16 / 2),
          new MeshBasicMaterial({
            color: 0xff0000,
            wireframe: true,
          }))
      surface.scale.setScalar(props.radius.scalar * Shared.LENGTH_SCALE)
      return surface
    }*/
    this.shaderMaterial = new ShaderMaterial({
      uniforms: {
        uColor: {value: new Vector3(1.0, 1.0, 1.0)},
        uLowTemp: {value: parseFloat(temp[0])},
        uHighTemp: {value: parseFloat(temp[1])},
        iTime: {value: 1.0},
        iResolution: {value: new Vector2()},
        iScale: {value: 100.0},
        iDist: {value: 1.0},
      },
      vertexShader: Shaders.VERTEX_SHADER,
      fragmentShader: Shaders.FRAGMENT_SHADER,
    })
    const surface = Shapes.sphere({matr: this.shaderMaterial})
    surface.scale.setScalar(props.radius.scalar * Shared.LENGTH_SCALE)
    this.setupAnim()
    return surface
  }


  /** */
  setupAnim() {
    this.preAnimCb = (time) => {
      // Sun looks bad changing too quickly.
      time = Math.log(1 + (time.simTimeElapsed * 8E-7))
      if (Shared.targets.pos) {
        this.shaderMaterial.uniforms.iTime.value = time
        const d = Shared.targets.pos.distanceTo(this.ui.camera.position)
        this.shaderMaterial.uniforms.iDist.value = d * 1E-2
      }
    }
  }
}
