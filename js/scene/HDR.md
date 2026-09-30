# One HDR pipeline: linear scene buffer, one tone map

The plan and design for [#86](https://github.com/celestiary/web/issues/86)
PR A: steps 1, 2 and 5 of its proposal.  The scene renders into a linear,
bright-range buffer in exposure units; the sky joins it in the same units;
Cesium's layers composite into it in the same units; and one tone map, PBR
Neutral, runs once, last.  Little visual change is intended: what this buys
is PR B (physical stars, metered exposure, removing the eye-adaptation hacks),
which needs every source on one scale.

Background: [Planet.md, lighting and exposure](Planet.md#lighting-and-exposure)
(the target-keyed exposure), [atmos/composition.md](atmos/composition.md) (the
atmosphere pass), [CESIUM.md](../../CESIUM.md) (the layers).

## Colour spaces: "stored values"

Celestiary never decodes or encodes sRGB.  Textures load with no colour space
(three's `NoColorSpace`), and the renderer's output colour space is linear, so
three's `colorspace_fragment` does nothing.  A texture's stored 8-bit value,
itself sRGB-encoded, is lit as if it were linear, and the result goes to the
screen as it is.  This doc calls that space **stored values**.  "Linear" below
means linear in light over stored values: doubling the Sun doubles the value.
Cesium's layers follow the same convention (`sunlitShader`, below).

Two kinds of value then live in the pipeline:

- **Scene-referred** (exposure units): lit surfaces, the sky.  1.0 is a white
  Lambertian surface facing the Sun at the exposure target, times
  `DISPLAY_GAIN` (so a sunlit white surface is 1.5).  Unbounded.
- **Display-referred**: what reaches the screen, 0 to 1, after the tone map.
  Also what the stars, the Milky Way, labels, lines, the Sun's surface shader
  and the rings write today: they are drawn with `toneMapped: false` and their
  values are meant as display values.

## Before

| Step | Target | Format | Holds |
|---|---|---|---|
| scene pass (`renderer.render(scene)`) | `_sceneRT` | RGBA8 | lit materials: `N(k·L)`, display; unlit: their own display values; clamped to 1 |
| Cesium composite (`layers.composite`) | `_sceneRT` | RGBA8 | Cesium's display values, premultiplied-over (netgl replay) |
| atmosphere pass | screen | RGBA8 | `mix(s, (1 − e^(−S)) + s·T, strength)`, display; no tone map |
| label overlay | screen | RGBA8 | display |

`N` is PBR Neutral, `k` the target-keyed exposure (`exposure.js`), `L` a
surface's radiance in three's units, `S` the atmosphere pass's in-scatter
(`uSunIntensity × LUT`), `T` its transmittance.  The sky and the scene meet in
display space: the sky's `1 − e^(−S)` is its own soft saturation, not the
scene's tone map.

## After

| Step | Target | Format | Holds |
|---|---|---|---|
| scene pass | `_sceneRT` | **RGBA16F** | lit materials: `k·L` (exposure-only tone map); display-referred ones: `N⁻¹(value)`; scene-referred |
| Cesium composite | `_cesiumRT` (RGBA8) → `_sceneRT` | | Cesium renders into its own target; a pass decodes it to scene-referred and composites it premultiplied-over |
| atmosphere pass | screen | RGBA8 | `N(mix(v, sky + v·T, strength))`: **the one tone map** |
| label overlay | screen | RGBA8 | display, as before |

### Scene pass: exposure only

`renderer.toneMapping = CustomToneMapping`, with three's custom tone-mapping
hook replaced by

    vec3 CustomToneMapping(vec3 color) { return toneMappingExposure * color; }

so a lit material writes `v = k·L` and nothing clamps it (three's
`LinearToneMapping` saturates to 1).  `_sceneRT` keeps `isXRRenderTarget`, the
tag that makes three tone-map into a render target at all.  Everything that
used `toneMappingExposure` (Earth's night lights divide by it) keeps working:
they still see the same exposure.

### Final tone map: PBR Neutral, once

Khronos PBR Neutral, as three's `NeutralToneMapping` without the exposure
multiply (the buffer already holds `k·L`):

    x = min(c.r, c.g, c.b)
    offset = x < 0.08 ? x − 6.25·x² : 0.04          (toe)
    c −= offset
    p = max(c.r, c.g, c.b)
    if p < 0.76: return c
    q = 1 − 0.24² / (p − 0.52)                      (shoulder: new peak)
    c *= q / p
    g = 1 − 1 / (0.15·(p − q) + 1)                  (desaturation)
    return mix(c, vec3(q), g)

It runs at the end of the atmosphere pass, on every path through it (the
pass-through when there's no atmosphere too).  A lit surface with no sky over
it therefore shows `N(k·L)` exactly as before.

### Display-referred content: `N⁻¹`

The stars, galaxy, labels and lines would otherwise go through `N` for the
first time: its toe maps a grey 0.02 to 0.0025, which would thin the star field
and the Milky Way.  So each of those materials converts its output with the
exact inverse of `N`, and the final tone map gives back the value it showed
before:

    q = max(y)                                       (undo the shoulder)
    if q ≥ 0.76:
      q = min(q, 0.999)
      p = 0.52 + 0.0576 / (1 − q);  g = 1 − 1 / (0.15·(p − q) + 1)
      c = (y − g·q) / (1 − g) · p / q
    else c = y
    m = max(min(c), 0)                               (undo the toe)
    offset = m ≥ 0.04 ? 0.04 : 0.4·√m − m
    return c + offset

Under `SrcAlpha` blending (additive stars, alpha-blended labels) the colour is
scaled by alpha after the shader, so the inverse is taken of the premultiplied
colour: `rgb = N⁻¹(rgb·a) / a`.  Over black that is exact; over something else,
and where several overlap, it's close (blending now adds in linear light, then
tone-maps).  Display values of 1 are clamped to 0.999 first (`N⁻¹(0.999)` ≈
58), so a saturated star stays saturated.

One helper, `sceneReferred(material)` in `hdr.js`, does this for any material,
built-in or `ShaderMaterial`: at compile time it renames the shader's `main`
and wraps it, so no shader's own code changes.  A shared uniform switches it
on only while drawing into the HDR buffer: the label overlay, drawn to the
screen after the tone map, gets its values unchanged.

PR B replaces the stars' and the Sun's display values with physical ones; the
labels, lines and grids stay display-referred.

### Blending in linear light

Translucent lit surfaces now blend before the tone map, not after: Earth's
clouds over the ground, and a Cesium layer's crossfade.  That is the
physically right order, and it changes those pixels: a half-covering cloud
(1.5 over 0.1, alpha 0.5) showed 0.50 and now shows `N(0.8)` = 0.76.  It's the
one expected brightening on Earth's disc; measured below.

## The sky in exposure units

The in-scatter LUT gives `x = pRlh·inS.rgb + pMie·inS.a`: the sky's radiance
per unit of solar irradiance at the top of the atmosphere, per steradian.  So
the sky's radiance is `x·E`, with `E = I / d^decay` the Sun's irradiance at the
planet (`shared.js`: `SUN_LUMINOUS_INTENSITY`, `SUN_LIGHT_DECAY`), and in
exposure units that is `x·E·k`.  When the planet is the exposure target,
`E·k = π·DISPLAY_GAIN` (`exposure.js`), so

    sky = x · E·k                       = π·DISPLAY_GAIN · x   (physical)
    sky = uSunIntensity · x · E·k / (π·DISPLAY_GAIN)           (what we draw)

The second line keeps each body's `sunIntensity` as the knob: it's the sky's
brightness relative to the physical single-scattering value, times
`π·DISPLAY_GAIN` = 4.71.  With the planet as the exposure target the factor
`E·k / (π·DISPLAY_GAIN)` is 1, and the sky gets exactly `S = uSunIntensity·x`
in exposure units, where before it got `1 − e^(−S)` in display units.  From
another body's exposure (the Moon's, looking back at Earth) the factor is the
ratio of the two bodies' irradiances; while exposure eases between targets,
the sky eases with it, as the surface does.

### Worked number: Earth's midday sky

Earth's atmosphere (`earth.json`): Rayleigh `β = (5.8, 13.5, 33.1)×10⁻⁶ /m`,
scale height 8 km, so vertical optical depth `τ = (0.046, 0.108, 0.265)`; Mie
`τ ≈ 0.006`.  For the zenith sky with the Sun 45° up (scattering angle 45°,
`pRlh = 3/(16π)·(1 + cos² 45°) = 0.0895`), single scattering gives about
`x ≈ pRlh·τ·e^(−1.2τ)` = (0.0039, 0.0085, 0.017) per steradian.

- **Physical, single scattering:** `π·1.5·x` = (0.018, 0.040, 0.081): luma
  0.039, about 4% of a sunlit white surface (1.5 × cos 45° = 1.06).  A real
  clear sky's zenith is about 15-25% of a sunlit white surface: multiple
  scattering and a real aerosol load (τ ≈ 0.1, not 0.006) make up the rest.
- **Before:** `1 − e^(−30x)` = (0.11, 0.23, 0.40) displayed: luma 0.21.
- **After:** `30x` = (0.12, 0.26, 0.52) in exposure units, `N` of it
  = (0.077, 0.215, 0.476) displayed: luma 0.20, within 4% of before.

So `sunIntensity` 30 keeps its value and the midday sky its brightness.  The
shape of the curve changes: `1 − e^(−S)` rises steeply from 0, while `N` has a
toe, so the dim sky (twilight, `S` ≈ 0.05) comes out about half as bright, and
more saturated (the toe takes more from the weakest channel); the bright limb
and horizon come out a little less red.  That shift is the sky changing model,
not a bug: PR B's metered exposure raises twilight on its own.

`sunIntensity`'s physical value is `π·DISPLAY_GAIN` = 4.71; Earth's 30 is 6.4×
that.  The factor stands in for multiple scattering and aerosols, and it's
what PR B tunes against, once stars are physical too.

The eye-adaptation boost keeps reading the sky's brightness as `1 − e^(−S)`,
so it behaves exactly as before; PR B removes it.

## Cesium in the same units

Cesium renders in its own (shadow) context; portal-netgl replays its GL calls
into celestiary's.  What reaches celestiary is Cesium's final draw to its
default framebuffer.

**Cesium's frame goes through 8-bit buffers.**  With `highDynamicRange` off (its
default), Cesium draws the scene into its globe-depth framebuffer, which is
`UNSIGNED_BYTE` unless HDR is on (`GlobeDepth.js`: `pixelDatatype = hdr ?
HALF_FLOAT : UNSIGNED_BYTE`), then copies that to the screen
(`Scene.js`, `globeDepth.executeCopyColor`).  So whatever a Cesium shader
writes is clamped to [0, 1] and quantized to 8 bits before netgl ever sees it;
portal-netgl carries the copy's values faithfully into a float target, but
they are already LDR.  Turning Cesium's HDR on makes its buffers float, but
also forces its own tone-mapping stage (there's no "none" tonemapper), and
lights the imagery in linear sRGB, not stored values.  So Cesium's layers hand
over values that fit in [0, 1], encoded so celestiary can recover exposure
units exactly:

- **Moon and Mars** (`sunlitShader`): already compute `v = stored · gain ·
  DISPLAY_GAIN · lambert`, in exposure units, and return `N(v)` (the same PBR
  Neutral).  `N` is the encoding: it fits `v` into [0, 1] with the display's own
  8-bit precision, and celestiary's `N⁻¹` recovers `v`.  The shader is
  unchanged.
- **Earth**: Cesium's globe lighting is its own (`GlobeFS.glsl`): from orbit it
  adds its ground atmosphere and applies `1 − e^(−2x)`; below ~10,000 km from
  Earth's centre (`lightingFadeOutDistance`) the ground atmosphere fades out
  and the lit imagery is written as it is; and its day side is flat
  (`clamp(5·lambert + 0.3)` without terrain normals, `0.9·lambert + 0.3` with
  them).  None of that is celestiary's lighting or in its units.  The matching
  path: Cesium draws only the lit surface, `stored × lambert` (its light at
  intensity 1, `lambertDiffuseMultiplier` 1, `vertexShadowDarkness` 0, ground
  atmosphere, fog and water effect off: the water effect's glint lit the
  sunward ocean up to twice celestiary's), which is at most 1 for any albedo,
  and celestiary
  multiplies by `DISPLAY_GAIN` to reach exposure units.  Earth's sky and
  ground haze then come from celestiary's atmosphere pass, over Cesium's globe
  as over its own, as Mars's already do (`bodies.js` `atmosphere: false`).
  One atmosphere model, in one set of units, on both sides of the swap: which
  PR B needs, since Cesium's sky is display-referred and would cover the
  daytime Moon and the stars with its own alpha.

Compositing: each Cesium frame now draws into `_cesiumRT`, an RGBA8 target
cleared to transparent black, with its own depth-stencil: celestiary's depth
is copied in (for the stencil shell's depth test), the shell writes the
stencil, and Cesium's frame is clipped to it.  Then a fullscreen pass
composites `_cesiumRT` into `_sceneRT`, premultiplied-over, decoding per body:
`N⁻¹(rgb/a)·a` for `sunlitShader` bodies, `DISPLAY_GAIN·rgb` for Earth.
Cesium's frame no longer clears `_sceneRT`'s depth, so the depth save and
restore around each frame go.

## Fallback: no float render targets

Rendering to RGBA16F needs `EXT_color_buffer_float` (WebGL2; it covers half
floats) or `EXT_color_buffer_half_float`.  Nearly every WebGL2 device has one,
mobile included, but without either the target is incomplete and draws
nothing.  So `ThreeUi` checks at start-up and, without one (or with `?hdr=0` in
the URL, for testing), keeps the old order: an RGBA8 `_sceneRT`, Neutral in
the scene pass, `sceneReferred` off, Cesium composited undecoded, and the
atmosphere pass adding `N(sky)` to the display-space scene with no final tone
map.

## Steps

1. This doc.
2. The buffer and the tone map: RGBA16F `_sceneRT`, exposure-only scene tone
   map, `N` at the end of the atmosphere pass, `sceneReferred` on the
   display-referred materials, `_cesiumRT` and the decode (with `N⁻¹` for every
   Cesium body at this step, Earth still Cesium's own display values), the
   fallback.  The sky still `1 − e^(−S)`, converted with `N⁻¹`, so the look
   holds while the buffer changes.
3. The sky in exposure units.
4. Earth's Cesium layer on the matching path, under celestiary's atmosphere.

After each: rebuild, `yarn parity`, the screenshot set, and compare with the
baseline numerically.

## Verification

- A fixed set of views on main and after each step, 480×300 on SwiftShader:
  Earth from 20,000 km (day side, and at 90° phase), Earth's surface at midday
  and at twilight, the Moon, Mars, Saturn with its rings, the Sun, a star field
  from 100 AU, and #86's daytime-Moon permalink; Cesium's layers on (the
  default) and forced off.  Per view, the median luma of each region and the
  median per-pixel ratio after/before.  Target: within ±5% where the sky
  doesn't change model.
- `yarn parity`, before and after.
- Unit tests: `N` and `N⁻¹` in JS (`hdr.js`, mirroring the GLSL), round trips
  and known points; the sky's scale (`exposure.js`).
- Not verifiable in the sandbox: a real GPU's float targets and blending, and
  mobile.  The fallback is exercised with `?hdr=0`.

## Results

Filled in as the steps land.
