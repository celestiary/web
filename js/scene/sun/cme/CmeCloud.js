import {SEGMENTS, STRAND_GLSL, cmeModel} from './cmeModel.js'


/**
 * The CMEs as their particles (cmeModel.js; js/scene/Sun.md, "CMEs"),
 * drawn into targets of their own that the corona's shader reads.  Each
 * particle adds its electrons' column where it is on screen, so thousands
 * of them sum to the CME's along every line of sight:
 *
 * - a **thread** (the rope's and the core's) is a ribbon along its path,
 *   facing the camera, a Gaussian across it;
 * - a **puff** (the front's) is a quad facing the camera, a Gaussian both
 *   ways, a little longer along its own way.  A ribbon that wide folds
 *   over itself wherever its path bends more tightly on screen than it is
 *   wide, and the folds add up to bright spikes; a blob can't fold.
 *
 * The sum is linear, which the picture isn't (the coronagraph's filter and
 * colour table in the activity view), so the particles can't be added to
 * the frame itself: the corona's shader takes the targets' column with its
 * own and draws both as one corona.
 *
 * Two targets, because the puffs are smooth and many times wider than the
 * threads: the threads' at the frame's size, the puffs' at a quarter of
 * it each way, where their fill costs a sixteenth.  Per pixel:
 * - r: the CMEs' K-corona, Thomson-scattered light over the disc's mean,
 *   **over the mean corona's at that pixel's radius** (the radial filter's
 *   table), which keeps it near 1 in a half-float, where the brightness
 *   itself, 1e-9, would be flushed to zero;
 * - b (the threads' only): the erupting prominences' cool plasma's
 *   optical depth, and g, a: that times its Hα (nm) and times its He II
 *   304 Å level (as the nm of Hα that give it in the activity view), so
 *   that many threads in a line saturate at the plasma's own emission.
 *
 * Loaded when a CME is first in view (SunLayers), not with the page, so
 * it imports nothing the page's first load has: three's classes, the
 * corona's physics and the view's constants are handed to cmeCloud()
 * (SunLayers CME_DEPS), as the credits dialog's are.  A module both
 * imported would be split into a file of its own for the first load to
 * fetch (esbuild/budget.js).
 */


// The threads' target is the frame's size, to at most this height; the
// puffs' is this share of it each way.
export const MAX_HEIGHT = 900
export const PUFF_SCALE = 0.25
// A particle is drawn out to this many of its Gaussian's σ, and at least
// this wide on screen (a thinner one is drawn that wide and that much
// fainter).
const EXTENT = 2.5
const MIN_SIGMA_PX = 0.8
// A thread is no brighter along the line of sight than at this sine of
// its angle to it (end on, its column has no bound), and fades out below
// it: there its ribbon has no direction on screen, and would fold.
const MIN_SIN = 0.25
// A puff is longer along its way than across by this share of its path.
const PUFF_STRETCH = 0.6
// A core thread's optical depth in the cool lines, across its middle.
export const COOL_DEPTH = 0.12
// All of a CME's particles are drawn when it is this many pixels in
// radius, and never fewer than this share of them.
const FULL_DETAIL_PX = 260
const MIN_DETAIL = 0.2
// The knots drift along the threads, and the particles' wobble turns, this
// many radians an hour.
// A camera is inside a CME within this of its angular reach (radians).
const INSIDE_MARGIN = 0.3
const KNOT_DRIFT = 1.5
const WOBBLE_DRIFT = 0.3
const MS_PER_HOUR = 3600e3


/**
 * @param {number} radiusPx The CME's leading edge on screen, pixels from the star
 * @param {number} count Every particle
 * @returns {number} How many of them to draw
 */
export function detailCount(radiusPx, count) {
  const share = Math.min(Math.max(radiusPx / FULL_DETAIL_PX, MIN_DETAIL), 1)
  return Math.max(1, Math.round(count * share))
}


/**
 * @param {number} width The frame's
 * @param {number} height
 * @returns {{threads: Array<number>, puffs: Array<number>}} The targets' sizes
 */
export function targetSizes(width, height) {
  const scale = Math.min(1, MAX_HEIGHT / Math.max(height, 1))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  return {threads: [w, h], puffs: [Math.max(1, Math.round(w * PUFF_SCALE)), Math.max(1, Math.round(h * PUFF_SCALE))]}
}


