# Volumetric clouds up close

Earth's clouds from inside the atmosphere (#169, under #111): where the
far-field cloud shell (#88, [Planet.md, clouds](../Planet.md#clouds)) fades
out on the way down, a ray-marched cloud layer takes over, seeded by the
same day's NASA GIBS coverage map, so the volumes stand where the satellite
saw cloud.  Lit by the Sun through the atmosphere's transmittance, by the
sky's diffuse light from the atmosphere's multiple-scattering table, and by
their own multiple scattering, in exposure units, and composited by the
atmosphere pass in its aerial perspective.  Code: `js/scene/clouds/`
(`CloudVolume.js` the pass, `cloudPhysics.js` the model, `cloudNoise.js`
the noise, `cloudPhase.earth.json` the droplets' phase function from
`tools/clouds/miePhase.mjs`).

## What it draws

- **One layer, Earth's low clouds**, from 800 m to 2.4 km over the ground
  sphere (`EARTH_LAYER`), with convective towers to 9 km where the map's
  cloud is thickest (below).  WMO's low clouds have bases from the ground
  to 2 km: marine stratocumulus at 0.5-1 km with tops at 1-2 km, trade
  cumulus from 0.6 km to 2-3 km; a cumulonimbus tops out at the
  tropopause, 8-12 km in middle latitudes (WMO International Cloud Atlas).
  Middle and high cloud (altostratus, cirrus) is not drawn: the map can't
  tell it from low cloud (Follow-ups).
- **Where the map says.**  The coverage map (`CloudMap`: the day's GIBS
  true colour unmixed over the Blue Marble, 16 km a texel) is the seed.
  At a sample, the map's coverage c thresholds a tiling 3D noise: cloud
  where the noise exceeds 1 − c.  The noise's distribution is equalised
  (`cloudNoise.equalize`), so the share of the volume over the threshold
  is c itself: a texel of coverage 0.4 is 40% cloud, as the shell drew it,
  and the hand-off between the two keeps the sky's cloud.  The noise is
  Schneider & Vos's Perlin-Worley (SIGGRAPH 2015, "The Real-Time
  Volumetric Cloudscapes of Horizon Zero Dawn"): a 128³ shape texture
  repeating every 24 km (Perlin dilated by Worley billows, and Worley at
  three frequencies) and a 32³ detail texture every 1.5 km, whose Worley
  erodes the edges, wispy at the base and billowy above.  Built in JS a
  slice a frame within a 6 ms budget (about a second of CPU on a laptop,
  three here), so the shell holds until they are in, then eases over to
  the volume in 1.5 s (`readiness`).
- **Type from the map's thickness.**  The map carries no cloud height, so
  the coarse coverage (its 128 km mip) picks the convective share: where
  the large-scale coverage is near 1 (thick, bright cloud over a wide
  area: a front, a storm), the layer's top rises toward the tower height
  in the columns where the shape noise is strongest, with the cumulus's
  denser water; elsewhere it is stratiform, flat-topped.  GIBS's cloud-top
  height and infrared products would seed the heights properly
  (Follow-ups).

## The model

Every constant is physical and cited; the look follows from them.

**Extinction** from the liquid-water content and droplet size, σ = 3·Q·LWC
/ (4·ρ·r_eff), Q the extinction efficiency, 2 for droplets much larger
than the wavelength (the extinction paradox; the Mie computation gives 2.09
at 10 µm): stratocumulus at 0.3 g/m³ and 10 µm is 45 per km, cumulus at
0.7 g/m³ and 12 µm 90 per km (`extinctionCoefficient`, `CLOUD_TYPES`;
Stephens 1978, J. Atmos. Sci. 35, 2111; Miles, Verlinde & Clothiaux 2000,
J. Atmos. Sci. 57, 295; Han, Rossow & Lacis 1994, J. Climate 7, 465;
Warner 1955; Lawson & Blyth 1998).  Water absorbs nothing in the visible
(Hale & Querry 1973): single-scattering albedo 1.

**The phase function** is Mie's, not a guessed lobe: `tools/clouds/miePhase.mjs`
runs Bohren & Huffman's BHMIE over a gamma distribution of droplets
(r_eff 10 µm, v_eff 0.1, Hansen & Travis 1974's cloud C1) at 550 nm, and
tabulates it at every half degree (`cloudPhase.earth.json`): asymmetry
0.866, the forward diffraction spike, the flat side, the fogbow at 138°
and the glory at 180°.  Two or three Henyey-Greenstein lobes were tried
and can't hold the side fall, the fogbow and the glory at once (half or
double at 30°, 90° and 138°); the table costs one texture read per ray.
**Delta-M** (Wiscombe 1977): the diffraction peak, 44% of the scattering
within 4°, is taken as unscattered, so the march's extinction is
σ·(1 − 0.44) and the phase function the peak-less remainder, renormalised
(asymmetry 0.76).  Half of a large droplet's extinction is diffraction,
so a cloud's beam penetrates twice as far as Beer's law with the full
extinction says; the ground seen through thin cloud keeps the light
diffracted by a degree or two, a blur the march doesn't draw.  The
fixture also holds the angular shapes of the scattering orders (the
k-fold spherical convolutions, Legendre coefficients to their k-th
power), unused for now (below).

**Multiple scattering** is the delta-Eddington field of the local column
(Joseph, Wiscombe & Weinman 1976, J. Atmos. Sci. 33, 2452; Shettle &
Weinman 1970): a conservative slab under a collimated beam has, with ω = 1,
a closed-form two-stream solution, F↑ − F↓ = E(e^(−τ/μ₀) − T) and F↑ + F↓
linear in τ plus the beam's exponential (`eddingtonSlab`: T = [1 +
e^(−τ*/μ₀) + (2γ + 3g/2)μ₀(1 − e^(−τ*/μ₀))] / (2 + 2γτ*), γ = 3(1 − g)/4,
in the delta-Eddington scaled τ and g).  At each sample the march takes
the diffuse intensity I₀ + μ I₁ of that solution, at the sample's depth
into a slab of the local column's optical depth (the Sun-path depth from
the light steps projected to the vertical, and the depth to the base from
the local density), scattered toward the eye as I₀ + g μᵥ I₁
(`eddingtonSource`), with the exact single scattering of the direct beam
by the Mie table on top.  Why not Wrenninge's octaves (Wrenninge, Kulla &
Lundqvist 2013; Hillaire 2016), the usual game method: calibrated against
the two-stream slab they can't follow it over two decades of τ (the top a
third too dark where the base was 2.5× too bright, or non-conservative;
the first cut tried them, with the convolved orders as each octave's
shape).  The Eddington field is what climate models use for cloud
radiative transfer, and `cloudPhysics.test.js` integrates the march's
model over a homogeneous slab: a thick slab (τ 10-50) reflects what the
slab's own R says to within 5% from above and passes what its T says to
within 6% from below (the diffuse source scaled by 0.97,
`EDDINGTON_SOURCE_SCALE`, for the Eddington intensity's boundary excess);
a wisp (τ 0.5) is single scattering.  A stratocumulus of τ 20 reflects
0.63 under a high Sun, as observed (Stephens 1978: about 0.65), where
single scattering alone gives 0.08.  The known limits: the Eddington
approximation passes a little too much of a thick slab, the beam from a
low Sun is the vertical beam's flux solution under the slant path's
optical depth, and the column's depths are estimated from the light
steps and the local density, not integrated.

**Light.**  Per unit of the Sun's irradiance at the top of the atmosphere:
the Sun's transmittance through the air to the ray's entry into the layer
from the atmosphere's transmittance table (red at sunset, zero past the
terminator), times the single scattering and the Eddington source (the
latter per unit of the beam's flux on the slab, so times μ₀); plus the
diffuse light from outside the cloud: from above, the Ψ(h, μ_s) of the
atmosphere's multiple-scattering table ([composition.md](composition.md#multiple-scattering):
the isotropic radiance from the sky and the sunlit ground at that
height, 0.03-0.05 per steradian at a Sun 30° up) through the slab's
diffuse transmittance of the optical depth above the sample; from below,
the ground's reflection (the body's albedo, Lambertian) of what the whole
column passes (its Eddington transmittance, times the beam's flux)
through the depth below.  Under an overcast the ground is in the cloud's
shadow, not the Sun's: the first cut lit cloud bases from below with Ψ,
which holds the sunlit ground, and scaled Ψ by the drawn sky's gain over
the physical (4.5 for Earth), and a thick overcast came out sky-blue at
three times the light its transmittance allows.  The drawn sky's gain
stands for the look of the sky's radiance, not for the irradiance it
delivers.  The march writes
radiance per unit irradiance; the atmosphere pass multiplies by the
irradiance times the exposure (`uCloudExposure` = `uSkyExposure` ×
π·`DISPLAY_GAIN`, [HDR.md](../HDR.md#the-sky-in-exposure-units)), so a
cloud top is in the same units as the ground and the sky, metered with
them.

**Ground shadow.**  For a pixel whose ray reaches the ground, the cloud's
optical depth along the Sun's path up through the layer from that point
(6 coarse samples), and the ground's irradiance under it is 1 − 0.85·(1 −
T(τ)) of the clear-sky value (`groundUnderCloud`): the direct beam's share
of a clear day's light, 0.85 (Iqbal 1983), through the slab's
transmittance, with the sky's share untouched.  The shell's `SHADOW_STRENGTH`
0.6 is close to the volume's for a thick cloud (0.85 × 0.8 = 0.68), and
the two blend across the hand-off band.

## In the air

The volume renders into a target of its own (two half-float textures: the
premultiplied radiance with the transmittance in alpha; the mean distance
along the ray and the ground shadow), and the atmosphere pass composites
it under `#if CLOUDS`, compiled in only while a volume was drawn
(`ThreeUi._setCloudComposite`):

    sky = S(eye → cloud) + T(eye → cloud) · cloud + Tc · [S(whole ray) − S(eye → cloud)]
    scene · (1 − shadow) · T(whole ray) · Tc

The near part is `marchSegment` to the cloud's mean distance (4-16 steps
by its optical depth, as the ground's); the far sky is the whole ray's
less the near part's, the same integrator's, so no transmittance is
divided out.  So a cloud 2 km up seen from the ground has the air to the
cloud over it and the sky beyond it through its transmittance, where the
shell, drawn into the scene buffer with no depth, could only be hazed as
the ground 6 km under it ([composition.md, clouds](composition.md#clouds)).
Rays from an eye under the ground sphere (the Dead Sea) skip it.

## The hand-off

The shell's far field ends between 30 km over the deck and 10 km
(`CloudShell.FAR_FIELD_FADE_M`).  With the volume ready the band is in two
halves: through the upper half the volume comes in over the whole shell
(`volumeShare`), and through the lower the shell fades out from under it
(`shellOpacity`), so where both are cloud the sky stays cloud.  Fading
both at once over the band, the first cut, composited the volume over a
half-faded shell over the sea, and the band's middle came out a quarter
darker than either end (the linear composite's mean over a cloud-covered
frame at 20 km: 0.58 against the shell's 0.84 and the volume's 0.67).
Above the band the volume is not rendered at all: no target, no GL call
(`CloudVolume.render` returns before any), and `CLOUDS` is 0 in the pass.
Below 10 km the shell is gone and the volume whole.  Without the volume
(its textures not built yet, `?clouds=off`, the LDR fallback) the shell
fades over the whole band as before.

**Both sides of the Cesium swap.**  The volume reads the scene's depth
(celestiary's sphere, or Cesium's ground sphere and terrain) and draws
over whichever is there, as the shell does; `yarn parity`'s
`earth-clouds-volume` view compares the two renders at 12 km over the
Gulf on Katrina's day (CESIUM.md, parity check).  The script builds the
noise textures at once (`CloudVolume.finish`) rather than within the
frame loop's budget.

## Cost

- **Nothing when it can't show:** above 30 km over the deck (the shell's
  far field), before the textures are built, in the LDR fallback, with
  `?clouds=off`, or with the atmosphere pass off.
- **The march at half the frame's size** by default (`?clouds=full`,
  `quarter`), at most 80 samples a ray: coarse steps of 80 m to 1 km on the shape alone
  through clear air, fine steps (a quarter, at most 60 m: 1.5 of a
  stratocumulus's optical depth) with the detail noise through cloud,
  backing up a coarse step on contact (Schneider & Vos), and out at a
  transmittance of 0.005, where the ray is taken as opaque (the Sun's
  disc, 1e9 of a sunlit white, showed through the remainder).  A ray
  along the horizon reaches 80 km, past which the air has hazed the
  clouds over.  Each cloud sample costs 5 light samples of the
  shape toward the Sun.  Rays that miss the layer, or hit the ground
  before it, cost a sphere test.
- **Temporal reprojection:** the march's start is jittered each frame
  (interleaved gradient noise over 8 frames), and the previous frame's
  target is reprojected through the camera's motion in the body frame
  (the cloud's mean distance, the previous eye and rotation) and blended
  in at 0.9 where it lands inside the frame and agrees on the distance
  (fading out as the distances differ by 10 to 30 %), so a still view
  converges over about 20 frames and a moving one keeps
  most of its history (`?clouds=notemporal` for the raw march).
- **Measured** on SwiftShader (headless, 640×400, `?perf=sync&barrier=read`:
  wall time per pass with the GPU waited for; a CPU's emulation, so
  relative only).  Over the Gulf on Katrina's day, the mean over the
  frames each pass ran:

  | View | `clouds.volume` | `atmosphere` | `scene` | `clouds` (shell) |
  |---|---|---|---|---|
  | 6 km, oblique, half size (default) | 317 ms | 100 ms | 115 ms | 17 ms |
  | 6 km, oblique, `?clouds=quarter` | 82 ms | 120 ms | 145 ms | 21 ms |
  | 12 km, straight down, half size | 470 ms | 162 ms | 200 ms | 34 ms |
  | 60 km (shell only; the volume doesn't run) | 0 | 171 ms | 148 ms | 26 ms |

  The half-size march costs about three atmosphere passes on this
  emulation; the quarter-size one 0.7 of one, at the price of a blockier
  cloud edge.  Above the hand-off band, and with `?clouds=off`, the frame
  is unchanged from `main` within the run-to-run noise.  On a real GPU the
  half-size march of a cloud-filled frame at 1470×837 is 300k rays × up to
  80 samples × (2 3D-texture reads + 5 light samples): the expectation is
  single-digit milliseconds at half size and under 3 ms at quarter, to be
  measured on the user's M2 with the `?perf=1` overlay's `clouds.volume`
  row (#189).

## Other bodies

The renderer is parametrised by `cloudPhysics.BODY_CLOUDS`: the particles'
phase function (a fixture from `tools/clouds/miePhase.mjs`, which takes the
particle size and index), the layers' heights and extinction, the
single-scattering albedo per channel, and what seeds the coverage.  Only
Earth is enabled.  The others are recorded there with their data and
sources, and what stands in the way:

- **Venus**: the three H₂SO₄ cloud layers of Pioneer Venus (Knollenberg &
  Hunten 1980), r_eff 1.05 µm droplets of index 1.44 (Hansen & Hovenier
  1974; Mie asymmetry about 0.72), τ ≈ 29 in all, the UV absorber
  darkening the blue.  Full cover: the seed is the texture itself, which
  is the deck's top, so the hand-off is from texture to volume, with the
  UV markings as the coverage's modulation.
- **Titan**: its haze is the atmosphere pass's aerosol, refitted to
  Huygens' DISR in #218, not a cloud deck; what this renderer would draw
  are the sparse tropospheric methane clouds (10-40 km; Griffith et al.
  2005), for which there is no map.
- **Jupiter** (and the giants, #41): the ammonia-ice cloud tops near 0.7
  bar, 0.5-1 µm particles (West, Strobel & Tomasko 1986; Sromovsky & Fry
  2010), with chromophores darkening the blue; the texture is the cloud
  top, so the seed is the colour map as the deck's top, on the parametric
  renderer #41 builds.

Each needs its Mie fixture (the tool takes the size, variance and index),
its layers, and a hand-off from its surface texture, which draws the
cloud top already, to the volume, which #41's parametric giants will
define.

## Follow-ups

- **Heights from data:** GIBS's cloud-top height and brightness
  temperature products would set the layer's top per texel, and tell
  cirrus from stratus; today the map's thickness picks the convective
  share.  Cirrus (ice, τ of a few tenths at 8-11 km) is the next layer.
- **Depth-aware upsampling** of the half-size target at cloud edges
  against the ground and the sky (bilinear now), and the history's
  rejection by colour as well as distance (ghosting after a fast time
  change).
- **The Eddington field's limits** (above): a low Sun's slant through the
  slab, and the column's depths integrated rather than estimated.  The
  scattering orders' shapes in the fixture could carry the angular
  distribution of the first few orders (a backlit cumulus's silver
  lining), which the Eddington field has isotropic plus a tilt.
- **The forward peak** the delta-M removed: the aureole round the Sun
  through thin cloud, as composition.md draws Mars's dust's.
- **Shadows on the shell's side** of the band and the shell's 6 km height
  against the volume's 0.8-2.4 km: a shift of the ground shadow's offset
  across the hand-off at a low Sun.
