# Planetary Rings Plan

Phases 1 and 2 below are built (`Rings.js`); the lighting of Phase 2 has
since been replaced by the physical model in the next section.

## Lighting: the rings in exposure units

The rings are lit like every other surface, in exposure units, by the
Sun's irradiance at the planet (`exposure.js` `irradianceAt`), and the
renderer's exposure scales them.  Until this change they were display
values (through `sceneReferred`) times Saturn's atmosphere's
`sunIntensity`: neither the Sun's falloff nor the exposure reached them,
and the gain was the atmosphere's, a pre-HDR distance falloff (4 for
Saturn).

**The model** (`ringPhotometry.js`, mirrored in GLSL): the classical
single-scattering slab of ring photometry (Chandrasekhar 1960; Cuzzi et
al. 1984, in *Planetary Rings*; Dones, Cuzzi & Showalter 1993, Icarus 105,
184).  For normal optical depth τ, the cosines μ₀ and μ of the Sun's and
the eye's angles from the ring normal, and phase angle α:

    lit face:    I/F = ϖP(α)/4 · μ₀/(μ + μ₀) · (1 − e^(−τ(1/μ + 1/μ₀)))
    unlit face:  I/F = ϖP(α)/4 · μ₀/(μ − μ₀) · (e^(−τ/μ) − e^(−τ/μ₀))

