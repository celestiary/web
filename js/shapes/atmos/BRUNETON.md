# Plan: Bruneton Precomputed Atmospheric Scattering

## Background

Bruneton & Neyret (2008), "Precomputed Atmospheric Scattering," CGF 27(4).
Reference impl: https://ebruneton.github.io/precomputed_atmospheric_scattering/

The current ray-march integrates 64 primary steps × 8 shadow steps = 512 iterations
per pixel, and still shows a visible stepped grid on the surface because the shadow
ray (j-loop) and primary ray (i-loop) both discretise the atmosphere into slabs whose
footprints project onto the surface.

The Bruneton approach: precompute atmospheric integrals into small textures **once per
atmosphere change**, then the fullscreen scatter pass does a handful of texture lookups
per pixel — smooth, accurate, cheap.

---

## Two-phase plan

### Phase 1 — Transmittance LUT (kills j-loop grid, quick win)

Replace the inner j-loop with a single texture lookup.

**T(r, μ) texture** — 2D, RGBA16F, ~256 × 64 texels
- r: distance from planet center ∈ [rGround, rAtmos]
- μ: cos(zenith angle of the ray) ∈ [-1, 1]
- Value: `exp(-τ)` — transmittance from (r, μ) to the atmosphere exit, **separately for
  Rayleigh (R), Mie (G)**; combined transmittance in B.
- Precomputed offline with ~500 integration steps (not real-time).

With T in hand, the shadow ray per primary sample `iPos`:
```glsl
vec2 uvT = transmittanceUV(length(iPos), dot(normalize(iPos), sunDir), rGround, rAtmos);
vec3 T_sun = texture2D(tTransmittance, uvT).rgb;   // replaces entire j-loop
```
Reduce I_STEPS to 32 (shadow is now smooth; primary banding much less visible).

### Phase 2 — In-scatter LUT (kills i-loop grid too, full quality)

Precompute **S(r, μ_view, μ_sun)** — single-scatter radiance — into a 3D texture
(or 2D atlas).  The fullscreen pass becomes two texture lookups and a phase-function
multiply.  This is the proper Bruneton model.

Start with Phase 1; add Phase 2 if Phase 1 grid is still visible.

---

## Math

### Transmittance parameterisation

Map (r, μ) → UV ∈ [0,1]² avoiding the horizon singularity.

Standard Bruneton mapping (from the reference code):
```glsl
// r ∈ [rG, rA], mu ∈ [-1, 1]
// H = sqrt(rA² - rG²)   (distance to horizon from ground)
// rho = sqrt(r² - rG²)  (distance to horizon from current altitude)
float H   = sqrt(rA*rA - rG*rG);
float rho = sqrt(max(0.0, r*r - rG*rG));
float u_r = rho / H;

float r_mu          = r * mu;
float discriminant  = r_mu*r_mu - r*r + rA*rA;
float d_max         = -r_mu + sqrt(max(0.0, discriminant)); // dist to atmos top
float d_min         = rA - r;                               // zenith path
float u_mu          = (d_max - d_min) / (sqrt(discriminant_max) - d_min);
// discriminant_max at mu=1: (rA-r)
// see paper Appendix B for full derivation
```

A simpler but less precise mapping (good enough for Phase 1):
```glsl
float u_r  = (r - rG) / (rA - rG);        // linear altitude [0,1]
float u_mu = mu * 0.5 + 0.5;              // cos(zenith) → [0,1]
```
The simple mapping has lower precision near the horizon; use the Bruneton mapping for
Phase 2.

### Transmittance integral (precompute shader)

```glsl
// Integrate exp(-beta_R * rho_R - beta_M * rho_M) along ray (r0, mu) to atmos exit
const int TRANSMIT_STEPS = 500;
vec2 p = rsi(eyePos_from_r_mu, rayDir_from_mu, rAtmos);
float tMax = p.y;

float odR = 0.0, odM = 0.0;
float dt  = tMax / float(TRANSMIT_STEPS);
for (int i = 0; i < TRANSMIT_STEPS; i++) {
  float t      = (float(i) + 0.5) * dt;
  vec3  pos    = origin + dir * t;
  float height = length(pos) - rG;
  odR += exp(-height / shR) * dt;
  odM += exp(-height / shM) * dt;
}
gl_FragColor = vec4(exp(-kR * odR), exp(-kM * odM), exp(-(kR*odR + kM*odM)), 1.0);
```

