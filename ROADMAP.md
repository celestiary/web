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
  colour and lighting to celestiary's own bodies. Both Moons, celestiary's
  mesh and Cesium's tiles, are lit by one lunar photometric function, with
  crater relief from LRO LOLA's DEM along the terminator
  ([Planet.md](js/scene/Planet.md#the-moons-photometry)). See
  [CESIUM.md](CESIUM.md).
- **Earth:** the simulation month's Blue Marble on both sides of the swap,
  under celestiary's atmosphere on both, Bing detail close in,
  night lights (NASA's Black Marble, GIBS tiles on Cesium's side) on both
  sides, and the date's clouds from NASA GIBS's daily true colour, one
  shell over both sides, from orbit ([#88](https://github.com/celestiary/web/issues/88)).
- **Stars:** ~120k stars from Celestia's Hipparcos-based `stars.dat`,
  asterisms, search over named stars and HIP numbers, pick-to-travel.
- **Galaxy:** the Milky Way's integrated light from published structural
  models (thin and thick discs, boxy bulge and long bar, four arms as Reid
  et al. measured them, dust and the Great Rift's clouds, HII regions,
  warp and flare), 2.5e10 L☉ in exposure units, ray-marched
  ([MilkyWay.md](js/scene/MilkyWay.md)); from outside the meter frames it
  as a photograph; from inside the band shows at the dark-adapted eye's
  gain, over the night sky's own light (airglow, the zodiacal light).
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

**Done recently:** follow in the link ([#102](https://github.com/celestiary/web/issues/102); [design/URLs.md](design/URLs.md#view)): `f` is the `F` flag in `s=`, beside `T`, left out when off and set after the target on a reload, so a link made while following reloads following and an old link reloads not; the audit had left it out as transient, the decision was to add it; and a finding, that `f` has no effect today (`Shared.targets.follow` is written and nothing reads it, since the camera-controls rewrite took out its callback), so the flag records the key's state and what `f` should do is a separate piece of work; the Sun's light falls off as the inverse square ([#192](https://github.com/celestiary/web/issues/192)'s calibration's second proposal; [Planet.md, the Sun's light](js/scene/Planet.md#the-suns-light-the-inverse-square)): `SUN_LIGHT_DECAY` 1.01 → 2, the intensity the Sun's in candela so three's units are lux (the old irradiance at 1 AU with d² would have needed 4.3e39, past float32), and everything at 1 AU renders as it did (Earth, the Moon, the night lights, clouds, earthshine, the stars, Cesium's layers); bodies at other distances now keep their true brightness against one another in one frame, where the kludge had Jupiter 2.4 stops and Neptune 4.9 bright against the Moon; against JPL Horizons at the occultation's date (a new offline fixture with its queries) the giants went from 1.7-3.3 mag bright to 0.04-0.32 faint, the render matching a Lambert sphere at each texture's mean to 0.06 mag, with what's left the textures' albedo and Lambert's phase law (Mercury 2.4 bright, Venus 1.0 and Mars 1.0 off) and Saturn's rings, display-valued; at the occultation view Jupiter's disc is 1.6 times the crescent's surface brightness (Horizons 1.57; it was 8.4), so the meter no longer dims the Moon for it; the outer bodies' sky gains (`sunIntensity`) found to be a pre-HDR distance falloff counted twice, proposed back to the physical 4.71; Cesium ion imagery sessions ([#92](https://github.com/celestiary/web/issues/92)'s Bing detail layer; [CESIUM.md](CESIUM.md#cesium-ion-sessions)): the monthly quota ran out (1038 imagery sessions of 1000 in a week) because Earth's layer asked ion for Bing (asset 2, billed per session) as soon as Earth or the Moon was targeted, so nearly every page load near Earth and every headless run, parity view and PR preview spent one; Bing is now requested only when the camera is under the altitude where a Blue Marble texel spans more than 2 screen pixels (derived from the texel size, the field of view and the canvas, with the angle floored at the telescope clamp of #176, so Earth from the Moon never asks), once per page, and a 401 or 403 from ion drops quietly to Blue Marble; request counts to `/v1/assets/2/endpoint` fall from 1 to 0 for Earth targeted, from 20,000 km and a telescope on Earth from the Moon, and stay 1 landed; testing builds without the token (`CESIUM_ION_TOKEN= yarn build`, AGENTS.md); the review's three findings on the PR: from orbit the night side showed the day surface and no lights, because deferring World Terrain left the globe on the plain ellipsoid, whose Cesium shading has a 0.3 floor (5 × Lambert + 0.3), so the terrain is requested with the globe again, as it was before the PR ([CESIUM.md](CESIUM.md#earths-lighting-needs-the-terrain)); the texture's wrap-around was that same lit surface, with no seam in the Blue Marble layer at any longitude; and the base imagery's first two levels, ten tiles popping in on the first zoom, are now the 4096×2048 map celestiary's own Earth already loads, as one image under the tiles, which serve from globe level 3 (one request in place of three at 20,000 km; the [Planet.md](js/scene/Planet.md#surface-texture-sources) tiles of levels 0-2 can go); the Moon's relief on Cesium's tiles ([#192](https://github.com/celestiary/web/issues/192)'s rendering item 2, the follow-up to PR [#199](https://github.com/celestiary/web/pull/199); [CESIUM.md, relief on the Moon's tiles](CESIUM.md#relief-on-the-moons-tiles)): from Earth the Moon is Cesium's tileset, which lit a smooth sphere, so #199's crater relief showed only on celestiary's own mesh; the tileset's shader now samples the same LOLA normal map by the fragment's longitude and latitude (a `TextureUniform`, `js/scene/cesium/relief.js`) and takes the Sun's and earthshine's Lambert against the perturbed normal, so the terminator is rough with crater walls in light and shade across the swap (Tycho sits on its imagery's crater; the lit rims along the user's terminator land on celestiary's own Moon's), the log encoding untouched; the map fades out where it is magnified past 2 pixels a texel, since the tiles' geometry never gave the shader a normal; `moon-quarter` parity 0.985 and 19.0 / 5.07 (1.000 and 18.4 / 4.90 before), inside its bounds, and with the Moon's photometry below 1.000 (mean 1.017) and 5.2 / 1.8, `imageryScale` kept at 0.815; at the user's ev+10 view the terminator keeps its relief when Cesium's tiles take over from celestiary's Moon, where with the photometry alone it went smooth (#205's report: the swap, not the exposure, which holds); `yarn parity --abort regex` refuses ion URLs (an imagery asset over quota); cast shadows (a horizon map) remain proposed; the Moon's photometry ([#192](https://github.com/celestiary/web/issues/192)'s calibration's first proposal; [Planet.md, the Moon's photometry](js/scene/Planet.md#the-moons-photometry), [HDR.md, a star beside the Moon](js/scene/HDR.md#a-star-beside-the-moon)): both Moons, celestiary's mesh and Cesium's tileset, lit by one lunar photometric function (lunar-Lambert, McEwen's L(α), its phase function solved per phase so the disc follows JPL Horizons' V(1, α) to 0.02 mag; one GLSL chunk in both shaders), the colour map's stored values (a linear stretch of I/F) scaled to the Moon's normal albedo (geometric 0.121), and no specular; earthshine on celestiary's own Moon too, through the same function; the meter anchors the Moon on its own brightest surface at its phase; at the occultation view the Moon sums to V −8.32 (Horizons −8.42, the texture's face −8.32; it was −10.95), its lit part 6.07 mag/arcsec² (5.97; 3.41 before), its earthlit side 13.7 (13.8-14.4; black before on celestiary's Moon), Cesium's and celestiary's agreeing to 0.01 mag; parity's `moon-quarter` 1.000 at `imageryScale` 0.815; a camera response for the display stays open (the relief on Cesium's tileset, above, is done); the Moon's terminator in relief ([#192](https://github.com/celestiary/web/issues/192)'s rendering item 2; [Planet.md, relief](js/scene/Planet.md#relief)): a 2048×1024 normal map from LRO LOLA's DEM (`moon_normal.jpg`, 620 KB, `tools/moon/lolaNormalMap.py`), so crater walls light and shade along the terminator seen from Earth; cast shadows (a horizon map) proposed; stars through a telescope's field ([#192](https://github.com/celestiary/web/issues/192)'s rendering item 3; [HDR.md, a telescope's field](js/scene/HDR.md#a-telescopes-field)): a field narrower than 45° magnifies, so the eye's 10′ patch on the screen is 10′ over the magnification on the sky, and a star keeps its size on screen as the field narrows; before, it stayed 10′ on the sky, a Gaussian 40 px wide at 0.91°, and no star showed by Jupiter at any exposure; the targeted star carries its name whatever its magnitude (DESIGN.md [the target's label](DESIGN.md#the-targets-label)): a search for HIP 46635 (V 8.4) showed no label, as the catalogue's sheet names only the named and the very luminous stars, and the link's `s=loL` has `l` (star labels) off, a letter in `s=` being a flip of the default; the target star's name is now drawn by `TargetLabel` while any label group (`l` or `p`) is on, whether or not the catalogue's sheet has it; the limiting magnitude is reported through the field (`starsDebug`, `ThreeUi.limitingMagnitude()`: 5·log10 M deeper; it read −7.1 at 0.44°, where the limit is 3.1), and why HIP 46635 hid beside the Moon is measured ([HDR.md, a star beside the Moon](js/scene/HDR.md#a-star-beside-the-moon)): with the lit side out of the frame it was Cesium's 2% night floor, which the earthshine below replaced (the gain 30 → 4,824, the star 0 → 106 of 255); with the lit edge in the frame the Moon holds the meter, and the star, 1/274 of a lit pixel, is under Neutral's toe (the Moon's photometry and a camera response proposed); Cesium's Moon without banding, lit at night by earthshine ([#192](https://github.com/celestiary/web/issues/192); [CESIUM.md, precision](CESIUM.md#precision-a-log-encoding-and-the-moons-earthshine)): a tileset's frame crosses Cesium's 8-bit buffers log-encoded (20 stops, dithered) and the decode inverts it, so the night side and the terminator no longer posterize under the meter's gain; the Moon's night side is Earth's reflected light (1e-4 of sunlight at full Earth), not a 2% floor ~300× too bright; drags and pitch keys slow with the field of view, so a telescope view can be steered (`fovTurnScale` in `js/zoom.js`; DESIGN.md [FOV-scaled turning](DESIGN.md#fov-scaled-turning)): a drag, free look or orbit, and the up/down arrow keys turned the view 0.005 rad a pixel (0.01 rad a frame) at any field, which at a 0.07° telescope view carried the scene 1,650 pixels for each pixel dragged (in a 400 px canvas); the rate is now scaled by the ratio of the field's tangent half-angle to the default's (45° unchanged, wider fields unchanged, 0.0015 at 0.07°), so the scene moves the same number of pixels per pixel dragged at every field, and an orbit drag takes it on top of the proximity scale; roll and the zoom steps (`,` and `.` are exact 0.9 and 1.1 factors; the wheel and pinch dolly, not the field) were already proportional and are untouched; merge approval given as a comment on the PR, and merges done by the dispatching session (AGENTS.md, [Pull requests](AGENTS.md#pull-requests)); a shared view reloads as shared (PR [#201](https://github.com/celestiary/web/pull/201), [#118](https://github.com/celestiary/web/issues/118)'s sharing; [design/URLs.md](design/URLs.md#what-a-link-restores)): the target was already the link's path (a searched star, `#hip:46635`, reloads targeted; now documented and checked through the search's Look at); the clock is in the link as `time:pause,rate=8` (paused restores paused at `t=`, the rate in force is kept for unpausing, real time is left out; the `cq=` rule is unchanged); the stars' setting is now a zero-default offset in magnitudes, shown as "Stars +1.0 mag" like EV and in the link as `sm=`, both stepping back to exactly 0; tracking is the `T` flag in `s=`; `fov=` keeps four significant figures, so a telescope's 0.0714 survives (it was rounded to 0.07, and under 0.005 to 0); the audit of what a link restores is in design/URLs.md, with the layer choice and `f` follow left for #118's follow-up; two of [#189](https://github.com/celestiary/web/issues/189)'s surface costs (PR [#196](https://github.com/celestiary/web/pull/196)): the exposure meter reads back asynchronously, through a ring of three pixel-pack buffers and fences, its reading a frame or more late with the gain its own frame rendered at, so the 40 ms stall every fourth frame on the user's M2 is gone and the adaptation is the same curve, later ([HDR.md, the meter's readback](js/scene/HDR.md#the-meters-readback)); and the atmosphere pass's march over the ground takes each step's mean density, as many steps as the segment's optical depth needs (4 to 16) and, for Earth, no delta-M half, so looking down from 7.5 km it is 4.5 times cheaper on SwiftShader with no pixel more than 1 of 255 changed ([composition.md, the march's cost](js/scene/atmos/composition.md#the-marchs-cost)); Jupiter smooth at a telescope's field from Earth ([#192](https://github.com/celestiary/web/issues/192)'s rendering item 1; [composition.md, which body's air](js/scene/atmos/composition.md#which-bodys-air), [Planet.md, small discs](js/scene/Planet.md#small-discs)): the atmosphere pass draws the air the camera is in, so a permalink targeting Jupiter from Earth's ground no longer drew Jupiter's air from 5.9 AU, where float32 has lost the disc (the speckle, the black holes and the blue halo), and Earth's sky is over the view; no body's air past 500 of its radii; a disc a few pixels across antialiased by its coverage and shaded per fragment as the sphere; and a planet's mesh until its disc is smaller than its 2 px point, on any canvas; three UI fixes from matching the Moon–Jupiter occultation of 2026-10-06 ([#192](https://github.com/celestiary/web/issues/192), PR [#195](https://github.com/celestiary/web/pull/195); the rendering items in that issue stay open): `t` centres the target and leaves the roll to the user (the camera turns by the shortest rotation, not `lookAt`, which squared the view to the ecliptic's up every frame; the roll arrow keys work while tracking; `c` still squares it; DESIGN.md [the target](DESIGN.md#the-target)); `j`, `k` and `l` change the time step while paused, the display showing it at once and resuming running at it (`Time.onTimeScaleChange`); and an exposure compensation in stops over the metered exposure, `-` and `=` a third of a stop a press (`[` and `]` stay the stars' limiting magnitude), `e` resets, shown as "EV +1.3" for two seconds, and in the link as `ev=1.33` ([HDR.md](js/scene/HDR.md#user-exposure-compensation), [design/URLs.md](design/URLs.md#view)); Ctrl/Cmd+key no longer fires the app's keys, so the browser's zoom isn't an exposure change; no "blue Earth" ghost ([composition.md, the ray's end](js/scene/atmos/composition.md#the-rays-end)): the atmosphere pass took a ray whose line met the atmosphere only behind the eye for a hit (since #55), so from above the air, looking away from a planet (toward the Sun over Earth's day side), it drew the planet's atmosphere mirrored through the eye, a flat, hard-edged blue disc with no land or clouds, which the metered exposure's dark gain (PR [#153](https://github.com/celestiary/web/pull/153)) made saturated; it now passes those rays through (`shellAhead`, a unit test holds it); the night sky's own light ([#186](https://github.com/celestiary/web/issues/186), PR [#187](https://github.com/celestiary/web/pull/187); [HDR.md, the eye and extended light](js/scene/HDR.md#the-eye-and-extended-light)): the dark-adapted eye's threshold against field size (Ricco's law to half a degree, Piper's to 2.4°, a tenth over the sky for a large field where a point needs 4.7 times it, anchored on the star calibration), and the night sky's diffuse light tone-mapped by a response of its own, 2.2 times the stars' gain at full dark adaptation (Ward's threshold mapping: the eye's just-visible difference on the dark sky is one display step), greyed as rods see it, and added over the stars' image in display values, so every star's step on screen is as calibrated; the night sky's own light in exposure units, which the meter reads (the dark gain stays 4e6): airglow (22.4 mag/arcsec² at the zenith, a layer at 90 km, the van Rhijn factor from its chord), the zodiacal light and gegenschein (a 3D dust cloud, Kelsall et al. 1998's, integrated along each ray from wherever the camera is, with Hong's phase function, normalised to Leinert et al. 1998's table from 1 AU, so off 1 AU and off the plane it is a lens round the Sun with no rim; cached, re-rendered only when the view changes by more than it shows) and the galaxy, now drawn by the atmosphere pass; and the catalogue's double counting measured (it resolves the model's light within 200 pc, 35% of the model's over the sky, 56% toward the poles) and fixed, a hole round the Sun in closed form along the march, so points and diffuse light make the measured integrated starlight.  From a dark site at −30° the band shows grey over a dark-grey sky; day, twilight and the Moon are unchanged, and so are the stars' steps on screen (the band on `main` had raised faint stars through the toe); with the Sun in the field the inner zodiacal light, over the meter's floor within about 25° of it, brings the gain down; by day, in most of twilight and where the ground fills the view, none of the night sky is drawn, marched or even compiled into the atmosphere pass, and with time running the galaxy's march and the zodiacal cache re-render every few frames, not every frame; the inner Galaxy's dust calibrated (A_V 2.1 through Baade's window, from 3.8; the band toward the centre 20.3-20.4 mag/arcsec², from 21.2, as Pioneer 10 measured; the Great Rift still a rift; Cygnus still about 1 mag faint, a follow-up); and the dark clouds' columns spread along each ray, so no cloud shows an edge from inside its reach (the hard edge 126 pc out, on `main` since #185). Mars's aureole round the Sun ([#188](https://github.com/celestiary/web/issues/188), in [#71](https://github.com/celestiary/web/issues/71), PR [#190](https://github.com/celestiary/web/pull/190); [composition.md, the dust's forward peak](js/scene/atmos/composition.md#the-dusts-forward-peak)): the dust's phase function has a narrow forward lobe, its diffraction peak, fitted to Mie scattering for 1.5 µm grains with the measured mean cosine kept; the multiple-scattering precompute takes that lobe as unscattered (delta-M), and the pass draws its single scattering exactly and its higher orders as a Poisson sum, so the core is 9× brighter, the blue zone 6° across instead of 18°, and the sky matches a Monte Carlo of Mie scattering within 15% from 0.5° to 60° (but the core with the Sun 10° up at τ 1, brighter on the sphere than in the plane-parallel reference), with the far sky still butterscotch; Earth's tables are unchanged; Earth's clouds from data ([#88](https://github.com/celestiary/web/issues/88)): the simulation date's NASA GIBS true-colour mosaic (VIIRS from late 2015, MODIS from 2000; the latest complete day for the present; the old bundled cloud texture before 2000 and in the future), unmixed into cloud coverage over the month's Blue Marble, drawn as one shell 6 km up over both sides of the Cesium swap (after the composite, before the atmosphere pass): lit by the Sun in exposure units, shadowing the ground, dimming the night lights under it, hazed by the atmosphere pass as the ground under it; it fades out below 30 km, the seam for [#169](https://github.com/celestiary/web/issues/169) ([Planet.md, clouds](js/scene/Planet.md#clouds)); one target, shown and used everywhere (PR [#181](https://github.com/celestiary/web/pull/181), DESIGN.md [the target](DESIGN.md#the-target)): a click on any label, a pick in the search, Look at, `g`, a double click and a link all go through `Scene.setTarget`, so the breadcrumb (Sun › Earth › Austin), the link's path (`#sun/earth/austin`, `#hip:32349`, `#asterism:ursa-major`) and what `t` tracks always agree; the camera's frame stays where the camera is, named by `from=` when it isn't the target's, so targeting never moves the view and the new link reloads to it ([design/URLs.md](design/URLs.md#path)); a pick in the search's dropdown targets any kind and leaves the bar open; `t` follows a place as its body turns; Cesium's layers bounded at telescope fields of view: no finer detail than a ~21″ pixel gets, so tracking Jupiter at 0.01° from the ground no longer runs the page out of memory ([#176](https://github.com/celestiary/web/issues/176), PR [#180](https://github.com/celestiary/web/pull/180); [CESIUM.md](CESIUM.md#detail-at-narrow-fields-of-view)); place names back on Earth, the Moon and Mars ([#172](https://github.com/celestiary/web/issues/172)): `CesiumLayers._hideSurface` hid each body's places group along with its surface, from before the labels drew in the overlay pass (after the composite, no depth test, back hemisphere discarded in the shader), so no place name showed while Cesium was the layer; it now hides only the surface group, a unit test holds it, and three `labels` parity views (`earth-labels`, `moon-labels`, `mars-labels`; the others' `s=alpoU` turns labels off, so none could have caught it) count the pixels the labels add over Cesium's render ([CESIUM.md](CESIUM.md#views-and-tolerances)); one picking model for every label ([#177](https://github.com/celestiary/web/pull/177), DESIGN.md [Picking](DESIGN.md#picking-labels)): a click or tap on a star, planet or moon, asterism or place name targets it and does nothing else, so `c` faces it and `g` goes; a double click or tap goes (a place by landing there, an asterism by turning to face it); asterisms get name labels at their stars' centroid; and a place is searchable under its body, the solar system and the root (the places index was keyed by a path the search never asked for, so no place had ever been found), where picking a result targets it and Go travels; no white dashes over Jupiter and Saturn at a telescope FOV from Earth's surface: the atmosphere pass takes a body whose depth sits near the far plane as past the air, not as a short ray through it ([composition.md](js/scene/atmos/composition.md#the-rays-end)); a planning pass (2026-10-06): the Sun and stars split into their own epic (#164), the Gazetteer, volumetric-cloud and procedural-exoplanet issues filed, #88 and #99 rescoped, the place-names regression found (#172), and three shared engines named to order the work; the debug axes inside the Sun and planets removed from the production scene (they showed at extreme zooms); esbuild hot-reload guarded by build-time `__DEV__` flag, so production and PR previews no longer log 404 errors for the nonexistent `/esbuild` endpoint; fixed moon radius data errors (Triton 10x, Janus 10x, Rhea 2x); a 30 s timeout on the Colonization whole-catalog test, which outran bun's 5 s default under load; patched transitive dependencies fflate (^0.8.3) and uuid (^11.1.1) with yarn resolutions to clear moderate dependabot alerts; the Moon orbit ([#87](https://github.com/celestiary/web/issues/87), PR [#130](https://github.com/celestiary/web/pull/130)); the data policy
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

Night lights on Cesium's Earth ([#93](https://github.com/celestiary/web/issues/93), PR [#179](https://github.com/celestiary/web/pull/179)): NASA GIBS's VIIRS Black Marble (the product celestiary's own `earth_night.jpg` is, checked against GIBS's tiles: kept, not rebuilt) as an imagery layer on Cesium's globe, 600 m a pixel, drawn in a second Cesium frame of its own with lighting off and added to the scene buffer as emitted light, `texel × smoothstep(−0.05, 0.05, −N·L) × NIGHT_LIGHT_RADIANCE × exposure`, the form and scale celestiary's surface shader has, so both sides of the swap match (Europe at night from 4,000 km: median pixel 1.004, channels 1.00, mean 0.98).  Cesium's own `nightAlpha` can't do it: its lighting multiplies the night imagery away, and its 8-bit frame can't hold a light 1e-5 of the day's.  The parity check gained night views, a mean-ratio metric for views where the two renders differ in resolution, and GIBS through Node ([CESIUM.md, night lights](CESIUM.md#night-lights), [Planet.md](js/scene/Planet.md#texture_night--emissive-city-lights-on-the-night-side)).

The star guide demo ([#165](https://github.com/celestiary/web/issues/165), the star renderer's workbench): its star links resolved against `<base href="/">` to the app root, and the router's referrer redirect then dropped the hash, so no `#Name` ever selected a star; the disc was never metered, because ThreeUI meters a resolved star's disc from its scene manager's objects and the guide had none (the Sun shader's radiance assumes the metered exposure, so it saturated white), now `guide/starScene.js`; with no hash the page showed whichever star the empty name `''` mapped to (`starnames.dat`'s trailing colons: HIP 24160), now Sol by default, and an empty name names no star.  The other guide pages were checked against the same pipeline: Planet (its Sun light had decay 0 where the exposure is calibrated to the app's 1.01, its surface waits on a `preAnimCb` the guide never ran), Stars (its store stub had no `getState`, which threw every frame) and Asterisms (it passed an empty catalog, so no asterisms were ever built) drew nothing or black, and draw now.  The star shader's noise is now band-limited by pixel footprint (octaves fade out as their features near a pixel), so a small disc, in the guide or the Sun in the app from afar, shows its mean surface colour instead of aliased speckle; the guide frames each star at 90% of its canvas.  Each star's surface noise is seeded from its Hipparcos id (`starSeed.js`: an offset of the noise domain for every layer, and a mild shift of the spot threshold; Sol and the app's Sun are seed 0, the original pattern), so no two stars share a pattern; spot density by star type is [#166](https://github.com/celestiary/web/issues/166)'s.  Left: the Atmosphere page, a work-in-progress demo with its own shader, still draws only its axes.

The Sun's photosphere from physical parameters ([#21](https://github.com/celestiary/web/issues/21), the first of [#164](https://github.com/celestiary/web/issues/164)'s star renderer; [Stars.md](js/scene/Stars.md)): a star's effective temperature from its class (de Jager & Nieuwenhuijzen 1987 over the HR diagram, Levesque et al. 2005 for red supergiants, 5,772 K for the Sun), its colour a blackbody's through the CIE observer, one table shared by the disc and the field stars (the hand RGB tables `tempRanges` and `StarSpectra`, and the dead `star.frag`/`star.vert`, gone), its disc's radiance the Sun's times its luminance over the Sun's (a display shows luminance; σT⁴ counts the light the eye doesn't see), and the meter and the glow reading it; limb darkening per channel by temperature (a grey LTE atmosphere fitted to the power-2 law: Claret's tables weren't reachable from the sandbox); granulation as convection cells at three scales sized by the pressure scale height, with a contrast by temperature (none above ~8,300 K, so Vega and Sirius are smooth); sunspots with umbra and penumbra in the Sun's latitude belts, and faculae bright toward the limb, each a blackbody at its own temperature; and the limb glow no longer drawn behind the disc, which had shown through the limb in blocks from 1 AU at a narrow field.

Every star from its parameters ([#166](https://github.com/celestiary/web/issues/166); [Stars.md](js/scene/Stars.md#every-star-from-its-parameters)): `starParams.js` gives each star its temperature, radius, mass, gravity, rotation and spots, published values for the Sun, Sirius, Vega, Altair, Betelgeuse and Proxima, else from the catalogue (a missing luminosity class inferred from the absolute magnitude; the radius by Stefan-Boltzmann through the bolometric correction, where it was √L_V: Betelgeuse 115 R☉ for 764, Proxima 0.01 for 0.15; the mass from the mass-luminosity relation); granules sized by the pressure scale height (Betelgeuse's 20 giant cells across its radius, Proxima's 820); Vega and Altair oblate and gravity-darkened (Roche model, von Zeipel, their measured β), turned to their measured inclination and position angle; spots by type (none on hot stars or supergiants, large ones at all latitudes on M dwarfs); and a catalogue star travelled to is drawn through the Sun's shader, metered, and approached to its surface (the zoom's floor was the last body's radius).

The galaxy's integrated light ([#99](https://github.com/celestiary/web/issues/99), PR [#185](https://github.com/celestiary/web/pull/185)): the 60k-point cloud, which carried the arms' points but almost none of the galaxy's light (at physical exposure faint arms round a small bar, with the meter lifted by hand), is replaced by a luminosity density from published structural models, thin and thick discs (Jurić et al. 2008), a boxy bulge and the long bar at 27° (Wegg et al. 2015), four arms placed and pitched as Reid et al. (2019) measured them with the young stars and HII regions on them, dust with lanes on the arms' inner edges, the Local Bubble and the Great Rift's clouds, and the warp and flare, normalised to 2.5e10 L☉ in exposure units and ray-marched through the volume (cached at up to 540 rows, re-marched only when the view moves).  From the Sun the poles are 23.8 mag/arcsec², as the integrated starlight there is.  From outside the meter anchors on the galaxy's brightest 2% (`galaxyGain`), so face-on from 45-100 kpc it settles at a gain of 1.2e8 with no help, a warm bar and bulge in blue arms with dust lanes and pink knots; edge-on a thin disc with its lane.  Inside the disc the eye's gain stays, and the night sky from Earth is unchanged; the band from inside is physically faint, in the tone map's toe at the dark-adapted gain ([MilkyWay.md](js/scene/MilkyWay.md), [HDR.md](js/scene/HDR.md#metered-exposure) rule 10).

The `?perf=1` overlay ([#189](https://github.com/celestiary/web/issues/189) step 1, the measuring step of [#121](https://github.com/celestiary/web/issues/121)'s surface frame rate; PR [#191](https://github.com/celestiary/web/pull/191)): GPU time per pass on the user's own GPU (`EXT_disjoint_timer_query_webgl2`, read frames late, nesting passes timed as sibling segments, disjoint events dropped), CPU time to issue each, and per-frame counts by pass (draw calls, full-screen passes, render-target switches, readbacks, uploads, triangles), with Cesium's replay, night lights, decode and its second, shadow GL context each on a row of their own; no timer extension shows CPU times and a note; seven toggles (`&off=atmosphere,clouds,nightlights,galaxy,cesium,meter,overlay`, or checkboxes) switch one pass off to bisect by FPS; Copy JSON gives the permalink, viewport, `devicePixelRatio`, GPU and the numbers to paste back.  The first M2 measurements showed ANGLE Metal's timer queries are per encoder, not per pass, so it also has sync timing (`?perf=sync`: the GPU waited for after every pass, each pass timed by the wall clock) and counts the calls that round-trip to the GPU process (`getError`, `getParameter`, `readPixels` ...) per pass.  Instrumentation only: no pass changed, and without `?perf=1` nothing is created and a frame makes the same GL calls ([DESIGN.md](DESIGN.md#perf-overlay), [AGENTS.md](AGENTS.md#working-efficiently) for asking the user for a snapshot).  Step 2, the fixes in order of the user's numbers, is open.

The Cesium layers' invisible work skipped ([#189](https://github.com/celestiary/web/issues/189) step 2, its Cesium items; [CESIUM.md, activation](CESIUM.md#activation) and [night lights](CESIUM.md#night-lights)): a Cesium body is active only when it can show, so the Moon under the horizon from Earth's surface is no longer a whole Cesium frame (it was active looking down, about 5 ms of the M2's frame; a body hidden behind another Cesium body's ground, or under 2 px in radius, is now celestiary's), and the night lights' second Cesium frame runs only where a ray in the frustum meets the night side (`frames.nightInView`, replacing a cap test that ignored the frustum) and the lights can reach half a display step at the exposure, but on the meter's frames, so the meter reads what it did.  Headless, per frame: facing the Sun by day, one Cesium frame instead of two (61 fewer draws in the replay, 5 fewer full-screen passes, 79 fewer synchronous queries), byte-identical; from 20,000 km over a gibbous Earth, the lights on one frame in four, 1 level of 255 on 7 values; on the surface looking down, one Cesium frame instead of three (237 to 79 queries, 27 to 16 full-screen passes); the night views unchanged.  The replay's synchronous queries are all portal-netgl's state checkpoint (53 `getParameter`, 16 `getVertexAttrib`, 10 `isEnabled` per Cesium frame; Cesium makes none): a tracked-state checkpoint, with no synchronous calls, is proposed for portal-netgl in the PR, with a patch.

Roadmap and issues groomed (2026-10-08): [#86](https://github.com/celestiary/web/issues/86) closed (PR A [#141](https://github.com/celestiary/web/pull/141), PR B [#153](https://github.com/celestiary/web/pull/153)); the epics' lists brought up to date ([#109](https://github.com/celestiary/web/issues/109), [#110](https://github.com/celestiary/web/issues/110), [#112](https://github.com/celestiary/web/issues/112), [#116](https://github.com/celestiary/web/issues/116), [#118](https://github.com/celestiary/web/issues/118), [#121](https://github.com/celestiary/web/issues/121), [#122](https://github.com/celestiary/web/issues/122), [#164](https://github.com/celestiary/web/issues/164)); status comments on [#192](https://github.com/celestiary/web/issues/192), [#189](https://github.com/celestiary/web/issues/189), [#92](https://github.com/celestiary/web/issues/92), [#71](https://github.com/celestiary/web/issues/71), [#163](https://github.com/celestiary/web/issues/163), [#155](https://github.com/celestiary/web/issues/155), [#102](https://github.com/celestiary/web/issues/102), [#97](https://github.com/celestiary/web/issues/97); and the follow-ups noted but not filed now are issues: the moons' labels overlapping at a telescope's field ([#207](https://github.com/celestiary/web/issues/207)), a camera-like response ([#208](https://github.com/celestiary/web/issues/208)), the unused Blue Marble levels 0-2 ([#209](https://github.com/celestiary/web/issues/209)), Earth's night side on the bare ellipsoid ([#210](https://github.com/celestiary/web/issues/210)), the Moon's cast shadows ([#211](https://github.com/celestiary/web/issues/211)), Cesium's rougher Moon terminator ([#212](https://github.com/celestiary/web/issues/212)), `yarn parity` with Bing blocked ([#213](https://github.com/celestiary/web/issues/213)), and portal-netgl's state checkpoint ([portal#32](https://github.com/pablo-mayrgundter/portal/issues/32)).

**Now** (small, visible, unblocked)
1. **Matching the Moon–Jupiter occultation** ([#192](https://github.com/celestiary/web/issues/192), the calibration of the
   Moon, Jupiter and the stars against the photos): the UI items, Jupiter's smoothness, the Moon's relief on both sides,
   stars at a telescope's field, the Moon's photometry and its earthshine are in (Done recently).  Open: physical 1/d²
   sunlight in place of `SUN_LIGHT_DECAY` (in progress on `claude/sun-inverse-square`, not merged), then `DISPLAY_GAIN`;
   Jupiter's moons as points of their own reflected light, 4-5 magnitudes fainter than the markers; the Moon's and
   Jupiter's colour against the physical ratio; a camera-like response for telescope fields
   ([#208](https://github.com/celestiary/web/issues/208)); the Moon's terminator across the swap
   ([#212](https://github.com/celestiary/web/issues/212)).  The per-photo numbers wait for the photos' host
   (`private-user-images.githubusercontent.com`), which the sandbox's proxy refuses.
2. **Surface frame rate** ([#189](https://github.com/celestiary/web/issues/189), 30-40 FPS on the surface against 60 in space):
   the overlay is in (PR [#191](https://github.com/celestiary/web/pull/191); Done recently), the Cesium layers skip what can't
   show (the Moon under the horizon, the night lights by day; Done recently), and the meter's readback is asynchronous and the
   atmosphere pass's march over the ground cheaper (PR [#196](https://github.com/celestiary/web/pull/196); Done recently).  A
   new `?perf=1` snapshot of the three views on production sets what is next: portal-netgl's state checkpoint
   (79 synchronous queries a Cesium frame; [portal#32](https://github.com/pablo-mayrgundter/portal/issues/32)),
   `cesium.replay`'s CPU, and [#103](https://github.com/celestiary/web/issues/103) upstream.

**Next** (the shared engines, below)

3. **Place names for every body** ([#170](https://github.com/celestiary/web/issues/170)) from the IAU Gazetteer: the
   labels engine, which also declutters labels that touch ([#207](https://github.com/celestiary/web/issues/207)).
4. **Earth's imagery detail layer** ([#92](https://github.com/celestiary/web/issues/92)): Bing is the detail layer and is
   requested only up close since PR [#202](https://github.com/celestiary/web/pull/202); Sentinel-2 and more Blue Marble
   resolution are open, and the layer needs `dev.virtualearth.net` reachable from the sandbox (the clouds,
   [#88](https://github.com/celestiary/web/issues/88), are done).
5. **Gaia's brightest ~1M stars** ([#98](https://github.com/celestiary/web/issues/98)): the point-population engine,
   designed under its heaviest load.
6. **Sharing and picking through Cesium** ([#118](https://github.com/celestiary/web/issues/118)): the layer choice
   ([#101](https://github.com/celestiary/web/issues/101); small; the clock, tracking, follow and the stars' setting are in), then picking on Cesium's globes
   ([#100](https://github.com/celestiary/web/issues/100)).

**Later**
7. The Sun's dynamic layers ([#167](https://github.com/celestiary/web/issues/167)) and its corona and wind ([#168](https://github.com/celestiary/web/issues/168)): the rest of
   stars up close ([#164](https://github.com/celestiary/web/issues/164); the photosphere and every star from its parameters are done), on the star renderer
   that is the first of the parametric body renderer.
8. Volumetric clouds up close ([#169](https://github.com/celestiary/web/issues/169)), seeded from #88's map; then
    Venus, Titan and the giants.
9. Gas giants on the parametric renderer ([#41](https://github.com/celestiary/web/issues/41)); rings ([#95](https://github.com/celestiary/web/issues/95)); auroras ([#23](https://github.com/celestiary/web/issues/23)).
10. Exoplanet systems ([#12](https://github.com/celestiary/web/issues/12)) drawn procedurally ([#171](https://github.com/celestiary/web/issues/171)); lookup beyond the
    catalogue ([#39](https://github.com/celestiary/web/issues/39)).
11. Small bodies and satellites ([#114](https://github.com/celestiary/web/issues/114)) on the point-population engine,
    starting with the asteroid data already in the repo ([#30](https://github.com/celestiary/web/issues/30)).
12. Surfaces and relief for bodies Cesium doesn't cover ([#113](https://github.com/celestiary/web/issues/113)), and the Moon's cast shadows
    from a LOLA horizon map ([#211](https://github.com/celestiary/web/issues/211)).
13. Deep sky: nebulae, other galaxies, Sgr A\* ([#117](https://github.com/celestiary/web/issues/117)); galactic dynamics ([#106](https://github.com/celestiary/web/issues/106)).
14. Spacecraft: integrator, then flight simulation ([#119](https://github.com/celestiary/web/issues/119)); missions and
    models ([#120](https://github.com/celestiary/web/issues/120)).

**Background** (alongside, whenever there's room)
- **Horizons regression tests for every body** ([#97](https://github.com/celestiary/web/issues/97), in [#112](https://github.com/celestiary/web/issues/112)): orientation
  is done ([#96](https://github.com/celestiary/web/issues/96)), with its sub-observer fixture, and so are the Moon's and the moons' fixtures. The planets' positions next, and the
  moons whose mean elements lose their phase: Phobos and Deimos (up to
  170° by 1950 and 2050), Janus, Triton, and Titania and Oberon at every
  date (URA182's epoch angles); the per-system theories ([#138](https://github.com/celestiary/web/issues/138), [#139](https://github.com/celestiary/web/issues/139), [#140](https://github.com/celestiary/web/issues/140)).
- **What's left of physically based light** ([#109](https://github.com/celestiary/web/issues/109)): [#86](https://github.com/celestiary/web/issues/86) (closed 2026-10-08), pre-exposure
  ([#157](https://github.com/celestiary/web/issues/157)) and the night sky's own light ([#186](https://github.com/celestiary/web/issues/186)) are done
  ([HDR.md](js/scene/HDR.md#the-eye-and-extended-light)); left are the benchmarks, the
  Artemis photo ([#59](https://github.com/celestiary/web/issues/59)) and the atmosphere QA ([#71](https://github.com/celestiary/web/issues/71); Mars's aureole is done), the moonlit sky
  ([#163](https://github.com/celestiary/web/issues/163), which takes its Moon from the lunar photometric function), veiling glare round bright discs, a star threshold that rises
  over a brighter background (the band, a moonlit sky), the inner Galaxy's dust
  ([MilkyWay.md](js/scene/MilkyWay.md#follow-ups)), and the night sky's
  light scattered by the air and lighting the ground
  ([composition.md](js/scene/atmos/composition.md#known-gaps--future-work));
  and, with the light now the inverse square, each body's own photometry
  ([Planet.md, the Sun's light](js/scene/Planet.md#the-suns-light-the-inverse-square)):
  its texture to its albedo (Mercury 1 mag bright, Mars 0.4, Neptune 0.4
  dark), phase functions for Mercury and Venus, physical rings
  ([#95](https://github.com/celestiary/web/issues/95)), and the outer
  bodies' sky gains back to the physical 4.71.
- **Cesium without ion, and its checks** ([#121](https://github.com/celestiary/web/issues/121)): Earth's night side is lit about 30% on the
  bare ellipsoid when ion's terrain is refused ([#210](https://github.com/celestiary/web/issues/210)); `yarn parity` views that don't
  settle with Bing blocked ([#213](https://github.com/celestiary/web/issues/213)); the Blue Marble tile levels 0-2, about 14 MB and now
  unused, can go ([#209](https://github.com/celestiary/web/issues/209)).

### Shared engines

Most of the list rests on three pieces of infrastructure; building each
once covers several features, so the order above builds them first.

- **A parametric body renderer**: one shader family driven by physical
  parameters (temperature, radius, composition, rotation), the same rule
  as the atmospheres. The Sun is its reference case ([#164](https://github.com/celestiary/web/issues/164)); every star
  ([#166](https://github.com/celestiary/web/issues/166)), the gas giants ([#41](https://github.com/celestiary/web/issues/41)) and procedural exoplanets ([#171](https://github.com/celestiary/web/issues/171)) reuse it.
- **Labels and nomenclature**: one catalogue pipeline (the IAU Gazetteer
  plus Earth's places) and one label renderer that is the same on both
  sides of the Cesium swap ([#170](https://github.com/celestiary/web/issues/170), [#172](https://github.com/celestiary/web/issues/172), done); later spacecraft and exoplanet names.
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
| [#109](https://github.com/celestiary/web/issues/109) Physically based light and exposure | [#86](https://github.com/celestiary/web/issues/86) (done), [#59](https://github.com/celestiary/web/issues/59), [#71](https://github.com/celestiary/web/issues/71) ([#188](https://github.com/celestiary/web/issues/188) done: Mars's aureole), [#157](https://github.com/celestiary/web/issues/157) (done: pre-exposure), [#163](https://github.com/celestiary/web/issues/163), [#186](https://github.com/celestiary/web/issues/186) (done: the night sky's own light), [#208](https://github.com/celestiary/web/issues/208) (a camera-like response for telescope fields), [#212](https://github.com/celestiary/web/issues/212) (the Moon's terminator across the swap); the Moon's photometry and earthshine, and the Sun's inverse-square light, are done under [#192](https://github.com/celestiary/web/issues/192) | [#87](https://github.com/celestiary/web/issues/87) for the daytime-Moon benchmark | [HDR.md](js/scene/HDR.md) (PR A, PR B and pre-exposure done), [Planet.md, lighting and exposure](js/scene/Planet.md#lighting-and-exposure), [atmosphere composition](js/scene/atmos/composition.md) |
| [#110](https://github.com/celestiary/web/issues/110) Earth across the Cesium swap | [#93](https://github.com/celestiary/web/issues/93) (done), [#92](https://github.com/celestiary/web/issues/92) (Bing gated to close-up views, done; Sentinel-2 and resolution open), [#88](https://github.com/celestiary/web/issues/88) (done), [#210](https://github.com/celestiary/web/issues/210) | [#105](https://github.com/celestiary/web/issues/105); re-check after [#109](https://github.com/celestiary/web/issues/109) | [CESIUM.md](CESIUM.md#data), [Planet.md, texture sources](js/scene/Planet.md#surface-texture-sources), [Planet.md, clouds](js/scene/Planet.md#clouds) |
| [#164](https://github.com/celestiary/web/issues/164) Stars up close: a dynamic Sun, every star from its parameters | [#165](https://github.com/celestiary/web/issues/165) (done), [#21](https://github.com/celestiary/web/issues/21) (done), [#166](https://github.com/celestiary/web/issues/166) (done), [#167](https://github.com/celestiary/web/issues/167), [#168](https://github.com/celestiary/web/issues/168) | [#109](https://github.com/celestiary/web/issues/109) (emissive, in exposure units) | [Stars.md](js/scene/Stars.md); [HDR.md, physical stars](js/scene/HDR.md#physical-stars) |
| [#111](https://github.com/celestiary/web/issues/111) Gas giants, rings, auroras, clouds | [#41](https://github.com/celestiary/web/issues/41), [#23](https://github.com/celestiary/web/issues/23), [#95](https://github.com/celestiary/web/issues/95), [#169](https://github.com/celestiary/web/issues/169) | [#109](https://github.com/celestiary/web/issues/109) for anything emissive; [#164](https://github.com/celestiary/web/issues/164)'s renderer for [#41](https://github.com/celestiary/web/issues/41); [#88](https://github.com/celestiary/web/issues/88) for [#169](https://github.com/celestiary/web/issues/169) | [rings.md](js/scene/rings/rings.md), DESIGN.md [rendering techniques](DESIGN.md#rendering-techniques) |

### B. Solar-system accuracy and surfaces

Every body where it really is, turned the way it really is, with a real
surface.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#112](https://github.com/celestiary/web/issues/112) Ephemerides and orientation | [#87](https://github.com/celestiary/web/issues/87) (done), [#6](https://github.com/celestiary/web/issues/6) (done), [#133](https://github.com/celestiary/web/issues/133) (done), [#96](https://github.com/celestiary/web/issues/96) (done), [#97](https://github.com/celestiary/web/issues/97), [#132](https://github.com/celestiary/web/issues/132) (done), [#138](https://github.com/celestiary/web/issues/138), [#139](https://github.com/celestiary/web/issues/139), [#140](https://github.com/celestiary/web/issues/140) | nothing | DESIGN.md [orbital mechanics](DESIGN.md#orbital-mechanics), [coordinates](DESIGN.md#coordinate-system--scale) |
| [#113](https://github.com/celestiary/web/issues/113) Surfaces for every body | [#9](https://github.com/celestiary/web/issues/9), [#10](https://github.com/celestiary/web/issues/10), [#43](https://github.com/celestiary/web/issues/43), [#170](https://github.com/celestiary/web/issues/170), [#211](https://github.com/celestiary/web/issues/211) (the Moon's cast shadows) | data policy for bundled DEMs | [Planet.md](js/scene/Planet.md), [CESIUM.md, ground](CESIUM.md#camera-and-light-coupling) |

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
| [#116](https://github.com/celestiary/web/issues/116) Milky Way: structure, Gaia stars, dynamics | [#99](https://github.com/celestiary/web/issues/99) (done), [#98](https://github.com/celestiary/web/issues/98), [#106](https://github.com/celestiary/web/issues/106), [#108](https://github.com/celestiary/web/issues/108) | data policy | [the galaxy plan](#the-galaxy-plan), [MilkyWay.md](js/scene/MilkyWay.md) |
| [#117](https://github.com/celestiary/web/issues/117) Nebulae, galaxies, Sgr A\* | [#20](https://github.com/celestiary/web/issues/20), [#40](https://github.com/celestiary/web/issues/40), [#22](https://github.com/celestiary/web/issues/22) | [#116](https://github.com/celestiary/web/issues/116)'s frame and scale | DESIGN.md [coordinates](DESIGN.md#coordinate-system--scale) |

### E. Navigation, time and sharing

Everything the user does keeps working where Cesium draws the ground.

| Epic | Issues | Depends on | Docs |
|---|---|---|---|
| [#118](https://github.com/celestiary/web/issues/118) Navigation, time and sharing | [#172](https://github.com/celestiary/web/issues/172) (done), [#101](https://github.com/celestiary/web/issues/101), [#102](https://github.com/celestiary/web/issues/102) (tracking and follow are in the link, done), [#100](https://github.com/celestiary/web/issues/100), [#42](https://github.com/celestiary/web/issues/42), [#207](https://github.com/celestiary/web/issues/207) (labels that touch) | picking needs readback from portal-netgl's shadow context | [permalink.md](js/permalink.md), DESIGN.md [navigation](DESIGN.md#navigation-goto-flow), [CESIUM.md follow-ups](CESIUM.md#follow-ups) |

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
| [#121](https://github.com/celestiary/web/issues/121) Cesium performance and verification | [#105](https://github.com/celestiary/web/issues/105) (done), [#176](https://github.com/celestiary/web/issues/176) (done), ion imagery sessions kept to close-up views ([CESIUM.md](CESIUM.md#cesium-ion-sessions); done), [#189](https://github.com/celestiary/web/issues/189) (step 1, the `?perf=1` overlay, done; the Cesium layers' invisible work, done; the meter's readback, done; the checkpoint's queries, [portal#32](https://github.com/pablo-mayrgundter/portal/issues/32), and `cesium.replay`'s CPU open), [#104](https://github.com/celestiary/web/issues/104), [#103](https://github.com/celestiary/web/issues/103), [#213](https://github.com/celestiary/web/issues/213) | [#103](https://github.com/celestiary/web/issues/103) is upstream in portal-netgl | [CESIUM.md](CESIUM.md#follow-ups), portal's [open problems](https://github.com/pablo-mayrgundter/portal/blob/main/packages/portal-netgl/DESIGN.md#open-problems-the-next-pr) |
| [#122](https://github.com/celestiary/web/issues/122) Housekeeping and data policy | [#107](https://github.com/celestiary/web/issues/107) (done), [#209](https://github.com/celestiary/web/issues/209) | | [AGENTS.md](AGENTS.md) |

## The galaxy plan

The goal is a Milky Way that looks like the real one from inside and
outside, and moves like it over billions of years, including the part
that needs dark matter.

1. **Shape from published models** ([#99](https://github.com/celestiary/web/issues/99), done: PR [#185](https://github.com/celestiary/web/pull/185),
   [MilkyWay.md](js/scene/MilkyWay.md)). The hand-tuned point cloud is
   replaced by a published structural model: the bar at 27°, four major
   arms placed and pitched as Reid et al. (2019) measured them, dust lanes
   that absorb and the Great Rift's clouds, the warp and flare of the outer
   disc, a thin and a thick disc at real scale heights (300 and 900 pc),
   and the boxy bulge (the stellar halo is left out: under 1% of the
   light). It carries the galaxy's integrated light, 2.5e10 L☉ in exposure
   units, ray-marched through the volume, and from outside the meter frames
   it as a photograph with no help. From inside, the band shows at the
   dark-adapted eye's gain over the night sky's own light, and the light
   the catalogue draws as points is left out of the diffuse light round the
   Sun ([#186](https://github.com/celestiary/web/issues/186), done). Left: the inner Galaxy's dust, too thick, keeps
   Sagittarius and Scutum 1.5-3 magnitudes fainter than the sky shows them;
   and the hole round the Sun is refitted when Gaia's stars come in.
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