/**
 * The cloud, given what it shares with the page's first load.
 *
 * @param {object} deps SunLayers' CME_DEPS: {three: its classes and
 *     constants, perf, EUV_VIEW, RADIAL_FIRST, RADIAL_SAMPLES, CORONA_GLSL,
 *     CORONA_RADII, GRAMS_PER_ELECTRON, SUN_RADIUS_CM, THOMSON_CM2,
 *     MAX_CMES, radialReference, dilution, generator, hash2}
 * @returns {{CmeCloud: Function, electronFactor: Function}}
 */
export function cmeCloud(deps) {
  const {
    three, perf, EUV_VIEW, RADIAL_FIRST, RADIAL_SAMPLES, CORONA_GLSL, CORONA_RADII, GRAMS_PER_ELECTRON,
    SUN_RADIUS_CM, THOMSON_CM2, MAX_CMES, radialReference,
  } = deps
  const {
    AddEquation, Color, CustomBlending, DoubleSide, Float32BufferAttribute, HalfFloatType,
    InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, Mesh, OneFactor, Scene, ShaderMaterial,
    Vector2, Vector3, Vector4, WebGLRenderTarget,
  } = three
  const {shapeOf, buildStrands} = cmeModel(deps)


  const HEAD = `
  ${CORONA_GLSL}
  attribute vec4 aPath;
  attribute vec4 aTube;
  attribute vec4 aWobble;
  attribute vec4 aExtra;
  // The CME's frame in view space: its axis at the apex, outward, their cross.
  uniform vec3 uT;
  uniform vec3 uD;
  uniform vec3 uB;
  uniform vec4 uShape;
  uniform vec4 uSeed;
  // The star's centre in view space (radii), and a radius in metres.
  uniform vec3 uSunCentre;
  uniform float uRadius;
  // Half the target in pixels, and pixels a radius at a depth of one radius.
  uniform vec3 uScreen;
  // The electrons' factor, the drawn particles' share scale, and the debug
  // switch (each particle's share, a pixel); the core's Hα and He II (nm).
  uniform vec3 uLight;
  uniform vec2 uCool;
  uniform float uRadialRef[${RADIAL_SAMPLES}];
  varying vec4 vOut;
  varying vec2 vX;
  ${STRAND_GLSL}

  float radialRef(float rho) {
    float x = clamp(log(max(rho, ${RADIAL_FIRST.toFixed(2)}) / ${RADIAL_FIRST.toFixed(2)}) /
        log(${CORONA_RADII.toFixed(1)} / ${RADIAL_FIRST.toFixed(2)}), 0.0, 1.0) * ${(RADIAL_SAMPLES - 1).toFixed(1)};
    int i = int(min(floor(x), ${(RADIAL_SAMPLES - 2).toFixed(1)}));
    return pow(10.0, mix(uRadialRef[i], uRadialRef[i + 1], x - float(i)));
  }

  // The Thomson-scattered light of a column at a point, over the disc's
  // mean and over the mean corona's on its line of sight; and whether the
  // point is out of the star and not round the camera (from inside a CME its
  // particles are a haze, and one seen from within its own tube's width has
  // no shape to draw).
  float scattered(vec3 p, vec3 los, float depth, float tube, out float fade) {
    float r = length(p);
    float cosChi = dot(p, los) / r;
    float rhoLos = length(p - dot(p, los) * los);
    fade = smoothstep(1.0, 1.04, r) * smoothstep(2.0, 6.0, depth / max(tube, 1.0e-3));
    return dilution(max(r, 1.0)) * (1.0 + cosChi * cosChi) / (r * r * radialRef(rhoLos));
  }
  `


  const THREAD_VERTEX = `${HEAD}
  void main() {
    float q = position.x;
    const float h = ${(0.5 / SEGMENTS).toFixed(6)};
    float psi;
    float tube;
    float psi1;
    float tube1;
    vec3 p0 = strandPoint(q, psi, tube);
    vec3 p1 = strandPoint(q + h, psi1, tube1);
    vec3 v0 = uSunCentre + p0;
    vec3 v1 = uSunCentre + p1;
    vec4 c0 = projectionMatrix * vec4(v0 * uRadius, 1.0);
    vec4 c1 = projectionMatrix * vec4(v1 * uRadius, 1.0);
    vec2 n0 = c0.xy / c0.w;
    vec2 dpx = (c1.xy / c1.w - n0) * uScreen.xy;
    float dl = length(dpx);
    vec2 across = dl > 1.0e-5 ? vec2(-dpx.y, dpx.x) / dl : vec2(0.0, 1.0);
    float depth = max(-v0.z, 1.0e-3);
    float sigma = aTube.z * tube;
    float sigmaPx = sigma * uScreen.z / depth;
    float drawnPx = max(sigmaPx, ${MIN_SIGMA_PX.toFixed(2)});
    float thin = sigmaPx / drawnPx;
    vX = vec2(position.y * ${EXTENT.toFixed(2)}, 0.0);
    vec2 ndc = n0 + across * (vX.x * drawnPx) / uScreen.xy;
    bool ahead = c0.w > 1.0e-3 && c1.w > 1.0e-3;
    gl_Position = ahead ? vec4(ndc * c0.w, 0.0, c0.w) : vec4(2.0, 2.0, 2.0, 1.0);

    vec3 dp = p1 - p0;
    float len = max(length(dp), 1.0e-9);
    vec3 los = normalize(v0);
    float slant = length(cross(dp / len, los));
    float sinA = max(slant, ${MIN_SIN.toFixed(2)});
    float env = strandEnvelope(q, psi);
    // The column through the thread's middle: its share a unit of q, over
    // the length a unit of q covers, its width and the line of sight's slant.
    float column = aTube.w * uLight.y * env * thin * h / (len * sigma * sinA);
    float fade;
    float light = scattered(p0, los, depth, tube, fade);
    fade *= smoothstep(${(0.4 * MIN_SIN).toFixed(3)}, ${MIN_SIN.toFixed(2)}, slant);
    float tau = aExtra.x == 2.0 ? ${COOL_DEPTH.toFixed(2)} * env * thin / sinA : 0.0;
    vOut = fade * vec4(uLight.x * column * light, uCool.x * tau, tau, uCool.y * tau);
    if (uLight.z > 0.5) {
      vOut = vec4(fade * column * depth * depth / (uScreen.z * uScreen.z * 2.5066283), 0.0, 0.0, 0.0);
    }
  }
  `


  const PUFF_VERTEX = `${HEAD}
  void main() {
    float psi;
    float tube;
    float psiA;
    float tubeA;
    vec3 p = strandPoint(0.5, psi, tube);
    vec3 pa = strandPoint(0.15, psiA, tubeA);
    vec3 pb = strandPoint(0.85, psiA, tubeA);
    vec3 v = uSunCentre + p;
    vec4 c = projectionMatrix * vec4(v * uRadius, 1.0);
    vec4 ca = projectionMatrix * vec4((uSunCentre + pa) * uRadius, 1.0);
    vec4 cb = projectionMatrix * vec4((uSunCentre + pb) * uRadius, 1.0);
    vec2 dpx = (cb.xy / cb.w - ca.xy / ca.w) * uScreen.xy;
    float dl = length(dpx);
    vec2 along = dl > 1.0e-4 ? dpx / dl : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);
    float depth = max(-v.z, 1.0e-3);
    vec3 los = normalize(v);
    // A blob longer along its way: its Gaussian along the screen is its
    // length's and its width's, by the slant of its way to the line of sight.
    vec3 way = pb - pa;
    float reach = 0.5 * length(way);
    float slant = reach > 1.0e-6 ? length(cross(way / (2.0 * reach), los)) : 0.0;
    float sigma = aTube.z * tube;
    float longer = sqrt(sigma * sigma + ${(PUFF_STRETCH * PUFF_STRETCH).toFixed(3)} * reach * reach * slant * slant);
    float px = uScreen.z / depth;
    float drawn = max(sigma * px, ${MIN_SIGMA_PX.toFixed(2)});
    float drawnLong = max(longer * px, ${MIN_SIGMA_PX.toFixed(2)});
    vX = position.xy * ${EXTENT.toFixed(2)};
    vec2 ndc = c.xy / c.w + (along * (vX.x * drawnLong) + across * (vX.y * drawn)) / uScreen.xy;
    bool ahead = c.w > 1.0e-3 && ca.w > 1.0e-3 && cb.w > 1.0e-3;
    gl_Position = ahead ? vec4(ndc * c.w, 0.0, c.w) : vec4(2.0, 2.0, 2.0, 1.0);

    // The column through the blob's middle: its share over 2π σ σ', the
    // √(2π) of one of them in the electrons' factor.
    float column = aExtra.y * uLight.y / (2.5066283 * drawn * drawnLong / (px * px));
    float fade;
    float light = scattered(p, los, depth, tube, fade);
    vOut = vec4(fade * uLight.x * column * light, 0.0, 0.0, 0.0);
    if (uLight.z > 0.5) {
      vOut = vec4(fade * column * depth * depth / (uScreen.z * uScreen.z * 2.5066283), 0.0, 0.0, 0.0);
    }
  }
  `


  const FRAGMENT = `
  varying vec4 vOut;
  varying vec2 vX;
  void main() {
    gl_FragColor = vOut * exp(-0.5 * dot(vX, vX));
  }
  `


  /**
   * @param {number} mass g
   * @returns {number} The factor on a particle's column (its share of the
   *     CME over radii squared, a Gaussian's √(2π) taken out) that gives its
   *     Thomson-scattered light over the disc's mean, before the geometry:
   *     (3σ_T / 16) N_e / (√(2π) R☉²)
   */
  function electronFactor(mass) {
    const electrons = mass / GRAMS_PER_ELECTRON
    return 3 * THOMSON_CM2 * electrons / (16 * Math.sqrt(2 * Math.PI) * SUN_RADIUS_CM * SUN_RADIUS_CM)
  }


  class CmeCloud {
    /** Builds the particles and a mesh of each sort for each CME that can be drawn at once. */
    constructor() {
      this.strands = buildStrands()
      this.debug = false
      this._size = new Vector2
      this._clearColor = new Color
      // The corona shader's own table (sun-shaders.js radialRef).
      const radial = radialReference(RADIAL_SAMPLES, RADIAL_FIRST, CORONA_RADII)
      const ribbon = []
      const ribbonIndex = []
      for (let j = 0; j <= SEGMENTS; j++) {
        ribbon.push(j / SEGMENTS, -1, 0, j / SEGMENTS, 1, 0)
        if (j < SEGMENTS) {
          const a = 2 * j
          ribbonIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
      this.threads = this._layer(this.strands.threads, ribbon, ribbonIndex, THREAD_VERTEX, radial)
      this.puffs = this._layer(this.strands.puffs, [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], [0, 1, 2, 0, 2, 3],
          PUFF_VERTEX, radial)
    }


    /**
     * One sort of particle: a scene with a mesh for each CME, each its own
     * geometry (its own count drawn) over the same attributes, and a target.
     *
     * @param {object} particles buildStrands' threads or puffs
     * @param {Array<number>} base One particle's vertices
     * @param {Array<number>} index
     * @param {string} vertexShader
     * @param {Array<number>} radial The radial filter's table
     * @returns {{scene: object, meshes: Array<object>, count: number, target: ?object}}
     */
    _layer(particles, base, index, vertexShader, radial) {
      const position = new Float32BufferAttribute(base, 3)
      const attributes = {
        aPath: new InstancedBufferAttribute(particles.path, 4),
        aTube: new InstancedBufferAttribute(particles.tube, 4),
        aWobble: new InstancedBufferAttribute(particles.wobble, 4),
        aExtra: new InstancedBufferAttribute(particles.extra, 4),
      }
      const scene = new Scene
      const meshes = []
      for (let i = 0; i < MAX_CMES; i++) {
        const geometry = new InstancedBufferGeometry
        geometry.setAttribute('position', position)
        geometry.setIndex(index)
        for (const [name, attribute] of Object.entries(attributes)) {
          geometry.setAttribute(name, attribute)
        }
        geometry.instanceCount = particles.count
        const material = new ShaderMaterial({
          uniforms: {
            uT: {value: new Vector3(1, 0, 0)},
            uD: {value: new Vector3(0, 1, 0)},
            uB: {value: new Vector3(0, 0, -1)},
            uShape: {value: new Vector4},
            uSeed: {value: new Vector4},
            uSunCentre: {value: new Vector3},
            uRadius: {value: 1},
            uScreen: {value: new Vector3(1, 1, 1)},
            uLight: {value: new Vector3},
            uCool: {value: new Vector2},
            uRadialRef: {value: radial},
          },
          vertexShader,
          fragmentShader: FRAGMENT,
          blending: CustomBlending,
          blendEquation: AddEquation,
          blendSrc: OneFactor,
          blendDst: OneFactor,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
          side: DoubleSide,
        })
        const mesh = new Mesh(geometry, material)
        mesh.frustumCulled = false
        mesh.visible = false
        scene.add(mesh)
        meshes.push(mesh)
      }
      return {scene, meshes, count: particles.count, target: null}
    }


    /**
     * Draws the CMEs into the targets, with the renderer's own target, clear
     * colour and auto-clear put back after.
     *
     * @param {object} renderer
     * @param {object} camera The frame's
     * @param {Array<object>} items Each CME in view space: {cme, d: outward,
     *     east, north: at its source (unit Vector3s)}
     * @param {object} view {sunCentre: Vector3 in view space (radii), radius
     *     (m), seed, ms: the simulated time}
     * @returns {{threads: object, puffs: object}} The targets' textures
     */
    render(renderer, camera, items, view) {
      const current = renderer.getRenderTarget()
      if (current) {
        this._size.set(current.width, current.height)
      } else {
        renderer.getDrawingBufferSize(this._size)
      }
      const sizes = targetSizes(this._size.x, this._size.y)
      this.shapes = items.map(({cme}) => shapeOf(cme, view.seed))
      const depth = Math.max(-view.sunCentre.z, 1e-3)
      // A CME the camera is inside isn't drawn: from within, its particles
      // are a haze round the camera, not a shape (the shader fades the ones
      // near it; this spares drawing the rest).  Inside: nearer the star
      // than its front, and within its width of its direction.
      const camDistance = view.sunCentre.length()
      const within = items.map(({cme, d}, i) => {
        const shape = this.shapes[i]
        const reach = shape.alpha + Math.asin(Math.min(1.6 * shape.kappa, 1)) + INSIDE_MARGIN
        const cos = -d.dot(view.sunCentre) / Math.max(camDistance, 1e-9)
        return camDistance < cme.front * 1.1 && cos > Math.cos(Math.min(reach, Math.PI))
      })
      for (const [layer, [w, h]] of [[this.threads, sizes.threads], [this.puffs, sizes.puffs]]) {
        if (!layer.target || layer.target.width !== w || layer.target.height !== h) {
          layer.target?.dispose()
          layer.target = new WebGLRenderTarget(w, h, {type: HalfFloatType, depthBuffer: false,
            minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false})
        }
        const pxPerRadius = 0.5 * h * camera.projectionMatrix.elements[5]
        layer.meshes.forEach((mesh, i) => {
          const item = items[i]
          mesh.visible = Boolean(item) && !within[i]
          if (!mesh.visible) {
            return
          }
          const {cme} = item
          const shape = this.shapes[i]
          const u = mesh.material.uniforms
          u.uD.value.copy(item.d)
          u.uT.value.copy(item.east).multiplyScalar(Math.cos(shape.tilt))
              .addScaledVector(item.north, Math.sin(shape.tilt)).normalize()
          u.uB.value.crossVectors(u.uD.value, u.uT.value)
          const hours = (view.ms - cme.launch) / MS_PER_HOUR
          u.uShape.value.set(shape.alpha, shape.H, shape.tube, shape.twist)
          u.uSeed.value.set(shape.theta, shape.phase + (WOBBLE_DRIFT * hours), shape.flip, KNOT_DRIFT * hours)
          u.uSunCentre.value.copy(view.sunCentre)
          u.uRadius.value = view.radius
          u.uScreen.value.set(w / 2, h / 2, pxPerRadius)
          // By the CME's size on the frame, whichever target this is.
          const framePx = cme.front * 0.5 * sizes.threads[1] * camera.projectionMatrix.elements[5] / depth
          const count = detailCount(framePx, layer.count)
          mesh.geometry.instanceCount = count
          u.uLight.value.set(electronFactor(cme.mass), layer.count / count, this.debug ? 1 : 0)
          u.uCool.value.set(shape.halpha, shape.euv / EUV_VIEW.coolPerNm)
        })
      }
      const autoClear = renderer.autoClear
      const clearAlpha = renderer.getClearAlpha()
      renderer.getClearColor(this._clearColor)
      perf.begin('cme')
      renderer.autoClear = false
      renderer.setClearColor(0x000000, 0)
      for (const layer of [this.threads, this.puffs]) {
        renderer.setRenderTarget(layer.target)
        renderer.clear(true, false, false)
        renderer.render(layer.scene, camera)
      }
      renderer.setRenderTarget(current)
      renderer.setClearColor(this._clearColor, clearAlpha)
      renderer.autoClear = autoClear
      perf.end('cme')
      return {threads: this.threads.target.texture, puffs: this.puffs.target.texture}
    }


    /** Frees the targets and the particles' buffers. */
    dispose() {
      for (const layer of [this.threads, this.puffs]) {
        layer.target?.dispose()
        for (const mesh of layer.meshes) {
          mesh.geometry.dispose()
          mesh.material.dispose()
        }
      }
    }
  }


  return {CmeCloud, electronFactor}
}
