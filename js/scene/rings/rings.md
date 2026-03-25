# Planetary Rings Plan

## Current state and problems

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
| `uSunIntensity` | float | Sun brightness scalar (from planet's atmosphere.sunIntensity or 1.0) |

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
