# Atmosphere composition: what the post-process pass actually does

Bruneton's precompute (see `BRUNETON.md`) gives us per-frame access to two LUTs:
- `tTransmittance` — fraction of light surviving a column at `(r, μ_v)`
- `tInScatter` — light scattered into a ray at `(r, μ_v, μ_s)`

This doc covers what the fullscreen post-process does on top of those samples
to compose the final pixel — the artistic/perceptual rules that turn
physically-correct radiance into something that reads as sky from any
viewpoint, day or night, surface or orbit.

## Composition equation

Final pixel = inscatter (sky color) + scene background (stars, surface, etc.)
attenuated by transmittance, tone-mapped once:

```glsl
sky = scattered * uSkyExposure;                     // exposure units
gl_FragColor.rgb = neutralToneMap(sky + scene.rgb * transmittance)
```

For a pixel whose surface lies inside the atmosphere (celestiary's own
ground, and Cesium's terrain, which rises above the sphere and sinks below
it), the sky is the air between the eye and it: single scattering and
transmittance marched along that segment (4 to 16 steps by its optical
depth, each step's sunlight through the transmittance table; [the march's
cost](#the-marchs-cost)), as the in-scatter table integrates its
rays (`marchSegment`), from the camera where it is.  The tables stay for
sky pixels.  The first cuts of #141 cut the table's in-scatter and depth at
the surface instead (Bruneton's `S(eye) − T·S(P)`), but the table's ray
ends at the sphere or the atmosphere's top wherever the surface is, and the
table is linear in `mu`, coarse at the horizon: a seam ran through near
terrain at the sphere's horizon (sky rays above it, ground rays below, the
far horizon's haze showing through the ridge), the ground under a camera
low over Mars got almost no haze, and terrain below the sphere was hazed
as if at the sphere.  Celestiary's own ground takes the same march, so the
look is one on both sides of the swap.  (Cesium's distance reaches the pass
as depth from below 20 km, `cesium/distance.js`; above, the sphere's depth.)

Where the ray meets the sphere but nothing was drawn (a gap in the
ground: the band between Cesium's Mars's horizon, under its datum, and
the sphere's), the pass draws the in-scatter of a ray at the horizon.
The table's lookups keep a sky ray in its sky rows and a ground ray in
its ground rows: at the horizon the filter blended the brightest
in-scatter with the dimmest, and that band came out darker than the sky
above it.

## The night sky's own light

The pass also draws the night sky's diffuse light ([HDR.md, the eye and
extended light](../HDR.md#the-eye-and-extended-light), #186), in the HDR
path only, each part pre-exposed (times `uExposureRelative`):

- **From beyond the air** (`nightBeyond`): the zodiacal light
  (`nightSky.js` `zodiacalLight`: `uZodiacal`, ZodiacalLight.js's cached
  target, the dust cloud integrated from the camera, S10⊙ × 1e-3, and
  `uZodiacalScale` to exposure units) and the galaxy's march (`uGalaxy`,
  MilkyWay.js's cached target, unexposed × 1e8), both at the frame's
  screen coordinates, where the scene's depth is at or behind the galaxy's far-plane
  depth (0.99995): behind every body, under the stars, where the galaxy
  was drawn in the scene pass before.  From the ground (a near plane of
  100 m) every body past ~4,000 km has a depth past that pin (1 − n/d), and
  the night sky's light was added over the Moon and the planets: in an
  eclipse, the zodiacal light's core across the Moon's dark disc.  The
  threshold is now the larger of the pin and a body's depth at 10¹³ m
  (`nightSkyDepth`), so any depth a body wrote is a body ([Sun.md,
  eclipses](../Sun.md#eclipses)).  It goes through the transmittance as
  the scene does, so it is extinguished toward the horizon and gone in a
  gap.
- **Airglow** (`airglow`): the layer's path along the ray (`airglowPath`:
  the chord through a shell 10 km thick at 90 km, which is the van Rhijn
  factor from below and finite at the limb from orbit, cut where the ray
  meets the ground or the surface it ends on), times its zenith light; the
  crossing beyond the ray's closest approach to the planet's centre (all of
  it, from under the layer) through the transmittance.  `uAirglow` holds
  the layer's radii, its zenith value and 1 / its thickness, from the
  body's `atmosphere.airglow`; zero for a body without.

The meter reads them as light (`uDebug` 7: the composite plus the night
sky's light); the display gets the eye's response to them, added over the
tone-mapped composite in display values (`extendedToDisplay`,
`displaySum`): `min(N(sky + scene·T) + N(G·grey(night)), 1)`.  Where the
pass runs without an atmosphere (deep space, the hard kill-switch) the
night sky's light from beyond is drawn the same way, over the scene.  The
LDR fallback draws none of it: its galaxy is in the scene pass, as before.
Where its brightest possible contribution is under half a screen step (by
day, to early in civil twilight) none of it is drawn and neither cache is
rendered (ThreeUi `_updateNightSkyShown`), nor where the ground fills the
view; and then its code isn't in the pass at all (`#if NIGHT_SKY`).

## Eclipses

The sun's intensity (`uSunIntensity`, the body's sky gain) is scaled by
what the camera, in the air, sees of the Sun past bodies other than the
air's own, plus what the sunlit air outside the shadow scatters in:
`eclipse.js` `eclipsedSky`, 6e-5 of the day's in totality, which puts the
zenith over Dallas on 2024-04-08 at the measured 13.1 mag/arcsec²
([Sun.md, eclipses](../Sun.md#eclipses)).  One factor for the whole sky,
from the camera: the sunset glow round the horizon in totality (the air
there is outside the shadow) needs the shadow sampled along the rays, a
follow-up; and from space the shadow on the air isn't drawn.

## Clouds

Earth's cloud shell (#88; [Planet.md, clouds](../Planet.md#clouds)) is in
the scene buffer before the pass runs, drawn over the ground as
premultiplied-over colour 6 km above it, and writes no depth.  So the pass
needs nothing of its own for clouds: a cloud's pixel reads the ground's
depth behind it, and is hazed as that ground, `sky + (cloud over ground) ×
T`, which from orbit (the shell's range: it's gone below 10 km) is the
cloud's own haze to within 6 km of air.

The volumetric clouds up close (#169; [clouds.md](clouds.md)) are the
pass's own: they render into a target of their own, and under `#if CLOUDS`
(compiled in only while a volume was drawn this frame, ThreeUi
`_setCloudComposite`) the pass composites them in the air: the segment
marched to the cloud's mean distance (`marchSegment`, as for the ground),
the cloud through that air, and the sky beyond the cloud through the
cloud's transmittance, that far sky being the whole ray's in-scatter less
the near segment's; the ground under the cloud takes its shadow.  So a
cloud seen from below the deck has the air to it and the sky past it,
which the shell can't ([clouds.md, in the air](clouds.md#in-the-air)).  With
no volume drawn the pass is as it was.

## The ray's end

The pass reads where each pixel's ray ends from the scene's depth: the
distance `tMax`, and the depth buffer's step there as its error,
`tMaxErr = tMax² / near · 2⁻²³` (`rayEnd.js` replays both in float32).
Four cases: nothing drawn (`background`, the cleared far plane: sky); a
body past where the ray leaves the atmosphere (`pastAtmosphere`: the
table's whole ray, as the sky has); a surface inside the air seen from
inside it (`shortRay`: the march to it); and from outside, the ground (the
table's ray to it).

**A ray meets the atmosphere only ahead of the eye** (`shellAhead`,
rayEnd.js, shared with the shader as `SHELL_AHEAD_GLSL`): `rsi` gives the
two distances where the ray's *line* crosses the shell, and from outside
the air, looking away from the planet, both are behind the eye.  The pass
took any crossing (`pAtm.x <= pAtm.y`) for a hit, from #55 on, so it drew
the planet's air mirrored through the eye: the entry clamped to the eye,
far above the table's top, a sky ray's in-scatter.  That was the "blue
Earth" the user saw on an M2 (`#sun/earth@10.0742,-72.1987,4.606397Mm;…`):
looking toward the Sun from over Earth's day side, Earth behind the
camera, a flat, hard-edged blue disc where Earth would be in a mirror,
with no land or clouds, since Earth itself was behind; from 222 km the
mirrored shell filled the frame, deep blue down to a black band (the rays
past the mirrored limb).  At the keyed exposure the ghost is about 1e-6
of a sunlit surface, invisible; the metered exposure (#86's PR B, PR
#153) made it a saturated blue: with nothing sunlit in the frame the gain
rises toward the dark sky's (×7e4 here), and the ghost was what it lifted.  The geometry draws nothing there (three
culls Earth, behind the near plane), so the Cesium layer and the surface
textures were never involved.  The pass's march (`scatter`) already gave
nothing there: its step, `p.y − max(p.x, 0)`, is negative.

**From inside, a body is past the air unless its depth puts it surely
inside**: `tMax + tMaxErr` short of the exit.  From outside, it is past
only when surely past, `tMax − tMaxErr` beyond the exit, so the planet's
own limb, seen from afar through coarse depth, stays ground.  The reason
is the near plane: from the ground it is metres (`dynamicNear`, 100 m at
156 m up), and the 24-bit step at a distance z is z² / near · 6e-8, so a
planet hundreds of Gm off lands on the far plane itself or a step or two
under it, where the distance is noise.  Jupiter from Earth's surface (8.8e11
m) writes the far plane on most of its disc and one step under it on the
rest, which reads 1.5e9 ± 3.4e9 m.  With the old test (past only when
surely past) those pixels were short rays: a 16-step march of 1.5e9 m,
its first sample 4.7e7 m out, found no air, so they showed Jupiter with no
extinction where the rest of the disc had it, in white dashes along the
depth's rounding contours (concentric arcs round the point nearest the
camera, fixed to the planet under zoom).  On SwiftShader 1% of the disc
at 0.01° (531 of 53,304 px); on the user's M2, whose depth rounds
differently, enough to cover it in dashes.  Above the atmosphere they went
away: the camera is no longer inside, and the near plane is km.  The
Moon (4 steps under far from the ground) was already past; Saturn's disc
had the same dashes (43 px).

## The tables' domain, and rays that start outside it

The tables cover the shell between the ground sphere (`rG`, the body's
radius) and the atmosphere's top (`rA`).  The pass composes every ray from
one rule: **the part of a ray outside the shell is integrated by the pass
itself, and the table takes over where the ray enters the shell.**  From
orbit that is the ray's entry at the top (`entryPos`, as it always was).
From an eye **below the sphere**, which Cesium's terrain allows (Valles
Marineris is 4-7 km under Mars's datum, the Dead Sea 430 m under Earth's),
it's the segment from the eye to where the ray leaves the sphere, marched
(`marchSegment`), then the table from that point: there the ray points
outward, a sky ray with `mu ≥ 0`, well inside the sky rows.  Its
in-scatter is the march's plus the table's through the march's
transmittance, and its transmittance the product.  At the sphere itself the
segment vanishes and the two cases meet.

**The Sun behind the planet, at a march's sample**, is the Sun under the
sphere's horizon there (`rayEnd.js` `sunBelowHorizon`): its zenith cosine
under −√(1 − R²/r²), taken from (r − R)(r + R); under the sphere, under the
local horizontal.  It was whether the ray to the Sun meets the sphere ahead
(`rsi`), whose near hit within a metre of the sphere is float32 noise: from
an eye under the sphere (Manhattan, ~30 m under Earth's), the samples where
the rays cross it took a Sun 33° down for up, and the night air showed
speckled blue bands (CESIUM.md, "New York", found on a real GPU).  The
precomputed tables still use `rsi` at their own samples.

Nothing is moved to make that work.  #141 had lifted the eye to the sphere
and looked up from there, which put the eye's horizon within float32 noise
of the rays clamped to it (below), and those flickered black on a real GPU
(the user's screenshots: a black band at the horizon on Mars and a black
wedge at the Dead Sea, "flickering horizon issues").  Nor is the table's
ground lowered to a body's deepest terrain: from orbit the table's rays
would then run 8 km past the real sphere through the densest air, tripling
Mars's disc haze unless cut, which is the cut #141 rejected.  Nor is the
atmosphere measured from the terrain under the camera (`rG` lowered by the
ground height there): the sky would then change with the ground under the
camera, a cliff edge away.

Surface pixels take the march from the eye where it is, as before (above).
Heights below the sphere count at the sphere's density, as the tables do: a
ground mesh's faces sag inside its sphere, and `e^(−h/H)` below it doubled
the haze from 37 km (#141); physically the air under a datum is denser, by
about `e^(δ/H_pressure)`, 1.8× at the floor of Hellas, but the Mie scale
height is a look, not the pressure's, and would give 10×.  A knob for
later.

**Which side of the horizon a table lookup is on is decided once, from the
ray's geometry** (`underHorizon`: from above the sphere the ray meets it
ahead; from below, it heads down into it), and passed to the encode.  The
encode used to decide for itself by comparing `mu_v` with the horizon's
cosine recomputed from `r` (`r² − rG²`, which loses most of its bits a
metre over a 3,000 km sphere), so a ray clamped to the horizon could land
on either side from one frame to the next.  The ground side of the ground
slice is zero, so that was the black: 0.006° to the ground side of the
clamp, the band's in-scatter drops from 2.14 to 0.06 (SwiftShader rounds
the other way, and shows the haze; the user's GPU doesn't).

**Gap pixels** (nothing drawn where the ray goes under the horizon: holes
in a ground mesh; the band between Cesium's terrain's horizon, under the
datum, and the sphere's) get the horizon's haze, the ray clamped to the
horizon as a sky ray, with no transmittance.  From below the sphere the
clamp is to the horizontal ray from the eye, which leaves the sphere where
the horizon ray from just above it would: the limit as the eye crosses the
sphere.  A body beyond the atmosphere seen under the sphere's horizon (the
Moon over the Dead Sea's far shore) takes the same horizon ray, with its
transmittance.

**The march integrates each step exactly** for its density
(`stepIntegral`, shared with the in-scatter precompute): the sunlight
reaching the step, through the ray's transmittance so far, times
`(1 − e^(−σ·ds)) / σ`.  Summing `e^(−τ)` at the end of each step, as both
did, lost 11% of each step at Mars's horizon (the table's 5.8 km steps at
ground density) and a third of a 280 km ground-level segment's; from below
the sphere a segment to the sphere's exit is 66 km at the sphere's density
for an eye 658 m under it, and a step of that lost most of its light.

## The march's cost

[#189](https://github.com/celestiary/web/issues/189).  On the user's M2
(the overlay's sync mode) the pass cost 7.5 ms looking down at Earth's
ground from 7.5 km, 3.7 ms at the day sky and 1.1 ms from 20 Mm.  **The
difference is the segment march** (`marchSegment`): a sky pixel, and the
disc from orbit, is one in-scatter lookup (four fetches) and one
transmittance fetch; a pixel whose ray ends on the ground inside the air
was 16 steps, each with two fetches (the Sun's transmittance and Ψ), a
ray-sphere test and, for the delta-M pair (the dust's narrow lobe), six
`exp` of three channels.  Looking down every pixel marches; at the day sky
a third do (the ground under the horizon); from orbit none.  On
SwiftShader (960×600, timings relative only: a CPU's emulation, on a loaded
machine, interleaved rounds), the pass looking down took 931 ms and 328 ms
with the march's loop emptied: two thirds of it was the march.  Not the
night sky's code (it isn't compiled in by day or with the ground filling
the view), not the depth reconstruction (the same for every pixel), not
the table lookups.

Three changes, the picture unchanged:

- **The step's density is its mean over the step** (`meanDensity`), from
  the density at its two ends with the height taken as linear along it,
  `(d0 − d1)/a` for `a = Δh/H`: exact for a straight step, where the
  midpoint's density under-counts a step down through the haze by
  `a²/24` (10% for a step of 1.5 Mie scale heights).  With the step's
  extinction integrated exactly for that density (`stepIntegral`), a
  step's in-scatter for one species is exact whatever its length, so the
  count no longer has to resolve the haze's scale height.
- **The step count follows the segment's optical depth, not its length**
  (`segmentSteps`): an upper bound, the extinction at the segment's lowest
  point (its end, or the ray's closest approach to the centre inside it)
  times its length in the bluest channel, one step per 0.1 of it
  (`SEG_STEP_TAU`), from 4 (`SEG_STEPS_MIN`) to 16.  From 7.5 km over
  Earth (3.8e-5 per metre at the ground in the blue) the bound is 0.29
  straight down and 0.40 at 45° (4 steps), 1.1 for ground 30 km off (12);
  along the ground to the horizon, and under Mars's datum, it stays 16.  Two steps
  at the least moved twilight's ground by 3 of 255 (the shadow's edge in
  the air sampled too coarsely); four keep it within 1.
- **The delta-M half only where there is a narrow lobe** (`#if
  MIE_PEAK`, set per body from `miePeakWeight`, as `NIGHT_SKY` is): for
  Earth the scaled and true transmittances are one, and the march computed
  both.

Measured in headless Chromium (SwiftShader, Cesium's layers off, the gain
pinned, clouds off), the old march put back into the same page as a
variant of the shader, so both render the same frame:

| View | Pixels marched | Display, old → new: max difference (of 255), pixels over 1 | Pass time, median of 10 interleaved rounds, old → new (960×600) |
|---|---|---|---|
| Earth's ground from 7.5 km, looking down | 100% | 1, none | 931 → 462 ms (no march: 328) |
| The day sky from 7.5 km, facing the Sun | 34% | 1, none | 377 → 356 ms |
| Twilight from 3 km (`earth-twilight-metered`) | 100% | 1, none | 827 → 498 ms |
| Earth from 20 Mm; the night side from 4 Mm and 400 km | 0% | 0 | unchanged |
| The ridge from 6.5 km, Mars's ridge from 4.4 km | 36%, 45% | 1, none | |
| Mars from 232 m, from 658 m under the datum (antisolar, aureole), the Dead Sea | 63%, below the sphere | 1, none | |

Looking down, the march is 4.5 times cheaper (603 → 134 ms over the
pass with no march); by day the sky's marched pixels are long rays near
the horizon, which keep their 16 steps.  Against `main`'s build at the
permalink's instant (`meter189-evidence/atmos`) the same views differ by
at most 1 of 255, but for the ridge views, whose terrain had loaded in one
run and not the other.  The user's M2 is the measure: the pass's `wall`
looking down should fall from 7.5 ms toward the day sky's.

**Not done, and why.**

- **Half-resolution in-scatter**, depth-aware upsampling: the ground's
  haze is smooth, but at every silhouette (a ridge against the sky, the
  horizon) the two sides differ by the sky's whole brightness, and an
  upsample there costs more than 1-2 of 255 on the edge pixels, which is
  where the eye looks.  With the march at 4-7 steps the saving is a few
  ms at most.
- **A precomputed aerial-perspective volume** (Hillaire 2020's camera
  froxels, 32×32×32 of in-scatter and transmittance per frame): the
  structural fix where a surface pass's per-pixel cost matters, a lookup
  in place of any march.  It is a new pass with its own resolution limits
  near the camera (a froxel 32 slices deep over tens of km is a few
  hundred metres: Cesium's terrain a few hundred metres off would take a
  coarse slice) and in twilight's shadow edge, and the in-scatter table
  stays for the sky.  Worth it if the pass is still a cost after this.

## Probing the pass

`uDebug` on the pass's material writes its intermediates instead of the
pixel, as raw floats, for a float render target: 1 the transmittance, 2
the sky (exposure units), 3 `(depthSample, tMax, flags)` with flags 1 gap,
2 beyond the atmosphere, 4 marched surface, 8 eye below the sphere, 16
under the horizon, 4 the in-scatter sample (Rayleigh rgb, Mie a), 5 the
ray's zenith cosine at the eye, the Sun's, and the eye's altitude; 7 the
linear composite before the tone map, the night sky's light in it, which
the metered exposure reads (ThreeUi `_meter`); 8 the night sky's light
alone (galaxy, zodiacal light, airglow, through the air), linear and
pre-exposed: divide by the exposure over Earth's keyed one for its
surface brightness.  In a
page: set it, render `ui._atmScene` with `ui._atmCamera` into a
`FloatType` target, `readRenderTargetPixels`.  Read a column of numbers
down a feature (the band at the horizon), not a picture: every cause in
#141 and here was found that way.  The intermediates (1 to 6) are written
only on rays that meet the air: a ray that misses it, or a frame with the
pass off, writes the tone-mapped scene there, so dividing a planet seen
from space by "transmittance" 1 divided it by its own display value (#192's
magnitudes).  Check the ray against the air, and take 1 where it misses.

`scene` is the linear HDR scene buffer, in exposure units (1.0 is a white
Lambertian surface lit by the Sun at the exposure target, before
`DISPLAY_GAIN`), and `scattered = uSunIntensity × LUT in-scatter`.
`uSkyExposure` carries the in-scatter to the renderer's exposure: the
Sun's irradiance at the planet times the exposure, over the
`π·DISPLAY_GAIN` that `exposure.js` normalizes a sunlit surface by
(`skyExposure`), so 1 when the planet is the exposure target.  This is the
standard single-scattering equation: forward-scattered atmospheric light,
plus attenuated background, then the display's one tone map (PBR Neutral).
See [HDR.md](../HDR.md) for the pipeline, the units and a worked number.

Before #86's PR A the scene buffer held display values (already
tone-mapped) and the sky was soft-saturated on its own,
`1.0 - exp(-scattered)`, and added to it.  The LDR fallback (no float
render targets) still composites that way, with `neutralToneMap(sky)` for
the sky.

The transmittance is used whole.  From an eye below the sphere, the march
takes the Sun as blocked wherever it is under the local horizontal
(`dot(pos, sunDir) < 0`): the table's rule, "the ray to the Sun meets the
sphere ahead", holds only from above it, and from below gave a Sun 47°
under the horizon a 200 m path to the ground, which lit the Dead Sea a
blue sky at midnight once the metered exposure lifted it.

## What the composite leaves to exposure, and what it still forces

The composite is the physical one: in-scatter plus the scene through the
transmittance, whole.  Two things used to be forced on it, and one still
is:

1. **Stars by day.**  The stars, the Milky Way and the Sun's disc are in
   exposure units (HDR.md, "Physical stars"): Sirius is a few 10⁻⁴ of a
   sunlit white surface, so the day sky, 0.1 to 0.5 of one, covers it by
   its light, and so does a sunlit Moon in view.  At twilight and at night
   the metered exposure (HDR.md, "Metered exposure") rises and they come
   through the physical transmittance (86% at the zenith from sea level).
   Before #86's PR B the stars were display values, and an
   "eye-adaptation boost" made the sky opaque wherever it was even faintly
   bright: a smoothstep on the sky's brightness, weighted by the camera's
   depth in the atmosphere, with a 0.08 transmittance floor so the night
   horizon still let starlight through, and #85's exemption of bodies
   beyond the atmosphere (the daytime Moon) and the ground.  All of it is
   gone.
2. **Sub-pixel rasterization gaps in the surface mesh.**  Earth's world
   position is ~1.5e11 m; float32 precision in the model-view matrix
   degrades to ~1 m, which produces sub-pixel holes at extreme close range.
   The depth buffer at those pixels reads "far" (sun, stars), and naive
   compositing leaks the background through where the surface should have
   covered.  Where the ray meets the sphere ahead of the recorded depth
   (`isGap`) the transmittance is forced to 0, so the hole shows only the
   in-scatter (bright haze by day, dark by night), which matches the
   surrounding surface and gives a crisp horizon edge whatever the mesh's
   tessellation.

## Multiple scattering

The tables are single scattering (BRUNETON.md): light scattered once out
of the Sun's beam into the ray.  The light scattered twice or more is a
second term, after Hillaire 2020 ("A Scalable and Production Ready Sky and
Atmosphere Rendering Technique", EGSR): from the second scattering on it
is taken as isotropic, so at each point it is one number per channel,
`Ψ(r, μ_sun)`, the radiance (per unit of the Sun's irradiance) the point
receives from all the higher orders.  `precomputeMultiScatter` makes it a
64×64 table from the transmittance table: at each (r, μ_sun) the
single-scattered radiance arriving from 64 directions, averaged (the
second scattering's uniform phase), with the sunlit ground's reflection
(the ground's albedo, [below](#the-ground-under-the-air)) where a direction meets the ground, over one minus
the average share of light leaving the point that is scattered again
before it escapes: the geometric sum of every order.  Along a ray the
in-scatter then adds `σ_s(x)·Ψ(x)` per metre through the ray's
transmittance, with no phase function: `precomputeInScatterMs` makes a
second atlas of it, laid out as the single-scatter atlas and read with
it (`sampleInScatter`'s `ms`), and the segment march adds it per step.
In the composition it is the third term of `scattered`.

What it does: Mars's dust (albedo 0.86-0.95) at optical depth 0.5 sends
most of its light round more than once, and the anti-solar sky, which
single scattering through a forward-peaked phase function leaves nearly
black (0.04 of a sunlit white surface at the zenith, 70° from the Sun),
fills in.  Earth's sky gains the same term; its gain (`sunIntensity`,
below) was re-fitted so its look held, and is now the physical one, its
aerosol in the data (Earth's air, below).  The approximation's limit is a
thick atmosphere (τ of several) or one whose multiple scattering is still
strongly forward: Venus, Titan.  There the isotropic sum under-counts the
forward glow: Titan's sky from the ground is a twentieth of what Huygens
saw (Per-body data).  An
aerosol's narrow forward lobe is taken out of the sum (delta-M; next
section).

## The dust's forward peak

Mars's dust grains (effective radius about 1.5 µm, three wavelengths)
diffract: about half of what they take from the beam goes into a lobe a
few degrees wide round the Sun, and that lobe is the compact, very bright
aureole Curiosity sees, white at the core after the tone map and bluish
for a few degrees (#188).  Two broad lobes can't make it: the data before
#188 drew a flat blue disc 18° across the zenith at midday, its core 9×
too faint.  A narrow lobe in the data alone fixed the core but turned the
far sky blue-grey: 64 directions per texel of the multiple-scattering
table can't resolve a lobe 3° wide, and the isotropic second scattering
spread its light over the whole sky.

**The phase function** has three lobes (Per-body data):
`P = f·CS(g_n) + (1 − f)·[w·CS(g) + (1 − w)·CS(g₂)]`.

| | red | green | blue |
|---|---|---|---|
| narrow lobe g_n (`miePeakPolarity`) | 0.919 | 0.931 | 0.944 |
| its share f (`miePeakWeight`) | 0.503 | 0.529 | 0.560 |
| broad forward lobe g (`miePolarity`) | 0.445 | 0.478 | 0.497 |
| back lobe g₂ (`mieBackPolarity`), weight 1 − w of the rest | −0.3, 0.21 | | |
| mean cosine | 0.636 | 0.669 | 0.700 |
| f × albedo (the delta-M share of the extinction) | 0.478 | 0.481 | 0.482 |

Fitted in log space to Mie scattering by spheres (Bohren & Huffman's
coefficients) over a gamma distribution of radii, r_eff 1.5 µm, v_eff 0.3
(Lemmon et al. 2004; Wolff et al. 2009; Chen-Chen et al. 2019 measure
1.0-1.9 µm at Gale), real index 1.50, at 650 / 550 / 450 nm, the
imaginary index solved per channel (0.0018 / 0.0030 / 0.0044) so the
single-scattering albedo is the data's 0.95 / 0.91 / 0.86.  Weights: 0.5°
to 90° from the Sun at 1, past 90° at 0.05, with the mean cosine held at
the old data's 0.635 / 0.669 / 0.70, within the 0.6-0.7 measured from
Mars (Tomasko et al. 1999; Pollack et al. 1995), and the back lobe held at
the old data's −0.3.  Spheres of that size have a mean cosine of
0.73 / 0.75 / 0.78: the diffraction peak depends on the grains' size, not
their shape, so it is fitted to Mie, but the side and back scattering of
irregular grains is flatter than spheres', so the measured mean cosine
holds there.  Against Mie the fit is within 10% from 0° to 20° (0.90 to
1.04), 0.83-0.91 at 30-60°, 1.25-1.31 at 90° and 2-3× at 120-150°, where
spheres have their side-scattering minimum, and 0.64-0.83 at 180°, under
the spheres' glory.  f × albedo is 0.48 in every channel: the diffraction
half of the extinction of grains much larger than the wavelength (f would
be 1 / 2·albedo, 0.53 / 0.55 / 0.58, for a pure diffraction lobe).  Scripts:
the session's `mars188-work/` (`mars188_fit.py`, `mars188_data.py`;
`mars-work/mars_mie.py` for the Mie code).

**Multiple scattering: delta-M** (Wiscombe 1977, J. Atmos. Sci. 34,
1408).  For the multiple-scattering precompute the narrow lobe's share is
taken as unscattered: light scattered into a 3° lobe travels on as if it
hadn't been.  The aerosol's extinction there is (1 − albedo·f) of the true
one (0.52 on Mars, nearly grey), its scattering (1 − f), and its phase
function the broad lobes (`miePhase`), whose mean cosine is 0.35-0.39, so
Hillaire's isotropic second scattering is a much better approximation
than with the whole phase function.  The delta-M beam (the Sun's light
after any number of scatterings in the narrow lobe) is what the gas and
the broad lobes scatter, so the in-scatter atlas's Rayleigh and a third
term, the broad lobes' extra single scattering of the delta-M beam over
the direct one (`tInScatterMs`'s a), use the scaled extinction too.  The
alternative, sampling many more directions near the Sun, doesn't help:
resolving the lobe takes thousands of directions per texel, and the
isotropic second scattering would still spread the lobe's light over the
whole sky, the blue-grey.  Delta-M with exact single scattering per pixel
is the standard remedy (Nakajima and Tanaka 1988, J. Quant. Spectrosc.
Radiat. Transfer 40, 51).

**Single scattering in the narrow lobe** is per pixel, exact: the
atlas's Mie (the direct beam, through the true extinction) times the
narrow lobe (`miePeakPhase`).  Its higher orders, light scattered two or
more times in the narrow lobe, make the aureole wider at a low Sun or a
dusty sky; the delta-M precompute counts them as the beam, so the pass
adds them: the k-fold convolution of a Henyey-Greenstein lobe of
asymmetry g is the lobe of g^k (its Legendre moments multiply), nearly so
for Cornette-Shanks, and the number of small-angle scatterings is
Poisson in the narrow lobe's optical depth τ_n on the light's path, so
the narrow lobe's term is the first order times
`Σ τ_n^(k−1)/k!·CS(g_n^k) / CS(g_n)`, up to 24 orders (`PEAK_ORDERS`;
τ_n capped at 12).  τ_n is the geometric mean of the view ray's (from the
delta-M and true transmittances, whose ratio is e^(albedo·f·τ_Mie)) and
the Sun's from where the ray enters the air (`peakDepth`): symmetric in
the two, as transmission is (reciprocity).  A plane-parallel emulation of
the method against a Monte Carlo of the same phase function (the
session's `mars188_emu.py`, `mars188_series.py`) chose it: the view's
slant alone is 3.6× too bright 90° from a high Sun, the Sun's 1.75× at
20° from a Sun 10° up; the geometric mean is within 11% everywhere from
0.5° to 60°.  Without the higher orders the aureole is 20-40% short 5-20°
out at τ 1 or a Sun 10° up.  The other form of the method, the whole
phase function on the delta-M beam (Nakajima and Tanaka's TMS), puts all
of the multiply forward-scattered light in the narrow lobe: the core 25%
too bright at a high Sun and 3× at 10°.

**Against the references** (the session's `mars188-evidence/`): the pass's
linear sky along the solar vertical at Gale (`uDebug` 2, red radiance over
the Sun's irradiance, per steradian), against a Monte Carlo of light
scattered many times (`mars-work/mars_mc.py`) with the Mie phase function
and with this data's, τ 0.5:

| from the Sun | Sun 84°: before | after | Mie MC | Sun 45°: after | Mie MC | Sun 10°: after | Mie MC |
|---|---|---|---|---|---|---|---|
| 0.5° | 0.39 (B/R 1.51) | 3.72 (2.04) | 3.73 (1.99) | 4.29 (2.04) | 4.32 (1.98) | 2.79 (2.01) | 2.55 (1.90) |
| 2° | 0.39 (1.50) | 3.01 (1.66) | 3.13 (1.68) | 3.42 (1.66) | 3.58 (1.68) | 2.37 (1.67) | 2.27 (1.65) |
| 5° | 0.37 (1.43) | 1.35 (1.06) | 1.50 (1.06) | 1.52 (1.08) | 1.69 (1.07) | 1.20 (1.15) | 1.25 (1.13) |
| 10° | 0.31 (1.26) | 0.43 (0.84) | 0.43 (0.78) | 0.46 (0.85) | 0.47 (0.79) | 0.43 (0.92) | 0.43 (0.85) |
| 20° | 0.18 (0.95) | 0.12 (0.81) | 0.13 (0.76) | 0.12 (0.81) | 0.13 (0.77) | 0.12 (0.83) | 0.12 (0.77) |
| 45° | 0.060 (0.74) | 0.045 (0.76) | 0.050 (0.81) | 0.035 (0.76) | 0.037 (0.78) | 0.025 (0.76) | 0.028 (0.75) |
| 90° | 0.064 (0.79) | 0.057 (0.71) | 0.055 (0.80) | 0.019 (0.71) | 0.013 (0.71) | 0.008 (0.70) | 0.006 (0.68) |

From 0.5° to 60° the red is within 13% of Mie's at every Sun and B/R
within 11%; B/R falls through 1 at 5.8° / 6.0° / 7.5° from the Sun (Mie:
about 5.7°, 5.8°, 6.6°; before, 18°); the far sky stays butterscotch, B/R
0.71-0.81.  At 90° the sky is 1.4× Mie's at the lower Suns: the phase
function there (1.3× Mie's at 90°, 3× at 120°) holds the measured mean
cosine; against the Monte Carlo of this data it is 0.91-1.18 there.  At
τ 1 (`mars188-cmp-t10.txt`) the Sun 84° and 45° are within 15% of Mie's
from 0.5° to 60°, B/R crossing 1 at 6.3° and 6.5°.  At the Sun 10° the
core, 0.5-3°, is 1.2-1.33× Mie's (B/R within 6%), within 14% from 4°
out: the Monte Carlo is plane-parallel, and the sphere's air mass is less
at a low Sun (the view's transmittance 10.5° up at τ 1 is 0.0059 in the
pass, e^(−1/sin 10.45°) = 0.0040 in the plane).

**The isotropic approximation's excess** 90-120° from the Sun, 1.2-1.75×
against full multiple scattering at the Sun 45° and 10° before #188, is
now 0.89-1.24× against a Monte Carlo of this data (τ 0.5 and 1): the
broad lobes' mean cosine (0.35-0.39) is much nearer isotropic than the
whole phase function's.

**Curiosity.**  PIA19400 (Mastcam M-34, calibrated sunset, sol 956):
blue over red relative to its value 8° from the Sun is 1.49 / 1.27 / 1.14
at 1° / 3° / 5°; celestiary at the Sun 3° up, τ 0.5, gives 1.74 / 1.41 /
1.18 (before, 1.09 / 1.09 / 1.07: no core), and the Mie Monte Carlo 1.52
/ 1.42 / 1.21.  Mastcam's midday sky frames beside the Sun in its optical
depth sequences (PDS, MSLMST_0011: sols 1063 and 1071, the Sun 67° and
74° up, 440 nm, relative brightness: the archive's labels carry no
radiance scale) fall from 3.0-3.4 at 8° to 0.43 at 25° over their value
at 15°; celestiary's blue, 3.4-3.9 to 0.43-0.48 (before, 1.7-1.9 to
0.43-0.49).

**Limits.**  From outside the atmosphere the Sun's slant at the ray's
entry is nil, so the narrow lobe's higher orders are off there: the
limb's aureole toward the Sun from orbit is the first order alone.  The
k-fold Cornette-Shanks lobe is approximated by the lobe of g^k.  The
alpha of each atlas is grey, red's transmittance, as before: Mars's
delta-M scaling is 0.522 / 0.519 / 0.518.  Earth has no narrow lobe, so
f = 0, the scaled extinction is the true one, the extra term is zero and
its tables are unchanged (#188's PR: their sums and every 997th value
identical; the second atlas's a, unused before, is 0 where it was 1).  The probe's `uDebug` 5
writes the multiply scattered in-scatter, with the broad lobes' extra in
its a.

## Which body's air

The pass draws one body's atmosphere (`ThreeUi._updateAtmUniforms`,
`atmosphereBody.js`):

- **The one the camera is in**: the body the camera is at (zoom.js
  `homeBody`), when it has air and the camera is within 20 of its
  atmosphere's radii.  From Earth's ground the sky is Earth's, whatever is
  targeted.
- Else the target's, when the camera is that near it, or when no body's
  air has been drawn yet; else the last one's (the Sun targeted after a
  planet).

The first rule is #192's: it used to be the target's or the last one's,
so a permalink that targets Jupiter from Earth's ground
(`#sun/jupiter@41.2054,-82.3901,169m;from=sun/earth;…`), with no last
body, drew Jupiter's air from 5.9 AU and none of Earth's.  There `rsi`'s
float32 has lost the disc: `b² − c` is a difference of two ~D² terms,
whose rounding (~D²·2⁻²³) is past the disc's whole R² at 2,900 radii, and
Jupiter was 12,500 radii off.  Its pixels went ground, sky or "in front of
the air" by rounding, and those at the far plane's depth (most of them,
from the ground) took the ground ray's zero transmittance: a disc in black
holes and stray pixels, in a blue speckle of Jupiter's limb haze set off
from it, the "pixelated Jupiter".  And the photos' sky had no Earth air
over it: no extinction, no airglow.

**Nor is a body's air drawn from past `ATMOSPHERE_MAX_RADII` (500) of its
radii** (`atmosphereResolvable`), where the same rounding starts to land
rays near the limb on the wrong side (`atmosphereBody.test.js` replays
`rsi` in float32, rayEnd.js `raySphere`: a ray in 300 wrong at 500
radii, 2% at 700, 32% at 12,500).  500 radii is where a body gives way to its far point at 45°
over 640 px; a narrow field from farther shows the disc large, without its
own air, whose limb is then under a pixel (Jupiter's 300 km at 5.9 AU is
0.07″).  `rsi` in the closest-approach form (`R² − |r₀ − (r₀·d)d|²`) would
keep the limb to far greater distances: a follow-up, kept out of #192's
fix while the pass's march was being reworked (#196).

## Per-body data

Each body's atmosphere is data in its JSON descriptor (`atmosphere`), and
the pass has one path for every body:

- `height`, `rayleigh` (rgb, per metre), `rayleighScaleHeight`: the gas.
- `mieCoeff` (extinction per metre at the ground, one number or rgb),
  `mieScaleHeight`: the aerosol or dust.  Its vertical optical depth is
  the product.  Per channel for an aerosol whose extinction follows
  Ångström's law (Earth's); one number for a grey one (Mars's dust,
  Titan's haze), whose tables are as they were.  The in-scatter tables
  hold the Mie of red alone (its coefficient and transmittance, in the
  atlas's a); for a per-channel aerosol the pass gives it its colour as
  Bruneton's 2017 implementation does without a Mie texture of its own
  (`mieColour`): the tables' Rayleigh over red's, which carries the path's
  transmittance colour, times the ratio of the coefficients.  Earth's now
  has the Mie's colour in an atlas of its own ([the Mie's
  colour](#the-mies-colour), below), which the reconstruction got wrong
  by up to 1.65 in the blue.  A grey
  aerosol keeps red's transmittance in every channel, as before
  (`mieParams` `chroma` 0): the bodies' fits (Mars's against its Monte
  Carlo) were made so.
- `ozone` (optional; Earth's alone): an absorbing layer that scatters
  nothing, as in Bruneton's 2017 implementation (BRUNETON.md, "The ozone
  layer"): `absorption`, rgb per metre at the layer's peak density, and
  its tent, `bottom`, `peak`, `top` (heights above the ground), the
  density rising linearly from 0 to 1 and falling back to 0.  The
  transmittance table holds its density integral in b, and every
  extinction (the Sun's path, the view ray, the march) adds it.
- `mieAlbedo` (one number or rgb; default 1): the aerosol's
  single-scattering albedo, the share of what it takes from the beam that
  it scatters.  Mars's dust absorbs blue: 0.95 / 0.91 / 0.86 (Tomasko et
  al. 1999, Pathfinder, 0.84 at 443 nm to 0.92 at 671 nm; Wolff et al.
  2009, CRISM, 0.86-0.90 at 440 nm, 0.94-0.96 at 650 nm), which is the
  butterscotch: the sky is the dust's colour, not the gas's.
- `miePeakPolarity`, `miePeakWeight` (one number or rgb; default 0, none),
  `miePolarity` (one number or rgb), `mieBackPolarity`,
  `mieForwardWeight` (defaults 0, 1): the phase function, Cornette-Shanks
  lobes, `P = f·CS(g_n) + (1 − f)·[w·CS(g) + (1 − w)·CS(g₂)]`: a narrow
  forward lobe (asymmetry g_n, share f, per channel), then the rest, a
  broad forward lobe (g per channel, weight w) and a back lobe (g₂).
  With no narrow lobe, one number and w = 1 is the single lobe Earth has
  always had (0.8).  Mars has all three (below, "The dust's forward
  peak"): mean cosine 0.636 / 0.669 / 0.700 (red, green, blue), within
  the 0.6-0.7 of Tomasko et al. 1999 and Pollack et al. 1995.  The
  narrow lobe is sharper in the blue, the bluish aureole round the Sun:
  diffraction by grains of a given size is narrower at shorter
  wavelengths.  (The two-lobe data before #188, forward 0.66 / 0.70 /
  0.74, back −0.3, w 0.92, had a mean cosine of 0.635 / 0.669 / 0.701;
  this doc gave it as 0.58-0.66.)
- `sunIntensity` (optional): the sky's gain.  With the planet as the
  exposure target, the sky in exposure units is the gain times the
  in-scatter, and the physical gain is π·`DISPLAY_GAIN` ≈ 4.71 (HDR.md;
  `exposure.js` `PHYSICAL_SKY_GAIN`), which every body takes when its data
  gives none (`skyGain`).  It is relative to the body's own sunlight:
  `skyExposure` is the body's irradiance times the exposure over
  π·`DISPLAY_GAIN`, 1 at the body's keyed exposure at any distance from
  the Sun, so the Sun's falloff (the inverse square, #192) reaches the sky
  once, through the irradiance.  No body sets one now.  Earth's was 21 (30
  before multiple scattering was in; matched to Cesium's Earth over the
  same imagery, Planet.md), 4.5× physical, standing in for the aerosols
  its tables didn't hold (a Mie optical depth of 0.006, against a real 0.1
  or so); with a clear day's aerosol and the ozone in its data it takes
  4.71 (Earth's air, below).
  - **Until #214's follow-up**, the other bodies carried #55's gains, from when this
    was the Sun's light at the body and fell with distance: Mercury 35,
    Venus 18, Mars 14 (physical since #147), Jupiter 6, Saturn 4,
    Uranus 2.8, Neptune 2.2, Titan 1.0, Pluto 0.7, Triton 0.6.  Since the
    sky took the body's irradiance (#86's PR A), the falloff was counted
    twice, and #214's audit found it.  Venus's 18 wasn't a falloff, but had
    no reason either: its limb came out brighter than a white surface
    (I/F 1.22).  Mercury's has no air to scatter, so its gain did nothing.
  - **What it changed**, from 5 radii at 60° phase, the linear composite
    as I/F (over a sunlit white's value; the lit disc's median, and the
    brightest pixel within 10 px of the limb in a close-up where the air
    is 40 px thick, over the disc 2.5 air-heights in):

    | Body | Gain | Disc median I/F | Limb over the disc in | Haze above the limb, I/F |
    |---|---|---|---|---|
    | Venus | 18 → 4.71 | 0.48 → 0.34 | 1.21 → 0.74 | 1.17 → 0.31 |
    | Jupiter | 6 → 4.71 | 0.35 → 0.32 | 0.95 → 0.92 | 0.42 → 0.33 |
    | Saturn | 4 → 4.71 | 0.30 → 0.32 | 0.92 → 0.94 | 0.28 → 0.33 |
    | Uranus | 2.8 → 4.71 | 0.32 → 0.34 | 0.64 → 0.80 | 0.22 → 0.37 |
    | Neptune | 2.2 → 4.71 | 0.22 → 0.24 | 0.60 → 0.82 | 0.16 → 0.33 |
    | Titan (and its haze's albedo, below) | 1.0 → 4.71 | 0.125 → 0.24 | 0.70 → 0.97 | 0.08 → 0.22 |
    | Pluto | 0.7 → 4.71 | 0.28 → 0.29 | | 0.014 → 0.096 |
    | Triton | 0.6 → 4.71 | 0.36 → 0.37 | | 0.015 → 0.12 |
    | Mars (unchanged) | 4.71 → 4.712 | 0.155 → 0.155 | 1.01 → 1.01 | 0.16 → 0.16 |

    The giants stay limb-darkened in visible light, as Voyager's and
    HST's broadband images show them (limb brightening on the giants is a
    methane-band effect, which the tables don't model); Uranus and Neptune
    less so, their Rayleigh haze now at its physical share.  Venus's limb
    is no longer brighter than its disc.
  - **Titan** at the physical gain alone was a white disc at I/F 0.59,
    three times Cassini's (Titan's geometric albedo is about 0.2 in the
    visible): its haze (τ ≈ 8) scattered without absorbing, and the gain of
    1 had stood in for the absorption.  `mieAlbedo` 0.95 / 0.90 / 0.80
    (red, green, blue) gives the haze the absorption Huygens' DISR measured
    (Tomasko et al. 2008, Planet. Space Sci. 56, 669: absorbing tholin-like
    aerosols, darkest in the blue; studies since take 0.94-0.96 in the near
    infrared), and the disc comes out at 0.24 and orange.  From the ground
    the sky is 0.005 of a sunlit white surface at the zenith with the Sun
    45° up (0.015 before), where Huygens found the daylight about a tenth
    of the Sun's at the top of the air: the isotropic multiple scattering
    under-counts a thick, forward-scattering haze (Multiple scattering,
    above).  Titan's haze profile and the second scattering in a thick
    haze are the follow-up ([#218](https://github.com/celestiary/web/issues/218)).
- The body's own `albedo` is the ground's share of the multiple
  scattering.

Mars's numbers: optical depth 0.5 (`mieCoeff` 4.5e-5 over an 11.1 km
scale height, the gas's, as the dust is well mixed: Conrath's profile;
MSL and MER measure 0.3-1 outside storms, Lemmon et al. 2004, 2015), and a
physical Rayleigh for CO2 at 6 mbar (τ 0.006 in the blue, 1/50 of
Earth's).  The first data had a 3 km dust scale height (τ 0.126), a
single lobe at 0.76, a gain of 14 and a red-heavy "Rayleigh" standing in
for the colour: the sky was 0.04 of a sunlit white surface at the zenith
and 0.13 at the anti-solar horizon, black after the tone map, and white
within 30° of the Sun.

## Earth's air: a clear day's aerosol and the ozone

Earth's data was Rayleigh and a token aerosol (`mieCoeff` 5e-6 /m over
1.2 km, τ 0.006, a single lobe at 0.8, no absorption) at 4.5 times the
physical gain.  It is now the measured air, at the physical gain:

- **Rayleigh**: 12.16×10⁻⁶ /m at 550 nm over 8 km, the standard
  atmosphere's column (Bucholtz 1995, Appl. Opt. 34, 2765; recalled): τ
  0.0973 at 550 nm, as λ^−4.08 (λ⁻⁴ with the air's depolarisation and
  dispersion).  It was (5.8, 13.5, 33.1)×10⁻⁶, Bruneton's and Hillaire's
  λ⁻⁴ from 1.24062e-6 /m at 1 µm (Bruneton's `demo.cc`), 11% over the
  standard column.  The channels take each spectrum's average over their
  response (the channels' coefficients, below): (6.26, 12.36, 29.41)×10⁻⁶.
- **The aerosol**: a clear day's continental and global mean.  τ 0.12 at
  550 nm: MODIS's multi-year means are 0.13 over the oceans and 0.19 over
  land (Remer et al. 2008, J. Geophys. Res. 113, D14S07), which include
  hazy days; OPAC's continental average is 0.15 and its clean continental
  0.06 (Hess, Koepke and Schult 1998, BAMS 79, 831; recalled).  Ångström's
  exponent 1.3 (Ångström's standard for continental air; recalled), so
  τ(λ) = 0.12 (λ/550)^−1.3 over the 1.2 km scale height (Bruneton's,
  kept); over the channels, `mieCoeff` (8.18, 10.12, 13.30)×10⁻⁵ /m, τ
  0.098 / 0.121 / 0.160.  Single-
  scattering albedo 0.93 (OPAC's continental average 0.925; AERONET's
  global means 0.93-0.95, recalled), asymmetry 0.7 (OPAC 0.70, AERONET's
  typical value at 550 nm; recalled), one Cornette-Shanks lobe.  Its
  visibility at the ground, 3.9 over the extinction at 550 nm, is 34 km.
- **Ozone**: 300 Dobson units in Bruneton's tent, 0 at 10 km, 1 at 25 km,
  0 at 40 km (its integral 15 km), so a peak number density of 300 ×
  2.687e20 / 15000 = 5.374e18 /m³, times the Bremen cross-sections at 233 K
  (Serdyuchenko et al. 2014, `demo.cc`'s `kOzoneCrossSection`, 10 nm bins
  from 360 nm), averaged over the channels: `absorption` (2.471, 1.794,
  0)×10⁻⁶ /m.  Chappuis's band, which peaks at 600 nm: red and green
  absorbed, blue not.  At 680, 550 and 440 nm alone (1.209e-25, 3.5e-25,
  1.582e-26 m²) it was (0.650, 1.881, 0.085)×10⁻⁶: red's a quarter of its
  band's.

### The channels' coefficients

Each channel's coefficient for a species is the species' spectrum averaged
over that channel's response under sunlight, not its value at one
wavelength (`tools/atmos/bandAverage.mjs`, `node
tools/atmos/bandAverage.mjs` prints the tables below; its test
`bandAverage.test.js`, and `atmosphere.test.js` checks Earth's data
against it):

- **The responses**: the rows of the XYZ to linear sRGB matrix applied to
  the CIE 1931 2° colour-matching functions, r̄ = 3.2406 x̄ − 1.5372 ȳ −
  0.4986 z̄ and so on, times the Sun's spectrum (ASTM G-173's
  extraterrestrial column; the tables are Bruneton's, `demo.cc` and
  `constants.h`), at 1 nm from 360 to 830 nm.  They have negative lobes
  (r̄ from 440 to 545 nm, b̄ over 500 nm, ḡ at both ends), and they are
  kept: the light through a path, as linear sRGB relative to the Sun's, is
  ∫ S c̄ T / ∫ S c̄, which is what the pass's white Sun times a per-channel
  transmittance has to reproduce.
- **The average**: k_c = ∫ S c̄ k / ∫ S c̄.  It is exact where the path is
  thin, for the transmittance and for the in-scatter (whose colour is
  ∫ S c̄ β), so the sky's colour is the spectrum's.  Ozone's blue comes out
  slightly negative (b̄'s negative lobe sits on the Chappuis band), a
  colour outside sRGB's gamut, and is clamped to 0.
- **The alternative**, matching each species' transmittance through its
  own column at the 20 km tangent (−ln(∫ S c̄ e^(−kN) / ∫ S c̄) / N), was
  measured too: species by species it doesn't add, and through the limb it
  misses the spectrum by more (below).

| /m | 680 / 550 / 440 nm | band average (now) | matched at 20 km |
|---|---|---|---|
| Rayleigh | 5.12, 12.16, 30.2 ×10⁻⁶ | 6.26, 12.36, 29.41 ×10⁻⁶ | 6.31, 12.68, 29.84 ×10⁻⁶ |
| aerosol | 7.59, 10.0, 13.37 ×10⁻⁵ | 8.18, 10.12, 13.30 ×10⁻⁵ | 8.18, 10.12, 13.30 ×10⁻⁵ |
| ozone | 0.650, 1.881, 0.085 ×10⁻⁶ | 2.471, 1.794, 0 ×10⁻⁶ | 2.498, 1.743, 0.061 ×10⁻⁶ |

The Rayleigh and the aerosol are smooth power laws and move little.  The
ozone's red is 3.8 times its value at 680 nm: the Chappuis band peaks at
600 nm, inside red's response, and 680 nm sees only its tail.  With red
under-absorbed through every long path the limb, and the haze over the
whole disc, came out lavender to magenta from low orbit, where the ISS's
photographs show a deep blue limb.

The light through the limb (a tangent path through the whole atmosphere,
linear sRGB relative to the Sun's, R 6371 km), the spectrum's against the
models':

| tangent height | spectral r / g / b | band average | 680 / 550 / 440 nm |
|---|---|---|---|
| 10 km | 0.124 / 0.049 / 0.0077 | 0.109 / 0.056 / 0.0084 | 0.317 / 0.056 / 0.0071 |
| 15 km | 0.145 / 0.110 / 0.084 | 0.125 / 0.112 / 0.078 | 0.428 / 0.108 / 0.069 |
| 20 km | 0.154 / 0.174 / 0.260 | 0.141 / 0.168 / 0.254 | 0.508 / 0.160 / 0.231 |
| 25 km | 0.209 / 0.267 / 0.479 | 0.202 / 0.258 / 0.481 | 0.602 / 0.246 / 0.448 |
| 30 km | 0.423 / 0.484 / 0.677 | 0.419 / 0.479 / 0.675 | 0.760 / 0.467 / 0.650 |
| 35 km | 0.725 / 0.749 / 0.813 | 0.724 / 0.748 / 0.811 | 0.896 / 0.742 / 0.798 |

Over 10 to 35 km the rms of ln(model / spectrum) is 0.070 for the band
average (its chromaticity, ln r/g and b/g, 0.103), 0.087 (0.128) matched
at 20 km, and 0.565 (0.713) at one wavelength a channel: three times the
spectrum's red at 15 to 25 km, red over blue at 20 km where the spectrum
is blue over red.  Straight up from sea level the band average gives the
spectrum's transmittance to the third digit (0.831 / 0.781 / 0.674 against
0.831 / 0.780 / 0.674; 0.868 / 0.782 / 0.668 at the three wavelengths).

Vertical optical depth from sea level (CPU integral of the tables' density
profiles; `atmosphere.test.js`):

| | red | green | blue |
|---|---|---|---|
| Rayleigh | 0.050 | 0.099 | 0.235 |
| aerosol | 0.098 | 0.121 | 0.160 |
| ozone | 0.037 | 0.027 | 0 |
| total | 0.185 | 0.247 | 0.395 |
| zenith transmittance | 0.831 | 0.781 | 0.674 |
| at 680 / 550 / 440 nm: total, transmittance | 0.142, 0.868 | 0.246, 0.782 | 0.403, 0.668 |
| before the measured air: total, transmittance | 0.052, 0.949 | 0.114, 0.892 | 0.271, 0.763 |

Against the textbook: ozone's 0.028 at 550 nm is the 0.03 of 300 DU (0.027
over green's band), and the Rayleigh is Bucholtz's 0.097 at 550 nm by
construction.

Through the limb (a tangent path, its transmittance, by the band
averages; "ozone" is the ozone's share alone; the spectrum's against the
models' is in the table above):

| tangent height | transmittance r / g / b | ozone's r / g / b |
|---|---|---|
| 5 km | 0.043 / 0.0082 / 8.5e-5 | 0.38 / 0.49 / 1 |
| 15 km | 0.13 / 0.11 / 0.078 | 0.22 / 0.33 / 1 |
| 25 km | 0.20 / 0.26 / 0.48 | 0.24 / 0.35 / 1 |
| 35 km | 0.72 / 0.75 / 0.81 | 0.76 / 0.82 / 1 |

From 15 km up the ozone takes two thirds of the green and three quarters
of the red and leaves the blue: at 25 km the light through the limb is
blue (0.48 against 0.26 and 0.20), where without the ozone it was
green-white.  That is the physical reason a limb from orbit stays deep
blue along the long paths where the tables' Rayleigh alone saturated
towards cyan.  At one wavelength a channel the ozone took only a third of
the red (0.68 at 25 km), and the limb went magenta.

**The zenith from sea level**, a CPU mirror of the tables' arithmetic
(single scattering through the transmittance and Hillaire's isotropic sum,
64 directions; the session's `atmo-cpu/sky.mjs`), as luminance
(`Y(L/E)` × the Sun's 1.27e5 lux, which is the sky in exposure units times
`EXPOSURE_UNIT_CD_M2`), against the CIE clear sky's zenith (Karayel et al.
1984, CIE 110: Lz = (1.376 T − 1.81) tan h + 0.38 kcd/m², Linke turbidity
T ≈ 3 for τ550 ≈ 0.1):

| the Sun's elevation | now: kcd/m² (single only), B/R | before (gain 21): kcd/m², B/R | CIE, T 2.5 / 3 / 3.5 |
|---|---|---|---|
| 30° | 1.86 (1.03), 3.0 | 6.0, 4.8 | 1.32 / 1.72 / 2.12 |
| 60° | 5.16 (3.96), 2.1 | 9.5, 4.4 | 3.20 / 4.39 / 5.59 |

Now within the CIE's range of turbidity (T about 3.2, a clear day, as the
aerosol's τ 0.12 is), where the old gain was 2.2-3.5 times over it and a
third bluer.  Nothing was tuned to it.  (Measured with the coefficients at 680, 550 and 440 nm,
before the band averages; the luminance is green's and moves little, the
B/R lower with red's larger Rayleigh and ozone.  Not re-measured.  The
ground's albedo in the multiple scattering, since, takes 14% off the zenith
at noon: [the ground under the air](#the-ground-under-the-air).)

## The ground under the air

The multiple scattering's table (`precomputeMultiScatter`) and the
volumetric clouds' light from below (CloudVolume) take a Lambertian ground
under every point, of the atmosphere's `groundAlbedo` (one number or
[r, g, b]; `AtmospherePrecompute` `groundAlbedo`), else the body's
`albedo`.  That `albedo` is a geometric albedo, the whole disc's, and
Earth's 0.367 has its air (the path radiance over the ground, a quarter
to a half of the disc's light: [the disc from low
orbit](#the-disc-from-low-orbit), below) and its clouds (two thirds of the
sky) in it.  As the ground's it counted both twice: the air's own
backscatter scattered again, and clouds under a clear sky, which are drawn
on their shell, over the ground they cover.  Earth's tables now take its
drawn ground's mean, the decoded Blue Marble's (`textureMeans.json`,
0.0976 / 0.0934 / 0.0878), which `atmosphere.test.js` holds to the
texture's.  The other bodies keep their `albedo`: Mars's 0.15 and the
giants' are near their ground's or their cloud tops', and Venus's and
Titan's ground is under a thick atmosphere whose fit was made with it.

Measured (SwiftShader, Cesium off, the pass's floats; the sky per unit of
the exposure): the in-scatter over the Kazakh desert from 400 km lost
14 / 11 / 6% (red, green, blue), all of it from the multiple scattering
(its ground-reflected share), and the sky from the Dead Sea's shore at
noon 14% at the zenith (B/R 2.13 to 2.16) and 32% 10° over the anti-solar
horizon (B/R 1.88 to 2.20), where the most of it was the ground's.  The
zenith's luminance was the CIE clear sky's at turbidity 3.2 (Earth's air,
above); 14% less is about 2.9, still a clear day's.

## The Mie's colour

The in-scatter atlas holds the Rayleigh's single scattering per channel
and the Mie's of red alone (its a).  For a grey aerosol the pass takes
that in every channel, as the bodies' fits were made.  For Earth's, whose
extinction follows Ångström's law, it gave it a colour by Bruneton 2017's
reconstruction (`mieColour`), Mie_c = a · (S_c / S_r) · (β_R,r / β_R,c) ·
(β_M,c / β_M,r): the Rayleigh's path colour, taken as the Mie's.  The two
didn't travel the same air: the aerosol's scale height is 1.2 km and the
gas's 8, so the light the aerosol scatters has come through nearly the
whole column and goes back through it, while the Rayleigh's mostly
scattered above it.  A CPU single scattering of Earth's data
(`atmosphere.test.js`, "the Mie's colour") puts the reconstruction over
the Mie by 1.00 / 1.15 / 1.65 through the disc from 400 km at the Aydar
Lake view (below), 1.00 / 0.82 / 0.60 by the Sun 5.5° up at 2°, and 2.4 in
the blue at the zenith then (where the Mie is 4% of the blue); at the
zenith at noon it is right to 2%.

Now `precomputeInScatter` renders a second atlas for a chromatic aerosol:
the Mie per channel over red's (half floats, a ratio: 8 MB at 2048×512;
0 where there is no light), on the main atlas's texture
(`texture.userData.mieColour`, read by the pass's `onBeforeRender`, so
ThreeUi's binding is as it was; disposed with it).  `sampleInScatter`
returns a times it, and the segment march (`marchSegment`) sums the Mie
per channel as it goes; a grey aerosol keeps `vec3(a)`.  At the Aydar view
the table's Mie over the desert went from 0.0269 / 0.0307 / 0.0336 to
0.0269 / 0.0263 / 0.0195, the CPU's 0.0252 / 0.0252 / 0.0195 at the frame's
centre.  By the low Sun the horizon toward it took more green and blue
(B/R 0.186 to 0.196 at 5.5°, 0.413 to 0.459 at 11.8°): the sunset is as
orange in red and green, a little less deep in blue.  The extra atlas
costs a second march over it: the whole re-precompute on SwiftShader went
from 3.4 to 4.6 s (a GPU's is milliseconds).

## The disc from low orbit

**The view**: Aydar Lake from the ISS's height, looking south from over
Kazakhstan,
`#sun/earth@47.3233,68.7289,400km;t=9821.711705jd;cq=-0.3992,0.736,0.3632,0.4087;fov=31.52deg;s=alpoGiFY;time:pause`.
NASA's photograph of it shows a warm, pinkish-tan desert under a thin
haze; the render's disc was a cool lavender, its canvas's mean (linear)
0.196 / 0.228 / 0.336.

The geometry is the cause.  The frame looks 60° off the nadir, so the
ground is seen 64° from its zenith (μ_v 0.43), and the Sun is 22° up there
(μ_s 0.37), 60° from the view ray (a forward scatter).  The two paths are
5.0 airmasses: the optical depth along the view and the Sun's path is 0.9
/ 1.2 / 2.0.  Measured (SwiftShader 360×240, Cesium off,
glare off, the meter settled across tasks; the scene buffer and the
pass's intermediates read as floats, `uDebug` 1, 2, 4, 5 and 7, over the
region's pixels; per unit of the exposure, where 1.5 is a white
Lambertian surface facing the Sun; the session's `disc-scripts/decomp.mjs`):

| desert (41,390 px) | red | green | blue | share of the pixel, green |
|---|---|---|---|---|
| ground as drawn, S (albedo 0.21 / 0.15 / 0.08 × 1.5 μ_s) | 0.112 | 0.082 | 0.044 | |
| view transmittance, T | 0.640 | 0.554 | 0.397 | |
| ground through the air, S·T | 0.069 | 0.044 | 0.016 | 25% → 28% |
| Rayleigh, single | 0.029 | 0.053 | 0.105 | 30% → 34% |
| aerosol, single (before → now) | 0.022 → 0.022 | 0.025 → 0.022 | 0.028 → 0.016 | 14% → 14% |
| multiple scattering (before → now) | 0.034 → 0.022 | 0.053 → 0.038 | 0.103 → 0.088 | 30% → 24% |
| the pixel (before → now) | 0.154 → 0.142 | 0.174 → 0.156 | 0.251 → 0.225 | |
| path radiance's share (before → now) | 55% → 51% | 75% → 72% | 94% → 93% | |

The lake (151 px) is 91% path radiance in the green; the Blue Marble's
November snow in the north (6,037 px, S 0.37 grey) shows 0.36 / 0.39 /
0.48 → 0.34 / 0.36 / 0.42, a bluish white.  The link's `i` turns the
clouds off; the white in the frame is that snow.

**Against physics.**  The view's transmittance is the plane-parallel
e^(−τ/μ_v), 0.653 / 0.566 / 0.402, to 3% (the curvature).  The single
scattering at the frame's centre, by a CPU march of Earth's data (600
steps, the Sun's path marched), is Rayleigh 0.0313 / 0.0574 / 0.115 and
aerosol 0.0252 / 0.0252 / 0.0195 against the table's 0.031 / 0.056 / 0.112
and (now) 0.027 / 0.026 / 0.020.  The multiple scattering is what
Hillaire's isotropic sum gives with a diffuse field of the sky's light
and the ground's: about half the single scattering's at green, which is
also what a hand estimate of that field gives (0.07 against 0.069, with
the 0.367 ground).  As path reflectance, π L / (E₀ μ_s), the green is
0.146 single and 0.20 with the rest, at an airmass sum of 5 and a forward
scatter: the oblique cameras of MISR (60° and 70°) see land through about
that much.  Nothing in the pass is off by the factor of two or three
that would make the desert warm: its air dominates because the view is
oblique and the Sun low.  The ground's albedo is warm (r/b 2.6) and
decoded right (Planet.md, [albedo](../Planet.md#albedo)); the Blue Marble
is surface reflectance, atmospherically corrected (MODIS), so the pass's
haze isn't on top of a haze in the picture; the planet shader adds no
tint, ambient or specular there (S is 1.5 × albedo × μ_s to the third
digit).

**What was wrong**, and is fixed: the ground's albedo in the multiple
scattering ([the ground under the air](#the-ground-under-the-air)) and the
aerosol's colour ([the Mie's colour](#the-mies-colour)).  Together they
take the desert's pixel from 0.154 / 0.174 / 0.251 to 0.142 / 0.156 /
0.225 per unit of the exposure (B/R 1.63 to 1.58); the meter lifts the
darker frame (gain 1.27 to 1.44), and the canvas's disc goes from 0.196 /
0.228 / 0.336 to 0.207 / 0.232 / 0.337 (B/R 1.72 to 1.63).  The limb
there is 0.323 / 0.432 / 0.672 → 0.320 / 0.409 / 0.661, deep blue still.

**What is still wrong, and moves the other way**: the ground is lit by
the Sun above the air.  Its light reaches the ground through the air's
transmittance, 0.615 / 0.522 / 0.354 at the frame's centre (μ_s 0.38),
and the sky's light adds 0.153 / 0.184 / 0.216 of E₀μ_s by single
scattering (a CPU hemisphere of rays), about 0.2 / 0.24 / 0.3 with the
higher orders: the ground's irradiance is about 0.81 / 0.76 / 0.65 of
what it is drawn with.  Drawn so, the desert's pixel would be about
0.137 / 0.147 / 0.214, bluer still (B/R 1.56 with the ground warmer and
darker).  It matters more toward the terminator, where the ground should
redden and dim, and it needs the ground's irradiance (Bruneton's
irradiance table, or the direct beam through the transmittance table and
the sky's from Ψ) in the planet's material and in Cesium's; not done
(known gaps, below).

**And the rest is the observer's.**  The model's colours are linear sRGB
relative to the Sun's light, white: a camera's white balance, auto or set
to daylight under a bluish scene, and the contrast and dehaze applied to
the photographs, aren't in it.  A regional aerosol (the Aral's and the
Kyzylkum's dust, a lower Ångström exponent and a lower albedo in the
blue) would warm the haze too; Earth has one aerosol.

## Knobs you might want to tune

- Per-body `sunIntensity`: the physical 4.71 unless the data has a
  documented reason (none does now); not a knob to tune a look by.
- The metered exposure's constants (`exposure.js`: the key, the highlight
  cap, the gain's range and time constant), documented in HDR.md.

## Earth's limb from low orbit: the gain, not the tone map

Against a NASA photograph from about the ISS's height, celestiary's limb went
black, blue, cyan-white, then a blue-veiled surface, where the photograph's
goes black, deep blue, then the surface.  Measured headless (2026-11-21,
420 km over the day side, the Sun 64° up, a column down through the limb, 3 px
a step, display values):

| Setting | Down through the limb |
|---|---|
| Earth's gain, 21; PBR Neutral | 2,13,36 → 70,132,240 → **191,235,248** → 149,197,247 |
| the physical 4.71; PBR Neutral | 3,9 → 12,36,79 → 126,138,144 (land and cloud show) |
| 21; AgX | 12,30,54 → 105,143,181 → 189,201,204 → 164,183,199 |
| 21; Neutral, sRGB out, textures decoded | 21,65,105 → 143,190,248 → 223,246,252 → 191,220,251 |

The cyan-white band is the tangent path's in-scatter at 4.5 times the
physical gain: blue clips (248) while green climbs, and Neutral's shoulder
desaturates what it compresses.  At 4.71 the band is gone and the surface
isn't veiled.  The other tone maps and the colour-managed pipeline don't
remove it.  The gain stood in for aerosols the tables didn't hold (above,
`sunIntensity`).

**Done**: Earth's air is physical, at 4.71, with a clear day's aerosol and
the ozone (Earth's air, above): the ozone's Chappuis absorption takes the
green and red from the long tangent paths and leaves the blue, which is
what keeps a real limb blue.  The table above was measured before; still to
verify by rendering: the limb from 420 km against the photograph (black →
deep blue → surface, no cyan band), the ground's sky at noon and sunset
(the aureole and the horizon's haze are the aerosol's now, the setting
Sun's reddened Mie through `mieColour`), Earth's disc from afar (the haze
over the disc is the aerosol's: the disc's I/F against Earth's geometric
albedo, 0.367, Planet.md) and the night side (unchanged but for the
twilight arc).  The gain was matched to Cesium's Earth; parity's Earth
views measure Cesium on against off under the same pass, so they should
move only where the haze, now heavier near the ground, covers both sides
(`earth-low-land-day`, `earth-low-dusk`, the terminator profiles of
`earth-orbit-gibbous`).

## Known gaps / future work

- **The channels' coefficients** are band averages (Earth's air, "The
  channels' coefficients"), which reproduce the spectrum's limb to about
  7%, not its exact colour: a transmittance's average over a band isn't
  the exponential of its coefficient's average, and the error grows with
  the optical depth (at 10 km, red 0.109 against 0.124).  A spectral model
  (Bruneton's 2017 implementation's 40 wavelengths, converted to the
  primaries) is the step after, for the long paths.  The other bodies'
  coefficients are still at one wavelength a channel; they have no
  absorber with a band inside a channel, so the error is the small one of
  the power laws (Earth's Rayleigh red moved 22%).
- **The grey aerosols' Mie colour.**  Mars's dust and Titan's haze keep
  red's transmittance for their Mie in every channel (`mieColour`, grey);
  Bruneton's reconstruction would colour it by the path, which moves their
  B/R, so their fits would need redoing with it.
- **The march's step count** (`segmentSteps`) bounds the segment's
  optical depth by the extinction at its lowest point times its length, in
  the bluest channel, and at Earth's ground that is now the aerosol's:
  1.7e-4 /m, against 3.8e-5 before (The march's cost, above).  Looking
  straight down from 7.5 km the bound is 1.27 (13 steps), where the
  segment's real optical depth is about 0.4 (the aerosol is in its lowest
  1.2 km): the march is about three times what it was in #189's view.  A
  bound per species with the ray's height range (`tMax·H/Δh` in place of
  `tMax` for the steep rays) would take it back to 4-5 steps; it would
  change the other bodies' step counts too, so it waits for a measure on a
  real GPU (`?perf=sync`).
- **The sky guest's gains by the Sun's altitude** (`js/sky/view.js`
  `METERED_GAIN`) were settled on Earth's sky at a gain of 21, and want
  re-measuring with the physical one.

- **The ground's light through the air.**  Celestiary's ground (and
  Cesium's) is lit by the Sun above the air: no transmittance on the
  Sun's path to it, and no sky light.  At the Aydar view its irradiance
  is about 0.81 / 0.76 / 0.65 of what it is drawn with ([the disc from low
  orbit](#the-disc-from-low-orbit)); toward the terminator the ground
  should redden and dim.  Bruneton's irradiance table (or the direct beam
  through the transmittance table and the sky's light from Ψ) in the
  planet's material, and the same in Cesium's lighting, so parity holds.
  The disc from orbit gets bluer with it, not warmer: its colour at an
  oblique view and a low Sun is its air's.
- **Twilight's stars.**  The metered exposure is a whole-frame meter;
  at −10° the horizon band toward the Sun (1.8e-3 of a sunlit white) or
  away from it (5.7e-4) caps the gain at a few hundred to a thousand,
  and the stars, Sirius at 4.4e-5, reach threshold only once the sky is
  under ~1e-5, about −20°.  The eye adapts to where it looks (the zenith
  at −10° is 1.2e-5, 10 cd/m² in the model's terms): a centre-weighted
  meter would bring the first stars out at nautical twilight looking up.
- **Gap pixels at twilight.**  A gap (a sub-pixel hole in the ground
  mesh at the horizon) takes the horizon ray's haze, which at twilight is
  the sunlit air above the shadow while the ground beside it is dark, so
  the holes show as specks along the horizon on the night side (visible
  since the night lights stopped lighting the whole land).  Marching the
  segment to the sphere instead, as a surface there, would darken them;
  it would also change the below-datum bands (`mars-low-horizon-band`,
  `earth-dead-sea-band`), which take the same path on purpose.
- **The night sky's own light** is drawn: airglow, the zodiacal light and
  the galaxy (above, #186).  Not yet: scattered moonlight (the moonlit sky,
  [#163](https://github.com/celestiary/web/issues/163)), airglow scattered
  by the lower atmosphere (it brightens the sky near the horizon by a
  further 10-20%), and the night sky's light lighting the ground (a
  moonless landscape is lit by it, at about 1e-4 lux).
- **Multiple scattering** is the isotropic sum above; the twilight glow
  on the antisolar horizon (the Earth's shadow and the Belt of Venus)
  is still single-scatter geometry plus that sum.
