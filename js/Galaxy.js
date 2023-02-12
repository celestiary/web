import {
  AdditiveBlending,
  AxesHelper,
  Points,
  ShaderMaterial,
} from 'three'
import GalaxyBufferGeometry from './GalaxyBufferGeometry.js'
import {pathTexture} from './material.js'
import * as Gravity from './gravity.js'


const Tau = 2.0 * Math.PI

/** */
export default class Galaxy extends Points {
  // numStars, ms
  // 400, 20
  // 500, 30
  // 600, 40
  // 700, 54
  // 800, 70
  // 900, 88
  // 1000, 110
  /** */
  constructor({numStars = 2, radius = 10} = {}) {
    super(new GalaxyBufferGeometry(numStars),
        new ShaderMaterial({
          uniforms: {
            texSampler: {value: pathTexture('star_glow', '.png')},
          },
          vertexShader: vertexShader,
          fragmentShader: fragmentShader,
          blending: AdditiveBlending,
          depthTest: true,
          depthWrite: false,
          transparent: true,
        }))
    this.numStars = numStars
    this.radius = radius
    this.pos = this.geometry.attributes.position.array
    this.vel = this.geometry.attributes.velocity.array
    this.mass = this.geometry.attributes.mass.array
    this.colors = this.geometry.attributes.color.array
    this.acc = new Float32Array(this.vel.length)
    this.first = true

    // Debug switch.
    if (numStars === 2) {
      this.initSimple()
    } else {
      this.initSpirals()
      this.initOrbits()
    }
  }


  /**
   * @param {number} dt
   * @param {boolean} debug
   */
  animate(dt = 1, debug = false) {
    Gravity.step(this.pos, this.vel, this.acc, this.mass)
    this.geometry.attributes.position.needsUpdate = true
  }


  // Private helpers
  /** Heavy particle at 0,0,0 and light particle at 1,0,0. */
  initSimple() {
    const SPEED = Gravity.G * 1e7
    console.log('SPEED: ', SPEED)
    // star 0: 0,0,0
    this.mass[0] = 100
    this.colors[0] = this.colors[1] = this.colors[2] = 1
    this.vel[2] = SPEED

    // star 1: 1,0,0
    this.pos[3] = 1
    this.mass[1] = 100
    this.colors[3] = 1
    this.vel[5] = -SPEED
    const axes = new AxesHelper()
    axes.position.set(1, 0, 0)
    this.add(axes)
  }


  /**
   * Preset positions in a spiral (just spokes for now and spiral
   * comes from time stepping.
   */
  initSpirals() {
    this.mass[0] = 1000
    // this.colors[0] = this.colors[1] = this.colors[2] = 0;
    const numSpokes = 5
    const armDensityRatio = 0.7
    const colorTemp = 0.5
    for (let i = 0; i < this.numStars; i++) {
      const off = 3 * i; const xi = off; const yi = off + 1; const zi = off + 2
      const theta = Math.random() * Tau
      const r = Math.random() * this.radius
      this.pos[xi] = r * Math.cos(theta)
      this.pos[yi] = (this.radius / 100) * (Math.random() - 0.5)
      this.pos[zi] = r * Math.sin(theta)
      this.colors[xi] = 1 - colorTemp + (colorTemp * Math.random())
      this.colors[yi] = 1 - colorTemp + (colorTemp * Math.random())
      this.colors[zi] = 1 - colorTemp + (colorTemp * Math.random())
      this.mass[i] = 10 * ((1 - armDensityRatio) + (armDensityRatio * Math.cos(theta * numSpokes)))
    }
  }


  /**
   * https://en.wikipedia.org/wiki/Standard_gravitational_parameter#Small_body_orbiting_a_central_body
   * https://github.com/jdiwnab/OrbitSim
   */
  initOrbits() {
    // const M0 = this.mass[0]
    // Start at 1 to skip moving center body.
    for (let i = 1; i < this.numStars; i++) {
      const off = 3 * i
      const xi = off
      // const yi = off + 1
      const zi = off + 2
      // const M1 = this.mass[i]
      const x = this.pos[xi]; const z = this.pos[zi]
      // const R = Math.sqrt((x * x) + (z * z))
      // const R2 = R * R
      const fR = 0// Gravity.G * M0 * M1 / R2 * 1e1;
      this.vel[xi] = -z * fR
      this.vel[zi] = x * fR
      // console.log(`${xi} ${zi} ${R} ${fR}`);
    }
  }
}


const vertexShader = `
  attribute float mass;
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = mass * 80. / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`


const fragmentShader = `
// https://gamedev.stackexchange.com/questions/138384/how-do-i-avoid-using-the-wrong-texture2d-function-in-glsl
#if __VERSION__ < 130
#define TEXTURE2D texture2D
#else
#define TEXTURE2D texture
#endif
  uniform sampler2D texSampler;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.) * TEXTURE2D(texSampler, gl_PointCoord);
  }
`
