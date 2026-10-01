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
transmittance marched along that segment (16 steps, each step's sunlight
through the transmittance table), as the in-scatter table integrates its
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

## Probing the pass

`uDebug` on the pass's material writes its intermediates instead of the
pixel, as raw floats, for a float render target: 1 the transmittance, 2
the sky (exposure units), 3 `(depthSample, tMax, flags)` with flags 1 gap,
2 beyond the atmosphere, 4 marched surface, 8 eye below the sphere, 16
under the horizon, 4 the in-scatter sample (Rayleigh rgb, Mie a), 5 the
ray's zenith cosine at the eye, the Sun's, and the eye's altitude.  In a
page: set it, render `ui._atmScene` with `ui._atmCamera` into a
`FloatType` target, `readRenderTargetPixels`.  Read a column of numbers
down a feature (the band at the horizon), not a picture: every cause in
#141 and here was found that way.

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

## Why the raw equation isn't enough

Two real-world phenomena aren't captured by the LUTs alone:

1. **Eye adaptation under bright sky.** Real eyes' iris constricts under
   daylight, so faint background sources (stars, distant planets) become
   sub-threshold even though physics says ~14% of their light reaches the
   retina at zenith from sea level. Without compensating in the renderer,
   star labels and Hipparcos points clearly poke through the day blue.
2. **Sub-pixel rasterization gaps in the surface mesh.** Earth's world
   position is ~1.5e11 m; float32 precision in the model-view matrix
   degrades to ~1m, which produces sub-pixel holes at extreme close range.
   The depth buffer at those pixels reads "far" (sun, stars), and naive
   compositing leaks the background through where the surface should
   have covered.

## The five composition rules

Computed in this order in the LUT branch (lines ~640–700 of `Atmosphere.js`);
the ray-march fallback applies the same rules with corresponding variables.

1. **LUT alpha** — `alpha = 1 - exp(-tau_max_channel)`. Trust the
   precompute. At zenith from sea level this is ~0.14, giving ~86% star
   transmittance — physically correct.
2. **Cap at 0.92** — `alpha = min(alpha, 0.92)`. Floor of 8% transmittance
   for any background. Earlier revs forced the inside-atmosphere alpha
   to ~1; that hid stars at the night horizon along with everything else.
3. **Brightness-tied opacity** — `alpha = max(alpha, smoothstep(0.01, 0.1, sky_max_ch) * altWeight)`,
   with `sky_max_ch` the max channel of `1 - exp(-scattered)`, the sky's
   brightness as it was measured before the HDR buffer, so the rule behaves
   as it did.  Models eye adaptation. Two factors:
   - `smoothstep` snaps alpha to 1 once the sky is even faintly bright,
     so day blue overrides stars without needing physically-implausible
     extinction.
   - `altWeight = clamp(1 - camAlt/atmHeight, 0, 1)` weakens the boost
     with altitude. At the surface (full weight) the eye is deeply
     embedded in the column and adapts fully; at the top of the
     atmosphere (zero weight) the eye effectively becomes a camera, no
     iris dilation, just LUT extinction. Without this gate, looking
     down at the day side from space turned the disc into featureless
     blue and hid the surface texture.
