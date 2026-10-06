import {
  BufferGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NoBlending,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import {ZODIACAL_STORE, zodiacalGlsl} from './nightSky.js'
import {viewChanged} from './viewCache.js'


/**
 * The cache is at most this many rows tall (and at most a quarter of the
 * frame's): the zodiacal light is smooth, and its integral is 32 steps a
 * pixel.
 */
export const ZODIACAL_MAX_HEIGHT = 270


/**
 * The zodiacal light's cache (HDR.md, "The night sky's own light";
 * nightSky.js ZODIACAL_CLOUD): the dust cloud's light along each view ray,
 * integrated from wherever the camera is, into a half-float target at
 * reduced resolution, S10⊙ × ZODIACAL_STORE, which the atmosphere pass
 * samples (`uZodiacal`).  It is rendered only when the view has changed by
 * more than the target can show: the camera moved a thousandth of its
 * distance from the Sun, the view turned half a texel, or the projection
 * or the frame's size changed.  So a still view costs nothing, and the sky
 * turning with time (a landed camera, time running) re-renders it every
 * few frames, not every frame.
 */
export default class ZodiacalLight {
  /** */
  constructor() {
    this.uniforms = {
      uCam: {value: new Vector3()},
      uViewToEcl: {value: new Matrix3()},
      uProj: {value: new Vector4(1, 1, 0, 0)},
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: `${zodiacalGlsl()}${FRAG}`,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new Mesh(geometry, this.material)
    mesh.frustumCulled = false
    this.scene = new Scene()
    this.scene.add(mesh)
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.target = null
    this.last = null
    this.renders = 0
  }


  /**
   * Render the cache if the view has changed enough.
   *
   * @param {object} renderer
   * @param {Vector3} camEcl The camera from the Sun, AU, in the scene's ecliptic axes
   * @param {Matrix3} viewToEcl The camera's rotation into those axes
   * @param {Array<number>} proj The projection's [0], [5], [8] and [9]
   * @param {number} width The frame's width, pixels
   * @param {number} height Its height
   * @returns {object} The cache's texture
   */
  update(renderer, camEcl, viewToEcl, proj, width, height) {
    const scale = Math.min(0.25, ZODIACAL_MAX_HEIGHT / Math.max(height, 1))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose()
      this.target = new WebGLRenderTarget(w, h, {type: HalfFloatType, depthBuffer: false,
        minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false})
      this.last = null
    }
    // A texel's angle; the camera may move a thousandth of its distance
    // from the Sun (at least 1e-4 AU).
    const texel = 2 * Math.atan(1 / Math.max(proj[1], 1e-12)) / h
    const position = camEcl.toArray()
    if (!viewChanged(this.last, position, viewToEcl, proj, Math.max(1e-3 * camEcl.length(), 1e-4), texel)) {
      return this.target.texture
    }
    this.uniforms.uCam.value.copy(camEcl)
    this.uniforms.uViewToEcl.value.copy(viewToEcl)
    this.uniforms.uProj.value.set(...proj)
    const current = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(this.target)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(current)
    renderer.autoClear = autoClear
    this.last = {position, view: viewToEcl.clone(), proj: [...proj]}
    this.renders++
    return this.target.texture
  }
}


const VERT = `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = `
uniform vec3 uCam;
uniform mat3 uViewToEcl;
uniform vec4 uProj;
varying vec2 vNdc;
void main() {
  vec3 view = vec3((vNdc.x + uProj.z) / uProj.x, (vNdc.y + uProj.w) / uProj.y, -1.0);
  vec3 d = normalize(uViewToEcl * normalize(view));
  gl_FragColor = vec4(vec3(min(zodiacalAlong(uCam, d) * ${ZODIACAL_STORE.toExponential(6)}, 6.0e4)), 1.0);
}
`