The radiance is (I/F)·E/π (the uniform `uSunRadiance` is E/π), and the
background shows through e^(−τ/μ), so the colour is premultiplied by the
cover and blended `One, OneMinusSrcAlpha`.  In the planet's shadow there
is no sunlight (the 15% "ambient" is gone; Saturnshine isn't modelled).

- **ϖ, the particles' single-scattering albedo**, is the colour map's
  stored value times `RING_ALBEDO_SCALE`, per channel.
- **τ** is the opacity map read as the share of the background a normal
  ray loses, 1 − e^(−τ), capped at τ 6.9.
- **P(α)**, the particles' phase function, is the power law
  P ∝ (π − α)³, normalized to a mean of 1 over the sphere: icy,
  regolith-covered particles scatter back toward the Sun, like Callisto
  (Dones et al. 1993 fit an exponent of about 3 to the A ring's Voyager
  phase curves).  The lit rings dim away from opposition; the old
  Henyey-Greenstein forward lobe (g 0.7, rings brightest backlit) and
  Blinn-Phong glint are gone: the dense rings are dark backlit, and what
  brightens in forward scattering is their dust (the F, G and E rings, the
  C ring's and Cassini Division's fine material), not modelled.
- **The calibration** is the rings' integrated light.  Mallama & Hilton's
  (2018, Astronomy and Computing 25, 10) magnitude law for Saturn, the one
  JPL Horizons uses, adds −1.825·sin B mag for the rings at ring opening B
  (plus an opposition surge, −0.378·sin B·e^(−2.25α), not modelled).
  `RING_ALBEDO_SCALE` 0.914 makes the render's rings add the law's light
  at B = 26.6° (2017 June 15, at opposition, the rings widest), 1.046 times
  the globe's, measured as the summed linear composite with the rings
  shown and hidden, from Earth's direction.  Then the B ring's band of the
  map (its median stored value 0.55) has ϖ ≈ 0.50, inside the 0.4-0.6
  that ring photometry finds for B ring particles.

**Checked** at #192's date (2026 October 6, B = 7.4°, phase 0.36°, two
days from opposition), not fitted there: the rings add 0.229 mag to the
globe in the render, against the law's 0.189 without the surge and 0.211
with it (JPL Horizons, #214).  Before, as display values, they added
0.07.  The model's tilt dependence is a little weak (the thin parts' light
doesn't fall as the rings close), but within 0.04 mag over B 7°-27°.

| Saturn from Earth's direction, 8 radii out | B = 26.6° (2017-06-15) | B = 7.4° (2026-10-06) |
|---|---|---|
| Rings' light over the globe's, render | 1.045 | 0.235 |
| Mallama & Hilton, without / with the surge | 1.046 / 1.29 | 0.190 / 0.214 |

**Known limits** (follow-up:
[#217](https://github.com/celestiary/web/issues/217)):
- The colour and opacity maps are pictures, not measurements, and their
  radial structure isn't registered to the rings': the map's brightest,
  fairly opaque band (stored value 0.8-1.0, opacity 0.6-0.9) falls at
  72-92 Mm, the C ring, which is the darkest and most transparent of the
  main rings (τ about 0.1, I/F about 0.1); the Cassini Division is 0.7
  opaque.  A radial profile of τ (Cassini UVIS and RSS occultations) and
  of I/F (Cassini ISS, HST) from the PDS Rings Node would make ϖ and τ
  measurements.
- Single scattering only: the tilt effect (the B ring brightening by about
  30% as the rings open, from multiple scattering and interparticle
  shadowing) and the opposition surge aren't modelled.
- The ring's shadow on the globe still dims by 0.9 of the opacity map
  (`injectPlanetShadow`), not e^(−τ/μ₀).

## Current state and problems (before Phase 1)

`js/scene/shapes.js:523` exports a `rings()` function used only in `Planet.js:255`:

- **Hardcoded geometry**: `RingGeometry(3, 6, 64)` in arbitrary units, not meters.
- **Broken UV mapping**: binary inner/outer UV hack; the code comment says "I still don't understand UVs".
- **Hardcoded to Saturn**: `if (this.props.name === 'saturn')` block in Planet.js.
- **Two-mesh double-side hack**: a second flipped mesh offset by 0.01 to see rings from below.
- **Shadows disabled**: `renderer.shadowMap.enabled` is commented out in ThreeUI.js. Even if enabled, Three.js PCF shadow maps cannot work at cosmic scale — the sun PointLight is 1.43 × 10¹² m from Saturn, and the shadow camera would need near=6e8 m, far=1.5e12 m, giving dynamic range ~2500:1 but the ring detail itself requires sub-1000 km shadow-map texels against an object that is ~100,000 km across. Shadow maps are a dead end here.
- **No shader**: plain `MeshStandardMaterial` with no specular glint, no forward scatter.
- **`depthTest: false`, `depthWrite: false`**: hacks around the broken double-face rendering.

---

## Goal

A self-contained `js/scene/rings/` module that:

1. Renders correct, data-driven ring geometry for any planet that declares a `rings` block in its JSON.
2. Has proper radial UV mapping so the color and alpha textures map cleanly across the ring width.
3. Uses a custom GLSL shader for:
   - **Transparency** from the alpha texture — ring gaps (Cassini Division, etc.) are genuinely transparent.
   - **Specular ice glint** — icy ring particles catch the sun at high angles.
   - **Forward scatter** — rings brighten when backlit (as seen from the lit side looking toward the sun).
   - **Planet shadow on rings** (analytical sphere intersection in ring frag shader).
   - **Ring shadow on planet** (analytical ring-plane intersection injected into planet's surface shader via `onBeforeCompile`).
4. Is abstracted enough to work for Saturn (rich textures), Uranus (thin, dark), Neptune (thin, dark), and Jupiter (very faint) — and future parametric planets.

---

## Ring data format

Add a `rings` block to each ringed planet's JSON, using Measure strings (same convention as `radius`):

```json
"rings": {
  "innerRadius": "66900e3 m",
  "outerRadius": "140210e3 m",
  "texture": "saturn"
}
```

- `innerRadius` / `outerRadius`: distance from planet center in meters.
- `texture`: base name used to load `${texture}ringcolor.png` and `${texture}ringalpha.png`.
  If `texture` is omitted, skip the rings mesh entirely (allows future procedural rings).

`reify.js` must be extended to reify `obj.rings.innerRadius` and `obj.rings.outerRadius` via `Measure.parse(val).convertToUnit()`, following the same pattern as `obj.atmosphere.height`.

### Values per planet

| Planet  | innerRadius | outerRadius | texture |
|---------|-------------|-------------|---------|
| Saturn  | 66900e3 m   | 140210e3 m  | saturn  |
| Uranus  | 38000e3 m   | 51150e3 m   | uranus  |
| Neptune | 41900e3 m   | 62932e3 m   | neptune |
| Jupiter | 122500e3 m  | 129000e3 m  | jupiter |

Uranus, Neptune, and Jupiter have no textures yet. Stubs go in the JSON; ring mesh is skipped until textures exist (guard: `if (!texture) return null`).

---

## Files

### New files

```
js/scene/rings/rings.md        — this document
js/scene/rings/Rings.js        — Rings class
js/scene/rings/rings-vert.js   — GLSL vertex shader (exported as a string)
js/scene/rings/rings-frag.js   — GLSL fragment shader (exported as a string)
js/scene/rings/Rings.test.js   — unit tests
```

### Modified files

| File | Change |
|------|--------|
| `js/scene/shapes.js` | Remove the `rings()` function entirely |
| `js/scene/Planet.js` | Replace `if (name === 'saturn')` with `if (props.rings) surface.add(new Rings(props))` |
| `js/reify.js` | Add `rings` sub-object reification |
| `public/data/saturn.json` | Add `rings` block |
| `public/data/uranus.json` | Add `rings` stub (no texture yet) |
| `public/data/neptune.json` | Add `rings` stub (no texture yet) |
| `public/data/jupiter.json` | Add `rings` stub (no texture yet) |

---

## Phase 1 — Geometry, UV, transparency

**Goal:** visually better than the current hack, no custom shader yet.

### Geometry

```js
new RingGeometry(innerRadius, outerRadius, 128)
```

Real meters, sourced from `props.rings.innerRadius.scalar` and `props.rings.outerRadius.scalar`.

### UV mapping

Three.js `RingGeometry` does not produce radial UVs. Fix in the constructor after geometry creation:

```js
const pos = geometry.attributes.position
const uvs = new Float32Array(pos.count * 2)
const v3 = new Vector3()
for (let i = 0; i < pos.count; i++) {
  v3.fromBufferAttribute(pos, i)
  const r = v3.length()
  uvs[i * 2] = (r - innerR) / (outerR - innerR)  // u: 0 at inner edge, 1 at outer
  uvs[i * 2 + 1] = 0.5                             // v: constant (texture is a 1D strip)
}
geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
```

### Material (Phase 1)

`MeshStandardMaterial` with:
- `map`: `saturnringcolor.png`
- `alphaMap`: `saturnringalpha.png`
- `transparent: true`
- `side: DoubleSide` — eliminates the flipped-mesh hack
- `depthTest: true`, `depthWrite: false` — correct for transparent objects
- `renderOrder: 2` — renders after planet surface (`renderOrder: 1`)

### Orientation

The ring plane must lie in the planet's equatorial plane. Saturn's `axialInclination` tilts the planet within its `planetTilt` group, so the rings (added as children of the surface) automatically tilt with it. The ring mesh lies in the XZ plane of Three.js object space by default from `RingGeometry` — that is correct.

---

## Phase 2 — Custom GLSL shader

Replace `MeshStandardMaterial` with `ShaderMaterial`. All Phase 1 UV logic moves into the vertex shader.

### Vertex shader (`rings-vert.js`)

```glsl
uniform float uInnerRadius;
uniform float uOuterRadius;

varying vec2  vUv;
varying vec3  vWorldPos;
varying vec3  vWorldNormal;

void main() {
  float r = length(position.xy);
  vUv = vec2((r - uInnerRadius) / (uOuterRadius - uInnerRadius), 0.5);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

### Fragment shader (`rings-frag.js`)

Uniforms:

| Uniform | Type | Description |
|---------|------|-------------|
| `uColorMap` | sampler2D | Ring color texture |
| `uAlphaMap` | sampler2D | Ring alpha/opacity texture |
| `uSunDir` | vec3 | Unit vector from planet center toward sun (world space) |
| `uPlanetCenter` | vec3 | Planet center in world space |
| `uPlanetRadius` | float | Planet radius in meters |
| `uInnerRadius` | float | Ring inner radius in meters |
| `uOuterRadius` | float | Ring outer radius in meters |
| `uSunRadiance` | float | A white Lambertian's radiance facing the Sun at the planet, E/π (was `uSunIntensity`, the atmosphere's gain; see Lighting) |
| `uAlbedoScale` | float | The particles' albedo per unit of the colour map (`RING_ALBEDO_SCALE`) |

Fragment logic:

1. **Sample and discard**
   ```glsl
   float alpha = texture2D(uAlphaMap, vUv).r;
   if (alpha < 0.01) discard;
   vec3 color = texture2D(uColorMap, vUv).rgb;
   ```

2. **Diffuse lighting** — rings are lit on both faces; use `abs(dot(...))`:
   ```glsl
   float nDotL = abs(dot(normalize(vWorldNormal), uSunDir));
   float diffuse = max(nDotL, 0.05);  // 0.05 ambient floor
   ```

3. **Specular ice glint** — icy ring particles produce a specular highlight:
   ```glsl
   vec3 viewDir = normalize(cameraPosition - vWorldPos);
   vec3 halfVec = normalize(uSunDir + viewDir);
   float spec = pow(max(dot(vWorldNormal, halfVec), 0.0), 60.0);
   // Apply on both faces
   spec = max(spec, pow(max(dot(-vWorldNormal, halfVec), 0.0), 60.0));
   vec3 specular = vec3(spec) * 0.25;
   ```

4. **Forward scatter (Henyey–Greenstein)** — rings are brightest when backlit:
   ```glsl
   // cosTheta negative when camera is between sun and rings
   float cosTheta = dot(-uSunDir, viewDir);
   float g = 0.7;
   float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
   float scatter = hg * 0.15;
   ```

5. **Planet shadow on rings** — analytical sphere intersection:
   ```glsl
   // Ray from ring fragment toward sun; does it hit the planet?
   vec3 oc = vWorldPos - uPlanetCenter;
   float b = dot(oc, uSunDir);
   float c = dot(oc, oc) - uPlanetRadius * uPlanetRadius;
   float disc = b * b - c;
   float inShadow = (disc > 0.0 && b < 0.0) ? 1.0 : 0.0;
   // b < 0 means planet is between fragment and sun
   float shadowFactor = 1.0 - inShadow * 0.85;  // 15% ambient in shadow
   ```

6. **Combine**
   ```glsl
   vec3 lit = (color * diffuse + specular + color * scatter) * shadowFactor * uSunIntensity;
   gl_FragColor = vec4(lit, alpha);
   ```

### Ring shadow on planet (`onBeforeCompile` injection)

Inject a shadow test into the planet's surface fragment shader. The ring plane in planet-local space is y = 0. The ring shadow attenuates the direct sunlight reaching the planet surface.

Uniforms injected into the planet material:
- `uRingSunDir` (vec3) — sun direction in world space
- `uRingNormal` (vec3) — ring plane normal in world space (same as planet pole direction)
- `uRingPlanePoint` (vec3) — any point on the ring plane (planet center)
- `uRingInner` (float)
- `uRingOuter` (float)
- `uRingAlphaMap` (sampler2D)
- `uRingInnerRadius` and `uRingOuterRadius` for UV computation

Shader injection: replace `#include <lights_fragment_begin>` to prepend a shadow multiplier:

```glsl
// Ray from surface fragment toward sun; intersect with ring plane
float denom = dot(uRingSunDir, uRingNormal);
float ringShadow = 1.0;
if (abs(denom) > 1e-6) {
  float t = dot(uRingPlanePoint - vWorldPosition, uRingNormal) / denom;
  if (t > 0.0) {  // intersection is between fragment and sun
    vec3 hit = vWorldPosition + t * uRingSunDir;
    float r = length(hit - uRingPlanePoint);
    if (r >= uRingInner && r <= uRingOuter) {
      float u = (r - uRingInner) / (uRingOuter - uRingInner);
      float ringAlpha = texture2D(uRingAlphaMap, vec2(u, 0.5)).r;
      ringShadow = 1.0 - ringAlpha * 0.9;  // 10% ambient leaks through
    }
  }
}
// Multiply direct light by ringShadow before it is used
directLight.color *= ringShadow;
```

The `uRingSunDir`, `uRingNormal`, and `uRingPlanePoint` uniforms must be updated each frame in `Animation.animate()` (or a new per-frame hook on the planet object), since the planet's orbital position changes the geometry.

---

## Rings.js class sketch

```js
export default class Rings extends Mesh {
  constructor(props) {
    const {innerRadius, outerRadius, texture} = props.rings
    const innerR = innerRadius.scalar
    const outerR = outerRadius.scalar

    const geometry = new RingGeometry(innerR, outerR, 128)
    // ... fix UVs (Phase 1) or let vertex shader handle it (Phase 2)

    const material = new ShaderMaterial({
      uniforms: {
        uColorMap:     {value: Material.pathTexture(`${texture}ringcolor`, '.png')},
        uAlphaMap:     {value: Material.pathTexture(`${texture}ringalpha`, '.png')},
        uSunDir:       {value: new Vector3(1, 0, 0)},  // updated per frame
        uPlanetCenter: {value: new Vector3},            // updated per frame
        uPlanetRadius: {value: props.radius.scalar},
        uInnerRadius:  {value: innerR},
        uOuterRadius:  {value: outerR},
        uSunIntensity: {value: props.atmosphere?.sunIntensity ?? 1.0},
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
  }

  // Called from Animation or Planet each frame with sun position in world space
  updateSunDir(sunWorldPos, planetWorldPos) {
    const dir = new Vector3().subVectors(sunWorldPos, planetWorldPos).normalize()
    this.material.uniforms.uSunDir.value.copy(dir)
    this.material.uniforms.uPlanetCenter.value.copy(planetWorldPos)
  }
}
```

---

## Rings.test.js

Unit tests to cover:
- UV computation: vertex at `innerR` → u=0, vertex at `outerR` → u=1, midpoint → u=0.5
- `Rings` constructor: throws if `props.rings` is missing required fields
- `Rings` constructor: geometry has correct `innerRadius` and `outerRadius` parameters
- Shadow sphere test logic (pure math, no Three.js): given ray origin, direction, sphere — correct in-shadow / not-in-shadow results
- Ring-plane intersection logic: sun ray from planet surface, intersects ring plane at expected r, maps to expected UV u

---

## Verification checklist

Phase 1:
- [ ] Rings are visible at Saturn from orbit view
- [ ] Color and alpha textures map correctly across the ring width (no binary inner/outer jump)
- [ ] Cassini Division gap is transparent (alpha texture shows through to space)
- [ ] Rings visible from below and above Saturn
- [ ] No z-fighting with planet surface

Phase 2 (shader):
- [ ] Ice specular glint visible at oblique sun angles
- [ ] Rings brighten when camera looks toward the sun through the rings
- [ ] Dark band on rings where Saturn's shadow falls (especially visible when Saturn is near equinox)
- [ ] Dark band on Saturn's surface where ring shadow falls (especially visible from equatorial view)
- [ ] Navigate to Saturn → press 'u' → shadow still renders correctly
- [ ] Navigate Sun → Earth → Saturn: shadows correct on first and return visit
- [ ] Check at Saturn equinox geometry (axial tilt ≈ 0 mod 90°): shadow band crosses full ring width
- [ ] No regression on planets without rings (Earth, Mars, etc.)

---

## Known issues deferred

- Uranus/Neptune/Jupiter ring textures: need to be created or sourced.
- Ring self-shadowing (A ring shadows B ring): not modelled; single-plane treatment.
- Ring system geometry: all rings treated as a single annulus. Separate band meshes (D, C, B, A) could give better detail but require multiple draw calls.
- `uSunDir` update hook: currently proposed in Animation; exact integration point TBD during implementation.
