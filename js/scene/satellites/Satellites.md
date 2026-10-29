# Earth satellites

[#50](https://github.com/celestiary/web/issues/50), in
[#114](https://github.com/celestiary/web/issues/114).  Satellites from
CelesTrak's GP data (their mean elements, as OMM), propagated by SGP4 to the
simulation's date and drawn round Earth: a point each, named by a budget the
info panel's slider sets, the groups (Starlink, Iridium, navigation...)
switched on and off there, each one targetable, searchable and linkable, and
gone to and ridden like a body.  Earth's satellites are a population
([population/Population.md](../population/Population.md)), the generic part
that other bodies' populations (orbiters, the Deep Space Network's
spacecraft) share: this doc is what's Earth's and CelesTrak's.

## Files

- `sgp4.js`: the snapshot's rows to records, each making its SGP4 state
  (satellite.js's `json2satrec`) the first time it's drawn; a position at a
  date (`temePosition`) and with the velocity (`temeState`); TEME to Earth's
  equator frame (`temeToEquator`); and each satellite's window round its
  elements' epoch (`inWindow`).
- `Satellites.js`: the population (`../population/Population.js`) whose
  positions are SGP4's: the points, groups, names and target nodes are the
  population's.
- `names.js`: what they're called (`displayName`, `aliasesOf`, from the
  snapshot's `known`), the orders a counted group can be in (`ORDERS`), the
  satellite panel's lines (`satelliteFacts`), and the load distance.  It has no dependencies, so the scene, the search and
  the link import it without the SGP4 chunk.
- `loadSatellites.js`: the chunk's entry. Scene imports it dynamically, with
  the snapshot and its groups' own files (`loadSatelliteRecords`, which layer
  mode shares).
- `../../search/providers/SatellitesProvider.js`: the search's entries, for
  any population.
- `../networks/` (not this population): the space network overlays, `S`,
  `I` and `D` ([Networks.md](../networks/Networks.md)), draw Starlink by its
  shells and Iridium with its crosslinks, from the same files as this
  population's Starlink and Iridium groups.
- `../../../tools/satellites/`: `fetch.mjs` refreshes the snapshot and the
  constellations' files (`yarn satellites`), `celestrak.mjs` asks CelesTrak,
  `select.js` holds the groups and the sampling, and `fetchHorizons.mjs`
  refreshes the Horizons fixture.

## The data

**A snapshot, bundled**, under `public/data/earth/satellites/`: `index.json`,
and the constellations the space networks draw (Starlink, Iridium) whole in
files of their own under `networks/` there, which the networks' overlays
read too ([Networks.md](../networks/Networks.md#the-data)): one copy each.
Refreshed by `yarn satellites`, not fetched live.

- **Why a snapshot.**  The app is a time machine. A live fetch serves only
  dates near today, and links, previews and tests would change under it.
  CelesTrak's usage policy also asks clients to fetch each data set at most
  once per update (every two hours for GP data), and it enforces that.  The
  snapshot without the constellations is small, 446 satellites in 70 KB,
  under the data policy's line for plain git (DESIGN.md, [data
  policy](../../../DESIGN.md#data-policy)); so are Starlink's 11,106 in the
  networks' compact columns, 860 KB (320 KB gzipped), and Iridium's 80.
  Starlink's were 1.8 MB as rows (543 KB gzipped), in Git LFS under
  `public/large/`, beside the overlay's own copy, until they became one
  file (below).
- **The snapshot** was fetched 2026-10-27 04:35 UTC, the first fetch as
  CSV (every group answered, every row read); its elements' epochs run to
  2026-10-27.  What's in it (`select.js` `GROUP_QUERIES`), each satellite
  once, under the first group that has it:

  | Group | Query | In CelesTrak's | Kept | Epochs |
  |---|---|---|---|---|
  | `stations` | `GROUP=stations` | 20 | 20 | 2026-10-26 |
  | `science` | `CATNR=20580` (Hubble) | 1 | 1 | 2026-10-26 |
  | `gnss` | `GROUP=gnss` (GPS, GLONASS, Galileo, BeiDou) | 169 | 169 | 2026-09-28 to 10-27 |
  | `molniya` | `NAME=MOLNIYA` | 33 | 33 | 2026-10-14 to 26 |
  | `weather` | `GROUP=weather` | 73 | 73 | 2026-10-26 to 27 |
  | `iridium` | `GROUP=iridium-NEXT` | 80 | 80 | 2026-10-07 to 26 |
  | `geo` | `GROUP=geo` | 569 | 150 | 2026-10-12 to 26 |
  | `starlink` | `GROUP=starlink` | 11,106 | 11,106 (300 shown to start) | 2026-10-20 to 27 |

  The epochs' spread is the catalogue's: a working satellite's elements
  are a day or two old, a dead one's (some GLONASS, Iridium spares,
  Molniyas) as old as its last tracking update.  The first snapshot (below)
  was fetched 2026-10-23 17:20 UTC, as JSON; this one, the same groups as
  CSV four days on, changed a station (21 to 20) and Starlink (11,116 to
  11,106), and nothing else in the counts.

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
  - **The GEO sample** is spaced evenly by NORAD number, so it spreads
    over the launches and the slots.
  - **Starlink whole, by serial number** (PR #292, at the maintainer's
    ask; it was a 300 sample before).  `select.js` gives the group an order
    and a count instead of a sample (`order: 'serial'`, the number in
    STARLINK-1008, then NORAD's; `count: 300`) and a file of its own
    (`file`).  The header carries them as `order` (`serial`), `orderedBy`
    ("serial number"), `count` and `file`, and the panel gives the group a
    slider, from one to all, the first by serial number (Population.md,
    [counted groups](../population/Population.md#counted-groups)).  Built
    from the same 17:20 UTC fetch, kept in a cache (`--cache --offline`):
    nothing new asked of CelesTrak.
  - **One file a constellation** (at the maintainer's ask, after the
    networks' overlays brought copies of their own): Starlink and Iridium
    are each one file under `networks/`, in the networks' compact columns
    with the names and designators (`compactElements.js`), which the
    overlays and this population both read.  The file is in NORAD order;
    `loadSatellites.js` puts a group in its `order` as it loads it
    (names.js `ORDERS`), so the slider's first are still by serial number.
    The rows it replaced came from the same 17:20 UTC fetch, rebuilt with
    nothing asked of CelesTrak: every name and designator the same, positions
    within 3 m over a week.
  - **What they fill:** the regimes [Lagrange.md](../Lagrange.md#orbital-regimes)
    draws.  LEO has the stations, Hubble, Iridium (780 km, 86.4°) and
    Starlink; MEO has the
    GNSS planes, on the GPS marks; then the GEO ring, Molniya, and the
    weather group's sun-synchronous orbits.
  - **The stations group** also holds the craft docked at the stations
    (Soyuz, Progress, Dragon, Shenzhou, Tianzhou) and cubesats they let go.
    So the names' budget starts at the best known (the header's `known`:
    the ISS, Tiangong, Hubble), which rank first; the slider names more,
    the rest of the stations next.  Every satellite is in the search.
- **The format** is one row per satellite: `[NORAD_CAT_ID, OBJECT_NAME,
  group, ...OMM fields]`.  The columns are named in the file.  The header
  records the source and the fetch time (`fetched`: the oldest group's, a
  rebuild from the cache keeping it), and it carries how the app shows the
  population, so the app has no table of its own: its `body` (`earth`),
  each group's `label`, `kind` (what one of it is, for a satellite's panel)
  and `color` with its URL and counts, in the panel's order, and `known`,
  the best known by NORAD number with the names people use and their
  aliases (`select.js` `KNOWN`).  A group kept in a file of its own names
  it (`file`, a path under public/, plain git, fetched as it is: not by
  `dataUrl`, which a preview resolves against production); that file is
  the networks' compact columns.  It's OMM, not TLE: the catalogue passed five digits on
  2026-07-11 (CelesTrak), and TLEs can't carry the new numbers.  The
  snapshot already has some, e.g. Soyuz MS-29, 100057 (and 473 of the
  Starlinks).  Nothing on the way assumes five: satellite.js's
  `json2satrec` takes the number as it is, links are `sat:<digits>`, the
  compact columns store differences.
- **Fetching** (`tools/satellites/fetch.mjs`, asking through
  `celestrak.mjs`): one request a group, the constellations' among them,
  through the proxy (`NODE_USE_ENV_PROXY=1`, which `yarn satellites` sets).
  - **As CSV** (`FORMAT=CSV`).  CelesTrak's [GP data
    formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
    page (updated 2026-06-23, read 2026-10-26) makes CSV the default since
    2026-05-09, is the format CelesTrak uses itself and promises not to
    change "unless absolutely necessary", where the JSON could; and the
    JSON is three times its size, while CelesTrak is short of bandwidth.
    `parseGpCsv` reads it into the records the JSON gave (`.1189007E-3` is
    the JSON's 0.0001189007: the same doubles), so nothing downstream
    changed, and throws on an answer that isn't GP CSV (its "No GP data
    found" comes as a 200) or a record SGP4 can't start from.
  - **Once per update.**  Each answer is kept in `tools/satellites/.cache`
    (git ignores it; `--cache DIR` for another) and used again for two
    hours.  `yarn networks` asked for Starlink and Iridium NEXT too, for the
    overlays' copies: without a shared `--cache` the second script asked
    again, and since 2026-03-26 CelesTrak answers a second download of a set
    that hasn't updated with a 403.  Now only this script asks CelesTrak.
    A run that stopped part way can be run again
    without asking for what it had; with `--offline`, the cache is used
    whatever its age and nothing is asked, to rebuild the files from the
    last fetch.
  - **Stopping at the first answer that isn't a 200**, as CelesTrak's
    [usage policy](https://celestrak.org/usage-policy.php) asks of machine
    clients; ignoring refusals gets an address firewalled (50 errors in two
    hours, 301s, 403s and 404s alike).  Redirects aren't followed
    (`redirect: 'manual'`): a 301 is one of those errors, and CelesTrak
    says to stop at it.  `--skip` leaves a refused group out without asking
    (a skipped group's own file is left as it was).
- **Licence and terms.**  The elements are the US Space Force's public
  catalogue (space-track.org), which CelesTrak republishes.  CelesTrak's
  usage policy (read 2026-10-23) sets access limits, the ones above, and
  its pages call the data freely available.  Neither the policy nor the
  GP documentation (read again 2026-10-26, after its update of 2026-06-23)
  says anything about redistributing a copy; the documentation asks users
  who value the service to donate.  *For the
  maintainer to decide:* whether committing a snapshot with attribution
  (the header's `source`, the info panel's "Elements from CelesTrak") is
  enough, or whether to ask CelesTrak, or space-track.org's terms, first.

### Kept fresh

A low satellite is drawn for 30 days round its elements' epoch
([below](#old-elements-and-dates-far-from-them)), so a snapshot more than a
month old shows today without Starlink, Iridium, the stations or Hubble.
`.github/workflows/satellites.yml` refreshes it every two weeks, on the 1st
and the 15th of each month at 06:17 UTC, and on demand (Actions, Satellites,
Run workflow):

- **It runs `yarn satellites`**, one request a group from CelesTrak, and
  stops at the first answer that isn't a 200, as CelesTrak's policy asks.
  That fails the job, and GitHub tells whoever last changed the schedule; no
  retry, so nothing hammers CelesTrak.  A 403 for a set "not updated since
  your last successful download" can come from another job on the same
  shared runner address: the next run, or a run by hand, asks again.
- **Then the tests that read the snapshot** (`tools/satellites`,
  `js/scene/satellites`, `js/scene/networks`, `js/layer`), before anything
  is pushed.
- **A changed snapshot opens one pull request**, from the branch
  `auto/satellites`, force-pushed from `main` each time, so an unmerged
  refresh is replaced by the next rather than stacking.  Its body lists the
  groups' counts.  Unchanged, nothing is pushed.
- **CI runs on it by dispatch:** a pull request opened with the workflow's
  own token starts no `pull_request` workflows, but a `workflow_dispatch`
  of `ci.yml` does, and its checks land on the pull request's commit.  No
  preview is built for it.
- **It needs** the repository's *Allow GitHub Actions to create and approve
  pull requests* (Settings, Actions, General), and merges by the maintainer
  as any other.  These pull requests add no ROADMAP or CHANGELOG entry:
  fresher elements are the data's upkeep, not a change.

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
- **Earth's tilt**: `earth/index.json`'s `axialInclination` is 23.45°, 0.0107°
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
  2e8 m.  The target's name shows wherever the points do.  The names and
  the group switches are the population's
  ([Population.md](../population/Population.md#what-every-population-gets)):
  the Satellites section of Earth's panel (and of a satellite's) lists the
  eight groups with their colours and counts as switches, and a Names
  slider from none to all shown, starting at the three best known, and
  Starlink's own slider, how many of them show (300 to start).  The
  names carry `labelTargets`, so a click targets a satellite and a double
  click goes there (labelPick.js).  The names behind Earth take no room,
  those shown keep their place, and they fade in and out
  ([Population.md](../population/Population.md#names-that-hold-still)).
  Each name is sized and dimmed by its distance from the camera, from the
  nearest of the names in view (14 px) to the farthest (11 px, 0.7 as
  bright), the nearer winning where two touch ([Population.md](../population/Population.md#names-by-distance)).
  The link keeps it all (`pop:earth=starlink,earth.labels=40,earth.starlink=2000`,
  design/URLs.md).  A search box at the top of the section finds Earth's
  satellites alone (Population.md, [search](../population/Population.md#search)).
- **Updated** each frame from the Julian Day animated.  While the points
  are shown, every satellite shown is propagated: 0.5 ms a frame for 700 of
  them (a third in deep space) in bun on this session's CPU.  Over 2,000
  shown (Starlink whole), those on near-circular orbits are carried along
  their circles between exact positions, 2,500 a frame in turn
  (Population.md, [many shown](../population/Population.md#many-shown)):
  SGP4's velocity gives each its circle, and Starlink's carried positions
  are within 0.12 km of SGP4's after 10 s and 0.7 km after a minute.  All
  11,116 cost 3 ms a frame in bun, and 6 ms in headless Chromium's update.
  A record's SGP4 state is made when it's first drawn (`sgp4.js`
  `newSatRecord`): parsing all of Starlink took 77 ms made at once, 33 ms
  now.  The targets' nodes are always updated, since the camera may ride
  one with `o` off.
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
- **Search**: `SatellitesProvider` finds each satellite under Earth's path,
  by its display name ("ISS"), CelesTrak's name ("ISS (ZARYA)"), the known
  aliases ("International Space Station", "Tiangong", "Hubble"), its NORAD
  number and its international designator: the groups shown whole through
  the search's fuzzy index, and every satellite, Starlink too, by its names'
  characters (js/search/DESIGN.md, [populations](../../search/DESIGN.md#populations)).
- **Info panel**: the NORAD number, the designator and the group; perigee
  and apogee heights, inclination, period and eccentricity from the mean
  elements; the elements' epoch and their age at the date; whether it's
  drawn; and the snapshot's date (`ControlPanel.showSatellite`).
- **Layer mode** ([design/LayerMode.md](../../../design/LayerMode.md)): the
  same population with a label budget of 0 (no sheets, which want
  ThreeUi's label pass) and without Starlink's file (the `S` network draws
  it, and the `I` network Iridium), hung in ECEF under a host's camera and
  clock; the host names what it wants from the layer's anchors
  (`norad:<n>`).
- **Models** (#25, done elsewhere for #120): a satellite's node is where a
  model would hang. The node is in Earth's equator frame, moved each frame,
  and the camera can already ride it.  A model sets
  `node.arrivalDistance` for the go.

## What loads when

Neither satellite.js (about 20 KB minified, 10 KB gzipped, its WASM
propagators stubbed out in `esbuild/common.js`) nor the snapshot is in the
first load.  `Scene.loadSatellites` imports the chunk and fetches the
snapshot once, then its groups' own files (Starlink's 320 KB gzipped,
Iridium's; the networks' overlays read the same files, so a second reader
gets them from the HTTP cache), when:

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
- `Population.test.js`: a counted group and the carrying (Population.md).
  `SatellitesProvider.test.js`: what goes to the fuzzy index, and the
  ranking by characters.  `select.test.js`: Starlink kept whole, by serial
  number, in its own file.
- In the browser (headless Chromium, SwiftShader, `CESIUM_ION_TOKEN=`
  build).  For PR #292's second round: the link
  `#sun/earth@2.3217,30.6675,15.963766Mm;t=9792.863603jd;…;pop:earth=starlink,earth.labels=300`
  loads 11,643 satellites, Starlink's 11,116 among them, 300 shown, and
  the slider reads "300 of 11,116, by serial number".  At "all" every one
  is drawn within three frames (`screens/satellites-50/starlink-all.png`),
  and the link gains `earth.starlink=11116`.  The panel's search for
  "starlink 2449" lists it, and a click targets it
  (`panel-search.png`).  The names, frame by frame:
  [Population.md](../population/Population.md#checked).  With the first snapshot at 2026-10-23 09:00 UTC: all 450 are drawn
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
  (`screens/satellites-50/`).  The group switches and the Names slider,
  clicked through the panel and reopened from their link:
  [Population.md](../population/Population.md#checked).

## Follow-ups

- **Fresher elements than a fortnight's.**  The scheduled refresh ([kept
  fresh](#kept-fresh)) keeps today within every low satellite's window
  while its pull requests are merged.  For elements of the day, the app
  could fetch live from CelesTrak when the date is within a few days of now
  and fall back to the snapshot otherwise; that needs CORS, which isn't
  checked yet, and every visitor's fetch would count against CelesTrak's
  limits, so it would need its own cache.
- **History.**  Dates outside the snapshot's windows need elements of their
  date: space-track.org's history (an account, and terms to read), or
  snapshots kept by date.
- **The whole catalogue** (about 30,000 objects with debris) would go on the
  point-population engine ([Gaia.md](../Gaia.md)), with the propagation in
  a worker or on the GPU.
- **The target's orbit line**, from its elements; ground tracks; passes over
  a place.
- **Models** (#25).
