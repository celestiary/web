import {
  ACESFilmicToneMapping,
  CustomToneMapping,
  HalfFloatType,
  LinearSRGBColorSpace,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PointLight,
  RGBAFormat,
  SRGBColorSpace,
  ShaderChunk,
  Scene,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import {TrackballControls} from 'three/examples/jsm/controls/TrackballControls.js'
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {Pass} from 'three/addons/postprocessing/Pass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import Fullscreen from '@pablo-mayrgundter/fullscreen.js/fullscreen.js'
import {INITIAL_FOV, SMALLEST_SIZE_METER, STARS_RADIUS_METER, SUN_RADIUS_METER} from './shared.js'
import {named} from './utils.js'


/** */
export default class ThreeUi {
  /** */
  constructor(container, animationCb, backgroundColor, renderer) {
    if (typeof container === 'string') {
      this.container = document.getElementById(container)
    } else if (typeof container === 'object') {
      this.container = container
    } else {
      throw new Error(`Given container must be DOM ID or element: ${container}`)
    }
    this.threeContainer = document.createElement('div')
    this.threeContainer.style.width = this.container.offsetWidth
    this.threeContainer.style.height = this.container.offsetHeight
    this.container.appendChild(this.threeContainer)
    this.scene = new Scene
    this.animationCb = animationCb || null
    this.width = this.threeContainer.offsetWidth
    this.height = this.threeContainer.offsetHeight
    const aspect = this.width / this.height
    this.camera = new PerspectiveCamera(INITIAL_FOV, aspect, 1e-1, 1e3) // Scene's near&far set by Celestiary
    this.camera.platform = named(new Object3D, 'CameraPlatform')
    this.camera.platform.add(this.camera)

    this.renderer = renderer ||
      this.initRenderer(this.threeContainer, backgroundColor || 0x000000)
    // this.initRenderer2(this.threeContainer, backgroundColor || 0x000000)
      

    this.initControls(this.camera)
    this.fs = new Fullscreen(this.container, () => {
      this.onResize()
    })
    window.addEventListener('resize', () => {
      if (this.fs.isFullscreen()) {
        this.onResize()
      }
    })
    this.onResize()
    this.scene.add(this.camera.platform)
    window.scene = this.scene
    window.camera = this.camera
    // Adapted from https://threejs.org/docs/#api/en/core/Raycaster
    this.clickCbs = []
    this.mouse = new Vector2
    this.clicked = false
    this.useStore = undefined // TODO(pablo): passed into and set in Scene

    // VR
    // TODO: clean up VR Button container or find better one from three.js.
    /*
      this.renderer.xr.enabled = true;
      const {vrButtonContainer, controller, controllerGrip} = initVR(this.renderer);
      this.container.appendChild(vrButtonContainer);
      this.scene.add(controllerGrip);
    */

    this.renderer.setAnimationLoop(() => {
      this.renderLoop()
    })
  }


  /** Sets camera near and far to deimos and local star cluster. */
  configLargeScene() {
    this.camera.near = SMALLEST_SIZE_METER
    this.camera.far = STARS_RADIUS_METER * 2
    this.camera.updateProjectionMatrix()

    // This is a bit of a hack.  Starting the camera away from center so there's
    // less obvious jumping around, e.g. seeing inside of sun.
    this.camera.position.z = SUN_RADIUS_METER * 1e3
  }


  /** */
  addClickCb(clickCb) {
    this.clickCbs.push(clickCb)
  }


  /** @returns {WebGLRenderer} */
  initRenderer(container, backgroundColor) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('webgl2')
    container.appendChild(canvas)
    const renderer = new WebGLRenderer({canvas: canvas, context: ctx, antialias: true})
    // No idea about this.. just like the way it looks.
    // renderer.toneMapping = AgXToneMapping
    // renderer.toneMapping = ACESFilmicToneMapping
    // renderer.toneMapping = LinearToneMapping
    renderer.toneMapping = NeutralToneMapping
    // renderer.toneMapping = NoToneMapping
    // renderer.toneMapping = ReinhardToneMapping
    // renderer.toneMapping = CustomToneMapping
    // ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(
    //   'vec3 CustomToneMapping( vec3 color ) { return color; }',
    //   CUSTOM_TONE_FRAG_GLSL
    // )
    renderer.toneMappingExposure = 3e-16
    renderer.outputColorSpace = LinearSRGBColorSpace
    this.width = this.container.offsetWidth
    this.height = this.container.offsetHeight
    renderer.setClearColor(backgroundColor, 1)
    renderer.setSize(this.width, this.height)
    renderer.sortObjects = true
    renderer.autoClear = true
    // Shadows
    // renderer.shadowMap.enabled = true
    // renderer.shadowMap.type = PCFSoftShadowMap
    return renderer
  }


  /** @returns {WebGLRenderer} */
  initRenderer2(container, backgroundColor) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('webgl2')
    container.appendChild(canvas)
    const renderer = new WebGLRenderer({canvas: canvas, context: ctx, antialias: true})
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = LinearSRGBColorSpace // Should be ignored bc defined by renderTarget below
    this.width = this.container.offsetWidth
    this.height = this.container.offsetHeight
    const renderTarget = new WebGLRenderTarget(
      this.width,
      this.height,
      {
        // Let’s use half-float for efficiency:
        type: HalfFloatType, // or THREE.FloatType if needed
        // outputColorSpace: LinearSRGBColorSpace, // SRGBColorSpace
        outputColorSpace: SRGBColorSpace,
        depthBuffer: true,
        stencilBuffer: false,
      }
    )
    const composer = new EffectComposer(renderer, renderTarget)
    this.composer = composer

    // The main render pass draws your scene into `renderTarget`:
    const renderPass = new RenderPass(this.scene, this.camera)
    composer.addPass(renderPass)
 
    const FilmicToneMapShader = {
      uniforms: {
        tDiffuse: { value: null },      // the input from previous pass
        toneMappingExposure: { value: 1 },      // an example uniform
      },
      vertexShader: TONE_PASS_VERT_GLSL,
      fragmentShader: TONE_PASS_FRAG_GLSL,
    }

    const toneMapPass = new ShaderPass(FilmicToneMapShader)
    composer.addPass(toneMapPass)
   
    renderer.setClearColor(backgroundColor, 1)
    renderer.setSize(this.width, this.height)
    renderer.sortObjects = true
    renderer.autoClear = true
    // Shadows
    // renderer.shadowMap.enabled = true
    // renderer.shadowMap.type = PCFSoftShadowMap
    return renderer
  }


  /** */
  initControls(camera) {
    const controls = new TrackballControls(camera, this.threeContainer)
    // Rotation speed is changed in scene.js depending on target
    // type: faster for sun, slow for planets.
    controls.noZoom = false
    controls.noPan = false
    controls.staticMoving = true
    controls.dynamicDampingFactor = 0.3
    // controls.rotateSpeed = 1
    controls.zoomSpeed = 1e1
    window.controls = controls
    controls.target = camera.platform.position
    this.controls = controls
  }


  /** */
  onResize() {
    // https://threejsfundamentals.org/threejs/lessons/threejs-responsive.html
    let width; let height
    if (this.fs.isFullscreen()) {
      width = window.innerWidth
      height = window.innerHeight
    } else {
      width = this.container.offsetWidth
      height = this.container.offsetHeight
    }
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.controls.handleResize()
  }


  /** */
  setFov(fov) {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    if (this.camera.onChange) {
      this.camera.onChange(this.camera)
    }
  }


  /** */
  multFov(factor) {
    // TODO(pablo): narrowing very far leads to overflow in the float
    // values, such that zooming out cannot return exactly to 45
    // degrees.
    const newFov = this.camera.fov * factor
    if (newFov >= 180) {
      return
    }
    this.setFov(newFov)
  }


  /** */
  resetFov() {
    this.setFov(INITIAL_FOV)
  }


  /** */
  setAnimation(animationCb) {
    this.animationCb = animationCb
  }


  /** */
  renderLoop() {
    this.camera.updateMatrixWorld()
    if (this.clicked) {
      for (const i in this.clickCbs) {
        if (Object.prototype.hasOwnProperty.call(this.clickCbs, i)) {
          const clickCb = this.clickCbs[i]
          clickCb(this.mouse)
        }
      }
      this.clicked = false
    }

    this.controls.update()
    if (this.animationCb) {
      this.animationCb(this.scene, this)
    }
    this.renderer.render(this.scene, this.camera)
    // this.composer.render()
  }
}