---

## New files

### `js/shapes/AtmospherePrecompute.js`

```js
import { DataTexture, FloatType, RGBAFormat, WebGLRenderTarget,
         PlaneGeometry, Mesh, ShaderMaterial, OrthographicCamera,
         Scene, Vector2 } from 'three'

/**
 * Precomputes Bruneton transmittance texture for given atmosphere params.
 * Returns a WebGLRenderTarget whose .texture is the T(r,μ) LUT.
 *
 * @param {WebGLRenderer} renderer
 * @param {object} atmos   — reified atmosphere props (height.scalar etc.)
 * @param {number} rGround — planet radius in meters
 * @returns {WebGLRenderTarget}  256×64 RGBA16F transmittance LUT
 */
export function precomputeTransmittance(renderer, atmos, rGround) {
  const W = 256, H = 64
  const rt = new WebGLRenderTarget(W, H, { type: FloatType })

  const mat = new ShaderMaterial({
    uniforms: {
      uGroundRadius:       { value: rGround },
      uAtmosphereRadius:   { value: rGround + atmos.height.scalar },
      uRayleigh:           { value: atmos.rayleigh },       // vec3 (β_R)
      uRayleighScaleHeight:{ value: atmos.rayleighScaleHeight.scalar },
      uMieCoeff:           { value: atmos.mieCoeff },       // β_M
      uMieScaleHeight:     { value: atmos.mieScaleHeight.scalar },
    },
    vertexShader:   TRANSMIT_VERT,
    fragmentShader: TRANSMIT_FRAG,
    depthTest: false,
    depthWrite: false,
  })

  const scene  = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const mesh   = new Mesh(new PlaneGeometry(2, 2), mat)
  mesh.frustumCulled = false
  scene.add(mesh)

  renderer.setRenderTarget(rt)
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)

  // clean up transient objects
  mat.dispose()
  mesh.geometry.dispose()

  return rt
}
```

**TRANSMIT_VERT** — simple fullscreen pass-through (same as FULLSCREEN_VERT).

**TRANSMIT_FRAG** — iterates 500 steps to compute transmittance, writes
`vec4(exp(-kR*odR), exp(-kM*odM), exp(-(kR*odR + kM*odM)), 1)` per texel.
Uses `uv` → `(r, mu)` via the simple parameterisation first, upgrade to Bruneton
mapping in Phase 2.

---

## Changes to existing files

### `js/shapes/Atmosphere.js`

1. **Import** `precomputeTransmittance` (or keep it internal, called from ThreeUI).

2. **`newAtmospherePass()`** — add two new uniforms:
   ```js
   tTransmittance: { value: null },   // set once per planet change
   uUseTransmittanceLUT: { value: 0 }, // 0 = fallback j-loop, 1 = LUT
   ```

