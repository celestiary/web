import {Matrix3, Matrix4, Vector3, Vector4} from 'three'


/**
 * A body's disc while it's a few pixels across: antialiased, and shaded as
 * the sphere it is.  See Planet.md, "Small discs".
 *
 * The scene buffer has no multisampling (ThreeUI._makeSceneRT), so a mesh
 * a few pixels across drew each pixel all or nothing, by whether its centre
 * fell inside: Jupiter at a telescope's field (9 px from Earth at 0.91°)
 * was a blocky octagon, whose pixel count, and so its brightness, jumped as
 * it moved.  Under SMALL_DISC_MAX_PX of radius the surface mesh is grown by
 * DISC_MARGIN_PX in the vertex shader, so every pixel the disc touches gets
 * a fragment, and each fragment works out from its own ray:
 *
 * - how much of its pixel the disc covers, from the ray's closest approach
 *   to the body's centre against the radius, in pixels (`fwidth` of the
 *   ray's direction gives the pixel's angle there, off the axis too);
 * - the sphere's normal and texture coordinate where the ray meets it, or
 *   for a pixel the disc only partly covers, at the middle of the part it
 *   covers: the grown mesh's own attributes are those of a bigger sphere,
 *   which would squeeze the texture and the limb's shading inward.
 *
 * The colour is scaled by the coverage, over black: a pixel at the limb
 * that the disc half covers is half as bright.  So the disc's light is
 * conserved to the pixel as it moves, and its size is the sphere's.  What
 * lies behind a partly covered pixel doesn't show through it (the surface
 * is opaque): a moon a few pixels across in transit has a dark rim over
 * its planet.  Past SMALL_DISC_MAX_PX the edge is left to the mesh, whose
 * stair-steps are then a small part of the disc.
 */


/** Radius in px under which the disc is drawn this way. */
export const SMALL_DISC_MAX_PX = 24

/** How far the mesh is grown, in px, to reach every pixel the disc touches. */
export const DISC_MARGIN_PX = 1.5

/**
 * Nearer than this, in radii, the disc isn't small however narrow the
 * field: the sphere's outline is then not the disc of its angular radius
 * (perspective), and the mesh is left alone.
 */
export const SMALL_DISC_MIN_RADII = 20


/**
 * @param {object} p
 * @param {number} p.radius The body's radius, metres
 * @param {number} p.distance The camera's distance to its centre, metres
 * @param {number} p.projScale The projection's y scale (1 / tan(fovy / 2),
 *   times the zoom: projectionMatrix.elements[5])
 * @param {number} p.heightPx The viewport's height, px
 * @returns {{on: boolean, radiusPx: number, inflate: number}} Whether to
 *   draw it as a small disc, its radius in px, and the mesh's scale
 */
export function smallDiscParams({radius, distance, projScale, heightPx}) {
  if (!(distance > radius * SMALL_DISC_MIN_RADII)) {
    return {on: false, radiusPx: Infinity, inflate: 1}
  }
  const tanR = radius / Math.sqrt((distance * distance) - (radius * radius))
  const radiusPx = tanR * projScale * heightPx / 2
  if (!(radiusPx <= SMALL_DISC_MAX_PX)) {
    return {on: false, radiusPx, inflate: 1}
  }
  // Off the axis the disc is stretched outward by up to 1 / cos² of the
  // angle, which the margin covers to 45° off it.
  return {on: true, radiusPx, inflate: 1 + (DISC_MARGIN_PX * 2 / Math.max(radiusPx, 0.25))}
}


/**
 * @returns {object} The uniforms smallDiscShaderMod and updateSmallDisc share
 */
export function newSmallDiscUniforms() {
  return {
    uDiscOn: {value: 0},
    uDiscInflate: {value: 1},
    uDiscCentre: {value: new Vector3()},
    uDiscRadius: {value: 1},
    uViewToBody: {value: new Matrix3()},
    uDiscProjection: {value: new Matrix4()},
  }
}


const _mv = new Matrix4()
const _vp = new Vector4()


/**
 * Per frame, before the surface is drawn (its onBeforeRender).
 *
 * @param {object} uniforms From newSmallDiscUniforms
 * @param {object} renderer
 * @param {object} camera
 * @param {object} surface The surface mesh, centred on the body
 * @param {number} radius Its radius, metres
 */
export function updateSmallDisc(uniforms, renderer, camera, surface, radius) {
  _mv.multiplyMatrices(camera.matrixWorldInverse, surface.matrixWorld)
  const centre = uniforms.uDiscCentre.value.setFromMatrixPosition(_mv)
  renderer.getCurrentViewport(_vp)
  const p = smallDiscParams({
    radius,
    distance: centre.length(),
    projScale: camera.projectionMatrix.elements[5],
    heightPx: _vp.w,
  })
  uniforms.uDiscOn.value = p.on ? 1 : 0
  uniforms.uDiscInflate.value = p.inflate
  uniforms.uDiscRadius.value = radius
  if (p.on) {
    uniforms.uViewToBody.value.setFromMatrix4(_mv).invert()
    uniforms.uDiscProjection.value.copy(camera.projectionMatrix)
  }
}


