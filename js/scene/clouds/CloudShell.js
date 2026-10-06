import {
  CustomBlending,
  FrontSide,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import {irradianceAt} from '../exposure.js'
import {CLOUD_LAYER} from '../../shared.js'
import {CLOUD_WHITE} from './cloudSource.js'


/**
 * Earth's far-field cloud shell: a sphere at the cloud deck's height,
 * textured with the coverage map (CloudMap), lit by the Sun in exposure
 * units, and casting its shadow on the ground behind it.  On its own layer
 * (CLOUD_LAYER), drawn by ThreeUi into the scene buffer after the Cesium
 * composite and before the atmosphere pass, so one shell covers both sides
 * of the swap and sits inside the atmosphere: the pass hazes it, as the
 * ground under it, and it covers the night lights under it, Cesium's and
 * celestiary's alike.  Planet.md, "Clouds".
 *
 * Premultiplied-over: colour × coverage, and an alpha that is the pixel's
 * coverage by the cloud and by its shadow, `1 − (1 − c)(1 − s)` (portal's
 * alpha contract: alpha is coverage).
 *
 * The far field only: from close to the deck its texels (16 km) are a blur,
 * so the shell fades out as the camera comes down to it (farFieldOpacity),
 * and from below it isn't drawn.  #169's volumetric clouds take over there.
 */


/** Cloud deck height over the ground sphere, metres. */
export const CLOUD_HEIGHT_M = 6000

/**
 * The camera's height over the deck at which the shell starts to fade out,
 * and where it's gone, metres.  #169 crosses over to volumetric clouds in
 * this band.
 */
export const FAR_FIELD_FADE_M = [24000, 4000]

/**
 * How much of the sunlight a fully covering cloud takes from the ground
 * under its shadow: the direct beam, less the sky's light, which still
 * reaches it.
 */
export const SHADOW_STRENGTH = 0.6

// Mip level of the shadow's lookup: a shadow is softer than its cloud.
const SHADOW_LOD = 1.5

const SEGMENTS = 256


/**
 * @param {number} cameraHeightM The camera's height over the ground sphere
 * @param {number} [cloudHeightM]
 * @returns {number} The far-field shell's opacity, 1 from high up, fading
 *   to 0 as the camera comes down to the deck
 */
export function farFieldOpacity(cameraHeightM, cloudHeightM = CLOUD_HEIGHT_M) {
  const [hi, lo] = FAR_FIELD_FADE_M
  const x = Math.min(Math.max((cameraHeightM - cloudHeightM - lo) / (hi - lo), 0), 1)
  return x * x * (3 - (2 * x))
}


/**
 * @param {number} groundRadius The body's radius, metres
 * @param {object} cloudMap A CloudMap
 * @param {object} opts
 * @param {Function} [opts.ready] Whether the body's surface is ready to be
 *   drawn under the clouds
 * @returns {Mesh}
 */
export function newCloudShell(groundRadius, cloudMap, {ready = () => true} = {}) {
  const cloudRadius = groundRadius + CLOUD_HEIGHT_M
  const material = new ShaderMaterial({
    name: 'cloud shell',
    uniforms: {
      tCoverage: {value: cloudMap.texture},
      uSun: {value: new Vector3(1, 0, 0)},
      uEye: {value: new Vector3()},
      uCloudRadius: {value: cloudRadius},
      // Rc² − Rg²: constant, and in doubles here, where the shader's
      // float32 would lose it.
      uShellOverGround: {value: (cloudRadius * cloudRadius) - (groundRadius * groundRadius)},
      uRadiance: {value: 0},
      uOpacity: {value: 1},
      uShadow: {value: SHADOW_STRENGTH},
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: FrontSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  })
  const shell = new Mesh(new SphereGeometry(cloudRadius, SEGMENTS, SEGMENTS / 2), material)
  shell.name = 'clouds'
  shell.layers.set(CLOUD_LAYER)
  shell.userData.map = cloudMap
  shell.preAnimCb = (time) => {
    cloudMap.update(time.simTime)
    shell.visible = ready()
  }
  const inverse = new Matrix4()
  const eye = new Vector3()
  const sun = new Vector3()
  let world
  shell.onBeforeRender = (renderer, scene, camera) => {
    const u = material.uniforms
    // The body frame (the shell's own: it's a child of the rotating
    // planet node, untransformed), in doubles: the world positions are
    // ~1.5e11 m.
    inverse.copy(shell.matrixWorld).invert()
    camera.getWorldPosition(eye).applyMatrix4(inverse)
    u.uEye.value.copy(eye)
    // The Sun is at the world group's origin (ThreeUi._exposureSunPos).
    world ??= scene.getObjectByName?.('WorldGroup') ?? null
    if (world) {
      world.getWorldPosition(sun)
    } else {
      sun.set(0, 0, 0)
    }
    sun.applyMatrix4(inverse)
    const sunDistance = sun.length()
    u.uSun.value.copy(sun).normalize()
    // A white cloud's radiance in three's units (Lambert: E·albedo/π), for
    // the renderer's exposure to scale as it does the lit surface.
    u.uRadiance.value = sunDistance > 0 ? CLOUD_WHITE * irradianceAt(sunDistance) / Math.PI : 0
    u.uOpacity.value = farFieldOpacity(eye.length() - groundRadius)
  }
  return shell
}


const VERTEX = `
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`


// Body frame: +Y north, +X the prime meridian.  three's sphere has
// u = atan(z, −x) / 2π (0 at −180°) and v = 1 at the north pole; the map's
// row 0 is north, so its t is 1 − v.
const FRAGMENT = `
#define PI 3.141592653589793
uniform sampler2D tCoverage;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uCloudRadius;
uniform float uShellOverGround;
uniform float uRadiance;
uniform float uOpacity;
uniform float uShadow;
varying vec3 vPos;
varying vec2 vUv;

vec2 mapUv(vec3 n) {
  return vec2(fract(atan(n.z, -n.x) / (2.0 * PI)), acos(clamp(n.y, -1.0, 1.0)) / PI);
}

void main() {
  if (uOpacity <= 0.0) discard;
  vec3 n = normalize(vPos);
  vec3 p = n * uCloudRadius;
  float cover = texture2D(tCoverage, vec2(vUv.x, 1.0 - vUv.y)).r * uOpacity;

  // The ground behind the cloud, along the view ray, and the cloud between
  // it and the Sun: its shadow there.
  float shadow = 0.0;
  vec3 d = normalize(p - uEye);
  float b = dot(p, d);
  float disc = b * b - uShellOverGround;
  if (b < 0.0 && disc > 0.0) {
    vec3 g = p + (-b - sqrt(disc)) * d;
    float sunUp = dot(normalize(g), uSun);
    if (sunUp > 0.0) {
      float bs = dot(g, uSun);
      vec3 s = g + (-bs + sqrt(bs * bs + uShellOverGround)) * uSun;
      shadow = uShadow * uOpacity * textureLod(tCoverage, mapUv(normalize(s)), ${SHADOW_LOD.toFixed(1)}).r *
        smoothstep(0.0, 0.05, sunUp);
    }
  }

  gl_FragColor = vec4(vec3(uRadiance * max(dot(n, uSun), 0.0)), 1.0);
  #include <tonemapping_fragment>
  gl_FragColor.rgb *= cover;
  gl_FragColor.a = 1.0 - (1.0 - cover) * (1.0 - shadow);
}
`
