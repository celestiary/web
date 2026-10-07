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
  was drawn in the scene pass before.  It goes through the transmittance as
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
Where its brightest possible contribution is under half a display step (by
day, in most of twilight) none of it is drawn and neither cache is
rendered (ThreeUi `_updateNightSkyShown`), nor where the ground fills the
view; and then its code isn't in the pass at all (`#if NIGHT_SKY`).

## Clouds

Earth's cloud shell (#88; [Planet.md, clouds](../Planet.md#clouds)) is in
the scene buffer before the pass runs, drawn over the ground as
premultiplied-over colour 6 km above it, and writes no depth.  So the pass
needs nothing of its own for clouds: a cloud's pixel reads the ground's
depth behind it, and is hazed as that ground, `sky + (cloud over ground) ×
T`, which from orbit (the shell's range: it's gone below 10 km) is the
cloud's own haze to within 6 km of air.  Seen from below the deck, a cloud
would want the march to it, not to the ground; that is #169's, with its
volumetric clouds.

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
ray's zenith cosine at the eye, the Sun's, and the eye's altitude; 7 the
linear composite before the tone map, the night sky's light in it, which
the metered exposure reads (ThreeUi `_meter`); 8 the night sky's light
alone (galaxy, zodiacal light, airglow, through the air), linear and
pre-exposed: divide by the exposure over Earth's keyed one for its
surface brightness.  In a
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
forward glow; those bodies keep the single-term look they have.  An
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
- `mieCoeff` (extinction per metre at the ground), `mieScaleHeight`: the
  aerosol or dust.  Its vertical optical depth is the product.
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

- Per-body `sunIntensity` — primary lever on overall day brightness.
- The metered exposure's constants (`exposure.js`: the key, the highlight
  cap, the gain's range and time constant), documented in HDR.md.

## Known gaps / future work

- **Surface-vs-atmosphere coloring from space.** The additive composite
  of inscatter + surface*T reads OK but the saturation/hue balance over
  land vs ocean isn't perfectly tuned, and the coastal hand-off looks
  slightly washed. Plausible knobs: per-channel inscatter scaling, a
  soft saturation curve on the composite, or proper aerial-perspective
  integration over the segment from surface depth back to camera.
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
