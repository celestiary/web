import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LineSegments,
  ShaderMaterial,
} from 'three'
import {ASTRO_UNIT_METER, overlay} from '../../shared.js'
import {named} from '../../utils.js'


/**
 * The solar wind, a first cut (js/scene/Sun.md, "The solar wind"): a
 * diagram, not light.  The wind's own light is nothing an eye sees (its
 * Thomson brightness at 1 AU is ~1e-15 of the disc's, far under the
 * zodiacal light), so it is drawn as the overlay draws orbits, in display
 * values over the frame, with the `o` toggle.
 *
 * Its streamlines are Parker's spirals (Parker 1958): plasma leaving the
 * Sun radially at v, from a footpoint turning with the Sun at Ω, traces
 * φ(r) = φ0 − Ω(r − r0)/v, about 45° from radial at 1 AU for the slow
 * wind.  The slow wind, ~400 km/s, near the current sheet; the fast wind,
 * ~750 km/s, from the polar coronal holes above ~±20-30° at minimum, as
 * Ulysses found (McComas et al. 2000); at maximum slow and fast wind mix
 * at every latitude (a model: the fast wind's latitude falls with the
 * cycle's level).  Dashes stream outward at the wind's speed on
 * simulated time: from 1 AU to Saturn in a few weeks at 750 km/s.
 */


export const SLOW_WIND_KM_S = 400
export const FAST_WIND_KM_S = 750
// Ω at the equator, sidereal: 14.713°/day (solarCycle.js ROTATION_DEG_PER_DAY).
const OMEGA_RAD_S = 14.713 * Math.PI / 180 / 86400
// Out to the termination shock, ~90 AU (Voyager 1 crossed it at 94 AU).
export const WIND_REACH_AU = 90
const LINES = 8
const LATITUDES_DEG = [-45, 0, 45]
const SEGMENTS = 400
const SUN_RADIUS_AU = 6.957e8 / ASTRO_UNIT_METER


/**
 * A Parker spiral's angle behind its footpoint at a distance.
 *
 * @param {number} rAu
 * @param {number} vKmS
 * @returns {number} radians
 */
export function parkerLag(rAu, vKmS) {
  return OMEGA_RAD_S * (rAu - SUN_RADIUS_AU) * ASTRO_UNIT_METER / (vKmS * 1000)
}


const VERTEX = `
attribute float aRadius;
attribute float aSpeed;
varying float vRadius;
varying float vSpeed;
void main() {
  vRadius = aRadius;
  vSpeed = aSpeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`


const FRAGMENT = `
varying float vRadius;
varying float vSpeed;
// Simulated days, and how far the camera is from the Sun (AU): the wind is
// faint near the Sun, where the orbits are the diagram, and fades past
// the reach.
uniform float uDays;
uniform float uCameraAu;
uniform float uOpacity;
const float AU_KM = ${(ASTRO_UNIT_METER / 1000).toFixed(1)};
void main() {
  // Dashes, moving out at the wind's speed, spaced in proportion to the
  // distance (a tenth of it) so they read at any scale.
  float travelled = vSpeed * uDays * 86400.0 / AU_KM;
  float spacing = max(0.1 * uCameraAu, 0.02);
  float dash = smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(6.2831853 * (vRadius - travelled) / spacing));
  // Shown round the camera's distance: inside a twentieth of it the orbits
  // are the diagram, and past it the spirals pile up in projection.
  float rel = vRadius / max(uCameraAu, 1.0e-3);
  float near = smoothstep(0.05, 0.5, rel) * (1.0 - smoothstep(0.7, 1.4, rel));
  float far = 1.0 - smoothstep(0.6, 1.0, vRadius / ${WIND_REACH_AU.toFixed(1)});
  float fast = vSpeed > ${((SLOW_WIND_KM_S + FAST_WIND_KM_S) / 2).toFixed(1)} ? 1.0 : 0.0;
  vec3 color = mix(vec3(0.95, 0.75, 0.35), vec3(0.55, 0.75, 1.0), fast);
  gl_FragColor = vec4(color * uOpacity * dash * near * far, 1.0);
}`


/**
 * @param {number} level activityLevel: the fast wind's latitude falls from
 *     25° at minimum to the poles' at maximum
 * @returns {LineSegments}
 */
export function newSolarWind(level = 0) {
  const fastAbove = 25 + (60 * Math.min(Math.max(level, 0), 1))
  const positions = []
  const radii = []
  const speeds = []
  for (const latDeg of LATITUDES_DEG) {
    const lat = latDeg * Math.PI / 180
    const v = Math.abs(latDeg) > fastAbove ? FAST_WIND_KM_S : SLOW_WIND_KM_S
    for (let k = 0; k < LINES; k++) {
      const phi0 = (k / LINES) * 2 * Math.PI
      let prev = null
      for (let i = 0; i <= SEGMENTS; i++) {
        // Spaced in log r: fine near the Sun, coarse out at the shock.
        const r = 0.05 * ((WIND_REACH_AU / 0.05) ** (i / SEGMENTS))
        const phi = phi0 - parkerLag(r, v)
        const m = r * ASTRO_UNIT_METER
        const p = [m * Math.cos(lat) * Math.cos(phi), m * Math.sin(lat), -m * Math.cos(lat) * Math.sin(phi)]
        if (prev) {
          positions.push(...prev.p, ...p)
          radii.push(prev.r, r)
          speeds.push(v, v)
        }
        prev = {p, r}
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aRadius', new BufferAttribute(new Float32Array(radii), 1))
  geometry.setAttribute('aSpeed', new BufferAttribute(new Float32Array(speeds), 1))
  const lines = new LineSegments(geometry, new ShaderMaterial({
    uniforms: {uDays: {value: 0}, uCameraAu: {value: 1}, uOpacity: {value: 0.35}},
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  }))
  lines.frustumCulled = false
  return overlay(named(lines, 'solar wind'))
}
