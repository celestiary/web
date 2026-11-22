# Earth's cryosphere

*Proposed 2026-11-22.  Nothing built yet; the data paths below were checked
from the sandbox that day.*

Earth breathing (PR #379) turns the Blue Marble's months through the year,
and the land's snow comes and goes with them.  The sea doesn't: the Blue
Marble is a land product, and its ocean is the same dark blue in every
month.  Read from `public/textures/earth/blue-marble/2004-MM.jpg`, the
Beaufort Sea (76° N 140° W), Hudson Bay (60° N 85° W) and the Weddell Sea
(68° S 40° W) are `[2, 5, 20]` in both March and September, when the Arctic's
ice is at its largest and smallest.  The ice shelves are in it (the Ross Ice
Shelf is `[238, 238, 238]`), as land.  So the most visible thing missing
from the seasons is sea ice: about 15 million km² in the Arctic's March and
18 million round Antarctica in September, nearly all of it gone from one
hemisphere or the other each half year.

This proposes the cryosphere as a layer of Earth's, the way the clouds are
one (#88, #169): the day's sea ice from NASA GIBS on both sides of the
Cesium swap far off, and close in a mesh of floes with a thickness, ridges,
leads and cliffs, with icebergs; then the ice sheets and glaciers with
their real thickness.

## Scale: what thickness can show

Worth stating first, because it decides what the meshes are for.

| Ice | Thickness | Above the water |
|---|---|---|
| Arctic first-year sea ice, end of winter | 1.5-2 m | 0.15-0.25 m |
| Arctic multiyear sea ice | 2.5-4 m | 0.3-0.5 m |
| Antarctic sea ice, mostly first-year | 0.5-1 m (more in the western Weddell) | 0.05-0.15 m |
| Pressure ridges | keels to 20-30 m | sails 1-5 m, rarely 10+ |
| Ice shelf fronts (Ross, Ronne-Filchner) | 200-400 m at the front | 15-50 m cliffs |
| Tidewater glacier fronts (Greenland, Svalbard) | 300-1,000 m | 20-80 m cliffs |
| Tabular Antarctic icebergs | 200-400 m | 25-50 m |
| Greenland's ice sheet | to about 3.4 km | |
| Antarctica's ice sheet | to nearly 5 km | |

Sea ice floats with about a ninth of it above the water (ice 900-920 kg/m³
in sea water 1,025, less with snow loading).  So **sea ice is flat**: a floe's
"cliff" is a step of decimetres, and the relief worth drawing is the ridges,
the rafting and the broken edges, seen from a few hundred metres up.  The
cliffs that read from tens of kilometres are the ice shelves', the tidewater
glaciers' and the icebergs'.  From orbit the cryosphere is colour and albedo,
not relief.  So there are three tiers, as the clouds have two:

1. **Far** (everywhere): the ice's colour and albedo on the ocean, under the
   clouds, on both surfaces.  This is what Earth breathing needs.
2. **Near** (below about 30 km over sea ice): floes as meshes round the
   camera, with freeboard, ridges and leads, from the same map.
3. **Features at any distance**: icebergs, ice shelf fronts and tidewater
   cliffs, as meshes of their own.

## Data

### Sea ice concentration, by day: NASA GIBS

GIBS serves the passive-microwave records as colour-mapped PNGs, which
invert exactly to concentration.  From `gibs.earthdata.nasa.gov`, which
sends CORS headers, needs no key and is already used for the clouds and the
night lights (`gibs.js`, credited the same way):

| Dates | Layer | Grid | Steps | Notes |
|---|---|---|---|---|
| 2002-09-01 to yesterday | `GHRSST_L4_MUR25_Sea_Ice_Concentration` | EPSG:4326, `2km` set; 0.25° native | 1% (101 palette entries, index = percent + 1, 0 no data) | Global plate carrée, the clouds' projection.  A few gaps (2021-02-20/21, 2022-11-09, 2023-02-02/03, 2023-04-22, 2024-07-02) |
| 1978-10-26 to 2021-02-19 | `SSMIS_Sea_Ice_Concentration` (NSIDC's SMMR/SSM/I/SSMIS) | EPSG:3413 and 3031 polar stereographic, 25 km | 0.4%; classes 251 pole hole, 253 coast, 254 land, 255 missing | Every other day until 1987-08-20 |
| 2012-07-02 to 2025-09-01 | `AMSRU2_Sea_Ice_Concentration_12km` | 4326, 3413, 3031 | | Finer, if the near field wants it |
| 2002-06-01 to 2011-10-04 | `AMSRE_Sea_Ice_Concentration_12km` | same | | |

**Checked:** MUR25 on 2026-03-10 and 2026-09-15 decodes to the Arctic's
maximum with the Antarctic minimum, then the reverse (level 0 and level 1
tiles).  The colour maps are `colormaps/v1.3/GHRSST_Sea_Ice_Concentration.xml`
and `SSMIS_Sea_Ice_Concentration.xml`.

**One day at level 1** (3 × 2 tiles of 512, 0.28° a pixel, finer than the
data's 0.25° only at the equator, where there is no ice) is **41 KB**, for
both hemispheres: next to the clouds' 1.2 MB a day it costs nothing.  The day
loads the way a cloud day does (`cloudDay.js`): after the date has stood for
a second, whole or not at all, from MUR25 from 2002-09, SSMIS before it
(reprojected from polar stereographic on decode), and the nearest day
either side of a gap.

**Before 1978-10-26 and in the future**, the atlas's median year (below),
labelled as such in the status, as the clouds fall back to their bundled
texture.

### The atlas, for Earth breathing and any timelapse

At 30 days a second a day's fetch is out, as for the clouds, which hold
their day while the clock steps.  But unlike the clouds, the sea ice has
a seasonal cycle you'd want to see while it runs.  So a bundled
**atlas**: weekly concentration over both polar caps (|lat| ≥ 45°, 1536 ×
320 bytes a frame at 0.28°), built by a tool from the same GIBS layers.  A
frame zlib-compresses to **33 KB** (2026-03-10), so about **1.7 MB a year**
weekly, about 80 MB for the record from 1979 weekly, or 19 MB monthly.  The
months' blending (`monthBlendOfJulianDay`, `stepMonthShares`) carries over
as-is, between weeks instead of months.  That fits the data policy
(bundled, in LFS under `public/large/earth/seaice/`, loaded with
`dataUrl`).

Proposed: weekly for the last ten years, monthly back to 1979, and a
**median year** (2015-2024, by week) for dates outside the record.  The
same weekly history also feeds the thickness model below.

### Sea ice thickness: modelled, until a source is reachable

The thickness products all come from hosts the sandbox refuses:

- PIOMAS, modelled thickness, monthly, 1979 on (`psc.apl.uw.edu`);
- CryoSat-2/SMOS merged, weekly, winter only (AWI, `data.meereisportal.de`);
- OSI SAF's ice type and edge (`osi-saf.eumetsat.int`, `thredds.met.no`);
- NSIDC's ice age, and everything else of NSIDC's (`nsidc.org`,
  `noaadata.apps.nsidc.org`, `n5eil01u.ecs.nsidc.org`; mostly behind an
  Earthdata login).

GIBS has no thickness.  So the first cut models it from the atlas, which
is physically fair and says so:

- **First-year ice** grows by Lebedev's (1938) relation, *h* = 1.33
  *F*^0.58 cm with *F* in freezing degree-days, with *F* = ΔT × days since
  the pixel last froze over (concentration over 15%) and ΔT a fixed 20 K.
  180 days gives 1.5 m, which is the Arctic's measured end-of-winter
  first-year ice.
- **Multiyear ice** is ice that lasted through the previous September's
  minimum (March's for the Antarctic) in the atlas: 2.5-3.5 m, with a
  field of noise.
- Then concentration below 100% thins the mean: leads and open water.

Fitted against PIOMAS's monthly means once that host is allowed; replaced
by PIOMAS's monthly field (12 small maps a year) if the fit is poor.

### The ice sheets and glaciers

The **surfaces** are already there: Cesium World Terrain has the ice
sheets' surface elevations, and the Blue Marble has their colour.  What's missing is **thickness**: for the
cliffs at the ocean, for a view with the ice taken off (the bed under
Greenland and West Antarctica, much of it below sea level), and for the
numbers (7.4 m and 58 m of sea-level rise in the two sheets).

- **ETOPO 2022** (NOAA NCEI, public domain; 15″, 30″ and 60″) comes as an
  *ice surface* and a *bedrock* version, so thickness is their difference,
  and it carries BedMachine's beds for both sheets.  At 60″ (about 2 km)
  Greenland's box is about 1,400 × 1,500 px, and Antarctica is reprojected to
  polar stereographic at 2 km, 2,800² px of int16.  A few MB each in LFS.
  Its hosts, `www.ngdc.noaa.gov` and `www.ncei.noaa.gov`, are refused here.
- **BedMachine** Greenland v5 and Antarctica v3 (NSIDC; 150 m and 500 m)
  are the primary sources ETOPO samples.  Behind an Earthdata login.
- **Mountain glaciers**: the Randolph Glacier Inventory 7.0's outlines
  (NSIDC-0770) and Millan et al. (2022)'s thickness, or Farinotti et al.
  (2019)'s consensus thickness (ETH Zürich's research collection, CC BY
  4.0).  About 275,000 glaciers; under 1% of the ice by volume, but the
  ones people know (the Alps, Alaska, the Himalaya, Patagonia).

## Rendering

### Far: the day's ice on the ocean

A one-byte concentration map, like the clouds' coverage map, read by both
surfaces:

- **celestiary's Earth**: a chunk in the surface material's shader chain
  (`Planet.js`, beside `monthMapShaderMod` and the ocean's roughness).  Over
  the ocean, the colour mixes toward ice by concentration, and the ice
  **turns the glint off**: the ocean roughness map is what makes the sea
  shine at the subsolar point, and ice is a rough diffuse surface.
- **Cesium's Earth**: an imagery layer over the month's stack (`season.js`
  already adds layers by day), from the same map, with alpha by
  concentration.  No patch: `globe.showWaterEffect` is off on our globes
  (`cesiumBody.js` `litSurfaceOnly`), so there is no water mask to fight.
- **Albedo**: bare ice 0.5-0.6, snow-covered ice 0.8-0.85, melt ponds in the
  Arctic's June and July down to 0.2-0.4 (by the atlas's week).  Earth's
  ground albedo for the atmosphere's tables (`textureMeans.json`'s month)
  must count the ice, or the sky's tables are made against a dark ocean.
  On both sides, matched by `yarn parity` at partial phase over the Arctic.
- **The clouds' unmixing** treats sea ice as cloud now (Planet.md: "Snow and
  sea ice that differ from 2004's unmix as cloud").  With the day's ice
  known, the ground it unmixes against can include it, which takes the
  false cloud off the ice pack.  A fix to the clouds that comes free.

### Near: floes as meshes

Below about 30 km over ice, the clouds' hand-off pattern
(`CloudShell.FAR_FIELD_FADE_M`): the far map fades out as a mesh field
comes in.

- **Tiles round the camera**, in a worker: a few km square at the finest
  level, coarser further out.  Floes are cells of a jittered Voronoi
  pattern at several scales (floe sizes follow a power law, metres to
  kilometres), kept where an equalised noise exceeds 1 − *c*, exactly as the
  volumetric clouds threshold theirs, so the drawn share of ice is the
  map's concentration and the hand-off holds.
- **Each floe** is extruded to its freeboard, from the thickness model (a
  ninth of *h*), with a broken edge (the step's profile jittered), rafting
  where floes overlap, and **ridges**: sails along random lines through the
  pack, denser in multiyear ice and near coasts, 1-5 m.  Leads are what the
  threshold leaves.  Snow cover softens the top.
- **Light** by the same ground irradiance as the surface (`groundLight.js`),
  in exposure units, through `sceneReferred()` where it applies (HDR.md).
  Water between floes is the ocean's own, and keeps its glint.
- **Both sides of the swap**: drawn in celestiary's scene against the
  scene's depth, as the volumetric clouds are over Cesium's ground.

### Icebergs: a few, for effect

Instanced meshes from a handful of procedural shapes: tabular (flat tops,
straight cliffs 25-50 m, Antarctic), and blocky and pinnacled (Greenland's
calving bergs, smaller).  Placed by a deterministic hash in cells, at
densities from where icebergs really are: the Southern Ocean's band north
of the shelves, Baffin Bay and the Labrador Sea's Iceberg Alley, East
Greenland's coast.  **Labelled as illustrative**, in the doc and in the
credits' notes, as the clouds' noise is.  Later, the named giants (A23a and
the like) at their real positions from the US National Ice Center's
tracking, which would make them data.

### Ice shelves and tidewater fronts

The fronts are where the ice sheet's surface meets the sea.  From ETOPO's
surface and bed, the ice-ocean edge is traced into a line, and a skirt mesh
drops from the ice's surface height there to the water: the Ross Ice
Front's 15-50 m wall, Jakobshavn's front.  Cesium World Terrain's ice
surface ends at the coast as a slope, at its tiles' resolution; the skirt
is the cliff it doesn't have.

### Without the ice (later)

A view with the bed in place of the ice: on Cesium's side, a terrain
provider from ETOPO's bedrock (Cesium's `CustomHeightmapTerrainProvider`
takes a raster, so no patch is needed), the sea flooding what's below
sea level; on celestiary's side, the sphere has no relief at that scale.  A
data view, not a look, so it belongs in a panel (Earth's section, or an
app), not the default.

## Where it lives

**In celestiary's own scene, not a NetGL guest, and not Cesium.**

- **Not a portal.**  The data is small: 41 KB a day, about 1.7 MB a year
  of atlas, a few MB of ice sheet thickness.  A NetGL guest earns its
  place for a foreign engine with a big renderer (Cesium, New York's
  city).  The near-field ice has to share celestiary's depth, its ground
  light, its exposure and its atmosphere pass, which all stay in this page;
  a guest would need each sent across the wire every frame.  If someone
  later brings a whole ocean-and-ice engine, a guest is the way to host
  it.
- **Not in Cesium.**  The far map has to be on celestiary's sphere too (one
  look across the swap), so it's ours either way, and Cesium takes it as
  an imagery layer we already know how to add.  The meshes draw over
  Cesium's depth as the volumetric clouds do.  This way the ice is on
  Earth whichever globe is drawn, and at every distance.
- **No upstream Cesium patch needed** for any phase here: an imagery layer,
  our own meshes, and `CustomHeightmapTerrainProvider` for the bed.  The
  one upstream candidate is if we ever turn Cesium's water effect on: its
  water mask comes from the terrain and knows nothing of ice, so a hook to
  modulate it by an imagery layer would be a general improvement (frozen
  lakes as much as sea ice).  Not needed while the effect is off.

## Phases

Each a PR, in this order.

1. **The day's sea ice, far.**  GIBS MUR25 and SSMIS by day, decoded and
   reprojected; the map in both surfaces' colour, albedo and glint; a
   *Sea ice* switch in Earth's section and an `s=` letter; the credit;
   `yarn parity` over the Arctic.  Verified: March against September, from
   orbit.
2. **The atlas.**  `tools/seaice/` builds the weekly frames from GIBS into
   LFS; the layer uses it while the clock steps (Earth breathing shows the
   ice breathe) and outside the record.  The ground albedo and the clouds'
   unmixing take the ice.
3. **Thickness.**  The model from the atlas, tested against published
   means (and against PIOMAS if its host is allowed).
4. **Floes, near.**  The mesh tiles, the hand-off, light, both sides.
5. **Icebergs.**
6. **The ice sheets' thickness**, the fronts' cliffs, then glaciers and the
   view without the ice.  Needs ETOPO's host.

## Needs from the maintainer

- **Hosts to allow**, for phases 3 and 6, through the environment's
  network settings: `www.ngdc.noaa.gov` and `www.ncei.noaa.gov` (ETOPO
  2022); `psc.apl.uw.edu` (PIOMAS, to check or replace the thickness
  model).  Optional: `www.usicecenter.gov` (named icebergs).  NSIDC's
  BedMachine and RGI need an Earthdata login, which is avoided while ETOPO
  and Farinotti cover them.
- **Decisions**: the atlas's span (weekly for ten years, monthly to 1979,
  as proposed, or weekly throughout at 80 MB); whether icebergs are on by
  default; whether the ice-free view is wanted.

## Open questions

- MUR25's sea ice is OSI SAF's, regridded; its ice edge against NSIDC's
  Sea Ice Index (the "NSIDC maps" people know) differs by a few percent in
  extent.  Using SSMIS (NSIDC's own) through 2021 and MUR25 after
  would put a step in the record at the switch, so MUR25 from 2002 on,
  throughout.
- The polar caps in the 4326 map are oversampled in longitude (at 80° a
  pixel is 5 km across and 31 km tall).  For the near field's seeding that's
  fine (the noise makes the detail); the far map wants a polar
  projection only if the pole looks smeared.
- Snow on the ice (`AMSRE_Snow_Depth_Over_Ice`, 2002-2011 only) is the
  difference between white and grey ice in spring; the albedo by week is a
  stand-in until there's a source for later years.