3. **FULLSCREEN_FRAG `scatter()`** — replace j-loop:
   ```glsl
   uniform sampler2D tTransmittance;
   uniform int       uUseTransmittanceLUT;
   uniform vec2      uTransmittanceSize;   // e.g. (256, 64)

   // helper — simple parameterisation (upgrade to Bruneton in Phase 2)
   vec2 transmittanceUV(float r, float mu, float rG, float rA) {
     return vec2(
       (r - rG) / (rA - rG),
       mu * 0.5 + 0.5
     );
   }

   // inside scatter(), after each iPos sample:
   // REPLACE entire j-loop with:
   float jOdR, jOdM;
   if (uUseTransmittanceLUT == 1) {
     float iAlt  = max(length(iPos) - rPlanet, 0.0);
     float iR    = iAlt + rPlanet;
     float mu_s  = dot(normalize(iPos), sunDir);
     vec2  uvT   = transmittanceUV(iR, mu_s, rPlanet, rAtmos);
     vec3  T     = texture2D(tTransmittance, uvT).rgb;
     // T.r = exp(-kR*odR), T.g = exp(-kM*odM)
     // recover odR, odM:
     jOdR = -log(max(T.r, 1e-7)) / max(kRlh.b, 1e-10);  // approx: use max channel
     jOdM = -log(max(T.g, 1e-7)) / max(kMie, 1e-10);
   } else {
     // original j-loop (fallback)
     float jStepSize = rsi(iPos, sunDir, rAtmos).y / float(J_STEPS);
     float jTime = 0.0;
     jOdR = 0.0; jOdM = 0.0;
     for (int j = 0; j < J_STEPS; j++) {
       vec3  jPos = iPos + sunDir * (jTime + jStepSize * 0.5);
       float jH   = max(length(jPos) - rPlanet, 0.0);
       jOdR += exp(-jH / shRlh) * jStepSize;
       jOdM += exp(-jH / shMie) * jStepSize;
       jTime += jStepSize;
     }
   }
   vec3 attn = exp(-(kMie*(iOdMie + jOdM) + kRlh*(iOdRlh + jOdR)));
   ```

   > Note: recovering odR/odM from T via -log is an approximation since T.r = exp(-β_R · odR)
   > but kRlh is a vec3.  Cleaner: store `kR·odR` and `kM·odM` directly in the LUT
   > (i.e. store optical depth, not transmittance) and skip the log.  See Phase 2 notes.

4. **Reduce I_STEPS** to 32 once LUT is active.

### `js/ThreeUI.js`

In `_updateAtmUniforms()`, when the target planet changes (new `tObj`):

```js
// Precompute transmittance LUT if atmosphere changed
if (this._lastAtmPlanet !== tObj) {
  this._lastAtmPlanet = tObj
  if (this._transmittanceRT) this._transmittanceRT.dispose()
  this._transmittanceRT = precomputeTransmittance(
    this.renderer, atmos, R)
}
const u = this._atmMesh.material.uniforms
u.tTransmittance.value     = this._transmittanceRT.texture
u.uUseTransmittanceLUT.value = 1
```

---

## Phase 2 notes (In-scatter LUT)

Precompute `S(r, μ_view, μ_sun)` — a 3D texture of size e.g. 32 × 128 × 32.

Precompute shader: for each (r, μ_view, μ_sun) texel, march the primary ray with
T-LUT shadow, accumulate scatter.  ~32 steps is accurate since shadow is smooth.

Fullscreen scatter pass becomes:
```glsl
// Two texture lookups, one phase-function multiply
vec3 inScatter = texture3D(tScatter, vec3(u_r, u_mu, u_mu_s)).rgb;
float pRlh = 3.0/(16.0*PI) * (1.0 + mu*mu);
float pMie = henyeyGreenstein(mu, polarity);
gl_FragColor = vec4((pRlh * kRlh + pMie * kMie) * inScatter, ...);
```

No loops at all — completely eliminates all stepping artifacts.

---

## Phasing / testing

1. Implement `AtmospherePrecompute.js` with transmittance shader + `precomputeTransmittance()`.
2. Add `tTransmittance` uniform to `newAtmospherePass`, keep j-loop as fallback.
3. Wire precompute into `ThreeUI._updateAtmUniforms` when planet changes.
4. Switch `uUseTransmittanceLUT = 1`, reduce `I_STEPS` to 32, confirm grid is gone.
5. Guide page `Atmosphere.jsx` can share the same precompute (pass renderer + params).
6. (Phase 2) Add `tScatter` 3D LUT when Phase 1 grid remnants are still visible.

## Verification

- Earth: smooth blue sky from surface, golden horizon limb, no grid on ocean ✓
- Mars: reddish sky ✓
- Mercury (no atmosphere): no effect ✓
- Guide `#/atmosphere` still works ✓
- LUT is recomputed only when planet changes, not every frame ✓