const CUSTOM_TONE_FRAG_GLSL = `
vec3 CustomToneMapping( vec3 color ) {

  // Hard-coded exposure. You could also pass this in as a uniform.
  float exposure = 1e-3;
    
  // Multiply the input color by the chosen exposure.
  vec3 x = color * exposure;
    
  // Shift by a small black offset, then clamp to >= 0.
  x = max(x - 0.004, 0.0);
    
  // Apply the filmic-ish curve
  // (Often referred to as a variation of ACES or a filmic mapping.)
  vec3 numer = x * (6.2 * x + 0.5);
  vec3 denom = x * (6.2 * x + 1.7) + 0.06;
  vec3 mapped = numer / denom;

  return mapped;
}
`


const TONE_PASS_VERT_GLSL = /* glsl */`
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const TONE_PASS_FRAG_GLSL = /* glsl */`
uniform sampler2D tDiffuse;
uniform float toneMappingExposure;
varying vec2 vUV;

vec3 CustomToneMapping(vec3 color) {
  // same logic from your snippet:
  vec3 x = color * toneMappingExposure;
  x = max(x - 0.004, 0.0);
  vec3 numer = x * (6.2 * x + 0.5);
  vec3 denom = x * (6.2 * x + 1.7) + 0.06;
  return numer / denom;
}

#ifndef saturate
// <common> may have defined saturate() already
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif

// source: https://github.com/selfshadow/ltc_code/blob/master/webgl/shaders/ltc/ltc_blit.fs
vec3 RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}

vec3 ACESFilmicToneMapping( vec3 color ) {
	// sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
  const mat3 ACESInputMat = mat3(
    vec3( 0.59719, 0.07600, 0.02840 ), // transposed from source
    vec3( 0.35458, 0.90834, 0.13383 ),
    vec3( 0.04823, 0.01566, 0.83777 )
  );

  // ODT_SAT => XYZ => D60_2_D65 => sRGB
  const mat3 ACESOutputMat = mat3(
    vec3(  1.60475, -0.10208, -0.00327 ), // transposed from source
    vec3( -0.53108,  1.10813, -0.07276 ),
    vec3( -0.07367, -0.00605,  1.07602 )
  );

  color *= toneMappingExposure / 0.6;

  color = ACESInputMat * color;

  // Apply RRT and ODT
  color = RRTAndODTFit( color );

  color = ACESOutputMat * color;

  // Clamp to [0, 1]
  return saturate( color );
}

void main() {
  vec3 hdrColor = texture2D(tDiffuse, vUV).rgb;
  vec3 mapped = ACESFilmicToneMapping(hdrColor);
  // vec3 mapped = CustomToneMapping(hdrColor);

  // If you want sRGB output, do gamma correction:
  mapped = pow(mapped, vec3(1.0/1.2));
  // mapped = pow(mapped, vec3(1e4));

  gl_FragColor = vec4(mapped, 1.0);
}
`
