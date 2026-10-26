# Space networks

Three networks that live in orbit, or talk to it, drawn round Earth as
overlays of their own: SpaceX's **Starlink**, the whole constellation;
**Iridium NEXT** and the links between its satellites; and NASA's **Deep
Space Network**, its dishes on the turning Earth and their live links out
to the spacecraft they're talking to.  Celestiary already propagates
satellites ([Satellites.md](../satellites/Satellites.md)); these reuse its
SGP4 and frames.

## Files

- `compactElements.js`: a constellation's mean elements as integer
  columns (`encodeElements`, `decodeElements`), so Starlink's ~11,000 fit
  in plain git.
- `Constellation.js`: a constellation's satellites as points, propagated in
  slices with the in-between carried on the GPU (Propagation, below).
- `Starlink.js`: Starlink's Constellation, coloured by shell.
- `iridium.js`: Iridium's model, pure: in service, the planes, the links.
- `IridiumNetwork.js`: Iridium's Constellation and its links, as wide lines.
- `dsn.js`: the DSN, pure: DSN Now's feed read, links, pointing to a
  direction, body-fixed to Earth's equator.
- `DeepSpaceNetwork.js`: the dishes, the complexes' names, the links and
  the spacecraft's names, and the polling.
- `loadNetworks.js`: the chunk's entry, imported by Scene when a network's
  overlay is first shown.
- `../../../tools/networks/`: `fetch.mjs` refreshes the snapshots (`yarn
  networks`), `dsnConfig.js` reads DSN Now's config.xml.
  `../../../tools/satellites/celestrak.mjs` is the CelesTrak fetch both
  tools share (one request a group, the two-hour cache).

## The data

Snapshots in `public/data/networks/`, refreshed by `yarn networks [--cache
DIR] [--only starlink,iridium,dsn]`, as the satellites' is (a time machine
can't depend on a live fetch for its orbits; Satellites.md, the data), and
from the same cache: `yarn satellites` asks for Starlink and Iridium NEXT
too, and run within two hours of it, this script asks CelesTrak for
nothing it has.  The
DSN's live feed isn't bundled: the app polls it.

| File | Source | What | Size |
|---|---|---|---|
| `starlink.json` | CelesTrak `GROUP=starlink`, fetched 2026-10-23 16:02 UTC | 11,116 satellites, epochs 2026-10-20 to 23 | 719 KB, 290 KB gzipped |
| `iridium.json` | CelesTrak `GROUP=iridium-NEXT`, same fetch | 80 satellites, with names | 7 KB |
| `dsn.json` | DSN Now's https://eyes.nasa.gov/dsn/config.xml | 3 complexes, 15 dishes, 170 spacecraft names | 5 KB |

- **Compact elements** (`compactElements.js`, format
  `celestiary-compact-omm-1`): a column per OMM field SGP4 starts from, as
  integers at the elements' own precision (mean motion to 1e-8 rev/day,
  eccentricity 1e-7, angles 1e-4°, B* 1e-9), the NORAD numbers as
  differences, the epoch in ms after the snapshot's first day.
  `MEAN_MOTION_DOT` and `_DDOT` are left out: SGP4 doesn't use them (they're
  SGP's).  Starlink's names are left out too (the NORAD number stands in);
  Iridium keeps them.  Against the full elements, positions agree to 0.15 km
  over a week (`compactElements.test.js`; 0.11 km worst over 2,000
  Starlinks).  CelesTrak's OMM JSON for the same set is 4.7 MB (its CSV, which the
  tools now ask for, about a third of that); rows in the
  satellites' format would be about 1.5 MB, over the data policy's line.
- **Starlink and Iridium are in the satellites' population too.** PR
  #292 (merged while this was open) put the whole of Starlink (in Git LFS,
  `public/large/satellites/starlink.json`) and Iridium in the orbits group
  (`o`), with a slider for how many, names, search and targets
  ([Satellites.md](../satellites/Satellites.md)). The network overlays draw
  the same satellites from their own snapshots (this one is
  `public/data/networks/starlink.json`, plain git): Starlink by shell and
  Iridium with its crosslinks. With both on, the same satellites are
  drawn twice. *For the maintainer:* keep both, or have the overlays draw
  from the population's records (one Starlink file, one propagation).
- **CelesTrak's policy** (Satellites.md): one download of a group per two
  hours, stop at the first refusal.  This snapshot was one request for each
  group, kept in a cache directory; the satellites' groups weren't asked
  again.
- **The DSN's configuration** gives each complex's latitude and longitude,
  not each dish's, and no heights.  So the dishes are drawn at their
  complex, on the surface.  The antennas' own coordinates are in the DSN's
  *810-005* handbook, module 301, which this sandbox couldn't reach
  (deepspace.jpl.nasa.gov is refused).  Ten kilometres across a complex is a
  pixel from anywhere a link is worth looking at.
