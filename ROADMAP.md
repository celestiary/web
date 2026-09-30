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
  included. Body rotation (prime meridians) is still a placeholder
  ([#96](https://github.com/celestiary/web/issues/96)).
- **Surfaces:** Earth, the Moon and Mars swap in place to Cesium's
  globes (terrain, imagery, ground-following zoom and landing), matched in
  colour and lighting to celestiary's own bodies. See
  [CESIUM.md](CESIUM.md).
- **Earth:** the simulation month's Blue Marble on both sides of the swap,
  Bing detail close in, celestiary's night lights and clouds on its own
  side only.
- **Stars:** ~120k stars from Celestia's Hipparcos-based `stars.dat`,
  asterisms, search over named stars and HIP numbers, pick-to-travel.
- **Galaxy:** a procedural 60k-point barred spiral (`MilkyWay.js`),
  hand-tuned, with a disc several times too thick so it contains the
  local catalogue.
- **Rendering:** PBR Neutral tone mapping, target-keyed exposure, a
  Bruneton atmosphere pass; an 8-bit LDR scene buffer, so stars and sky
  are held in balance by tuned constants, not physics.

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
  pipeline of [#86](https://github.com/celestiary/web/issues/86) once it lands, not the current LDR one, so it isn't
  tuned twice. Until then, keep new constants few and documented.
- **One look across the Cesium swap.** Anything drawn on a body Cesium can
  replace (Earth, the Moon, Mars) must look the same on both sides, and is
  verified numerically: median pixel ratios with the layer forced on and
  off, per [AGENTS.md](AGENTS.md#working-efficiently).
- **Evidence with every visual change:** screenshots or the PR preview.

## Now / Next / Later

The recommended order. "Now" is what to pick up first; within a group the
order is a suggestion.

**Done recently:** the Moon orbit ([#87](https://github.com/celestiary/web/issues/87), PR [#130](https://github.com/celestiary/web/pull/130)); the data policy
([#107](https://github.com/celestiary/web/issues/107), PR [#129](https://github.com/celestiary/web/pull/129)); the scripted parity check, `yarn parity`
([#105](https://github.com/celestiary/web/issues/105), PR [#134](https://github.com/celestiary/web/pull/134); see [CESIUM.md](CESIUM.md#parity-check)); the Moon's rotation
and orbital periods in `moon.json` ([#132](https://github.com/celestiary/web/issues/132), PR [#135](https://github.com/celestiary/web/pull/135)); the stars in the
ecliptic of date, one scene frame ([#133](https://github.com/celestiary/web/issues/133), PR [#136](https://github.com/celestiary/web/pull/136)); the other moons' and
Pluto's orbital planes and elements, and the planets' IAU poles
([#6](https://github.com/celestiary/web/issues/6), PR [#137](https://github.com/celestiary/web/pull/137)); the far points, a debugging aid for track B: moons'
points visible again, and hidden behind nearer bodies (PR PRNUM; see DESIGN.md
[the far point](DESIGN.md#the-far-point)).

**Now**
1. **Body orientation** ([#96](https://github.com/celestiary/web/issues/96), in [#112](https://github.com/celestiary/web/issues/112)): with the moons' planes ([#6](https://github.com/celestiary/web/issues/6)) and one
   scene frame ([#133](https://github.com/celestiary/web/issues/133)) done, the IAU prime meridians (the poles landed with
   #6; every body but Earth and the Moon still spins once a day), with
   synchronous moons facing their planets. Then Horizons regression tests
   for every body ([#97](https://github.com/celestiary/web/issues/97)).
2. **Physically based light and exposure** ([#86](https://github.com/celestiary/web/issues/86), [#109](https://github.com/celestiary/web/issues/109)). The foundation of
   the rendering track: it changes the scene buffer, so it goes before
   more visual tuning. PR A (linear half-float scene, one tone map, the
   sky in exposure units, Cesium in the same units) first, then PR B
   (physical stars, metered exposure, removing the hacks). `yarn parity`
   is its check across the swap: the Moon is 9.5% darker on Cesium's
   side, and Earth's Cesium side is redder and lacks the blue haze
   close in.

**Next**
3. **Earth across the swap** ([#110](https://github.com/celestiary/web/issues/110)): night lights ([#93](https://github.com/celestiary/web/issues/93)), then the imagery
   detail layer ([#92](https://github.com/celestiary/web/issues/92)), then clouds ([#88](https://github.com/celestiary/web/issues/88)). After #86's PR A, so
   they're tuned once. #92's low views need `dev.virtualearth.net`
   (Bing) reachable from the sandbox.
4. **Milky Way** ([#116](https://github.com/celestiary/web/issues/116)): the realistic shape ([#99](https://github.com/celestiary/web/issues/99)), then the brightest
   ~1M Gaia stars ([#98](https://github.com/celestiary/web/issues/98)), then galactic dynamics with a dark-matter toggle
   ([#106](https://github.com/celestiary/web/issues/106)). See [the galaxy plan](#the-galaxy-plan).
5. **Sharing and picking through Cesium** ([#118](https://github.com/celestiary/web/issues/118)): the layer choice and
   follow state in the permalink (small), then picking on Cesium's globes.

**Later**
6. Small bodies and satellites ([#114](https://github.com/celestiary/web/issues/114)), starting with the asteroid data
   already in the repo ([#30](https://github.com/celestiary/web/issues/30)).
7. Lookup beyond the bundled catalogue and exoplanet systems ([#115](https://github.com/celestiary/web/issues/115)).
8. Distinctive appearances: Sun, gas giants, rings, auroras ([#111](https://github.com/celestiary/web/issues/111)).
9. Surfaces and relief for bodies Cesium doesn't cover ([#113](https://github.com/celestiary/web/issues/113)).
10. Deep sky: nebulae, other galaxies, Sgr A\* ([#117](https://github.com/celestiary/web/issues/117)).
11. Spacecraft: integrator, then flight simulation ([#119](https://github.com/celestiary/web/issues/119)); missions and
    models ([#120](https://github.com/celestiary/web/issues/120)).

Housekeeping ([#122](https://github.com/celestiary/web/issues/122)) happens alongside, whenever it's cheap.

## Tracks

Each table lists the track's epics in order. "Docs" is where to read
before starting.

### A. Rendering fidelity

Make the sky, the Sun, Earth and the giants look right, on one physically
based light scale, and the same on both sides of the Cesium swap.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#109](https://github.com/celestiary/web/issues/109) Physically based light and exposure | [#86](https://github.com/celestiary/web/issues/86), [#59](https://github.com/celestiary/web/issues/59), [#71](https://github.com/celestiary/web/issues/71) | [#87](https://github.com/celestiary/web/issues/87) for the daytime-Moon benchmark | [Planet.md, lighting and exposure](js/scene/Planet.md#lighting-and-exposure), [atmosphere composition](js/scene/atmos/composition.md) |
| [#110](https://github.com/celestiary/web/issues/110) Earth across the Cesium swap | [#93](https://github.com/celestiary/web/issues/93), [#92](https://github.com/celestiary/web/issues/92), [#88](https://github.com/celestiary/web/issues/88) | [#105](https://github.com/celestiary/web/issues/105); re-check after [#109](https://github.com/celestiary/web/issues/109) | [CESIUM.md](CESIUM.md#data), [Planet.md, texture sources](js/scene/Planet.md#surface-texture-sources) |
| [#111](https://github.com/celestiary/web/issues/111) Sun, gas giants, rings, auroras | [#21](https://github.com/celestiary/web/issues/21), [#41](https://github.com/celestiary/web/issues/41), [#23](https://github.com/celestiary/web/issues/23), [#95](https://github.com/celestiary/web/issues/95) | [#109](https://github.com/celestiary/web/issues/109) for anything emissive | [rings.md](js/scene/rings/rings.md), DESIGN.md [rendering techniques](DESIGN.md#rendering-techniques) |

### B. Solar-system accuracy and surfaces

Every body where it really is, turned the way it really is, with a real
surface.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#112](https://github.com/celestiary/web/issues/112) Ephemerides and orientation | [#87](https://github.com/celestiary/web/issues/87) (done), [#6](https://github.com/celestiary/web/issues/6) (done), [#133](https://github.com/celestiary/web/issues/133) (done), [#96](https://github.com/celestiary/web/issues/96), [#97](https://github.com/celestiary/web/issues/97), [#132](https://github.com/celestiary/web/issues/132) (done), [#138](https://github.com/celestiary/web/issues/138), [#139](https://github.com/celestiary/web/issues/139), [#140](https://github.com/celestiary/web/issues/140) | nothing | DESIGN.md [orbital mechanics](DESIGN.md#orbital-mechanics), [coordinates](DESIGN.md#coordinate-system--scale) |
| [#113](https://github.com/celestiary/web/issues/113) Surfaces for every body | [#9](https://github.com/celestiary/web/issues/9), [#10](https://github.com/celestiary/web/issues/10), [#43](https://github.com/celestiary/web/issues/43) | data policy for bundled DEMs | [Planet.md](js/scene/Planet.md), [CESIUM.md, ground](CESIUM.md#camera-and-light-coupling) |

The orbit gap is closed: the Moon has its own theory and orbital frame
([#130](https://github.com/celestiary/web/pull/130)), and Pluto and the other moons follow published mean elements
in their Laplace planes or equators, precessed to date, with offline JPL
Horizons fixture tests ([#6](https://github.com/celestiary/web/issues/6); see DESIGN.md [mean elements](DESIGN.md#mean-elements-pluto-and-the-moons)). Mean
elements leave phase errors of a few degrees over decades for the
resonant Galileans, and tens of degrees for Mars's, Uranus's and
Neptune's moons, whose tabulated periods or epoch angles are too coarse:
a per-system theory (Lieske E5, TASS, GUST86) or the JPL ephemerides is
the refinement. [#97](https://github.com/celestiary/web/issues/97) extends the Horizons tests to every body, and [#96](https://github.com/celestiary/web/issues/96) turns
the bodies to their IAU prime meridians. The whole scene, stars
included, is in the ecliptic of date ([#133](https://github.com/celestiary/web/issues/133)).

### C. Catalogues and external data

Real populations from public catalogues, under the data policy.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#114](https://github.com/celestiary/web/issues/114) Asteroids, comets, satellites | [#30](https://github.com/celestiary/web/issues/30), [#50](https://github.com/celestiary/web/issues/50) | data policy; [#112](https://github.com/celestiary/web/issues/112)'s orbital frames; 3D models ([#25](https://github.com/celestiary/web/issues/25)) for satellites | DESIGN.md [data loading](DESIGN.md#data-loading) |
| [#115](https://github.com/celestiary/web/issues/115) Lookup beyond the catalogue, and exoplanets | [#39](https://github.com/celestiary/web/issues/39), [#12](https://github.com/celestiary/web/issues/12) | [#112](https://github.com/celestiary/web/issues/112) for multi-planet orbits | [search design](js/search/DESIGN.md) |

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
| [#118](https://github.com/celestiary/web/issues/118) Navigation, time and sharing | [#101](https://github.com/celestiary/web/issues/101), [#102](https://github.com/celestiary/web/issues/102), [#100](https://github.com/celestiary/web/issues/100), [#42](https://github.com/celestiary/web/issues/42) | picking needs readback from portal-netgl's shadow context | [permalink.md](js/permalink.md), DESIGN.md [navigation](DESIGN.md#navigation-goto-flow), [CESIUM.md follow-ups](CESIUM.md#follow-ups) |

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
