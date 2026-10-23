# Earth satellites

[#50](https://github.com/celestiary/web/issues/50), in
[#114](https://github.com/celestiary/web/issues/114).  Satellites from
CelesTrak's GP data (their mean elements, as OMM), propagated by SGP4 to the
simulation's date and drawn round Earth: a point each, the best known named,
each one targetable, searchable and linkable, and gone to and ridden like a
body.

## Files

- `sgp4.js`: the snapshot's rows to SGP4 records (satellite.js's
  `json2satrec`), a position at a date (`temePosition`), TEME to Earth's
  equator frame (`temeToEquator`), and each satellite's window round its
  elements' epoch (`inWindow`).
- `Satellites.js`: the scene object.  One `Points` for all of them, the
  names, and a node per targeted satellite.  Moved each frame from the
  Julian Day animated (`preAnimCb`).
- `names.js`: what they're called (`displayName`, `aliasesOf`), the target
  (`satelliteTarget`), the info panel's lines (`satelliteFacts`), and the
  load distance.  It has no dependencies, so the scene, the search and the
  link import it without the SGP4 chunk.
- `loadSatellites.js`: the chunk's entry. Scene imports it dynamically, with
  the snapshot.
- `../../search/providers/SatellitesProvider.js`: the search's entries.
- `../../../tools/satellites/`: `fetch.mjs` refreshes the snapshot (`yarn
  satellites`), `select.js` holds the groups and the sampling, and
  `fetchHorizons.mjs` refreshes the Horizons fixture.

## The data

**A snapshot, bundled:** `public/data/satellites.json`, refreshed by `yarn
satellites`, not fetched live.

- **Why a snapshot.**  The app is a time machine. A live fetch serves only
  dates near today, and links, previews and tests would change under it.
  CelesTrak's usage policy also asks clients to fetch each data set at most
  once per update (every two hours for GP data), and it enforces that.  A
  snapshot is small: 748 satellites are 118 KB, 41 KB gzipped, well under
  the data policy's line for plain git (DESIGN.md, [data
  policy](../../../DESIGN.md#data-policy)).
- **The snapshot** was fetched 2026-10-23 13:01 UTC; its elements' epochs
  run to 2026-10-23.  What's in it (`select.js` `GROUP_QUERIES`), each
  satellite once, under the first group that has it:

  | Group | Query | In CelesTrak's | Kept | Epochs |
  |---|---|---|---|---|
  | `stations` | `GROUP=stations` | 21 | 21 | 2026-10-20 to 23 |
  | `science` | `CATNR=20580` (Hubble) | 1 | 1 | 2026-10-23 |
  | `gnss` | `GROUP=gnss` (GPS, GLONASS, Galileo, BeiDou) | 170 | 170 | 2026-09-23 to 10-23 |
  | `molniya` | `NAME=MOLNIYA` | 33 | 33 | 2026-10-14 to 23 |
  | `weather` | `GROUP=weather` | 73 | 73 | 2026-10-22 to 23 |
  | `geo` | `GROUP=geo` | 569 | 150 | 2026-10-12 to 23 |
  | `starlink` | `GROUP=starlink` | 11,116 | 300 | 2026-10-21 to 23 |

  - **Starlink came a fetch later.**  The first snapshot (2026-10-23 08:48
    UTC, PR #286) had no Starlink.  CelesTrak answered a 403: the set hadn't
    updated since "your last successful download" on 2026-10-22 14:50 UTC,
    which was another client on this session's shared address.  The policy
    says to stop at a refusal and report it, rather than ask again or work
    round it with another query.  So that snapshot was built with `--skip
    starlink`, its header naming the group.  CelesTrak was then unreachable
    at 11:00 and 12:00 UTC, and answered every group at 13:01.
  - **Molniya by name:** CelesTrak no longer has a Molniya group.  The name
    query brings the Molniya satellites themselves, most of them defunct
    but still in their orbits.
  - **The samples** (GEO and Starlink) are spaced evenly by
    NORAD number, so they spread over the launches and the orbital planes.
  - **What they fill:** the regimes [Lagrange.md](../Lagrange.md#orbital-regimes)
    draws.  LEO has the stations, Hubble and Starlink; MEO has the
    GNSS planes, on the GPS marks; then the GEO ring, Molniya, and the
    weather group's sun-synchronous orbits.
  - **The stations group** also holds the craft docked at the stations
    (Soyuz, Progress, Dragon, Shenzhou, Tianzhou) and cubesats they let go.
    So the scene names only the best known (`names.js` `KNOWN`: the ISS,
    Tiangong, Hubble) and the target.  Every satellite is in the search.
- **The format** is one row per satellite: `[NORAD_CAT_ID, OBJECT_NAME,
  group, ...OMM fields]`.  The columns are named in the file, and the
  header records the source, the fetch time (`fetched`) and each group's
  URL and counts.  It's OMM, not TLE: the catalogue passed five digits on
  2026-07-11 (CelesTrak), and TLEs can't carry the new numbers.  The
  snapshot already has some, e.g. Soyuz MS-29, 100057.
- **Fetching** (`tools/satellites/fetch.mjs`): one request a group, through
  the proxy (`NODE_USE_ENV_PROXY=1`, which `yarn satellites` sets).  It
  stops at the first answer that isn't a 200, as CelesTrak's [usage
  policy](https://celestrak.org/usage-policy.php) asks of machine
  clients; ignoring refusals gets an address firewalled.  `--cache DIR`
  keeps each group's answer for two hours, so a run that stopped part way
  can be run again without asking for what it had.  `--skip` leaves a
  refused group out without asking.
- **Licence and terms.**  The elements are the US Space Force's public
  catalogue (space-track.org), which CelesTrak republishes.  CelesTrak's
  usage policy (read 2026-10-23) sets access limits, the ones above, and
  its pages call the data freely available.  Neither the policy nor the
  GP documentation says anything about redistributing a copy.  *For the
  maintainer to decide:* whether committing a snapshot with attribution
  (the header's `source`, the info panel's "Elements from CelesTrak") is
  enough, or whether to ask CelesTrak, or space-track.org's terms, first.

### Old elements, and dates far from them

Mean elements age.  SGP4 is a few kilometres off within a day of the
elements' epoch in low orbit, and the error grows with drag, which the
elements don't model.  After a month in low orbit the position along the
orbit is a guess.  Higher up there is little drag, so the plane and the
phase hold for months.  So each satellite is drawn only within a window
round its elements' epoch (`sgp4.js` `WINDOW_DAYS`):

- 30 days for a low orbit: a period under 225 minutes, SGP4's own split
  between near-Earth and deep space.
- 180 days for anything higher.

Outside its window a satellite isn't drawn and has no position.  It's still
in the search, and the info panel says it isn't drawn and why.  A go to it
goes to Earth instead.  A date before a satellite's launch is outside its
window too.  So a snapshot shows its satellites for about a month either
side of its date in low orbit, and half a year higher up.  Dates further
out need a newer snapshot (see [follow-ups](#follow-ups)).

## The frame

SGP4's positions are in TEME: the true equator and the mean equinox of the
elements' date.  The satellites hang from Earth's `planetTilt`, the node
Earth's spin (GMST) turns under.  Its frame has +Y at the north pole and +X
at the equinox of date, with Earth's tilt, `rotateX(−axialInclination)`,
from the ecliptic of date (DESIGN.md, [frames and
time](../../../DESIGN.md#frames-and-time)).  So TEME (x, y, z) goes to
(x, z, −y) there, in metres: the same remap as the ecliptic's to the
scene's.  Two things differ:

- **Nutation**, which TEME has and the scene doesn't: under 20″.  That's
  0.2 to 0.33 km for Vanguard 1 at 7,000 to 9,000 km out, and up to about
  4 km at GEO.
- **Earth's tilt**: `earth.json`'s `axialInclination` is 23.45°, 0.0107°
  (38″) over the J2000 obliquity, 23.4393°.  The satellites hang in the
  equator as drawn, so their ground tracks match Earth's drawn surface, and
  they carry that 38″ in space: 1.6 km for Vanguard 1.  Correcting Earth's
  tilt would correct both together.

Time: SGP4 takes UTC, and so does the clock.  The Julian Day animated is the
clock's UTC Julian Day (`Time.toJulianDay`), the same one Earth's GMST turns
by.

## In the scene

- **Drawn** on the overlay layer in the orbits group (`o`), as the regimes
  and Lagrange marks are. They're annotations: a 3.5 px dot per satellite,
  coloured by group, with depth testing, so Earth hides those behind it.
  The points are hidden when the camera is more than 1.5e9 m from Earth's
  centre (about four times the Moon's distance), and the names past
  2e8 m.  The target's name shows wherever the points do.  A name is a
  one-label sheet that moves with its satellite each frame.  It carries
  `labelTargets`, so a click targets the satellite and a double click goes
  there (labelPick.js).
- **Updated** each frame from the Julian Day animated.  While the points
  are shown, every satellite is propagated: 0.5 ms a frame for 700 of them
  (a third in deep space) in bun on this session's CPU.  The targets' nodes are always updated, since the
  camera may ride one with `o` off.
- **The target** is `{kind: 'satellite', id, name, body: 'earth'}`, set
  only through `Scene.setTarget`, like every other target (DESIGN.md, [the
  target](../../../DESIGN.md#the-target)).  It works the way a place does:
  Earth is `Shared.targets.obj` and the satellite is `Shared.targets.label`.
  `c` faces it (`labelPosition`), `t` tracks it, the breadcrumb reads Sun ›
  Earth › ISS, and the page title is its name.
- **Going** (`g`, a double click, the search's Go, a link's path alone):
  `Scene.goTo` with a satellite targeted hangs the camera platform on the
  satellite's node and arrives 300 km from it (`ARRIVAL_DIST`; a model can
  set `node.arrivalDistance`), along the line it came in on, unless that
  line comes from below the satellite's height, within 72° of straight up
  (`SAT_ARRIVAL_MIN_UP`).  Then it arrives straight above, Earth behind
  the satellite.  The first preview with the real data went to the ISS on
  Earth's far side and arrived under it, 266 km up, looking out at the
  stars; a satellite under 300 km up would have put the camera inside
  Earth.  Following
  is on for the node, so the camera rides the satellite as time runs.
  `Shared.targets.cur`, the camera's frame, stays Earth, so a link made
  there is in Earth's frame.  The approach's exposure prediction is skipped
  for this hop: it assumes a camera facing the body from about ten radii,
  and from 300 km off a satellite it took the view for the night side, a
  gain of 4e6 where the meter settled on 4, which showed as a white frame
  on arrival.  The meter carries on from the gain it has.
- **Riding and leaving** (`f`): off leaves the camera in Earth's frame
  (`_parentNode` of a satellite node is Earth's `orbitPosition`); on rides
  the targeted satellite again.
- **Links**: the path is `sat:<NORAD number>` (`targetPath.js`, e.g.
  `#sat:25544`), and the frame is Earth's (`REF_FRAME.satellite`).  A link
  with a view restores the camera round Earth at its time, then targets the
  satellite.  With `F` set it rides the satellite again, from there.
- **Search**: `SatellitesProvider` lists each satellite under Earth's path,
  by its display name ("ISS"), CelesTrak's name ("ISS (ZARYA)"), the known
  aliases ("International Space Station", "Tiangong", "Hubble"), its NORAD
  number and its international designator.
- **Info panel**: the NORAD number, the designator and the group; perigee
  and apogee heights, inclination, period and eccentricity from the mean
  elements; the elements' epoch and their age at the date; whether it's
  drawn; and the snapshot's date (`ControlPanel.showSatellite`).
- **Models** (#25, done elsewhere for #120): a satellite's node is where a
  model would hang. The node is in Earth's equator frame, moved each frame,
  and the camera can already ride it.  A model sets
  `node.arrivalDistance` for the go.

## What loads when

Neither satellite.js (about 20 KB minified, 10 KB gzipped, its WASM
propagators stubbed out in `esbuild/common.js`) nor the snapshot is in the
first load.  `Scene.loadSatellites` imports the chunk and fetches the
snapshot once, when:

- the view could show the satellites: the camera within 1.5e9 m of Earth
  with the orbits (`o`) shown.  A watcher node under Earth's `planetTilt`
  asks each frame until they're in.  The homepage holds the overlays, so
  its tour never fetches them;
- a `sat:` link is opened;
- the first search is made (`searchIndex.loadOnSearch`).

A failed load is logged and asked for again by the next need.

## Checked

- `sgp4.test.js`: satellite.js reproduces Vallado's verification case 00005
  (Vanguard 1, *Revisiting Spacetrack Report #3*, AIAA 2006-6753) to 1e-6
  km at the epoch.  OMM input agrees with the same TLE to under 10 m a day
  either side.  Also the rows, the windows and the frame remap.
- `sgp4.horizons.test.js`, against JPL Horizons (offline fixture
  `sgp4.horizons.json`, its queries inside; `tools/satellites/fetchHorizons.mjs`):
  - Vanguard 1, from the same TLE through Horizons' own SGP4 (its TLE
    input), at the epoch, 6 h and 1 d on.  Taken to the scene's axes:
    within 0.33 km with the J2000 obliquity (nutation is the rest), and
    within 1.6 km in Earth's equator as drawn (its 23.45° tilt).  This
    checks the frame and the time.
  - The ISS (Horizons −125544, its trajectory) at its snapshot elements'
    epoch (2026-10-22 23:36 UTC), 6 h and 1 d either side: 0.02 km at the
    epoch, 0.14 and 0.26 km 6 h off, 0.04 and 0.38 km a day off.  (With the
    first snapshot's elements, of 2026-10-21: 0.00, 0.61 and 1.52 km.)
    Horizons' ISS is fitted from elements like these, as the near-zero at
    the epoch shows.
    So this checks the propagation and the frame together, not the
    elements against the station's own tracking.
- `Satellites.test.js`: positions, windows, nodes, names, the distance
  rules, the panel's lines.
- `Scene.satellites.test.js`: loading once, hanging under Earth's tilt, the
  `o` group, the watcher (not while the overlays are held, not from far),
  targeting, going (the platform on the node, Earth the frame, riding as
  time runs), leaving, and the go to Earth for a satellite with no
  position at the date.
- `targetPath.test.js`, `SearchSlice.test.js`: `sat:` paths and the
  breadcrumb.  `Celestiary.test.js`: a link to Earth fetches the snapshot.
- In the browser (headless Chromium, SwiftShader, `CESIUM_ION_TOKEN=`
  build).  With the first snapshot at 2026-10-23 09:00 UTC: all 450 are drawn
  and the points' program compiles.  From 191,000 km the GEO sample sits
  on the geostationary ring, the GNSS satellites on and round the GPS
  planes, Molniya's on their long ellipses, and the weather satellites
  close in.  The ISS, Tiangong and Hubble are named.  The ISS targeted
  titles the page "ISS — Celestiary", and the panel shows 415 – 424 km,
  51.6°, 93.0 min, and the elements 2.3 days old.  A go arrives 300 km
  above it and rides it (link `#sat:25544@…`).  With this snapshot, at
  2026-10-23 13:05 UTC: all 748 are drawn, and Starlink's 300 make a
  shell hugging Earth inside the LEO band.  The go to the ISS, on the day
  side this time, shows its name readable over bright cloud
  (`screens/satellites-50/`).

## Follow-ups

- **Fresher elements.**  A scheduled workflow could run `yarn satellites`
  and open a PR each week.  Or the app could fetch live from CelesTrak when
  the date is within a few days of now and fall back to the snapshot
  otherwise; that needs CORS, which isn't checked yet.
- **History.**  Dates outside the snapshot's windows need elements of their
  date: space-track.org's history (an account, and terms to read), or
  snapshots kept by date.
- **The whole catalogue** (about 30,000 objects with debris) would go on the
  point-population engine ([Gaia.md](../Gaia.md)), with the propagation in
  a worker or on the GPU.
- **The target's orbit line**, from its elements; ground tracks; passes over
  a place.
- **Models** (#25).