4. **`insideAtm` gate** — the brightness boost is also conditional on
   the camera being inside the atmosphere shell. From space the LUT alone
   correctly captures the thin-column transmittance; boosting it would
   over-occlude.  Nor does it apply where anything drew depth: bodies
   beyond the atmosphere (`beyondAtm`, the daytime Moon) or the ground
   and anything else inside it (`groundDrawn`).  It's for the stars and
   the galaxy, which draw none.  Over the ground it hid the day surface
   under the haze, more the lower the camera: T 0.094 from 7.5 km,
   instead of 0.5-0.87 (#141).
5. **Gap-pixel hard occlusion** — if `isGap` (geometric ground in front
   of recorded depth), force `alpha = 1.0`. The sub-pixel holes show
   only inscatter (bright haze by day, dark by night) instead of leaking
   background. Side effect: a crisp horizon edge regardless of mesh
   tessellation density.

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
(the body's `albedo`) where a direction meets the ground, over one minus
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
below) is re-fitted so its look holds.  The approximation's limit is a
thick atmosphere (τ of several) or one whose multiple scattering is still
strongly forward: Venus, Titan.  There the isotropic sum under-counts the
forward glow; those bodies keep the single-term look they have.

## Per-body data

Each body's atmosphere is data in its JSON descriptor (`atmosphere`), and
the pass has one path for every body:

- `height`, `rayleigh` (rgb, per metre), `rayleighScaleHeight`: the gas.
- `mieCoeff` (extinction per metre at the ground), `mieScaleHeight`: the
  aerosol or dust.  Its vertical optical depth is the product.
- `mieAlbedo` (one number or rgb; default 1): the aerosol's
  single-scattering albedo, the share of what it takes from the beam that
  it scatters.  Mars's dust absorbs blue: 0.95 / 0.91 / 0.86 (Tomasko et
  al. 1999, Pathfinder, 0.84 at 443 nm to 0.92 at 671 nm; Wolff et al.
  2009, CRISM, 0.86-0.90 at 440 nm, 0.94-0.96 at 650 nm), which is the
  butterscotch: the sky is the dust's colour, not the gas's.
- `miePolarity` (one number or rgb), `mieBackPolarity`,
  `mieForwardWeight` (defaults 0, 1): the phase function, two
  Cornette-Shanks lobes, the forward one's asymmetry per channel with
  weight w, and a back lobe.  One number and w = 1 is the single lobe
  Earth has always had (0.8).  Mars: forward 0.66 / 0.70 / 0.74, back
  −0.3, w 0.92, an effective asymmetry of 0.58 (red) to 0.66 (blue),
  within the 0.6-0.7 of Tomasko et al. 1999 and Pollack et al. 1995; the
  sharper forward peak in the blue is the bluish aureole round the Sun,
  which those authors trace to the micron-sized dust scattering shorter
  wavelengths more nearly forward.
- `sunIntensity`: the sky's gain.  With the planet as the exposure target,
  the sky in exposure units is `sunIntensity × in-scatter`, and the
  physical value is `π·DISPLAY_GAIN` ≈ 4.71 (HDR.md).  Mars has it: its
  sky's brightness is its dust's.  Earth's 21 (30 before multiple
  scattering was in; matched to Cesium's Earth, Planet.md) is 4.5×
  physical, standing in for its aerosol load; #86's PR B tunes it against
  physical stars and metered exposure.  The rings reuse it as their
  brightness.
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

## Knobs you might want to tune

- `0.92` extinction cap — lower = stars peek through more at night
  horizon; higher = more opaque
- `(0.01, 0.1)` smoothstep bounds — lower bound = brightness at which
  stars start fading at dawn; upper bound = brightness at which sky
  goes fully opaque. Narrower band = sharper twilight star-fade.
- `altWeight` curve — currently linear `1 - camAlt/atmHeight`. Could
  be steepened (e.g. `pow(1 - alt/H, 2)`) so eye-adaptation drops off
  faster with altitude.
- Per-body `sunIntensity` — primary lever on overall day brightness.

## Known gaps / future work

- **Surface-vs-atmosphere coloring from space.** The additive composite
  of inscatter + surface*T reads OK but the saturation/hue balance over
  land vs ocean isn't perfectly tuned, and the coastal hand-off looks
  slightly washed. Plausible knobs: per-channel inscatter scaling, a
  soft saturation curve on the composite, or proper aerial-perspective
  integration over the segment from surface depth back to camera.
- **Auto-exposure (eye adaptation over time).** The `altWeight` boost
  is a static per-pixel proxy for eye adaptation. A real implementation
  would sample average scene luminance and adjust `toneMappingExposure`
  with a temporal smoothing filter (~2 s constant) — letting the same
  rendering work for stars-from-orbit and sun-disc-up-close without
  per-context tuning.  Now that the sky and the scene share one linear
  buffer ([HDR.md](../HDR.md)), that's #86's PR B.
- **Multiple-scattering.** Current LUT is single-scatter only; the
  twilight glow on the antisolar horizon is a multi-scattering
  phenomenon that would need additional precompute passes.
