import {
  BufferAttribute,
  DoubleSide,
  Mesh,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three'
import * as Material from '../material.js'
import {VERT} from './rings-vert.js'
import {FRAG} from './rings-frag.js'


/**
 * Compute the ring UV u-coordinate for a vertex at radius r.
 * u=0 at inner edge, u=1 at outer edge.
 *
 * @param {number} r Distance from planet center in meters.
 * @param {number} innerR Inner ring radius in meters.
 * @param {number} outerR Outer ring radius in meters.
 * @returns {number}
 */
export function computeRingUv(r, innerR, outerR) {
  return (r - innerR) / (outerR - innerR)
}


/**
 * Returns true if a point at fragPos is in the planet's shadow
 * (i.e. a ray from fragPos toward sunDir intersects the planet sphere).
 *
 * Mirrors the GLSL shadow test in rings-frag.js for unit testing.
 *
 * @param {Vector3} fragPos  World position of the ring fragment.
 * @param {Vector3} sunDir   Unit vector toward the sun (world space).
 * @param {Vector3} center   Planet center in world space.
 * @param {number}  radius   Planet radius in meters.
 * @returns {boolean}
 */
export function sphereInShadow(fragPos, sunDir, center, radius) {
  const ocX = fragPos.x - center.x
  const ocY = fragPos.y - center.y
  const ocZ = fragPos.z - center.z
  const b = (ocX * sunDir.x) + (ocY * sunDir.y) + (ocZ * sunDir.z)
  const c = (ocX * ocX) + (ocY * ocY) + (ocZ * ocZ) - (radius * radius)
  const disc = (b * b) - c
  return disc > 0 && b < 0
}


/**
 * Returns the ring-plane shadow factor (0 = fully shadowed, 1 = fully lit)
 * for a planet surface point. Mirrors the GLSL injection in injectPlanetShadow.
 *
 * @param {Vector3} surfPos    Planet surface point in world space.
 * @param {Vector3} sunDir     Unit vector toward sun (world space).
 * @param {Vector3} ringCenter Ring/planet center in world space.
 * @param {Vector3} ringNormal Ring plane normal in world space.
 * @param {number}  innerR     Inner ring radius in meters.
 * @param {number}  outerR     Outer ring radius in meters.
 * @param {Function} alphaAt   alphaAt(u) -> [0,1] ring opacity at UV u.
 * @returns {number} Multiplier for surface light (0.1 to 1.0).
 */
export function ringPlaneShadow(surfPos, sunDir, ringCenter, ringNormal, innerR, outerR, alphaAt) {
  const denom = sunDir.dot(ringNormal)
  if (Math.abs(denom) < 1e-6) {
    return 1.0
  }
  const diff = new Vector3().subVectors(ringCenter, surfPos)
  const t = diff.dot(ringNormal) / denom
  if (t <= 0) {
    return 1.0
  }
  const hitX = surfPos.x + (t * sunDir.x)
  const hitY = surfPos.y + (t * sunDir.y)
  const hitZ = surfPos.z + (t * sunDir.z)
  const hit = new Vector3(hitX, hitY, hitZ)
  const r = hit.distanceTo(ringCenter)
  if (r < innerR || r > outerR) {
    return 1.0
  }
  const u = (r - innerR) / (outerR - innerR)
  const ringAlpha = alphaAt(u)
  return 1.0 - (ringAlpha * 0.9)
}


/**
 * Planetary ring system rendered with a custom GLSL shader.
 *
 * Features:
 *   - Radial UV mapping using real inner/outer radii from planet JSON.
 *   - Alpha-texture transparency (ring gaps like Cassini Division).
 *   - Blinn-Phong specular for ice-particle glint.
 *   - Henyey-Greenstein forward scatter (backlit brightening).
 *   - Analytical planet-shadow-on-rings (sphere test in fragment shader).
 *   - Ring-shadow-on-planet via injectPlanetShadow(surfaceMaterial).
 *
 * Planet JSON "rings" block (Measure strings, same convention as "radius"):
 *   "rings": {
 *     "innerRadius": "66900e3 m",
 *     "outerRadius": "140210e3 m",
 *     "texture": "saturn"
 *   }
 *
 * reify.js must reify rings.innerRadius and rings.outerRadius before this
 * constructor is called (see reify.js).
 */
export default class Rings extends Mesh {
  /** @param {object} props Reified planet props (props.rings already reified). */
  constructor(props) {
    const {innerRadius, outerRadius, texture} = props.rings
    const innerR = innerRadius.scalar
    const outerR = outerRadius.scalar

    const geometry = new RingGeometry(innerR, outerR, 128)

    // Three.js RingGeometry does not produce correct radial UVs by default.
    // u=0 at inner edge, u=1 at outer edge; v=0.5 (texture is a 1-D strip).
    const pos = geometry.attributes.position
    const uvs = new Float32Array(pos.count * 2)
    const v3 = new Vector3()
    for (let i = 0; i < pos.count; i++) {
      v3.fromBufferAttribute(pos, i)
      const r = v3.length()
      uvs[i * 2] = computeRingUv(r, innerR, outerR)
      uvs[(i * 2) + 1] = 0.5
    }
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2))

    const material = new ShaderMaterial({
      uniforms: {
        uColorMap: {value: Material.pathTexture(`${texture}ringcolor`, '.png')},
        uAlphaMap: {value: Material.pathTexture(`${texture}ringalpha`, '.png')},
        // Updated each frame in onBeforeRender.
        uSunDir: {value: new Vector3(1, 0, 0)},
        uPlanetCenter: {value: new Vector3()},
        uPlanetRadius: {value: props.radius.scalar},
        uInnerRadius: {value: innerR},
        uOuterRadius: {value: outerR},
        uSunIntensity: {value: props.atmosphere ? (props.atmosphere.sunIntensity || 1.0) : 1.0},
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      side: DoubleSide,
      depthTest: true,
      depthWrite: false,
    })

    super(geometry, material)
    this.renderOrder = 2
    // Rotate ring into the XZ plane (equatorial): RingGeometry is in XY plane by default.
    this.rotateX(Math.PI / 2)

    this._innerR = innerR
    this._outerR = outerR
    this._texture = texture
    this._planetMaterial = null
    this._tmpWorldPos = new Vector3()
    this._tmpQuat = new Quaternion()
    this._tmpNormal = new Vector3()

    this.onBeforeRender = () => {
      this.getWorldPosition(this._tmpWorldPos)
      // Sun is at world origin (0, 0, 0); sunDir points from planet toward sun.
      const sunDir = this._tmpWorldPos.clone().negate().normalize()
      this.material.uniforms.uSunDir.value.copy(sunDir)
      this.material.uniforms.uPlanetCenter.value.copy(this._tmpWorldPos)

      if (this._planetMaterial && this._planetMaterial.userData.ringShadowShader) {
        const rs = this._planetMaterial.userData.ringShadowShader
        // Ring plane normal = parent surface mesh's world-space Y axis (planet pole).
        // rotateX(PI/2) on this mesh puts the ring in XZ, so the parent's Y is the normal.
        if (this.parent) {
          this.parent.getWorldQuaternion(this._tmpQuat)
          this._tmpNormal.set(0, 1, 0).applyQuaternion(this._tmpQuat)
          rs.uniforms.uRingCenter.value.copy(this._tmpWorldPos)
          rs.uniforms.uRingSunDir.value.copy(sunDir)
          rs.uniforms.uRingNormal.value.copy(this._tmpNormal)
        }
      }
    }
  }


  /**
   * Inject ring-shadow code into a planet surface material via onBeforeCompile.
   * Must be called before the material's first render (before first compile).
   * The Rings mesh then updates the shadow uniforms each frame in onBeforeRender.
   *
   * Injection adds:
   *   - A world-position varying (vRingWorldPos) computed in the vertex shader.
   *   - Six uniforms (uRingSunDir, uRingNormal, uRingCenter, uRingInner,
   *     uRingOuter, uRingAlphaMap) updated per frame.
   *   - A shadow multiply on gl_FragColor before tone mapping.
   *
   * @param {object} planetMaterial Three.js MeshPhysicalMaterial instance.
   */
  injectPlanetShadow(planetMaterial) {
    const innerR = this._innerR
    const outerR = this._outerR
    const alphaMap = Material.pathTexture(`${this._texture}ringalpha`, '.png')

    // Chain any previously set onBeforeCompile (e.g. Earth's ocean roughness patch).
    const prevCompile = planetMaterial.onBeforeCompile
    planetMaterial.onBeforeCompile = (shader, renderer) => {
      if (prevCompile) {
        prevCompile(shader, renderer)
      }

      // Store shader reference for per-frame uniform updates in onBeforeRender.
      planetMaterial.userData.ringShadowShader = shader

      shader.uniforms.uRingSunDir = {value: new Vector3(0, 1, 0)}
      shader.uniforms.uRingNormal = {value: new Vector3(0, 1, 0)}
      shader.uniforms.uRingCenter = {value: new Vector3()}
      shader.uniforms.uRingInner = {value: innerR}
      shader.uniforms.uRingOuter = {value: outerR}
      shader.uniforms.uRingAlphaMap = {value: alphaMap}

      // Inject world-position varying into vertex shader.
      shader.vertexShader = `varying vec3 vRingWorldPos;\n${shader.vertexShader}`
      shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
        vRingWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`,
      )

      // Inject uniforms, varying declaration, and shadow multiply into fragment shader.
      const ringUniforms = `uniform vec3 uRingSunDir;
uniform vec3 uRingNormal;
uniform vec3 uRingCenter;
uniform float uRingInner;
uniform float uRingOuter;
uniform sampler2D uRingAlphaMap;
varying vec3 vRingWorldPos;
`
      shader.fragmentShader = `${ringUniforms}${shader.fragmentShader}`

      // Multiply gl_FragColor by ring shadow factor before tone mapping so the
      // attenuation happens in linear light space (output_fragment sets gl_FragColor,
      // tonemapping_fragment follows immediately after).
      const shadowBlock = `{
  float _denom = dot(uRingSunDir, uRingNormal);
  if (abs(_denom) > 1e-6) {
    float _t = dot(uRingCenter - vRingWorldPos, uRingNormal) / _denom;
    if (_t > 0.0) {
      vec3 _hit = vRingWorldPos + _t * uRingSunDir;
      float _r = length(_hit - uRingCenter);
      if (_r >= uRingInner && _r <= uRingOuter) {
        float _u = (_r - uRingInner) / (uRingOuter - uRingInner);
        float _ringA = texture2D(uRingAlphaMap, vec2(_u, 0.5)).r;
        gl_FragColor.rgb *= 1.0 - _ringA * 0.9;
      }
    }
  }
}
#include <tonemapping_fragment>
`
      shader.fragmentShader = shader.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          shadowBlock,
      )
    }
    planetMaterial.needsUpdate = true
    this._planetMaterial = planetMaterial
  }
}
