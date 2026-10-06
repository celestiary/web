# One HDR pipeline: linear scene buffer, one tone map

The design for [#86](https://github.com/celestiary/web/issues/86).  PR A
(steps 1, 2 and 5 of its proposal): the scene renders into a linear,
bright-range buffer in exposure units; the sky joins it in the same units;
Cesium's layers composite into it in the same units; and one tone map, PBR
Neutral, runs once, last.  PR B (steps 3, 4 and 6): the stars, the Milky
Way and the Sun's disc in the same units ([physical stars](#physical-stars)),
the exposure metered from the buffer ([metered exposure](#metered-exposure)),
and the eye-adaptation boost, the transmittance floor and the `beyondAtm`
exemption gone.

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
  Also what labels, lines, grids and the rings write: they are drawn with
  `toneMapped: false` and their values are meant as display values.  The
  stars, the Milky Way and the Sun's disc wrote display values too until PR
  B made them scene-referred (below).

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

PR B replaced the stars' and the Sun's display values with physical ones; the
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

`sunIntensity`'s physical value is `π·DISPLAY_GAIN` = 4.71; Earth's 30 was 6.4×
that.  The factor stood in for multiple scattering and aerosols; since the
precompute integrates multiple scattering (composition.md, "Multiple
scattering") Earth's gain is 21, 4.5×, re-fitted to hold its sky's luma,
and the rest is the aerosol load PR B tunes against, once stars are
physical too.  Mars has the physical value: its sky is its dust's.

The eye-adaptation boost kept reading the sky's brightness as `1 − e^(−S)`,
so it behaved exactly as before, until PR B removed it.

## Physical stars

A star is a point: what reaches the eye is an illuminance `E_star`, not a
radiance.  Over the patch it lands in, of solid angle `Ω`, it is the
radiance `E_star / Ω`, and relative to a white Lambertian surface facing the
Sun, whose radiance is `E_sun / π`, that is `π·E_star / (E_sun·Ω)`.  In
exposure units, with `DISPLAY_GAIN` as every surface has it, a star's value is

    value = DISPLAY_GAIN · π · (E_star / E_sun,1AU) / Ω · exposureRelative

`E_star / E_sun,1AU` is the star's illuminance here over the Sun's at 1 AU,
from the catalogue's lumens and the inverse square law (`shaders/stars.vert`;
the Sun's 3.0e28 in those units over 4π AU²); Sirius is 7.9e-11 of the Sun.
`exposureRelative` (`exposure.js`) is the renderer's exposure over Earth's
keyed one, so the value is right at any exposure (the shared
`absoluteUniforms` in `hdr.js`, set every frame).

**The limiting magnitude is the parameter** (`exposure.js`
`LIMITING_MAGNITUDE`, 6.5): the naked eye's at a dark site, dark adapted,
which is the metered exposure's dark-adapted gain (`METER_GAIN_MAX`, 4e6
over Earth's keyed exposure, wherever the camera is; below).  A star of that magnitude shows `LIMIT_VALUE` there, 0.12 in
exposure units, 12 of 255 through Neutral's toe: just visible.  Brighter
stars have 2.5× more light per magnitude (6.0 is 25 of 255, 5.0 110, 4.0
white and blooming), fainter ones less, down into black smoothly (7.0 a
dusting at 5, 8 and beyond black): no pop at the limit.  Each magnitude's
2.5× is compressed by the tone map above 0.76 and steepened by its toe
below 0.08.  At any other exposure the limit moves with the gain
(`limitingMagnitude(exposureRelative, starGain)` = 6.5 + 2.5·log10(gain ×
starGain / 4e6)): by day, at the keyed exposure, −10, so only the Sun,
the Moon and Venus pass, the same arithmetic at a lower gain; with the
user's star gain (`ThreeUi.setLimitingMagnitude(m)`, the `[` and `]` keys
step it by 0.5, as Celestia's do), fainter, as a longer exposure or a
telescope does: a magnitude more is 2.5× every star's light.  The
settings and the permalink hold switches (`s=` letters), so the numeric
limit isn't in them yet.

**The patch** a star's light is spread over follows from the limit: the
solid angle `EYE_PATCH_SR` at which a star at the limit, at the
dark-adapted gain, shows `LIMIT_VALUE` (a star's value is
`DISPLAY_GAIN·π·ratio/Ω·gain`): 8.2e-6 sr, a 9.7 arcmin square, which is
the dark-adapted eye's resolution of a point (rod acuity, ~20/200, 10
arcmin).  That coincidence is why the calibration is physical.  The
patch is that, or a pixel where a pixel is coarser: a 1080 px screen at
45° has 2.5′ pixels, a 300 px test viewport 9′: per pixel alone the
screen would show every star 13× brighter than the test render, and the
whole Hipparcos catalogue (to magnitude 9-12) as white dots.  With the
patch the two agree, and the sky's depth is set by the exposure, not the
display.

**The sprite's pixels carry the star's light**, `L × patch²`, over a
Gaussian kernel (`shaders/stars.frag`) a quarter of the patch wide (σ =
patch/4: 1 px on a 1080 px screen, 2 px at 2160), whose sum, 2πσ², is
0.39 patch², so the kernel's peak is 2.5 L (`STAR_PEAK_OVER_RADIANCE`):
narrower than the patch, as a point's spread on a sensor or the retina is
narrower than the eye's resolution element, which detects rather than
blurs; and the light stays above the tone map's toe (quadratic under
0.08) instead of dying in it across a wide halo.  So a limit star peaks
at 0.3 on a screen, 60 of 255, with its halo falling into the toe.  σ is
never under 0.6 px, so the peak doesn't depend on where the star falls
between pixel centres (the nearest centre, at most 0.7 px off, reads 0.5
of it at worst, 0.85 typically).  On a viewport so coarse that the pixel
is the patch (the 300 px test render: a 9′ pixel) a star under white is
that one pixel at L, flat, wherever it falls, so the limit star reads
`LIMIT_VALUE` exactly, and the screen's 2.5 L is the one difference
between the two.  The second cut had σ = 0.4 × patch, whose sum is
patch² and whose peak is L: "one law from the faintest star up", and
exactly the calibration on the test viewport, but on the user's screen
a magnitude fewer stars than the first cut (σ = sprite/4, the same
quarter), whose peak was 2.5 L there and L × (0.4-1) on the test
viewport, where its sub-pixel Gaussian straddled.  Past the value the
peak shows as white, σ grows 0.75 px per decade of light (bloom): the
peak passes white, and the radius where it does is a saturated core that
grows with the log of the light, with the halo outside it, as a bright
star looks to the eye and on a sensor (Sirius at the dark-adapted gain:
a core of radius 4 px in an 18 px halo on the test viewport).  The quad is
sized from the radius where the kernel falls under `VISIBLE_VALUE`
(0.004, under 1 of 255), plus a pixel, so it is as large as the visible
star and no larger (to 96 px), and an edge window in the fragment shader
takes the kernel to zero inside it: a bright star is round at every
exposure.  The first cut's quad grew 3 px per decade with σ a quarter of
it, and at a high gain the Gaussian was over white out to the quad's
edge, so the brightest stars, and the Sun from Pluto, drew as squares
(the user's preview).  **The glare cap** (`STAR_GLARE_CORE_PATCHES`, 2):
the saturated core's radius is at most two patches (20′, 8 px at 1080p),
the peak held to what puts the kernel at white there, with the halo
falling off from it and still widening with the log of the light; past
the cap the light is lost, as it is to a saturated retina.  Without it
the core grew without limit and the Sun from 52 AU, 1e9 over white at
the dark gain, was a 120 px disc on the user's screen; it is now a 16 px
core in a halo of about 50 px, Venus 16 px in 32, Sirius 16 px in 27, and
from 5 AU the halo is 66 px: disc, to dazzling star, to star (from a
light-year, magnitude −2.7, a star like Sirius; from 10 pc, its absolute
4.8, a point just at white).  Rendered on the
480×300 test viewport (a 1 px patch: a 2 px cap), labels and orbits off,
at the dark gain: from 52 AU a saturated core of 2-3 px radius in a glow
of 13 px at 30 of 255 and 16 px at 10; from 5 AU 2 px in 16 and 19; from
1,000 AU 2-3 px in 10 and 12; from a light-year a 2×2 px core in 6-7 px; from 1 AU at a 5° field the
mesh's 32 px disc and its glow ring cover the sprite's capped core.  **A resolved disc is no point**: the sprite's
light fades by (patch/θ)² once the star's disc, θ = 2r/d, outgrows the
patch, so the Sun's mesh and a halo take over from the point within a
few AU (from Earth, 0.1 of it).
A texture
(`star_glow.png`) did this at first, and lost two magnitudes: its flat
core is 6% of the sprite's half-width, so a 2 px sprite sampled it at
0.06 and a 4 px one at 0.27, and mipmaps flattened a 3 px sprite's peak to
a third of the core (a star of magnitude 4 reached 10 of 255 where the
arithmetic gave 97).  Before that the sprite was sized by the catalogue's
radius, which spread Deneb over 110 px; and `4π·d²` in metres overflowed
float32 past 550 ly and zeroed every star beyond.  Values are clamped
to what the half-float buffer holds (`HDR_MAX_VALUE`, 6e4).

**Every star sits on the far-plane boundary** unless pulled inside.  The
camera's far plane is six galaxy radii and its near plane metres, so the
projection's (f + n) / (f − n) is 1 in float32 and a star's clip z is
d − 2n, which rounds to d = w for any star.  A GPU whose perspective
divide is an approximate reciprocal lands z / w on either side of 1 by
the bits of w, and the star is clipped or not with the camera's
position: Alnilam gone at one yaw and back at the next on the user's
M2, while SwiftShader, which divides exactly, drew it at both.
`stars.vert` pulls z to `FAR_PLANE_INSIDE` × w (1 − 1e-6: 8 ulps of 1,
8 steps of the 24-bit depth buffer): still behind every planet that was
in front (only one past 8 AU, a sub-pixel point, shares the stars'
depth), and over the Milky Way, which pins its z to the far plane.
`starClipZ` (`exposure.js`) replays the float32 arithmetic for tests.

**Nor a square of d, even one the compiler makes.**  With the pull-in
in, the user's M2 still lost Alnilam (1,977 ly) within about 9° of the
view axis, with its lumens and sprite ordinary and nothing in front of
it (`starProbe`: ulpsInside 8.9), and on #162's preview lost Thabit and
Na'ir al Saif as the camera backed along the line to Orion past 1,950 ly
from each (at 0.979 and 1.011 of 2^64 m along the view axis for Thabit,
0.993 and 1.005 for Na'ir al Saif).  2^64 m is sqrt(FLT_MAX): a square
of a distance in metres past it is Inf in float32.  The source squared
no metres: E = (lumens·1e-18) / (4π·(z·1e-9)²), z the distance along the
view axis.  But under fast math, which ANGLE's Metal backend compiles
with, a compiler may reassociate and cancel the constant scales, to
lumens / z² × 1/4π, and z² is Inf past 2^64 m: E = 0, a black star.
SwiftShader computes the source as written and drew every one.  Swapping
that folded form into `stars.vert` reproduces the user's frames on
SwiftShader exactly: Alnilam black from 0° to 9° off the axis and back
at 10°, Aludra and the Garnet Star black at the centre, Deneb (1,412 ly
in the catalogue) untouched, and in the user's four steps Thabit and
Na'ir al Saif black where they vanished and nowhere else.  `stars.vert`
now takes the inverse square in logs, `exp2(log2(lumens·1e-18 / 4π) −
2·log2(d_Gm))`, past a `max()` that keeps the scale from being folded
through: no algebra makes a square of d from that.  It renders
identically on SwiftShader (the same peaks and pixel counts at the
user's views and at Alnilam, Deneb, Aludra and the Garnet Star centred).
Nothing else in `stars.vert` squares or dots a vector in metres.  The
wide lines' lengths and the labels' directions, which did (`length()`,
`normalize()`: sqrt and rsqrt of a dot), now go through `safeLength` and
`safeNormalize` (`rte.js` `SAFE_LENGTH_GLSL`): the largest component out
first, through `clamp()`, which no fold passes through.  And as a
precaution, the stars' and the Milky Way's clip coordinates leave their
shaders divided through to w = 1 (`clipToW1`, as `wideLines.js`), so no
GPU's own arithmetic after the shader meets a clip w in metres past
2^64; that alone didn't bring Alnilam back.  7,002 of the catalogue's
106,748 stars are past 2^64 m from the Sun (Alnilam, Aludra, Na'ir al
Saif, Thabit, the Garnet Star; the farthest 11,649 ly), and from a
camera elsewhere a different set.  `starClip.test.js` replays the
source as written, as folded and in logs in float32, over the whole
catalogue from cameras out to 100 ly and over the user's four steps.

**Measured** (a probe projects every catalogue star, computes its
apparent magnitude and reads its pixel): the night sky from the outback
at 4e6 shows 234 stars over 10 of 255 to magnitude 6.5 in the 45° field
(of its 2,665 catalogue stars: 55 of 102 in the 6.0 bin at a mean of 17,
36 of 166 in the 6.5 bin at 10), the deep-space field 410 (read at 3.1e6
of its 4e6, still rising); a dark site's 2,500 stars above the horizon
to 6.5 are about 150-270 in such a field.  Rendered peaks are 0.6-0.8 of
the arithmetic (a 1 px point straddling pixels).  All 106,747 catalogue
stars are drawn (`renderer.info`), none culled.  The ceiling was set by
this star, not by a luminance: 3e6 put the limit at 6.0, 1e7 at 7.5 (×4
in light near the toe is ×8 on screen).

**Per body**, with the dark end absolute and the quarter-patch kernel
(the same probe, 480×300 at 45°, each view 60° up and away from the Sun
from 2-4 radii over the body, settled at the dark gain): the absolute
gain is 4e6 everywhere, and a mag 6 star is the one pixel it falls in
at 0.16-0.19 in exposure units (the test viewport's pixel is the patch),
from Mercury to Pluto.  92-94% of the stars to 6.5 in view render at 10
of 255 or more in every field (the rest straddle the frame's edge or sit
under a brighter star), against 28% at Mercury and 100% at Jupiter and
Pluto in the first cut, when the gain followed the keyed exposure (0.45×
Earth's at Mercury, 37× at Pluto), and 57-65% with the second cut's
σ = 0.4 × patch, whose sub-pixel Gaussian lost up to 5× of a faint
star's peak with where it fell.

| From | Keyed / Earth's | Absolute gain | Stars ≥ 10 of 255 to 6.5 (to 6.0) / in view | First cut (7cb678a): rendered / in view, at | σ = 0.4 × patch (cc83a76) |
|---|---|---|---|---|---|
| Mercury | 0.45 | 4.00e6 | 1,015 (666) / 1,088 | 285 / 1,006 at 1.8e6 | 687 |
| Earth | 1.00 | 3.98e6 | 897 (528) / 975 | 663 / 975 at 4.0e6 | 559 |
| Mars | 1.57 | 3.98e6 | 1,230 (784) / 1,336 | 691 / 728 at 6.3e6 | 855 |
| Jupiter | 5.4 | 3.98e6 | 710 (421) / 764 | 769 / 770 at 2.2e7 | 442 |
| Pluto | 36.9 | 4.00e6 | 793 (490) / 844 | 1,239 / 1,239 at 5.8e7 | 522 |
| Earth's surface at night, Sun −35°, 50° up | 1.02 | 3.99e6 | 314 (221) / 425 | 234 | 206 |
| Deep space, 4.7 AU, away from the Sun | 1.00 | 3.98e6 | 718 (446) / 768 | 410 | 447 |
| The user's Pluto star field (its permalink) | 36.9 | 4.00e6 | 1,477 (911) / 1,579 | — | 1,033 / 1,579 |

At 1080p (a 4 px patch, σ = 1 px) the deep-space field holds 822 of its
823 stars to 6.5 and the night field 380 of 481: a mag 6 star is an 8 px
quad peaking at 0.42-0.49, about 100 of 255, and a mag 2 star a 16 px
quad with a round 5-6 px saturated core (0.73-0.83 of its bounding box;
a disc fills 0.785, a square 1).  **The Sun from Pluto** (the user's permalink at 11.3 Tm, 480×300, its
point centred): its disc is 0.4′, under a pixel, so the sprite is all of
it: a round saturated core of 29×23 px, 0.92 of its circle, in a halo of
radius 24-35 px (a 59 px quad), at a metered gain its own highlight caps
near 1,500-2,000 over the keyed exposure (5e4 absolute), with 394 stars
to 6.5 beside it; the first cut drew it as a 64 px square.  In the user's
star-field permalink Sirius renders 234 at its centre with a saturated
8×8 px core that fills 0.77 of its bounding box inside a 5 px halo.

**The Sun's disc** (`star-shaders.js`) is `DISPLAY_GAIN / θ²` on average over
the disc, its limb darkening divided by its mean and its granulation,
spots and faculae a blackbody's at each fragment's temperature (every
star's disc is that times its surface brightness over the Sun's, its
luminance, not σT⁴: [Stars.md](Stars.md); a catalogue star travelled to
is drawn so and metered as the Sun is),
θ its angular radius from 1 AU: 69,357 at Earth's
keyed exposure, through the luminous shoulder (`hdr.js`
`luminousShoulder`: itself to 3e4, then compressed toward 5e4, at most
it), as its limb glow (`newAtmosphere`, held to the 1e4 the buffer has
left over that) is, so the texture's granulation and limb darkening
survive in the buffer at any exposure and the disc and its glow, which
add where the depth buffer can't tell the rim from the shell 0.07 radii
behind it (from 71 Gm its resolution is 5e8 m), sum to at most 6e4,
under half-float's 65,504 (over it a value is Inf, NaN once sampled, a
black pixel: with the disc at 6e4 and the glow at 2e4 the rim's red
channel overflowed, 29 pixels round the disc).  The shell now skips
what lies behind the disc (a ray test in its shader: [Stars.md, the limb
glow](Stars.md#the-limb-glow)), which also took out the glow's blocks
through the limb from 1 AU at a narrow field.  The point sprites add
single digits at most there (the glare cap).  The shoulder is the fix
for the top of half-float, not a stopgap
([pre-exposure](#pre-exposure), [#157](https://github.com/celestiary/web/issues/157)):
the buffer holds the disc at the frame's gain, and in a dark-adapted
frame with the Sun a small disc or a point in it the disc is 1e9 over
white, physically, which no buffer holds; the tone map's rule that a
non-finite input shows as the white point is the second line.  At the
keyed exposure the disc is white; the metered exposure brings it down
to show the granulation (rule 6 below).  **The black disc inside a
bright limb** the user saw on zooming in, and every SwiftShader render
of the disc, which was taken for a SwiftShader limitation, was neither
overflow nor SwiftShader: the disc's noise took its time from
log(1 + elapsed × 8e-7) with elapsed the simulated time since the app
started, NaN once that is 21 minutes in the past, every permalink with a
past `t=`.  The linear readback showed the disc NaN with its base at 0.6
as at 6e4.  `Star.js` `noiseTime` is finite for any time now, and the
tone map maps a non-finite input to the white point, never black.  The
ring of white dots round the disc, one per segment of the glow shell,
was the shell's `pow(dotP, 1.1)` of a negative normal dot at the
silhouette's vertices, NaN, which the clamp on its output turned into
the ceiling on a GPU whose `min` drops the NaN; `dotP` is floored at 0.

**The Milky Way** ([MilkyWay.md](MilkyWay.md), #99) is its integrated
light: a luminosity density from published structural models, 2.5e10 L☉
in all, ray-marched with its dust.  A column of 1 L☉/kpc² along the line
of sight is DISPLAY_GAIN·π·(AU/kpc)² in exposure units at Earth's keyed
exposure (`galaxyModel.js` `VALUE_PER_LSUN_KPC2`): the Sun's light at 1 AU
over the column's, per steradian, as a star's is over its patch.  1 L☉/pc²
(26.4 mag/arcsec² in V) is 1.1e-10.  From the Sun the poles are 23.8
mag/arcsec², 1.2e-9 (the integrated starlight there is 23.5-24), and the
band 21-22.6, 0.3-1.7e-8: at the dark-adapted gain 0.005 and 0.01-0.07, in
the tone map's toe, so the band barely shows.  That is the eye's
calibration for extended light (MilkyWay.md, "From inside"), not the
galaxy's.  From outside, the bulge face-on is 6e-8, and the meter frames
it as a photograph (rule 10 below).

## Metered exposure

The target-keyed exposure ([Planet.md](Planet.md#lighting-and-exposure))
shows a sunlit target at its albedo and is the anchor.  Over it a **metered
gain** adapts to what's in the frame, as the eye or an auto-exposing camera
does (`exposure.js` `meteredGain`, `ThreeUi._meter`):

1. Every `METER_EVERY_FRAMES` (4) frames the atmosphere pass renders its
   linear composite, sky plus scene through the transmittance in exposure
   units before the tone map (its probe view 7, `composition.md`), into a
   32×32 float target, which is read back.
2. The frame's **mean log luminance**, divided by the gain it was rendered
   at so it is the scene's at the keyed exposure, asks for the gain that
   brings it to `METER_KEY` (0.3, middle grey for a white of 1.5).  Pixels
   under `METER_FLOOR` (7.5e-8) count as the floor, so black asks for
   `METER_GAIN_MAX` = `METER_KEY / METER_FLOOR` = 4e6, not infinity.  That
   is the eye's dark adaptation: a scene of 8e-3 cd/m² (a moonlit
   landscape) shown as a sunlit one, set so that magnitude 6.5 just shows
   (above).  **The dark end is absolute**, over Earth's keyed exposure:
   the keyed exposure scales with the Sun's irradiance at the target
   (0.4× Earth's at Mercury, 40× at Pluto), and a floor and ceiling in
   keyed units made a dark frame's exposure, and the stars' limit with it,
   depend on the target, a magnitude shallower at Mercury and four deeper
   at Pluto (the user's preview: Mercury few stars, Pluto nearly all).
   So the floor is `METER_FLOOR × keyedOverEarth` and the ceiling
   `METER_GAIN_MAX / keyedOverEarth` in keyed units (`meteredGain`), and
   a dark frame reaches the same exposure, and the same limit, from
   Mercury to Pluto; the sunlit end (never below 1, the highlight cap)
   stays keyed, so a sunlit target shows at its albedo.
3. **Never below 1 for a sunlit scene.**  The luminance the brightest
   `METER_HIGHLIGHT_FRACTION` (2%) of the frame exceeds is lifted to at
   most `METER_HIGHLIGHT` (0.6, a sunlit surface of albedo 0.4): a frame
   holding a sunlit surface (the Moon at quarter, Mars from orbit, Earth's
   clouds, a midday sky) keeps the keyed exposure; a low Sun's sky and
   ground, a twilight, are lifted toward the key; a star field, whose
   sprites cover less than 2% of the frame, runs to the dark-adapted gain.
4. **Below 1 only for a blown highlight.**  Where a twentieth of the
   frame (`METER_BLOWN_FRACTION`, 0.05) is over `METER_BLOWN_VALUE` (20
   sunlit whites: only a self-luminous surface is, the Sun's disc at
   46,000; the sky round a low Sun peaks at a few whites over 2% of the
   frame, a sunlit surface is never over 1.5), the gain falls to bring
   that twentieth to `METER_HIGHLIGHT` (0.6, a sunlit surface), to
   `METER_GAIN_MIN` (5e-6) at most: the Sun's disc, from within 12 radii
   or a 2° field from 1 AU, shows its granulation and limb.  A quarter of
   the frame over a white (the first cut) missed the user's view from 2.5
   radii, where the disc was 22% of the frame and stayed a white at gain
   1 (`meterLast`: highlight 46,810, `blown` at the floor).  Brought to a white
   (the first cut) it was a flat light grey: the tone map's shoulder
   compressed the texture's 0.5-1 into 0.78-0.95 of the display (the
   user's preview, 0xEE), and its limb glow, a display-valued shell,
   stayed white round it; the glow now carries the disc's radiance
   (`newAtmosphere`), and a lift of the disc's colour with the camera's
   distance, white past 0.2 AU, is gone, so the disc keeps its
   granulation wherever it fills the twentieth.  Smaller in the frame,
   rule 6 brings the gain to its surface once its disc is resolved
   (from 8 to 32 px across), and under that it is a point in whatever
   the rest of the frame asks.
5. **A sunlit body in the frame anchors the gain, continuously in its
   share of the field** (`sunlitBodyGain`, from `ThreeUi._sunlitBodies`:
   every planet and moon whose disc is in the frame, with its lit
   fraction from its phase, its diameter in pixels and its share of the
   frame's pixels).  The anchor is the gain at which the body's brightest
   sunlit surface is at a target value: its sunlit white at the
   target-keyed exposure (`DISPLAY_GAIN × keyed(target) / keyed(body)`)
   times `HIGHLIGHT_ALBEDO_FACTOR` (2.5) × its Bond albedo, to 1 (Earth's
   clouds are 0.9 over its 0.37, the Moon's highlands 0.2 over its 0.12).
   Two blends, both in log gain and both over the disc's share of the
   frame's pixels (its solid angle over the field's), so a step of zoom
   never steps the exposure:
   - **how much of the anchor applies, by the disc's share of the frame**
     (`SUNLIT_FRAME_WEIGHT`, 0.01% to 0.2%): adaptation follows the
     luminance integrated over the field, so a bright source weighs by
     its solid angle, not by its size in pixels.  None for a speck of the
     field: the full Moon at 45° is a 0.5° disc in 45° × 72°, 0.006%, and
     barely moves a dark-adapted eye in space, so it leaves the gain to
     the frame and is a dazzling white disc among the stars; Jupiter from
     Earth at 45° (40″) a star of the night.  All of it by 0.2%, where
     the target's own blend (next) begins, so the two blends chain, and
     well under the 2% at which the highlight rule takes the disc itself,
     so the rules agree over the user's telescope steps (1.8-2.3%) and
     Jupiter at a 0.1° field (0.4-0.6%) keeps its bands.  The second cut
     weighed the anchor by the disc's diameter in pixels (1.5 to 6 px), a
     resolution, not a luminance: the Moon's 4 px disc on the 300 px test
     viewport took a star field from 4e6 to 40 and showed none of its 975
     stars, and on a 1080 px screen (7 px) every field with the Moon in it
     went to 3.3 ([#157](https://github.com/celestiary/web/issues/157)'s
     PR).
   - **the target, by the disc's share of the frame**
     (`SUNLIT_FRAME_FRACTION`, 0.2% to 2%): a white
     (`METER_HIGHLIGHT_MAX`) for a small disc, falling to a sunlit
     surface (`METER_HIGHLIGHT`, 0.6) as the share reaches the 2% the
     highlight rule above keys on, so the two rules agree where they
     meet and the disc is exposed alike whichever holds.  A ±15% step of
     zoom moves the gain under 20% over the anchored disc, and under
     three stops where the anchor weighs in.

   What a bright small disc does take from the stars, physically, is
   not the eye's gain: its **veiling glare** (Stiles-Holladay, `L_veil ≈
   10·E/θ²` cd/m² for an illuminance E in lux at θ degrees from the
   source: the full Moon's 0.25 lux veils 0.1 cd/m² at 5° and 0.006 at
   20°, 50× and 3× a dark sky) is light in the field, which the meter
   would read and which hides the stars near the disc; and from Earth's
   surface the **moonlit sky** (0.001-0.003 cd/m² near full, 2-3
   magnitudes over a dark site) hides the faint stars everywhere.
   Neither is drawn yet: the glare is the next step for the anchor (a
   halo on the Moon, Venus and Jupiter as the Sun has its glow shell,
   metered like any light), the moonlit sky belongs to the atmosphere
   pass (a second, weak source), and until then a wide field with the
   Moon in it shows every star a dark site does, with the Moon white.

   The Moon filling a 1° field: 1.33, its highlands at 0.6 and its
   maria dimmer (the hard cap's 3.3, a white, is what `starsDebug`
   logs); in a 10° field, 0.13% of it, most of the way into the weight,
   the gain is within a few times the anchor (7.4 here) and the
   Moon a bright disc, its highlands over white, the brightest stars
   left; at 45° the field keeps 4e6 and its stars; Earth's crescent from
   94,000 km (1.3% of the frame): 1.1, its clouds just white, no stars; Jupiter at a
   telescope's 0.04° field from Earth, 275 px across on a 1140 px frame
   (2.3% of it): 2.16 (its keyed exposure is 5.3× Earth's by
   `exposureAt`), its brightest band at 0.6 and its centre at 0.43, and
   2.16 and 2.20 at the next two steps of zoom out (255 and 230 px, the
   last under 2%), where the first cut gave 2.16, 2.16 and 4e6.  The
   percentile rules
   above miss a body under 2% of the pixels, and ran a frame with Earth's
   crescent in it to the dark-adapted gain: the crescent a flat white (the
   user's preview).  An eye or a camera won't blow out the one lit thing in
   view, and with it in view the stars legitimately go; with no lit body
   in view the field keeps its dark adaptation.  The first cut
   (`sunlitBodyCap`, kept for `starsDebug`) was a hard cap that took a
   body as resolved by its angular size against the eye's 10′ patch,
   whatever the field of view: at the telescope field Jupiter, 300 px
   across but 40″, never anchored, the 2% rule alone held it at 0.6, and
   when a step of zoom took the disc under 2% of the frame the rule
   dropped it and the gain went to 4e6, the disc from its bands to a
   flat white at once (the user's preview).  Only a disc that fits in the
   frame anchors (the lit fraction is the whole disc's: from the ground or
   low orbit on the night side the lit part is beyond the frame, and the
   dark ground adapts), and only with a twentieth of it lit
   (`LIT_FRACTION_MIN`): a limb crescent past 154° of phase doesn't put
   out the night side's cities from orbit.  Never under 1: the target's
   own sunlit side keeps its keyed exposure.
6. **A self-luminous disc in the frame brings the gain to its surface**
   (`luminousDiscGain`, from `ThreeUi._luminousDiscs`: the Sun's mesh
   when it is in the frame, with its diameter in pixels).  Once the disc
   is resolved the gain is blended, in log gain, from the meter's answer
   at 8 px of diameter to the disc's own at 32 px (`LUMINOUS_DISC_PX`,
   scaled by the pixel ratio): the gain at which the disc's radiance
   (`SUN_DISC_RADIANCE`, 69,357 at Earth's keyed exposure) shows as
   `METER_HIGHLIGHT`, with its granulation and limb.  So the Sun from
   5-52 AU is a point in a dark-adapted field; from 1 AU at 45° on a
   1080 px screen (13 px) the blend has begun; from within about 60 Gm
   (32 px) its disc shows its surface; and there is no jump between, as a
   camera pointed at the Sun stops down.  The stars go as the disc takes
   the frame.  The blown rule above needed a twentieth of the frame, which
   the disc reaches only from 5 Gm, and the user saw a white disc from
   50 Gm in.  The floor `METER_GAIN_MIN` is absolute, over Earth's keyed
   exposure, as the ceiling is: from Pluto's keyed exposure the same disc
   needs 37× less.
7. **While the scene loads**, a frame with nothing in it (every sample
   exactly zero: a texture or the star catalogue still to come) asks for
   nothing, and the gain stays (`frameCanBeEmpty`: the star catalogue not
   yet drawn, or the exposure target's surface not ready and no Cesium
   layer standing in).  Without this the gain ran to 3e6 on the black
   loading frame and the planet, when it came, overflowed the buffer.
   Once loaded, a black frame is a dark one and runs to the dark-adapted
   gain: the pixels can't tell the two apart.  The first cut decided it
   from them (empty if the meter's maximum was exactly zero), and that
   missed the user's star field on an M2 Mac with nothing in the console:
   the meter is 1,024 single taps over the frame, under 1% of its pixels,
   and a star field at the keyed exposure is a few hundred 2 px points of
   1e-5 to 1e-7 (Sirius 4e-5), so every tap can miss them, and under
   half-float's smallest normal value (6.1e-5) a GPU may flush them to
   zero outright (the 4 px sprites before the round kernel put Sirius's
   centre at 8e-5, which survived); the frame read zero, the gain held at
   1, and the stars stayed 1e-5 of white.  On SwiftShader, which keeps
   half-float denormals, the meter's brightest tap at 1080p was one star's
   edge at 4e-8.  Since [pre-exposure](#pre-exposure) the floor is
   explicit (`emitted`): a star field at gain 1 writes nothing to the
   buffer on any GPU, so the rule stays for as long as the loading frame
   renders at gain 1, and the scene, not the pixels, says whether the
   frame can be empty.  The LDR fallback's bytes quantize a star field to zero,
   so it takes every black frame as dark, and a planet loading there is
   blown out for the second the gain takes to fall.  `c.ui.starsDebug()`
   logs the meter's last reading, the gain and its cap with the bodies
   that set it, the GPU's point-size range and fragment precision and a
   few stars' sprites, for checking a build on a machine at hand.
8. **The meter sees only the physical scene.**  Labels, orbit paths,
   asterism and expansion lines, grids and the pick marker are drawn in
   the overlay pass, after the readback (`shared.js` `overlay` puts every
   node of one on `OVERLAY_LAYER`).  In the scene pass, through
   `sceneReferred`, their values were fixed display values, so their
   keyed reading fell as the gain rose and the highlight rule found a
   fixed point wherever the gain was when their pixels reached the
   frame's 2%: the user's star field with labels and orbits on settled
   at 1,700-1e4 instead of 4e6 and lost its faint stars.  With them out,
   a frame meters the same with every overlay on as off.  What still
   reaches the buffer display-valued is a body's far point (a few pixels,
   kept in the scene pass so the day sky hides it as it does the stars;
   DESIGN.md) and the rings (`Rings.js`), which should become physical.
9. The gain **eases in log space** (`easeExposure`), with a time constant
   of `METER_TAU_UP_SECONDS` (1.5 s) rising, the eye adapting to the dark,
   and `METER_TAU_DOWN_SECONDS` (0.3 s) falling, a camera catching up with a
   planet come upon from a star field; the keyed exposure itself keeps its
   0.5 s between targets.  The gain asked for is the scene's whatever
   exposure the frame was rendered at (step 2), so there is no loop to
   oscillate: at a fixed view the goal is a constant and the gain settles
   on it; as the view moves the goal moves with the frame's content and
   the easing smooths it.
10. **The galaxy from outside anchors the gain** (`galaxyGain`;
   [MilkyWay.md, "Exposure"](MilkyWay.md#exposure-framed-as-a-photograph-from-outside)),
   as a camera framing a galaxy exposes for the galaxy.  The rules above
   key the frame's mean, which the black round it floors, and stop at the
   dark-adapted 4e6, where a disc of 21-24 mag/arcsec² is 0.01-0.1: faint
   arms round a small bar, which the user had to lift by hand.  Instead the
   brightest 2% of the frame's lit part (`meanLogLuminance`: the pixels
   within 1e-3 of its 2% highlight) is brought to `GALAXY_HIGHLIGHT` (1.5,
   at the shoulder).  This is blended in log gain by how far outside the
   galaxy the camera is (`galaxyModel.js` `outsideWeight`, 0 anywhere in
   the disc, so the night sky and its stars keep the eye's gain), and by
   the lit part's share of the frame (0.5% to 5%).  It may pass
   `METER_GAIN_MAX`, as a long exposure does, to `GALAXY_GAIN_MAX` (1e10);
   the stars' limit deepens with it, and from outside the catalogue's stars
   are fainter than magnitude 11.  Face-on from 45 or 100 kpc the gain
   settles at 1.2e8, oblique from 50 kpc at 8.3e7, edge-on from 80 kpc at
   5.2e7; from 3 kpc over the Sun it stays at 4e6.

The exposure then reaches everything in the buffer's units: the surfaces
(the scene pass), the sky (`uSkyExposure`), the stars (`exposureRelative`),
and Cesium's frames, whose decode is scaled by the exposure over the body's
keyed one (`ThreeUi.exposureOf`) so the two sides of the swap move together.
In the LDR fallback the meter reads the 8-bit composite, display values: in
the dark, where the gain matters, Neutral's toe is near linear and the gain
is close; in the bright it is under-read and the gain stays at 1.

The overflow in step 5 is guarded everywhere: the scene pass's exposure
multiply, the decode, the stars and the Sun's disc clamp to `HDR_MAX_VALUE`
(6e4, under half-float's 65504), since a value past it becomes Inf, NaN out
of the tone map, a black pixel, and a meter that reads black holds the gain
that overflowed it; a non-finite pixel in the meter counts as the maximum.
The other end is floored: emitted radiance under `HDR_MIN_NORMAL` (6.1e-5,
half-float's smallest normal value) is written as zero (below).

### Pre-exposure

[#157](https://github.com/celestiary/web/issues/157).  **The buffer holds
the frame as exposed, every source alike.**  The scene pass multiplies a
lit surface by `toneMappingExposure`, which `_updateExposure` sets to the
target-keyed exposure times the metered gain (eased); `uExposureRelative`
is that same exposure over Earth's keyed one, `keyedOverEarth × gain`,
and every emitted source (the stars, the Milky Way, the Sun's disc and
its glow) multiplies its radiance at Earth's keyed exposure by it before
writing (`absoluteUniforms`); the sky's `uSkyExposure` and Cesium's
decode (`exposureOf`) carry the same exposure.  So a mag 6 star at the
dark gain is 0.17 in the buffer, Alnilam 9.4 (its kernel's peak 1.3 on
the 300 px viewport, 5.8 at 1080p), Sirius 170, the Milky Way's band
0.01-0.07, and the Sun's disc at the luminous-disc gain 0.600.
`ThreeUi._renderedGain` records the gain the frame renders with, once,
before the scene pass, and `_meter` divides its readback by that record:
not by the meter's goal, nor by `_meterGain`, which the exposure's own
0.5 s easing trails (`starsDebug` logs it as `renderedGain`).  The issue
took the buffer for the keyed scene with the gain applied after it, 1e-6
to 1e5; PR B had put the gain in the buffer already, and this is the
measurement.

**The floor.**  What falls under half-float's smallest normal value
(`HDR_MIN_NORMAL`, 6.1e-5) at the dark gain is invisible: a star fainter
than magnitude 15 (the limit star is 0.12, 2.5× less per magnitude), the
Gaussian halo past where the quad's window has taken it under a display
step, and the Milky Way's outer disc from outside at a low gain (it
was the filtered edges of the point cloud's sprites, before #99).
SwiftShader keeps such values as subnormals; a GPU that flushes them
(ANGLE on Metal) stores zero.  `emitted()` (`hdr.js`, its GLSL in the
Milky Way's, the Sun's disc's and the glow's shaders, and a copy in
`stars.frag`, which is a file; a test keeps the constants equal) writes a
channel under the floor as zero, so every GPU holds the same buffer and a probe here reads
what the user's Mac holds.  It costs nothing visible: 6.1e-5 is 1/65 of a
display step through the tone map, and the star counts and pixels below
are unchanged.  The Milky Way and the glow output premultiplied with
alpha 1 (their additive blend adds the colour as is), so the floor applies
to what reaches the buffer.  The Milky Way's march holds its light in a
half-float target unexposed, times 1e8 (`STORE_SCALE`), where it is 1e-3
to 10, and the pass applies the exposure and the floor after it.  The LDR fallback can't hold under 1/255 and
is unchanged to the pixel.

**At the keyed exposure** (gain 1: the loading frame, or a frame a sunlit
body anchors) the star field as a whole is under the floor: Sirius alone
peaks over it on a screen (1.2e-4, 1/35 of a display step), nothing on
the test viewport.  That is why rule 7's `frameCanBeEmpty` stays: on any
GPU the meter can't tell a loading frame from a star field at gain 1 by
its pixels, and the scene has to say.  The star field is invisible there
either way (Sirius 4.4e-5 of white).

**The top of half-float** is reached by one source, the Sun's disc, and
only in a frame whose gain the disc doesn't set: a dark-adapted field with
the Sun a point or a small disc in it.  From 300 Gm at 4e6 the disc's
mesh, under a pixel, is 69,357 × 4e6 = 3e11 before the shoulder; the
buffer reads 5e4 in red, the shoulder's ceiling, with the glow's 1e4 on
top.  That is physical, 1e9 over white, and no buffer holds it: the
shoulder is the fix there, not a stopgap.  Once the disc is resolved the
luminous-disc gain brings it to 0.6 (rule 6), and nothing else is within
a decade of the ceiling: at 8 and 2 Gm the buffer's largest value is the
disc's glow, 60.

**Not the Alnilam dropout.**  Alnilam's buffer value at the dark gain is
1.3 to 9.4, far from either end, and it renders here at every view it is
in (106 to 171 of 255 at its exact pixel, 480×300).  A flush of
subnormals can't take it.  `c.ui.starProbe('Alnilam')` on the user's
Mac, at the view where it is missing, is still the measurement to make.

**Measured** (SwiftShader, 480×300, Cesium's layers off, `main` at
50bfcf8 against this change, each view settled; the scene buffer read as
half floats, each pixel's brightest channel classified against 6.1e-5
and 65,504; the meter's composite, which adds the sky, read as floats):

| View | Absolute gain | Stars ≥ 10 of 255 to 6.5 (to 6.0) / in view, before → after | Scene buffer: pixels > 0, before → after | Subnormal pixels in it, before → after | Smallest value after | At gain 1: subnormal, before → after |
|---|---|---|---|---|---|---|
| Earth from 65 Mm, the Moon's 4 px disc in the frame (`sunlitBodyGain` holds it at 40) | 40 | 0 (0) / 975 → the same | 5,767 → 19 | 5,748 → 0 | 7.7e-5 | 617 → 0 |
| Pluto from 12 Mm, 60° up and away from the Sun | 4.0e6 | 790 (490) / 844 → 793 (490) | 7,042 → 6,924 | 122 → 0 | 6.13e-5 | 6,108 → 0 |
| Orion from 232 Gm, the Milky Way on (the user's Alnilam permalink, `s=lpo`) | 4.0e6 | 1,227 (775) / 1,309 → the same | 19,906 → 19,298 | 258 → 0 | 6.13e-5 | 868 → 0 |
| The Sun from 300 Gm, bare | 3.97e6 | 1,300 (810) / 1,418 → the same | 11,180 → 10,898 | 283 → 0 | 6.12e-5 | 948 → 0 |

The buffer's largest value is the Sun's, 59,968, in the two views that
hold it, and no pixel is non-finite in any.  Every named star reads the
same before and after (Alnilam 106.6 of 255 at its exact pixel in the
Orion view, 159-171 in the Sun views; Sirius 96.7 / 194; a mag 6 star
32-55 at its brightest neighbour), the gains agree within the easing's
noise (under 1%), and the pixels lost are the ones under the floor.  The
Sun series at 71, 8 and 2 Gm and Jupiter at the telescope field from
0.04° to 0.3° read as PR B's tables have them (the gains 3.97e6, 8.65e-6,
8.65e-6; 2.16, 2.48, 4.37, 5.40; the disc at 0.600 and Jupiter's centre
at 0.43-1.07), before and after alike; a single pixel of the Sun's disc
varies run to run on `main` as here, since its granulation's clock is
the wall-clock start.  The meter's composite (`uDebug` 7, floats) still
holds values under 6.1e-5 after the floor: the sky's in-scatter where
the pass runs (Pluto's thin atmosphere with the Sun 8° up, 6,400
pixels), and its resampling of the buffer's pixels next to black (the
Sun views, 7,000); the half-float buffer, read directly, holds none.
`yarn parity`: 17 views, 87 checks, 0 failed, no baseline moved.

### Results

SwiftShader, 480×300, Cesium's layers off (celestiary's own bodies; the
swap is `yarn parity`'s, below), against `main` at the same commit.
Medians of the display luma (of 255) over a region; "gain" is the metered
gain the frame settled on, and "meter" what it read at the keyed exposure
(the mean log luminance, and the luminance the brightest 2% exceed).

| View | Gain | Meter (mean / 2%) | Region | Before | After |
|---|---|---|---|---|---|
| Earth's surface, outback, Sun 43° up | 1 | 0.67 / 1.9 | sky / ground | 90.8 / 191 | 90.8 / 191 |
| Earth's surface, Ganges plain, Sun 60° up | 1 | 0.76 / 2.1 | sky / ground | 98.5 / 191 | 98.6 / 191 |
| Earth from 400 km, Sun 14° up (`earth-low-dusk`) | 1 | 0.34 / 0.41 | all | 74.1 | 74.1 |
| Earth from 20,000 km, 64° phase | 1 | 1e-6 / 0.76 | disc / space | 58.3 / 0 | 55.9 / 0 |
| Earth from 20,000 km, at the terminator | 1.02 | 6e-7 / 0.59 | disc | mean 41.7 | mean 32.9 |
| Earth's night side from 20,000 km | 7.3e4 | 1e-10 / 8e-6 | disc median / 90th pct | 5.9 / 37 | 6.8 / 96 |
| Civil twilight, outback, Sun −4°, toward it | 4.4 | 0.017 / 0.13 | sky / glow / ground | 1 / 7.8 / 115 | 11.6 / 47.8 / 0 |
| Twilight from 3 km, Sun −5°, toward it | 7.2 | 0.002 / 0.08 | sky (lower half) | 10 | 55.6 |
| Nautical twilight, Sun −10°, toward it | 268 | 7e-5 / 1.8e-3 | sky / horizon | 0 / 0.2 | 0 / 55 |
| Nautical twilight, Sun −10°, away from it | 1,000 | 5e-5 / 5.7e-4 | sky 50° up / all | 0 / 0 | 0.9 / 1.9 |
| Night, Sun −35°, looking up | 4e6 | 6e-14 / 3e-9 | stars: pixels over 20 / 100 | 22,460 / 196 (display values) | 426 / 102 (242 stars over 10, to mag 6.5) |
| Deep space, 4.7 AU from the Sun, away from it | 4e6 (3.1e6 at 120 frames) | 6e-14 / 4e-9 | stars: pixels over 20 / 100 | 22,690 / 324 (display values) | 281 / 72 (410 stars over 10) |
| The Moon from 5,000 km, quarter | 1.22 | 2e-6 / 0.49 | lit disc | 61 | 77 |
| The daytime Moon, quarter, Sun 42° and Moon 38° up, 4.7° fov | 1 | 0.32 / 0.34 | sky / Moon | 72.4 / 127 | 72.4 / 127 |
| Mars, Valles Marineris, Sun 18° up, zenith (`mars-sky-zenith`) | 2.1 | 0.13 / 0.29 | zenith / 35° lower | 11 / 44 | 34 / 104 |
| Mars, same, away from the Sun (`mars-sky-antisolar`) | 1.9 | 0.16 / 0.19 | sky 50° up / horizon / ground | 19 / 36 / 34 | 47 / 77 / 76 |
| Mars, same, toward the Sun (`mars-sky-aureole`) | 1 | 0.53 / 2.3 | aureole / 40° off / ground | 210 / 92 / 48 | 210 / 92 / 52 |
| Mars from 232 m, Sun 26° up (`mars-low-horizon`) | 1.25 | 0.24 / 0.48 | ground / sky | 44 / 53 | 56 / 68 |
| Earth's crescent from 94,000 km, 30% lit, in a star field (`sunlitBodyCap`; with `sunlitBodyGain` the cap's target at 0.3% of the frame is 1.39, the gain 1.01, by the function) | 1.09 (the cap) | 7.5e-8 / 6.9e-8 | crescent (0.3% of the frame) | white, 4e6 (the second cut) | peak 238, median 100, none saturated; 7 stars |
| The Moon from the outback at night, 77% lit, 10° field (`sunlitBodyCap`) | 3.33 (the cap) | 2.3e-8 / 2.3e-8 | the disc | white, 4e6 (the second cut) | 47-232 with its phase |
| The Sun's disc, zooming in from 232 Gm to 8 Gm (`luminousDiscGain`; 1000×595, bare) | 4.0e6 at 4.5 px across (232 Gm), 1.8e6 at 10.5 px (100 Gm), 3,700 at 16 px (65 Gm), 1.67 at 21 px (50 Gm), 8.65e-6 from 35 px (30 Gm) | — | the disc | white to 5 Gm, then 0.6 | 6e4 to 50 Gm, 0.600 from 30 Gm; monotone, no jump |
| Jupiter from Earth at a telescope's field, zooming out, 0.04° to 0.3° (`sunlitBodyGain`; 1000×570, bare, the user's permalink) | 2.16 at 130 px across (2.3% of the frame), 2.16 at 121 px (2.0%), 2.20 at 109 px (1.6%), 2.58 at 87 px (1.0%), 4.57 at 52 px (0.37%), 5.37 at 17 px (0.04%) | — | the disc's centre, linear | 2.16, 2.16, then 4e6 (the hard cap, which never took Jupiter: 40″) | 0.43, 0.43, 0.44, 0.52, 0.93, 1.05: its bands at every step, a white only as a small disc; no step of gain over 14% between steps of 15-20% in zoom |
| The Sun's disc at 71 Gm, 8 Gm and 2 Gm, the clock set by the permalink (`noiseTime`, the shoulder, the glow's share) | 8.65e-6 at 8 and 2 Gm, 2.5e4 at 71 Gm | — | the disc, linear | NaN (black) at every distance; then 29 NaN on the rim at 71 Gm | 0.600 at the centre with the texture's colour at 8 and 2 Gm (limb 0.165); 49,980 at 71 Gm with the glow on its rim; no non-finite pixel in any frame |
| The Sun from 7 radii | 5e-6 (the floor: SwiftShader's disc is non-finite, which the meter counts as the maximum) | 66 / 1.2e10 | disc | black (SwiftShader; its rim 6e4) | the same |
| Earth star field from 65 Mm, 60° up and away from the Sun, the Moon's 3.5 px disc in the frame (0.006% of it) (`sunlitBodyGain` by the disc's share of the field, #157) | 4.0e6 (the pixel weight: 40) | 5e-14 / 1e-8 | stars ≥ 10 of 255 to 6.5 (to 6.0) / in view | 0 (0) / 975 at 40, the Moon's 4 px disc anchoring | 897 (528) / 975; the Moon a white disc |
| The Moon from 20,000 km over Earth's night side, 45° (0.008% of the frame) | 4.0e6 (was 133) | 5e-14 / 6e-9 | stars to 6.5 / in view | 0 / 986 | 910 / 986 |
| The Moon from the outback at night, 77% lit, 10° field (0.13% of the frame, `moon-night`) | 7.4 (was 3.33) | 1e-8 / 1e-8 | the disc | 47-232 with its phase | its highlands over white, the maria at 1.3; the brightest stars left (the limit −7.8) |
| Jupiter at 0.1° from Earth (52 px, 0.37% of the frame) | 4.37 (unchanged) | — | the disc's centre, linear | 0.90 | 0.90 |
| Jupiter at 0.3° (17 px, 0.04%) | 4,130 (was 5.4) | — | the disc's centre, linear | 1.05, just white | 815: a white point among the stars, the blow-out gradual over the zoom from 0.1° |

- **A sunlit scene is untouched**: the midday surface, Earth from orbit by
  day and at the terminator, the daytime Moon, Mars toward the Sun and
  from 400 km all read as before, at gain 1.  Earth's disc from 20,000 km
  is 4% darker in its median: the night lights' floor (the texture's grey
  land, 0.02-0.09, at a fixed display value) is gone from the dark limb.
- **The stars are gone from a sunlit frame** (space 0 instead of 6.8 mean
  beside Earth; the daytime sky): their light is under a sunlit surface's
  by 1e4 or more, so the keyed exposure can't show them, as a camera
  can't.  They are back where the frame is dark: at night and in deep
  space the gain reaches 4e6 (the 1.5 s constant), and a 45° field holds
  240-410 stars over 10 of 255, to magnitude 6.5, the brightest first and
  blooming; the display-valued catalogue showed thousands at every
  exposure.
- **Mars's low Sun comes up**: 2.1× at the zenith (11 → 34, the lower sky
  44 → 104), 1.9× away from the Sun, 1.25× from 232 m; the view toward the
  Sun, whose top 2% is the aureole at 2.3, stays.  The sky's colour holds.
- **Twilight on Earth lifts 4× at −4°** (the sunset glow 7.8 → 48, the
  sky 1 → 12), 270-1,000× at −10°; the horizon band toward the Sun (1.8e-3
  of a white; away from it 5.7e-4, 8° up) caps the gain, so the stars,
  Sirius at 4.4e-5, reach threshold only once the sky is below ~1e-5,
  about −20°: later than the eye, which adapts to where it looks (the
  zenith at −10° is 1.2e-5), not the whole frame.  A centre-weighted meter
  is the follow-up.
- **The quarter Moon brightens 1.26×** (61 → 77): its top 2% is 0.49, under
  the 0.6 cap; from the dark-adapted night side of Earth it is white.
- **The night side from orbit** shows its cities at 7e4 gain (90th
  percentile 37 → 96): the night lights are a radiance now (3e-5 of a
  white for the texture's full white), invisible beside the day side at
  the terminator (as #93 will tune) and brought up with the frame.
- **The gain settles without pumping**: at a fixed view the goal is a
  constant and the gain approaches it monotonically (the star field: 57 →
  9.7e4 → 8.5e5 → 1.8e6 → 2.4e6 at 0, 1.9, 3.4, 4.8, 6.2 s); the last
  eight frames of every settled view agree to 1e-3.  A planet loading from
  a black frame keeps the gain (step 5).
- **The LDR fallback** (`?hdr=0`) meters its 8-bit composite: the star
  field reaches the dark-adapted gain and shows its stars; a planet that
  loads from black is blown out while the gain comes down through clipped
  readings, ×0.3 per metering, a few seconds.
- **The Sun up close** was taken as unjudgeable here: its disc's interior
  rendered non-finite on SwiftShader, black after the tone map, and the
  meter counted a non-finite pixel as the maximum, so the gain ran to
  its floor whatever the frame.  That was the noise's time going NaN for
  a permalink's past `t=` (above), on every GPU; with `noiseTime` the
  disc renders here (the rows above).  On a real
  GPU (the user's M2, 1.74 Gm, the disc 40% of the frame) the quarter
  reads 69,357 × the texture, about 59,000, the gain falls to 1.0e-5
  and the disc shows at 0.35-0.7 with its granulation and limb, the glow
  shell under it (`meteredGain`'s tests); brought to a white in the first
  cut it was a flat 0xEE.

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

- **Moon and Mars** (`sunlitShader`): `stored · lambert` (with a night floor),
  at most 1, as Earth's globe below; the decode multiplies by the body's gain,
  `DISPLAY_GAIN · textureGain / imageryScale`.  (They first returned `N(v)` of
  their exposure-unit value, which the decode inverted with `N⁻¹`; #141's review
  made every body one path, and the 8-bit Neutral round trip had lost
  highlights.)
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
composites `_cesiumRT` into `_sceneRT`, the same for every body: `rgb ×
bodyGain`, opaque, with the terrain's distance from alpha as depth
(CESIUM.md).
Cesium's frame no longer clears `_sceneRT`'s depth, so the depth save and
restore around each frame go.

**Emitted light doesn't fit that frame.**  The frame holds a lit surface, at
most 1; Earth's night lights are ~4.5e-5 of a lit white at the keyed exposure
and are meant to be seen at the night side's gain (up to 4e6), under one
level of the day's 8 bits.  So they are a second Cesium frame, the night
imagery's stored values on black, decoded by a pass that adds them to
`_sceneRT` as `stored × nightFactor × NIGHT_LIGHT_RADIANCE × toneMappingExposure`,
the form celestiary's own surface shader has, before the atmosphere pass and
the meter ([CESIUM.md, night lights](../../CESIUM.md#night-lights)).

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

SwiftShader, 480×300, against `main` at the same commit.  "Pixel ratio" is
the median per-pixel luma ratio after/before over the region (bodies: the
pixels over luma 12 of 255); "mean" is the ratio of mean luma, which the
star field moves.  `off` forces Cesium's layers off (celestiary's own
bodies); `on` is the default, Cesium where it's in range.

| View | Region | Pixel ratio | R / G / B | Mean |
|---|---|---|---|---|
| Earth, 20,000 km, 25° phase, off | lit | 1.000 | 1.00 / 1.00 / 1.14 | 1.04 |
| Earth, 20,000 km, 90° phase, off | lit | 1.000 | 1.00 / 1.00 / 1.00 | 1.06 |
| Earth's surface, Sun 50° up, off | sky | 1.059 | 0.88 / 1.06 / 1.27 | 1.07 |
| | sea | 0.884 | 0.63 / 0.89 / 1.08 | 0.94 |
| Earth's surface, Sun 3° down, off | sky | 0.715 | 0.74 / 0.71 / 0.44 | 0.78 |
| | glow | 0.962 | 1.05 / 0.93 / 0.57 | 1.01 |
| The Moon, 5,000 km, quarter, on and off | lit | 1.000 | 1.00 / 1.00 / 1.00 | 1.03 |
| Mars, 12,000 km, on and off | lit | 1.000 | 1.00 / 1.00 / 1.00 | 1.02 |
| Saturn and its rings | lit | 1.000 | 1.00 / 1.00 / 1.00 | 1.06 |
| Star field, 100 AU, labels and asterisms on | all | 1.000 | | 1.05 |
| Daytime Moon, quarter, Sun and Moon 45° up, off | sky | 0.904 | 0.64 / 0.90 / 1.12 | 0.91 |
| | Moon | 1.038 | 1.01 / 1.04 / 1.12 | 1.03 |

- **Bodies without sky over them are unchanged**: every lit body's pixel
  ratio is 1.000, on either side of the swap.  Cesium's frames decode
  exactly (`N⁻¹` of `N`).
- **The star field's mean rises 3-6%** (the "mean" column of the space
  views; 12% in the densest field, behind the Sun): single stars are exact,
  but overlapping glows now add in linear light before the tone map, and
  the toe's inverse is square-root-like, so a pair tone-maps brighter than
  their old clamped sum (+13% in pixels of luma 20-80, -11% in the few over
  160, label edges over glows).  PR B replaces the stars' values anyway.
- **The sky changes model, as expected.**  The midday sky is 6% brighter in
  luma and more saturated (red 0.88, blue 1.27): `1 − e^(−S)` desaturated
  it, compressing the strong blue channel more than the weak red, and PBR
  Neutral doesn't.  Twilight is 29% dimmer, with the least blue left:
  Neutral's toe crushes dim values (the worked number above).  The sea
  under the midday haze is 12% darker (its haze is sky, and redder before).
- Earth's night lights (celestiary's only then; Cesium's now draws them, #93, [CESIUM.md](../../CESIUM.md#night-lights)) and the Sun's glow ring are
  unchanged.  The Sun's disc is black in SwiftShader on `main` and here
  alike.

**Across the swap** (Cesium's layer over celestiary's own, per view): on
`main` the Cesium-drawn Earth differed wherever its own atmosphere showed,
up to 2× (the midday sea 2.02, sky 1.47, the twilight glow 1.9; the daytime
Moon 0.69 behind Cesium's sky).  Now its sky and haze are celestiary's:
1.000 for the sky at midday and at twilight, 1.000 for the midday sea, and
0.966 for the daytime Moon (the Moon's own gap, CESIUM.md).  `yarn parity`:
Earth from orbit 0.990 in luma (was 0.975, with R/G/B 1.13/0.97/0.74, now
0.98/0.99/1.00), from 400 km at dusk 1.002 (was 0.899, 1.20/0.87/0.51, now
1.00 in each); the Moon (0.967) and Mars (0.990) as before.  Details:
[CESIUM.md, baselines](../../CESIUM.md#baselines-and-what-they-show).

The LDR fallback (`?hdr=0`) matches `main` exactly on the Moon and the star
field, and shows the sky as the HDR path does.

**Low over the day ground** (found on the preview, on a real GPU): once
Cesium's Earth was under celestiary's atmosphere pass, the day ground
washed out below ~40 km, to a yellow glow near the surface.  It did on
celestiary's own Earth too, on `main`; Cesium's own atmosphere had hidden
it on that side.  Two causes in the pass, both fixed: the eye-adaptation
boost covered the ground (over it, from 7.5 km, T was 0.094 instead of
0.87 / 0.75 / 0.50 in R / G / B), and the in-scatter table's ground slice
gave every ground ray the horizon's in-scatter (from 16 m the sky term over
the ground was 2.7 in exposure units, with T 0; now 0.001, with T 0.99).
See [composition.md](atmos/composition.md) and the `earth-low-land-day`
parity view.

**Terrain above the sphere's horizon** (found on the preview, in Canyon de
Chelly): with the wash-out fixed, terrain that rose above celestiary's
sphere's horizon, a ridge seen from a valley, was drawn as sky, cut off
along a straight line.  Nothing gave it depth, so the pass took it for
sky: T at its 0.08 floor and the full ray's sky over it (on a ridge near
Everest from 6.5 km: T 0.08, sky 0.35 / 0.69 / 1.16, the ridge's own
1.04 let through at 8%, against the valley floor's T 0.82 / 0.66 / 0.38).
Cesium's terrain distance now reaches the pass as depth
([CESIUM.md](../../CESIUM.md), `cesium/distance.js`), and the pass hazes
the segment to it (composition.md): on a ridge 17 km off, T 0.96 /
0.91 / 0.79 and a sky of 0.07 / 0.16 / 0.33.  The `earth-ridge-day`
parity view looks up a valley at such a ridge and checks it against the
valley's ground in the same render: the ridge's median luma is 0.97 of
the ground's and its blue/red 0.99 of it (before, 0.69 and 2.24: sky).
The ground itself, from below 20 km, is hazed for its own distance too,
not the sphere's; over the Ganges plain, where they're the same, the
four Himalaya views read as before (T and sky within 0.01 across the
swap), and `earth-low-land-day` holds (0.969).

**Mars's horizon** (found on the preview): Mars's Cesium layer, a
tileset, didn't carry its terrain's distance (only Earth's globe did), so
its terrain above the sphere's horizon was drawn as sky (from 232 m: T
0.004, the full ray's sky over it).  And its terrain lies mostly below
Mars's datum: the ground sphere's depth, nearer, covered it, so the band
between the terrain's horizon and the sphere's read as ground with the
stars through it (T 0.79 over the star field), and with the camera below
the datum the tables had no rows for the eye and the ground's in-scatter
went to 0 (the view darkened).  Now Mars carries the distance too, the
sphere's depth isn't written under a terrain depth (that band is the
horizon's haze), and the eye is looked up from the sphere when below it
(since replaced: the ray from an eye below the sphere is marched to where
it leaves the sphere and the table taken from there; composition.md, "The
tables' domain").
Parity views `mars-low-horizon` and `mars-low-horizon-band`.

**Mars's near ridges** (found on the preview): a seam ran through near
terrain at the sphere's horizon, as if the far horizon showed through the
ridge (from 4.4 km, one row on the line: T 0.754 and sky 0.156 against
0.829 and 0.111 a row away), and low over Mars the near ground had no
haze.  The pass had cut the table's in-scatter and depth at the surface;
the table's rays end at the sphere or the top, sky above the line and
ground below.  The surface's segment is now marched (composition.md): on
that row T 0.826 and sky 0.116, smooth.  Not Cesium's alpha: the decode
draws every body opaque.  And every Cesium body now takes one path
(CESIUM.md, architecture).