- **Licence and terms**: the elements as for the satellites (the maintainer's
  open question there applies here too).  DSN Now's data is NASA's,
  published for the public; its feed sends `Access-Control-Allow-Origin: *`.

## Propagation

SGP4 for all 11,116 Starlinks is 7 to 8 ms a frame on this session's CPU
(bun and Chromium alike): too much at 60 fps.  So `Constellation`:

- **Propagates a slice a frame**: Starlink's every 20 frames (556 a frame),
  Iridium's all every frame (80).  All of them on the first frame shown and
  after a jump in the date of more than half a day (one 8 ms frame, 20 ms in
  Chromium).
- **Carries each between its refreshes on the GPU**, along the circle its
  last state lies on: p(t) = r cos(ω dt) + (v/ω) sin(ω dt), ω = |v|/|r|.
  These orbits are near circular (e under 0.001), so against SGP4, over
  real Starlinks: 0.3 m worst after 1 s, 3.4 m after 10 s, 49 m after a
  minute, 0.4 km after 167 s, 6 km after 10 minutes.  At real time a
  satellite is refreshed every third of a second; at 100× every 33 s of
  its time (metres); at 1000× every 333 s (about a kilometre).  A circle
  rather than a tangent line stays bounded at any rate.
- **Times on the GPU** are seconds after a reference re-based every 600 s of
  the clock, so float32 holds them to under a millisecond.  Positions are
  metres from Earth's centre in float32 (half a metre).
