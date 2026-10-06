# Roadmap

Where celestiary is going, in what order, and why. The issues are the
source of truth for the details: each track below is a set of epics, and
each epic is a GitHub issue labelled `epic` whose sub-issues are the work.
This doc holds what an issue can't: the order, the dependencies between
tracks, and the decisions that apply across them.

Keep it current, in the PR that makes the change: a PR that closes an
issue, lands an epic's piece or shifts priorities updates the
**Now / Next / Later** list and the track tables itself, so there are no
separate roadmap PRs. When a decision here changes, say what replaced
it and why.

## Where we are

- **Solar system:** planets on VSOP87C and the Moon on Meeus's truncated
  ELP-2000/82 (within ~4″ of JPL Horizons, 1950–2050); Pluto and the other
  moons on published mean elements in their real orbital planes (Laplace
  planes or equators), with the planets' IAU poles. The Galileans, Titan
  and Pluto are within 0.3° of Horizons' planes, and in phase within 3°
  (Europa, by 2050) and 0.02°. All in the ecliptic of date, the stars
  included. Every body turns by its IAU WGCCRE pole and prime meridian,
  within 0.003° of Horizons' sub-observer points, Earth by GMST
  ([#96](https://github.com/celestiary/web/issues/96)).
- **Surfaces:** Earth, the Moon and Mars swap in place to Cesium's
  globes (terrain, imagery, ground-following zoom and landing), matched in
  colour and lighting to celestiary's own bodies. See
  [CESIUM.md](CESIUM.md).
- **Earth:** the simulation month's Blue Marble on both sides of the swap,
  under celestiary's atmosphere on both, Bing detail close in,
  celestiary's night lights and clouds on its own side only.
- **Stars:** ~120k stars from Celestia's Hipparcos-based `stars.dat`,
  asterisms, search over named stars and HIP numbers, pick-to-travel.
- **Galaxy:** a procedural 60k-point barred spiral (`MilkyWay.js`),
  hand-tuned, with a disc several times too thick so it contains the
  local catalogue.
- **Rendering:** one linear, half-float scene buffer in exposure units
  (target-keyed exposure), the Bruneton sky added in the same units, and
  one tone map, PBR Neutral, last ([HDR.md](js/scene/HDR.md)); Cesium's
  layers composite in the same units; the stars, the Milky Way and the
  Sun's disc at their physical brightness in those units, and the
  exposure metered from the buffer over the target-keyed one, so the day
  sky hides the stars by its light and twilight and the night bring them
  out (#86's PR B).

## Decisions that apply across tracks

- **Data: bundle up to hundreds of MB, fetch beyond.** External data in
  the tens to hundreds of MB is bundled in the repo, with large binaries
  in Git LFS, under `public/large/`. Gaia-scale data (GB and up) is
  fetched over the network. The workflows fetch LFS files (cached), and
  PR previews load large data from `main`'s deploy at
  `celestiary.github.io/web/` (same origin as the previews) instead of
  copying it (a Pages site is capped at about 1 GB), unless the PR
  changes that data; see [DESIGN.md, data policy](DESIGN.md#data-policy)
  ([#107](https://github.com/celestiary/web/issues/107)). Document each dataset's source, licence and rebuild recipe
  next to the code that uses it (e.g. [Planet.md](js/scene/Planet.md#surface-texture-sources)).
- **Physically based first.** New visual work is tuned against the HDR
  pipeline of [#86](https://github.com/celestiary/web/issues/86), not the old LDR one, so it isn't tuned twice. Its
  buffer and single tone map (PR A), physical stars and metered exposure
  (PR B) are in; keep new constants few and documented.
- **One look across the Cesium swap.** Anything drawn on a body Cesium can
  replace (Earth, the Moon, Mars) must look the same on both sides, and is
  verified numerically: median pixel ratios with the layer forced on and
  off, per [AGENTS.md](AGENTS.md#working-efficiently).
- **Evidence with every visual change:** screenshots or the PR preview.

## Now / Next / Later

The recommended order. "Now" is what to pick up first; within a group the
order is a suggestion.

**Done recently:** a planning pass (2026-10-06): the Sun and stars split into their own epic (#164), the Gazetteer, volumetric-cloud and procedural-exoplanet issues filed, #88 and #99 rescoped, the place-names regression found (#172), and three shared engines named to order the work; the debug axes inside the Sun and planets removed from the production scene (they showed at extreme zooms); esbuild hot-reload guarded by build-time `__DEV__` flag, so production and PR previews no longer log 404 errors for the nonexistent `/esbuild` endpoint; fixed moon radius data errors (Triton 10x, Janus 10x, Rhea 2x); a 30 s timeout on the Colonization whole-catalog test, which outran bun's 5 s default under load; patched transitive dependencies fflate (^0.8.3) and uuid (^11.1.1) with yarn resolutions to clear moderate dependabot alerts; the Moon orbit ([#87](https://github.com/celestiary/web/issues/87), PR [#130](https://github.com/celestiary/web/pull/130)); the data policy
([#107](https://github.com/celestiary/web/issues/107), PR [#129](https://github.com/celestiary/web/pull/129)); the scripted parity check, `yarn parity`
([#105](https://github.com/celestiary/web/issues/105), PR [#134](https://github.com/celestiary/web/pull/134); see [CESIUM.md](CESIUM.md#parity-check)); the Moon's rotation
and orbital periods in `moon.json` ([#132](https://github.com/celestiary/web/issues/132), PR [#135](https://github.com/celestiary/web/pull/135)); the stars in the
ecliptic of date, one scene frame ([#133](https://github.com/celestiary/web/issues/133), PR [#136](https://github.com/celestiary/web/pull/136)); the other moons' and
Pluto's orbital planes and elements, and the planets' IAU poles
([#6](https://github.com/celestiary/web/issues/6), PR [#137](https://github.com/celestiary/web/pull/137)); two debugging aids for track B: the far points,
with moons' points visible again and hidden behind nearer bodies (PR [#143](https://github.com/celestiary/web/pull/143); see DESIGN.md
[the far point](DESIGN.md#the-far-point)), and orbit lines drawn from each body's own ephemeris,
so the bodies sit on them (PR [#142](https://github.com/celestiary/web/pull/142)), which also limits the simulation to the
dates its ephemerides hold, J2000 ± 6000 years (DESIGN.md [frames and time](DESIGN.md#frames-and-time)); [#86](https://github.com/celestiary/web/issues/86)'s PR A (PR [#141](https://github.com/celestiary/web/pull/141)), one linear
HDR buffer and one tone map, the sky in exposure units, and Earth's
Cesium layer under celestiary's atmosphere, hazing Cesium's terrain for
its own distance ([HDR.md](js/scene/HDR.md)).
Orbit drag slows with proximity: `rotateScale` turns it by `1 - exp(-alt / R)` of full speed, so a drag moves a similar share of the visible ground at 200 m as at 20,000 km (PR [#144](https://github.com/celestiary/web/pull/144); DESIGN.md [proximity-scaled orbit drag](DESIGN.md#proximity-scaled-orbit-drag)).
The atmosphere pass from under a body's datum (Valles Marineris, the Dead Sea), one model: a ray from an eye below the ground sphere is marched to where it leaves the sphere and the tables take over there, the horizon side of a lookup is decided once from the ray's geometry (the black band that flickered at the horizon on a real GPU was rounding), the march integrates each step exactly, below-datum permalinks restore (the ground floor waits for Cesium's terrain height), and the restored camera quaternion is normalized (PR #145; [composition.md](js/scene/atmos/composition.md#the-tables-domain-and-rays-that-start-outside-it)).  Mars's sky away from the Sun was as dim as its single-scatter parameters made it (0.04 of a sunlit white surface at the zenith).
#86's PR B (PR [#153](https://github.com/celestiary/web/pull/153)): the stars, the Milky Way and the Sun's disc in exposure units, a star's light over at least the dark-adapted eye's 10 arcmin so the star field is the same on any screen; the exposure metered from the HDR buffer over the target-keyed one (the mean log luminance keyed to middle grey, a highlight cap that anchors any frame holding a sunlit surface, a fall below 1 for the Sun's disc, eased 1.5 s up and 0.3 s down), so the day sky hides the stars by its light and twilight, the night and deep space bring them out, Mars's low-Sun sky comes up, and the Sun's granulation shows; the eye-adaptation boost, the 0.08 transmittance floor and `beyondAtm` are gone; Cesium's decode follows the exposure ([HDR.md](js/scene/HDR.md#physical-stars)).
Stars past 1,950 ly (2^64 m, sqrt(FLT_MAX)) from the camera, for Apple GPUs: under Metal's fast math the inverse square folded into a square of the distance in metres, Inf, so they went black (Alnilam at the screen's centre, Thabit and Na'ir al Saif as the camera backed off); it is now taken in logs, the wide lines' and labels' lengths go through a barrier, and the stars' and the Milky Way's clip coordinates leave at w = 1 ([HDR.md](js/scene/HDR.md#physical-stars)).
Body orientation ([#96](https://github.com/celestiary/web/issues/96), PR [#149](https://github.com/celestiary/web/pull/149)): every body but Earth turns by the IAU WGCCRE 2015 rotation model, pole and prime meridian with the periodic terms (the Moon too, from Cassini's laws, 0.035° away), within 0.003° of JPL Horizons' sub-observer points from 1950 to 2050 (offline fixture; the first of [#97](https://github.com/celestiary/web/issues/97)'s tests); before, every body but Earth and the Moon turned once a day from an arbitrary meridian.  Synchronous moons face their planets as a result, where their mean elements keep their phase; five textures centred on 180° are turned to match (`texture_longitude`), and Jupiter's clouds follow System II with the Great Red Spot at its observed longitude (DESIGN.md [body rotation](DESIGN.md#body-rotation-iau-prime-meridians), [Planet.md](js/scene/Planet.md#texture-longitudes)).
Mars's day sky (PR #147): multiple scattering in the precompute, for every body (Hillaire's isotropic sum from the transmittance table; [composition.md](js/scene/atmos/composition.md#multiple-scattering)), and Mars's dust as published data: optical depth 0.5 through the gas scale height, a single-scattering albedo that absorbs blue, a two-lobe phase function sharper forward in the blue, the physical gain; the zenith sky went from 0.040 to 0.092 of a sunlit white surface (tan, three quarters of it multiply scattered), the anti-solar horizon from 0.13 to 0.19, and the sunward sky 20° from the Sun from 2.9 to 0.6, so near terrain reads again.  Earth gains the same term with its gain re-fitted (30 → 21).  What's left for #86's PR B is exposure: at a low Sun the whole scene, sky included, sits in Neutral's toe.
The search bar's two actions: Go (an arrow; travels, as Enter does) and Look at (the magnifier; targets the result and turns the camera in place, without moving), for checking which face of a body points at the viewer ([js/search/DESIGN.md](js/search/DESIGN.md#go-and-look-at)) (PR [#151](https://github.com/celestiary/web/pull/151)).
Pre-exposure ([#157](https://github.com/celestiary/web/issues/157)): the HDR buffer was found to hold every emitted source at the frame's gain already (PR B's `uExposureRelative` is the target-keyed exposure over Earth's times the metered gain), so a mag 6 star at the dark gain is 0.17 in the buffer and Sirius 170, not 1e-6 as the issue feared; the gain the frame renders with is now recorded once and divides the meter's readback, emitted radiance under half-float's smallest normal value (6.1e-5, 1/65 of a display step) is written as zero so a GPU that flushes subnormals and one that keeps them hold the same buffer, and the half-float ends are measured: the Sun's disc in a dark-adapted frame is the one source that reaches the top, physically (1e9 over white), and the shoulder holds it, so the shoulder is the fix there, not a stopgap ([HDR.md, pre-exposure](js/scene/HDR.md#pre-exposure)); and the sunlit-body anchor weighs by a disc's share of the field (its solid angle), not its size in pixels, so the Moon at 45° leaves a star field at the dark gain where the pixel weight had taken it to 40 and shown no stars (HDR.md, metered exposure rule 5; veiling glare and the moonlit sky are the recorded next steps).

The star guide demo ([#165](https://github.com/celestiary/web/issues/165), the star renderer's workbench): its star links resolved against `<base href="/">` to the app root, and the router's referrer redirect then dropped the hash, so no `#Name` ever selected a star; the disc was never metered, because ThreeUI meters a resolved star's disc from its scene manager's objects and the guide had none (the Sun shader's radiance assumes the metered exposure, so it saturated white), now `guide/starScene.js`; with no hash the page showed whichever star the empty name `''` mapped to (`starnames.dat`'s trailing colons: HIP 24160), now Sol by default, and an empty name names no star.  The other guide pages were checked against the same pipeline: Planet (its Sun light had decay 0 where the exposure is calibrated to the app's 1.01, its surface waits on a `preAnimCb` the guide never ran), Stars (its store stub had no `getState`, which threw every frame) and Asterisms (it passed an empty catalog, so no asterisms were ever built) drew nothing or black, and draw now.  Left: the Atmosphere page, a work-in-progress demo with its own shader, still draws only its axes.

**Now** (small, visible, unblocked)
1. **Place names back on Earth, the Moon and Mars** ([#172](https://github.com/celestiary/web/issues/172)): the
   Cesium layer hides each body's places group, a leftover from before
   labels drew in the overlay pass.
2. **Night lights on Cesium's Earth** ([#93](https://github.com/celestiary/web/issues/93)): ion's Earth at Night
   (asset 3812) isn't in the account; add it from the Asset Depot, or tile
   the bundled night map, then match it to celestiary's side numerically.
3. **The galaxy's integrated light** ([#99](https://github.com/celestiary/web/issues/99), rescoped): a smooth disc and
   bulge carrying the Milky Way's luminosity, the arms as density and
   colour, dust and HII regions, so the galaxy from outside reads like a
   photograph and the meter needs no help. See [the galaxy plan](#the-galaxy-plan).

**Next** (the shared engines, below)

4. **Stars up close** ([#164](https://github.com/celestiary/web/issues/164)): the photosphere ([#21](https://github.com/celestiary/web/issues/21)), then every star
   from its parameters ([#166](https://github.com/celestiary/web/issues/166)), on one star renderer: the first of the
   parametric body renderer.
5. **Place names for every body** ([#170](https://github.com/celestiary/web/issues/170)) from the IAU Gazetteer: the
   labels engine.
6. **Earth's clouds from data** ([#88](https://github.com/celestiary/web/issues/88)): daily NASA GIBS imagery where it
   exists, a shell over both sides of the swap; then the imagery detail
   layer ([#92](https://github.com/celestiary/web/issues/92)), which needs `dev.virtualearth.net` reachable from the
   sandbox.
7. **Gaia's brightest ~1M stars** ([#98](https://github.com/celestiary/web/issues/98)): the point-population engine,
   designed under its heaviest load.
8. **Sharing and picking through Cesium** ([#118](https://github.com/celestiary/web/issues/118)): the layer choice and
   follow state in the permalink (small), then picking on Cesium's globes.

**Later**
9. The Sun's dynamic layers ([#167](https://github.com/celestiary/web/issues/167)) and its corona and wind ([#168](https://github.com/celestiary/web/issues/168)).
10. Volumetric clouds up close ([#169](https://github.com/celestiary/web/issues/169)), seeded from #88's map; then
    Venus, Titan and the giants.
11. Gas giants on the parametric renderer ([#41](https://github.com/celestiary/web/issues/41)); rings ([#95](https://github.com/celestiary/web/issues/95)); auroras ([#23](https://github.com/celestiary/web/issues/23)).
12. Exoplanet systems ([#12](https://github.com/celestiary/web/issues/12)) drawn procedurally ([#171](https://github.com/celestiary/web/issues/171)); lookup beyond the
    catalogue ([#39](https://github.com/celestiary/web/issues/39)).
13. Small bodies and satellites ([#114](https://github.com/celestiary/web/issues/114)) on the point-population engine,
    starting with the asteroid data already in the repo ([#30](https://github.com/celestiary/web/issues/30)).
14. Surfaces and relief for bodies Cesium doesn't cover ([#113](https://github.com/celestiary/web/issues/113)).
15. Deep sky: nebulae, other galaxies, Sgr A\* ([#117](https://github.com/celestiary/web/issues/117)); galactic dynamics ([#106](https://github.com/celestiary/web/issues/106)).
16. Spacecraft: integrator, then flight simulation ([#119](https://github.com/celestiary/web/issues/119)); missions and
    models ([#120](https://github.com/celestiary/web/issues/120)).

**Background** (alongside, whenever there's room)
- **Horizons regression tests for every body** ([#97](https://github.com/celestiary/web/issues/97), in [#112](https://github.com/celestiary/web/issues/112)): orientation
  is done ([#96](https://github.com/celestiary/web/issues/96)), with its sub-observer fixture. Positions next, and the
  moons whose mean elements lose their phase: Phobos and Deimos (up to
  170° by 1950 and 2050), Janus, Triton, and Titania and Oberon at every
  date (URA182's epoch angles); the per-system theories ([#138](https://github.com/celestiary/web/issues/138), [#139](https://github.com/celestiary/web/issues/139), [#140](https://github.com/celestiary/web/issues/140)).
- **What's left of physically based light** ([#109](https://github.com/celestiary/web/issues/109)): [#86](https://github.com/celestiary/web/issues/86) and pre-exposure
  ([#157](https://github.com/celestiary/web/issues/157)) are done ([HDR.md](js/scene/HDR.md#pre-exposure)); left are the benchmarks, the
  Artemis photo ([#59](https://github.com/celestiary/web/issues/59)) and the atmosphere QA ([#71](https://github.com/celestiary/web/issues/71)), the moonlit sky
  ([#163](https://github.com/celestiary/web/issues/163)), veiling glare round bright discs, and the night sky's own light
  (airglow, the zodiacal light;
  [composition.md](js/scene/atmos/composition.md#known-gaps--future-work)).

### Shared engines

Most of the list rests on three pieces of infrastructure; building each
once covers several features, so the order above builds them first.

- **A parametric body renderer**: one shader family driven by physical
  parameters (temperature, radius, composition, rotation), the same rule
  as the atmospheres. The Sun is its reference case ([#164](https://github.com/celestiary/web/issues/164)); every star
  ([#166](https://github.com/celestiary/web/issues/166)), the gas giants ([#41](https://github.com/celestiary/web/issues/41)) and procedural exoplanets ([#171](https://github.com/celestiary/web/issues/171)) reuse it.
- **Labels and nomenclature**: one catalogue pipeline (the IAU Gazetteer
  plus Earth's places) and one label renderer that is the same on both
  sides of the Cesium swap ([#170](https://github.com/celestiary/web/issues/170), [#172](https://github.com/celestiary/web/issues/172)); later spacecraft and exoplanet names.
- **Point populations**: one tiled, instanced point renderer with LOD and
  magnitude cuts, for Gaia ([#98](https://github.com/celestiary/web/issues/98)), asteroids and comets ([#30](https://github.com/celestiary/web/issues/30)),
  satellites ([#50](https://github.com/celestiary/web/issues/50)) and the telescope mode ([#155](https://github.com/celestiary/web/issues/155)).

Housekeeping ([#122](https://github.com/celestiary/web/issues/122)) happens alongside, whenever it's cheap.

## Tracks

Each table lists the track's epics in order. "Docs" is where to read
before starting.

### A. Rendering fidelity

Make the sky, the Sun, Earth and the giants look right, on one physically
based light scale, and the same on both sides of the Cesium swap.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#109](https://github.com/celestiary/web/issues/109) Physically based light and exposure | [#86](https://github.com/celestiary/web/issues/86) (done), [#59](https://github.com/celestiary/web/issues/59), [#71](https://github.com/celestiary/web/issues/71), [#157](https://github.com/celestiary/web/issues/157) (done: pre-exposure), [#163](https://github.com/celestiary/web/issues/163) | [#87](https://github.com/celestiary/web/issues/87) for the daytime-Moon benchmark | [HDR.md](js/scene/HDR.md) (PR A, PR B and pre-exposure done), [Planet.md, lighting and exposure](js/scene/Planet.md#lighting-and-exposure), [atmosphere composition](js/scene/atmos/composition.md) |
| [#110](https://github.com/celestiary/web/issues/110) Earth across the Cesium swap | [#93](https://github.com/celestiary/web/issues/93), [#92](https://github.com/celestiary/web/issues/92), [#88](https://github.com/celestiary/web/issues/88) | [#105](https://github.com/celestiary/web/issues/105); re-check after [#109](https://github.com/celestiary/web/issues/109) | [CESIUM.md](CESIUM.md#data), [Planet.md, texture sources](js/scene/Planet.md#surface-texture-sources) |
| [#164](https://github.com/celestiary/web/issues/164) Stars up close: a dynamic Sun, every star from its parameters | [#165](https://github.com/celestiary/web/issues/165) (done), [#21](https://github.com/celestiary/web/issues/21), [#166](https://github.com/celestiary/web/issues/166), [#167](https://github.com/celestiary/web/issues/167), [#168](https://github.com/celestiary/web/issues/168) | [#109](https://github.com/celestiary/web/issues/109) (emissive, in exposure units) | [HDR.md, physical stars](js/scene/HDR.md#physical-stars) |
| [#111](https://github.com/celestiary/web/issues/111) Gas giants, rings, auroras, clouds | [#41](https://github.com/celestiary/web/issues/41), [#23](https://github.com/celestiary/web/issues/23), [#95](https://github.com/celestiary/web/issues/95), [#169](https://github.com/celestiary/web/issues/169) | [#109](https://github.com/celestiary/web/issues/109) for anything emissive; [#164](https://github.com/celestiary/web/issues/164)'s renderer for [#41](https://github.com/celestiary/web/issues/41); [#88](https://github.com/celestiary/web/issues/88) for [#169](https://github.com/celestiary/web/issues/169) | [rings.md](js/scene/rings/rings.md), DESIGN.md [rendering techniques](DESIGN.md#rendering-techniques) |

### B. Solar-system accuracy and surfaces

Every body where it really is, turned the way it really is, with a real
surface.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#112](https://github.com/celestiary/web/issues/112) Ephemerides and orientation | [#87](https://github.com/celestiary/web/issues/87) (done), [#6](https://github.com/celestiary/web/issues/6) (done), [#133](https://github.com/celestiary/web/issues/133) (done), [#96](https://github.com/celestiary/web/issues/96) (done), [#97](https://github.com/celestiary/web/issues/97), [#132](https://github.com/celestiary/web/issues/132) (done), [#138](https://github.com/celestiary/web/issues/138), [#139](https://github.com/celestiary/web/issues/139), [#140](https://github.com/celestiary/web/issues/140) | nothing | DESIGN.md [orbital mechanics](DESIGN.md#orbital-mechanics), [coordinates](DESIGN.md#coordinate-system--scale) |
| [#113](https://github.com/celestiary/web/issues/113) Surfaces for every body | [#9](https://github.com/celestiary/web/issues/9), [#10](https://github.com/celestiary/web/issues/10), [#43](https://github.com/celestiary/web/issues/43), [#170](https://github.com/celestiary/web/issues/170) | data policy for bundled DEMs | [Planet.md](js/scene/Planet.md), [CESIUM.md, ground](CESIUM.md#camera-and-light-coupling) |

The orbit gap is closed: the Moon has its own theory and orbital frame
([#130](https://github.com/celestiary/web/pull/130)), and Pluto and the other moons follow published mean elements
in their Laplace planes or equators, precessed to date, with offline JPL
Horizons fixture tests ([#6](https://github.com/celestiary/web/issues/6); see DESIGN.md [mean elements](DESIGN.md#mean-elements-pluto-and-the-moons)). Mean
elements leave phase errors of a few degrees over decades for the
resonant Galileans, and tens of degrees for Mars's, Uranus's and
Neptune's moons, whose tabulated periods or epoch angles are too coarse:
a per-system theory (Lieske E5, TASS, GUST86) or the JPL ephemerides is
the refinement. [#96](https://github.com/celestiary/web/issues/96) turned the bodies to their IAU prime meridians, checked against
Horizons' sub-observer points, and [#97](https://github.com/celestiary/web/issues/97) extends the Horizons tests to every
body's position. The whole scene, stars
included, is in the ecliptic of date ([#133](https://github.com/celestiary/web/issues/133)).

### C. Catalogues and external data

Real populations from public catalogues, under the data policy.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#114](https://github.com/celestiary/web/issues/114) Asteroids, comets, satellites | [#30](https://github.com/celestiary/web/issues/30), [#50](https://github.com/celestiary/web/issues/50) | data policy; [#112](https://github.com/celestiary/web/issues/112)'s orbital frames; 3D models ([#25](https://github.com/celestiary/web/issues/25)) for satellites | DESIGN.md [data loading](DESIGN.md#data-loading) |
| [#115](https://github.com/celestiary/web/issues/115) Lookup beyond the catalogue, and exoplanets | [#39](https://github.com/celestiary/web/issues/39), [#12](https://github.com/celestiary/web/issues/12), [#171](https://github.com/celestiary/web/issues/171) | [#112](https://github.com/celestiary/web/issues/112) for multi-planet orbits | [search design](js/search/DESIGN.md) |

### D. Stars and deep sky

The universe past the Hipparcos neighbourhood.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#116](https://github.com/celestiary/web/issues/116) Milky Way: structure, Gaia stars, dynamics | [#99](https://github.com/celestiary/web/issues/99), [#98](https://github.com/celestiary/web/issues/98), [#106](https://github.com/celestiary/web/issues/106), [#108](https://github.com/celestiary/web/issues/108) | data policy | [the galaxy plan](#the-galaxy-plan) |
| [#117](https://github.com/celestiary/web/issues/117) Nebulae, galaxies, Sgr A\* | [#20](https://github.com/celestiary/web/issues/20), [#40](https://github.com/celestiary/web/issues/40), [#22](https://github.com/celestiary/web/issues/22) | [#116](https://github.com/celestiary/web/issues/116)'s frame and scale | DESIGN.md [coordinates](DESIGN.md#coordinate-system--scale) |

### E. Navigation, time and sharing

Everything the user does keeps working where Cesium draws the ground.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#118](https://github.com/celestiary/web/issues/118) Navigation, time and sharing | [#172](https://github.com/celestiary/web/issues/172), [#101](https://github.com/celestiary/web/issues/101), [#102](https://github.com/celestiary/web/issues/102), [#100](https://github.com/celestiary/web/issues/100), [#42](https://github.com/celestiary/web/issues/42) | picking needs readback from portal-netgl's shadow context | [permalink.md](js/permalink.md), DESIGN.md [navigation](DESIGN.md#navigation-goto-flow), [CESIUM.md follow-ups](CESIUM.md#follow-ups) |

### F. Spacecraft and missions

Things that fly, and real ones.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#119](https://github.com/celestiary/web/issues/119) Flight simulation | [#11](https://github.com/celestiary/web/issues/11), [#2](https://github.com/celestiary/web/issues/2) | [#112](https://github.com/celestiary/web/issues/112) | DESIGN.md [orbital mechanics](DESIGN.md#orbital-mechanics) |
| [#120](https://github.com/celestiary/web/issues/120) Missions and models | [#25](https://github.com/celestiary/web/issues/25), [#19](https://github.com/celestiary/web/issues/19), [#13](https://github.com/celestiary/web/issues/13) | [#25](https://github.com/celestiary/web/issues/25) first: satellites and spacecraft need models | |

### G. Platform, performance and quality

Keep the Cesium compositing fast and checked by scripts, and keep the
repo lean.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#121](https://github.com/celestiary/web/issues/121) Cesium performance and verification | [#105](https://github.com/celestiary/web/issues/105) (done), [#104](https://github.com/celestiary/web/issues/104), [#103](https://github.com/celestiary/web/issues/103) | [#103](https://github.com/celestiary/web/issues/103) is upstream in portal-netgl | [CESIUM.md](CESIUM.md#follow-ups), portal's [open problems](https://github.com/pablo-mayrgundter/portal/blob/main/packages/portal-netgl/DESIGN.md#open-problems-the-next-pr) |
| [#122](https://github.com/celestiary/web/issues/122) Housekeeping and data policy | [#107](https://github.com/celestiary/web/issues/107) (done) | | [AGENTS.md](AGENTS.md) |

## The galaxy plan

The goal is a Milky Way that looks like the real one from inside and
outside, and moves like it over billions of years, including the part
that needs dark matter.

1. **Shape from published models** ([#99](https://github.com/celestiary/web/issues/99)). Replace the hand-tuned
   parameters of `MilkyWay.js` with a published structural model: the
   bar and its angle, four major arms with measured pitch angles, dust
   lanes that absorb, the warp and flare of the outer disc, a thin and a
   thick disc at real scale heights (hundreds of parsecs, not the current
   ten thousand light years), and the bulge and stellar halo. The disc
   no longer needs to be thick enough to hold the local catalogue once
   Gaia supplies the stars around the Sun.
   It also carries the galaxy's integrated light, the unresolved light of
   billions of stars that makes a galaxy's look from outside: a smooth disc
   and bulge with the Milky Way's total luminosity in exposure units, the
   arms as density and colour on it, so the meter needs no help.
2. **The brightest ~1M Gaia stars** ([#98](https://github.com/celestiary/web/issues/98)). Gaia DR3 has about 1.8
   billion sources; a magnitude cut at around G ≈ 11 leaves on the order
   of a million (pick the exact cut from the archive's counts), which carries the look of the real sky. At the
   ~20 bytes per star of the current catalogue, a million is about 20 MB:
   bundleable under the data policy, and tiled (HEALPix or an octree by
   magnitude) so it loads progressively. Deeper cuts (tens of millions
   and up) are the network case. Merge with `stars.dat` without
   duplicates, colour from BP−RP, and keep a point budget so a laptop
   holds its frame rate.
3. **Dynamics from a mass model** ([#106](https://github.com/celestiary/web/issues/106)). Instead of pairwise N-body
   (O(N²), and unstable with the step sizes a viewer needs), move stars
   and gas as test particles in a smooth potential: bulge, stellar discs,
   gas disc and a dark-matter halo, from a published Milky Way mass model.
   Each particle's motion is independent, so it runs in a shader or a
   worker at millions of particles. Spiral arms are density waves with a
   pattern speed, and gas follows a flow field through them. The toggle
   is the point: with the halo, the rotation curve is flat as observed;
   without it, the curve falls off Keplerian-style, and over a few hundred
   Myr the outer disc visibly fails to hold together. Plot the curve
   alongside, against the observed one.
4. **Retire the old N-body** ([#108](https://github.com/celestiary/web/issues/108)): `Galaxy.js` and `gravity.js`, now
   only used by the `/guide` demo, go once [#106](https://github.com/celestiary/web/issues/106) gives the guide a
   replacement.

## Related docs

- [AGENTS.md](AGENTS.md): how to work in this repo, and the routing table
  to every design doc.
- [DESIGN.md](DESIGN.md): the architecture as built.
- [CESIUM.md](CESIUM.md): the Cesium layers, and their follow-ups.
- [PLAYBOOK.md](PLAYBOOK.md): how we plan, debug and verify.
- portal's [README](https://github.com/pablo-mayrgundter/portal#roadmap):
  the compositing library's own roadmap, which [#121](https://github.com/celestiary/web/issues/121) and [#118](https://github.com/celestiary/web/issues/118) depend on.