/**
 * The GLSL: where a pixel's ray meets the sphere, as smallDisc.js's header
 * says.  In view space; `rd` the ray's unit direction from the eye.
 */
const DISC_FRAGMENT_GLSL = `
  float discCov = 1.0;
  vec3 discNormal = vec3(0.0, 0.0, 1.0);
  vec2 discUv = vec2(0.0);
  vec2 discUvDx = vec2(0.0);
  vec2 discUvDy = vec2(0.0);
  vec3 discHit = -vViewPosition;
  if (uDiscOn > 0.5) {
    vec3 rd = normalize(-vViewPosition);
    // From the centre to the ray's closest approach: both are ~the
    // distance (8.8e11 m for Jupiter from Earth), so this is good to
    // ~1e5 m, against a radius of 7e7.
    vec3 off = rd * dot(rd, uDiscCentre) - uDiscCentre;
    float q = length(off);
    // A pixel's width at the body, from the ray's turn across it.
    float pix = length(uDiscCentre) * max(length(dFdx(rd)), length(dFdy(rd)));
    discCov = clamp((uDiscRadius - q) / max(pix, 1e-30) + 0.5, 0.0, 1.0);
    // Shade the covered part's middle: the ray itself inside the disc,
    // nearer the centre by half the covered width at the limb.
    float qs = clamp(min(q, uDiscRadius - (0.5 * discCov * pix)), 0.0, uDiscRadius);
    vec3 side = q > 0.0 ? off / q : vec3(0.0);
    float s = qs / uDiscRadius;
    discNormal = side * s - rd * sqrt(max(0.0, 1.0 - s * s));
    // Where the ray meets the sphere, or for a pixel the disc only partly
    // covers, its closest approach (the limb): the depth the grown mesh
    // would otherwise write is up to its margin over the surface, above
    // the air (Earth's at 22 radii: 1,000 km up), so the atmosphere pass
    // drew no sky over the disc (Planet.md, "Small discs").
    float along = dot(rd, uDiscCentre);
    discHit = rd * (along - sqrt(max(0.0, (uDiscRadius * uDiscRadius) - (q * q))));
    // The body frame's direction, and three's sphere mapping (shapes.js
    // sphere: SphereGeometry, u from -x round through +z, v from +y down).
    vec3 b = normalize(uViewToBody * discNormal);
    float u = atan(b.z, -b.x) / (2.0 * PI);
    discUv = vec2(fract(u), 1.0 - (acos(clamp(b.y, -1.0, 1.0)) / PI));
    // Mip level from the gradients of u taken where it doesn't wrap.
    vec2 uv2 = vec2(fract(u + 0.5), discUv.y);
    discUvDx = dFdx(discUv);
    discUvDy = dFdy(discUv);
    vec2 dx2 = dFdx(uv2);
    vec2 dy2 = dFdy(uv2);
    if (abs(dx2.x) + abs(dy2.x) < abs(discUvDx.x) + abs(discUvDy.x)) {
      discUvDx = dx2;
      discUvDy = dy2;
    }
    // Last: the derivatives above need the whole 2x2 quad.
    if (discCov <= 0.0) discard;
  }
  if (uDiscOn > 0.5) {
    vec4 discClip = uDiscProjection * vec4(discHit, 1.0);
    gl_FragDepth = clamp((0.5 * discClip.z / discClip.w) + 0.5, 0.0, 1.0);
  } else {
    gl_FragDepth = gl_FragCoord.z;
  }
`


/**
 * Patches a MeshStandard/Physical material's shaders (an onBeforeCompile
 * step, after any that also patch the tone-mapping include, so the
 * coverage scales them too).
 *
 * @param {object} uniforms From newSmallDiscUniforms
 * @returns {function(object): void}
 */
export function smallDiscShaderMod(uniforms) {
  return (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uDiscInflate;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed *= uDiscInflate;`)
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uDiscOn;
uniform vec3 uDiscCentre;
uniform float uDiscRadius;
uniform mat3 uViewToBody;
uniform mat4 uDiscProjection;`)
        .replace('#include <map_fragment>', `${DISC_FRAGMENT_GLSL}
#ifdef USE_MAP
  vec4 sampledDiffuseColor = uDiscOn > 0.5 ?
      textureGrad(map, discUv, discUvDx, discUvDy) : texture2D(map, vMapUv);
  diffuseColor *= sampledDiffuseColor;
#endif`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (uDiscOn > 0.5) {
  normal = discNormal;
}`)
        .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb *= discCov;
#include <tonemapping_fragment>`)
  }
}
