import {
  AdditiveBlending,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import {EMITTED_GLSL, HDR_MAX_VALUE, absoluteUniforms, hdrSupported} from './hdr.js'
import {
  STORE_SCALE, bakeMapSteps, catalogToGalactic, galaxyGlsl, galaxyNormUniforms, normalize, outsideWeight,
  sceneToGalacticRotation,
} from './galaxyModel.js'


/**
 * The march's render target is at most this many pixels tall (and at most
 * half the frame's height): the galaxy's light is smooth on that scale, and
 * the march is the expensive part.
 */
export const MARCH_MAX_HEIGHT = 540


/**
 * The Milky Way (#99; MilkyWay.md): its integrated light, from a published
 * structural model (galaxyModel.js), ray-marched through the volume in
 * exposure units.
 *
 * One full-screen triangle, drawn in the scene pass behind everything (its
 * depth is pinned to the far plane, as the point cloud's was): for each
 * pixel the view ray, in the galactocentric frame G, integrates the model's
 * emission through its dust, so the same pass gives the face of a barred
 * spiral from outside, the edge-on disc with its dust lane, and the band
 * across the sky from inside.  The light is radiance, not display values:
 * the pass writes it times the frame's exposure (pre-exposure, HDR.md), as
 * the stars and the Sun do.
 *
 * Where the buffer is float (HDR.md), the march runs into a render target
 * at up to MARCH_MAX_HEIGHT rows, holding the light unexposed (times
 * STORE_SCALE), and only when the view changes; each frame then samples it
 * and applies the exposure, so a still view costs one texture read a
 * pixel.  In the LDR fallback it marches in the pass itself.
 *
 * The model's in-plane map takes about 1.5 s to bake (galaxyModel.js
 * bakeMapSteps); in a browser it bakes in slices between frames, and the
 * galaxy appears when it is done.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.bake] Bake the map (default: in a browser); tests skip it
 * @returns {Mesh}
 */
export default function newMilkyWay({bake = typeof requestAnimationFrame === 'function'} = {}) {
  const geometry = fullScreenTriangle()
  const mapTexture = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)
  mapTexture.needsUpdate = true
  const march = {
    uGalaxyMap: {value: mapTexture},
    uGalaxyMapScale: {value: new Vector4(1, 1, 1, 1)},
    uGalaxyNorm0: {value: new Vector4()},
    uGalaxyNorm1: {value: new Vector4()},
    uCamG: {value: new Vector3()},
    uViewToG: {value: new Matrix3()},
    uProj: {value: new Vector4(1, 1, 0, 0)},
  }
  // The march's render target, and its texture for the composite.
  const marchTarget = {value: null}
  const marchTexture = {value: null}
  const marchMaterial = new ShaderMaterial({
    uniforms: march,
    vertexShader: VERT_MARCH,
    fragmentShader: `${galaxyGlsl()}${FRAG_MARCH}`,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const material = new ShaderMaterial({
    uniforms: {
      ...march,
      uMarch: marchTexture,
      uMarchSize: {value: new Vector2(1, 1)},
      uExposureRelative: absoluteUniforms.uExposureRelative,
    },
    vertexShader: VERT_COMPOSITE,
    fragmentShader: FRAG_COMPOSITE,
    defines: {GALAXY_DIRECT: 0},
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
  material.visible = false
  const mesh = new Mesh(geometry, material)
  mesh.name = 'MilkyWay'
  mesh.frustumCulled = false
  // Behind the stars (renderOrder 0), as the point cloud was.
  mesh.renderOrder = -2
  // A full-screen triangle has no place in the scene to be picked at.
  mesh.raycast = noRaycast

  const marchScene = new Scene()
  const marchMesh = new Mesh(geometry, marchMaterial)
  marchMesh.frustumCulled = false
  marchScene.add(marchMesh)
  const marchCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const camWorld = new Vector3()
  const viewToLocal = new Matrix3()
  const objRotation = new Matrix3()
  const sceneToG = new Matrix3()
  const r = sceneToGalacticRotation()
  sceneToG.set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8])
  const size = new Vector2()
  let direct = null
  let lastKey = null
  const debug = {cameraG: [0, 0, 0], outsideWeight: 0, marches: 0, ready: false, bakeMs: 0, target: marchTarget}
  mesh.userData.galaxy = debug

  mesh.onBeforeRender = (renderer, scene, camera) => {
    if (direct === null) {
      direct = !hdrSupported(renderer)
      material.defines.GALAXY_DIRECT = direct ? 1 : 0
      material.fragmentShader = direct ? `${galaxyGlsl()}${FRAG_COMPOSITE}` : FRAG_COMPOSITE
      material.needsUpdate = true
    }
    // The camera in G, kpc: its position in this object's frame (the
    // catalogue's, metres from the Sun; the StellarFrame's precession and
    // the worldGroup's rebase above it), as rte.js does it, in float64.
    camera.getWorldPosition(camWorld)
    const e = mesh.matrixWorld.elements
    const dx = camWorld.x - e[12]
    const dy = camWorld.y - e[13]
    const dz = camWorld.z - e[14]
    const camG = catalogToGalactic(
        (e[0] * dx) + (e[1] * dy) + (e[2] * dz),
        (e[4] * dx) + (e[5] * dy) + (e[6] * dz),
        (e[8] * dx) + (e[9] * dy) + (e[10] * dz))
    march.uCamG.value.set(camG[0], camG[1], camG[2])
    debug.cameraG = camG
    debug.outsideWeight = outsideWeight(camG)
    // View direction → G: the camera's rotation, this object's inverse, the catalogue → G turn.
    viewToLocal.setFromMatrix4(camera.matrixWorld)
    objRotation.setFromMatrix4(mesh.matrixWorld).transpose()
    march.uViewToG.value.copy(sceneToG).multiply(objRotation).multiply(viewToLocal)
    const p = camera.projectionMatrix.elements
    march.uProj.value.set(p[0], p[5], p[8], p[9])
    if (direct) {
      return
    }
    // The march, into its target, when the view has changed.
    const current = renderer.getRenderTarget()
    if (current) {
      size.set(current.width, current.height)
    } else {
      renderer.getDrawingBufferSize(size)
    }
    const scale = Math.min(0.5, MARCH_MAX_HEIGHT / Math.max(size.y, 1))
    const w = Math.max(1, Math.round(size.x * scale))
    const h = Math.max(1, Math.round(size.y * scale))
    if (!marchTarget.value || marchTarget.value.width !== w || marchTarget.value.height !== h) {
      marchTarget.value?.dispose()
      marchTarget.value = new WebGLRenderTarget(w, h, {type: HalfFloatType, depthBuffer: false,
        minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false})
      marchTexture.value = marchTarget.value.texture
      lastKey = null
    }
    material.uniforms.uMarchSize.value.set(w, h)
    const key = [...camG, ...march.uViewToG.value.elements, p[0], p[5], p[8], p[9], w, h, debug.ready]
    if (lastKey && key.every((v, i) => v === lastKey[i])) {
      return
    }
    lastKey = key
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(marchTarget.value)
    renderer.render(marchScene, marchCamera)
    renderer.setRenderTarget(current)
    renderer.autoClear = autoClear
    debug.marches++
  }

  if (bake) {
    bakeInSlices(({map, norms, ms}) => {
      const tex = new DataTexture(map.data, map.size, map.size, RGBAFormat, UnsignedByteType)
      tex.minFilter = LinearFilter
      tex.magFilter = LinearFilter
      tex.wrapS = tex.wrapT = ClampToEdgeWrapping
      tex.generateMipmaps = false
      tex.needsUpdate = true
      march.uGalaxyMap.value = tex
      march.uGalaxyMapScale.value.set(...map.scale)
      const u = galaxyNormUniforms(norms)
      march.uGalaxyNorm0.value.set(...u.uGalaxyNorm0)
      march.uGalaxyNorm1.value.set(...u.uGalaxyNorm1)
      material.visible = true
      debug.ready = true
      debug.bakeMs = ms
      mapTexture.dispose()
    })
  }
  return mesh
}


/** Mesh.raycast for the galaxy: it is never hit. */
function noRaycast() {
  // A full-screen triangle at the far plane covers no place in the scene.
}


/**
 * Bake the model's map a slice at a time, between frames.
 *
 * @param {function({map: object, norms: object, ms: number}): void} done
 */
function bakeInSlices(done) {
  const steps = bakeMapSteps()
  const start = performance.now()
  const slice = () => {
    const until = performance.now() + 16
    let next = steps.next()
    while (!next.done && performance.now() < until) {
      next = steps.next()
    }
    if (next.done) {
      const map = next.value
      done({map, norms: normalize(map), ms: performance.now() - start})
    } else {
      setTimeout(slice, 0)
    }
  }
  setTimeout(slice, 0)
}


/** @returns {BufferGeometry} One triangle covering clip space, with its uv */
function fullScreenTriangle() {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
  return g
}


// ---- Shaders ---------------------------------------------------------------

const VERT_MARCH = `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// The view ray through this pixel, from the projection (its offsets too),
// turned into G; the march from the camera's position in G.  Interleaved
// gradient noise (Jimenez 2014) offsets the first step, fixed per pixel.
const RAY_GLSL = `
uniform vec3 uCamG;
uniform mat3 uViewToG;
uniform vec4 uProj;
vec3 galaxyRay(vec2 ndc) {
  vec3 view = vec3((ndc.x + uProj.z) / uProj.x, (ndc.y + uProj.w) / uProj.y, -1.0);
  return normalize(uViewToG * normalize(view));
}
float galaxyJitter(vec2 frag) {
  return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
}
`

const FRAG_MARCH = `
${RAY_GLSL}
varying vec2 vNdc;
void main() {
  vec3 light = galaxyMarch(uCamG, galaxyRay(vNdc), galaxyJitter(gl_FragCoord.xy));
  gl_FragColor = vec4(min(light, vec3(${HDR_MAX_VALUE.toFixed(1)})), 1.0);
}
`

// Pinned to the far plane, behind every depth-writing object.
const VERT_COMPOSITE = `
varying vec2 vUv;
varying vec2 vNdc;
void main() {
  vUv = uv;
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`

const FRAG_COMPOSITE = `
${EMITTED_GLSL}
uniform float uExposureRelative;
uniform sampler2D uMarch;
uniform vec2 uMarchSize;
#if GALAXY_DIRECT
${RAY_GLSL}
#endif
varying vec2 vUv;
varying vec2 vNdc;
void main() {
#if GALAXY_DIRECT
  vec3 light = galaxyMarch(uCamG, galaxyRay(vNdc), galaxyJitter(gl_FragCoord.xy));
#else
  vec3 light = texture2D(uMarch, vUv).rgb;
#endif
  // Pre-exposed (HDR.md): the light at Earth's keyed exposure, times the
  // frame's exposure over it; held under the buffer's ceiling, and nothing
  // under its smallest normal value.
  vec3 value = light * (${(1 / STORE_SCALE).toExponential(6)} * uExposureRelative);
  gl_FragColor = vec4(emitted(min(value, vec3(${HDR_MAX_VALUE.toFixed(1)}))), 1.0);
}
`