- **Only while shown**: nothing is propagated while the overlay is off, or
  with the camera more than 1.5e9 m from Earth (the satellites' rule).
- **Only while the clock moves**: a frame at the same Julian Day as the
  last (paused, or a layer host's view at a held time) propagates and
  uploads nothing; `lastRefreshed` is then 0 and `primed` stays true.
- **Uploads by range**: a frame's slice goes up as one or two update
  ranges (it wraps) of `position`, `aVw` and `aState`, and a re-base sends
  `aState` whole.
- **The links' uploads** (`wideLines.js` `setWideLineSegments`, for
  Iridium's links and the DSN's beams): each attribute's span of changed
  values goes up as one range, and nothing goes up where nothing changed.
  The beams' ends and colours change only with a feed. Their starts move
  with Earth while the clock runs, so between feeds only the starts go up,
  and with the clock held nothing does. Layer mode's cost:
  [design/LayerMode.md](../../../design/LayerMode.md#cost).
- **Measured** (headless Chromium on this session's CPU, SwiftShader;
  `performance.now()` is coarsened to 0.1 ms there): Starlink 0.6 ms a
  frame, Iridium (with its links) 0.36, the DSN 0.01.  In bun: Starlink 0.42
  ms a frame (556 a frame; 0.9 ms at 1,112, every 10 frames).  The GPU's
  part is 11,116 points, each a sin and a cos in the vertex shader.  Real-
  GPU frame times are for a `?perf=1` snapshot on the preview (AGENTS.md).
- **Not done**: a worker.  The slice is under a millisecond; a worker would
  move it off the main thread at the cost of a second copy of satellite.js
  and a message a frame.  Worth it for the whole catalogue (30,000 with
  debris), with the point-population engine (Satellites.md, follow-ups).

## Starlink

A `Constellation` of every satellite in CelesTrak's group, 2 px points
coloured by shell, by inclination: the 43° shells teal, 53° blue, 70°
violet, the polar (97.6°) pink.  Those under 330 km (from the mean motion:
raising their orbits after launch, or coming down) are drawn at 45%.  In
the snapshot the working shells are at about 340 to 580 km; 108 are under
330.  Drawn within each satellite's elements' window (30 days, Satellites.md).

## Iridium

A `Constellation` of the iridium-NEXT group (80, propagated whole each
frame), and its links worked out again each frame from where the satellites
are (`iridium.js`).  The model, kept simple:

- **In service**: the mean motion within 0.005 rev/day of the median.  The
  spares sit lower (14.43 to 14.80 rev/day against 14.34) and are drawn
  grey, unlinked.  The snapshot has 67 in service: 66 and one in-orbit spare
  at the working height, which the model can't tell apart.
- **Planes**: the in-service satellites' nodes (RAAN) from their elements,
  clustered where more than 10° apart: six, ~31.6° apart, 11 to 12 each.
  Numbered east from the widest gap (202° in the snapshot), the **seam**:
  planes 1 and 6 either side of it pass each other going opposite ways.
  Each plane has a colour, its links a dimmer one.
- **In plane**: each satellite to the ones ahead and behind, ordered by
  argument of latitude (from its position and velocity).
- **Across planes**: each satellite to the nearest one in each neighbouring
  plane (planes k ± 1, never across the seam), each pair once.  None while
  either end is poleward of 60°: there the planes converge and cross, and
  Iridium switches its cross-plane links off.  60° is a model value;
  Iridium doesn't publish its own.  So the cross-plane links come and go as
  the satellites cross that latitude.
- **Line of sight**: a link must clear Earth by 100 km.  A plane missing a
  satellite has no link across the gap (65° apart, the line passes under
  the atmosphere).
- At the moment shot below: 67 in-plane links and 61 cross-plane.
- **Not modelled**: the real links' pointing limits and handovers, the
  ground stations and gateways, the spares' own links.

## DSN

`DeepSpaceNetwork` hangs from Earth's planetTilt, as the satellites do:

- **The dishes and the complexes' names** are in a child turned by GMST each
  frame (`earthFixed`), as Animation turns Earth, at their latitudes and
  longitudes (`coords.js` `latLngAltToBodyFixed`): a ring per dish, and the
  name as the places' are (the far side's not drawn; no depth test, since
  the ground is at their depth).  A click on a complex's name targets it as
  a place, a double click goes there.  The names show within 2e8 m of
  Earth.
- **The feed** (`dsn.js` `parseDsnXml`): DSN Now's
  https://eyes.nasa.gov/dsn/data/dsn.xml, a flat XML document read with a
  tag-and-attribute scan (no DOMParser, so bun's tests run it).  Each dish
  has its azimuth and elevation (whole degrees), its up and down signals
  (active or not, the spacecraft, band, rate) and its targets with their
  upleg and downleg ranges in km and round-trip light time (`-1`: not
  known).
- **A link** is a dish and a spacecraft with a signal active up or down
  (`dsnLinks`); a dish on engineering or testing (target `DSN`) has none.
  The spacecraft's names are config.xml's friendly names ("Voyager 1" for
  `VGR1`).
- **Its geometry**: the dish's pointing to a direction in the body-fixed
  frame (`topocentricDirection`: east, north and up on the sphere), out to
  the range (the downleg's, else the upleg's, else half the light time);
  that end turned to Earth's equator frame by GMST at the feed's time
  (`bodyFixedToEquator`), and kept there.  So as Earth turns, the dish moves
  with it and the far end stays on the spacecraft.  Refraction isn't
  modelled, and the angles are whole degrees: Voyager 1's end is good to
  about 1°, 3 AU at its 172 AU.
- **Checked against the sky**: from the fixture (the feed at 2026-10-23
  16:01 UTC), DSS 63's pointing at Voyager 1 comes out at RA 17.28 h, Dec
  +12.3°, and DSS 43's at Voyager 2 at RA 20.26 h, Dec −59.8°: where the
  two have been for years (RA 17h 13m, +12°; RA ~20h, −58° to −60°).
- **No range**: most near-Earth links don't give one (`-1`).  They're drawn
  2e9 m along their pointing in eight dashes that fade: a direction, not a
  place.
- **Up and down**: a downlink is a 3 px blue beam (additive), an uplink a
  1.5 px orange one drawn over it, opaque, so a link with both is an orange
  core in a blue beam.
- **The spacecraft's names** at the far ends, each once, shown while the end
  is apart from Earth on the screen (more than 5% of the camera's distance
  from its centre): from far out the Moon's and the dashes' ends are on
  Earth.
- **Live only**: DSN Now says what the dishes are doing now.  The links are
  drawn while the clock is within an hour of the feed's time; at any other
  date there are dishes and no links.
- **Polling**: from the animation loop, at most every 5 s (the feed's own
  cadence), only while the overlay is shown and the page visible (no frames
  run while the tab is hidden, and `document.hidden` is checked too), and
  not while `navigator.onLine` is false.  The URL carries `?r=` the 5 s
  slot, since the feed's CDN keeps a copy an hour.  A failure is quiet: no
  console message, `status` records it, and the next poll waits twice as
  long, up to 5 minutes.

## In the scene

- **Their own overlays**, not the orbits group: `S` Starlink, `I` Iridium,
  `D` the DSN (`Scene.NETWORK_KEYS`, in `OVERLAY_KEYS`).  Each has its fade,
  its setting and its letter in the link's `s=` (off by default, so `s=ID`
  shows Iridium and the DSN), and is in `V`'s presentation mode and the
  first load's reveal (with the diagrams).  Three, not one: they're
  different things at different scales (a shell at 500 km, a mesh at 780,
  beams to 170 AU), each with its own cost, and a link can show one.  Not
  `o`: that would load and propagate 11,000 satellites for everyone who
  looks at an orbit.
- **No keys**: three rows in Settings' Networks group (`k.addAction`), as
  the ecliptic and galactic grids have.  The few free letters are left for
  the maintainer to assign (Celestia's conventions decide most keys).
- **Labels made later** (the spacecraft's) take the overlay's fade
  (`network.fadeUniform`, set by `Scene.loadNetwork`).
- **The homepage** holds the overlays, so its tour never loads a network.

## What loads when

Nothing in the first load.  `Scene.loadNetwork(key)` imports the
satellites' chunk, which carries the networks' code too
(`loadSatellites.js` re-exports `loadNetwork`), and fetches that network's
snapshot once, when its overlay is first shown (`Scene._showOverlay`): a
Settings row, `V`'s restore, a link's `s=`.  A failed load is logged and
asked again the next time it's shown.  The DSN's feed then every 5 s while
shown.

- **Why not a chunk of its own.** The networks' code imports modules the
  first load has (wideLines, fade, SpriteSheet, hdr, coords) and some the
  satellites' chunk has (sgp4).  As its own dynamic import it made a third
  set of importers for them, and esbuild's splitting cut the first load's
  shared chunk into three: two more requests on the homepage (29 against
  main's 27, over the 28 budget; `yarn load-budget`).  In the satellites'
  chunk the sets are main's again, 27 requests.  The cost: that chunk grows
  from 34 KB to 55 KB minified, fetched whenever the satellites are.

## Checked

- `compactElements.test.js`: the round trip and SGP4 agreement.
- `Constellation.test.js`: the slices, the jumps, nothing while hidden, the
  carry against SGP4, the GPU's state against the CPU mirror, the window.
- `iridium.test.js`: a made-up six-plane constellation (planes and their
  order, argument of latitude, links in plane and across, the seam, the
  polar cut-off, a gap) and the snapshot (67 in service, six planes).
- `dsn.test.js`: the feed fixture (`dsn.fixture.xml`), the links and names,
  ranges, the pointing frame, GMST's turn, the Voyagers' sky positions; the
  polling cadence, not while hidden, the back-off; beams from the dishes to
  the ranges, the dashes, the live window, the far end fixed in space as
  Earth turns.
- `loadNetworks.test.js`: each network from its bundled file; each under
  1 MB.  `Scene.networks.test.js`: the keys and the link, loading once on
  first show, hanging, the fade, `applySettings`, held on the homepage.
- In the browser (headless Chromium, SwiftShader, a `CESIUM_ION_TOKEN=`
  build, the live feed through the proxy), 2026-10-23 16:40 UTC: Starlink's
  11,116 all drawn round Earth from 26,000 km; Iridium's six planes and 128
  links from 24,000 km; Goldstone's and Madrid's beams from 60,000 km; and
  from 400 AU the beams from Madrid and Canberra to Voyager 1 and 2, named.
  The live feed polled every 5 s with no failures.

## For a layer mode

Built: [design/LayerMode.md](../../../design/LayerMode.md) (`layer.html`,
`js/layer/`), which takes the networks as below with `labels: false`.  What
a host app over NetGL that has celestiary draw only its overlays, with the
host's camera and clock, needs from this code:

- **The clock**: every network moves from the Julian Day passed to its
  `update(jd)` (`preAnimCb`), not from `Time`; a host's time drives it as
  is.  The DSN's polling uses the wall clock and its links show only near
  the feed's time, so a host replaying another date gets dishes and no
  links.
- **The frame**: they hang from Earth's planetTilt (Earth's equator of date,
  +Y the pole, +X the equinox); a host places that node from its own Earth
  (its centre and orientation) and the networks follow.  The DSN turns its
  dishes by `gmstRad(jd)` itself, so a host Earth turned by another model
  should match GMST, or pass its rotation in.
- **The camera**: Constellation and the DSN read `camera` (passed in) only
  for distance rules; the wide lines need the camera in `onBeforeRender`
  for RTE; nothing else assumes celestiary's camera platform.
- **Depth**: the points and lines are depth-tested on the overlay layer
  against the scene's depth; a host compositing them needs to supply Earth's
  depth or accept no occlusion (the dishes do their own far-side test).

## Follow-ups

- **Per-dish coordinates** from DSN 810-005 module 301 (needs its host),
  with heights.
- **One Starlink:** the overlays drawing from the satellites' population
  (#292), which has the search, names and targets, instead of a snapshot
  of their own.
- **The DSN's spacecraft as targets**, and links to the ones celestiary
  already has (the Moon's LRO, a probe's own body once #119 has them).
- **History**: links at a past date need DSN Now's history, which isn't
  public.
- **A worker** for the propagation, with the whole catalogue.
