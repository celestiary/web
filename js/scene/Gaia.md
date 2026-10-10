# Gaia's stars, and the point-population engine

[#98](https://github.com/celestiary/web/issues/98), step 2 of
[the galaxy plan](../../ROADMAP.md#the-galaxy-plan): the brightest ~1M
stars of Gaia DR3, tiled and loaded progressively, merged with the bundled
catalogue, drawn by the stars' own shader to the star field's limiting
magnitude.  It is built as the shared **point-population engine**
(ROADMAP, *Shared engines*), which asteroids and comets
([#30](https://github.com/celestiary/web/issues/30)), satellites
([#50](https://github.com/celestiary/web/issues/50)) and the telescope mode
([#155](https://github.com/celestiary/web/issues/155)) will reuse.

**Status.**  The engine, the build pipeline and the physics are in, and
checked with unit tests and with the bundled catalogue run through the
same tile pipeline in the app.  **The tiles themselves are not built
yet**: the ESA Gaia archive (`gea.esac.esa.int`, and its mirrors) is
refused by the sandbox's network proxy.  Until they are, the app finds no
manifest at `large/gaia/v1/index.json`, draws nothing more and asks for
nothing more.  Once the archive is reachable, one command builds them:

    yarn gaia all          # counts, fetch (48 chunks, cached), tile → public/large/gaia/v1/

then `git lfs install` (once) and commit `public/large/gaia/v1/`
([Rebuilding](#rebuilding)).

| Piece | Where |
|---|---|
| HEALPix (NESTED): pixels, centres, cones | `points/healpix.js` |
| The tile format: columns, 30 bytes a star | `points/tileFormat.js` (`float16.js` for velocities) |
| The tiling: HEALPix cells by magnitude | `points/tileTree.js` |
| Which tiles to draw and fetch, to the limit and the budget | `points/selection.js` |
| The engine: loading, drawing, eviction | `points/PointPopulation.js` |
| A tile of stars to the star shader's attributes | `points/starTile.js` |
| The star points' material, shared with the catalogue | `starsMaterial.js`, `shaders/stars.vert` (`POINT_MOTION`) |
| Gaia's population in the scene, `?gaia=0`, `?pointBudget=` | `gaia/gaiaPopulation.js` (made in `Scene.objectFactory`) |
| The archive queries, the cut, the CSV | `gaia/adql.js` |
| Frame and epoch: ICRS J2016.0 to the catalogue frame, J2000.0 | `gaia/astrometry.js` |
| G to V, BP−RP to Teff | `gaia/photometry.js` |
| One Gaia row to a point record; distances | `gaia/records.js` |
| The merge with stars.dat | `gaia/dedup.js` |
| The build, rows to tiles, with its report | `gaia/build.js`; `tools/gaia/gaia.mjs` (CLI), `tools/gaia/tap.mjs` (TAP client) |
| The check in the app | `tools/gaia/skyCheck.mjs` |

## The source and its licence

**Gaia DR3** (Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1; the
mission: Gaia Collaboration, Prusti et al. 2016, A&A 595, A1), from the
ESA Gaia archive's TAP service, `https://gea.esac.esa.int/tap-server/tap`:
`gaiadr3.gaia_source`, its Hipparcos-2 cross-match
`gaiadr3.hipparcos2_best_neighbour`, and Bailer-Jones et al. 2021's
distances (AJ 161, 147), `external.gaiaedr3_distance` (EDR3's astrometry
is DR3's, under the same source_id).

**Licence: CC BY-SA 3.0 IGO**, credit ESA/Gaia/DPAC.  The tiles are a
derived work (carried to J2000, converted to V and to the scene's frame,
merged), so they are shared under the same licence, which the build writes
beside them (`public/large/gaia/v1/LICENSE.txt`) with ESA's requested
acknowledgement:

> This work has made use of data from the European Space Agency (ESA)
> mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia
> Data Processing and Analysis Consortium (DPAC,
> https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the
> DPAC has been provided by national institutions, in particular the
> institutions participating in the Gaia Multilateral Agreement.

The acknowledgement is ESA's standard text as recalled: the archive's
credits page isn't reachable from the sandbox, so check it there when the
data is built, and add Gaia to the app's credits when its stars first
show.  The ShareAlike term applies to the data, not to the code (ISC).

## The query

Two steps, both ADQL on the archive (`gaia/adql.js`):

1. **The cut, from the archive's counts.**  `countsQuery` counts
   `gaia_source` in 0.05 mag bins of G brighter than 13; `chooseCut` takes
   the upper edge of the first bin where the running count reaches the
   target (1,000,000; `--target N`).  The roadmap expects G ≈ 11.  The
   counts are cached (`tools/gaia/.cache/counts.json`) and written into the
   manifest, so the cut is recorded with the data it chose.  `yarn gaia
   counts` prints the table and the cut without fetching anything else.
2. **The stars**, in 48 chunks of source_id (Gaia's own order-1 HEALPix
   cells: a source_id over 2^35 is its order-12 cell, so a cell is a
   source_id range), each an asynchronous job, cached as it completes, so a
   failed chunk is the only one fetched again and no job comes near the
   archive's anonymous 3M-row limit:

```sql
SELECT g.source_id, g.ra, g.dec, g.ref_epoch,
       g.parallax, g.parallax_error,
       g.pmra, g.pmra_error, g.pmdec, g.pmdec_error,
       g.radial_velocity, g.radial_velocity_error,
       g.phot_g_mean_mag, g.bp_rp, g.astrometric_params_solved,
       h.original_ext_source_id AS hip, h.angular_distance AS hip_sep,
       d.r_med_geo, d.r_med_photogeo
FROM gaiadr3.gaia_source AS g
LEFT OUTER JOIN gaiadr3.hipparcos2_best_neighbour AS h ON h.source_id = g.source_id
LEFT OUTER JOIN external.gaiaedr3_distance AS d ON d.source_id = g.source_id
WHERE g.phot_g_mean_mag < :cut
AND g.source_id >= :lo AND g.source_id < :hi
```

No quality cuts: to G ≈ 11 Gaia's sources are real stars, and a cut on
the astrometry would drop exactly the bright stars with poorer solutions.

**Distances** (`records.js` `chooseDistance`), by preference: Bailer-Jones's
photogeometric median, which adds the star's colour and magnitude to its
parallax and is the more precise where the parallax is poor; their
geometric median; 1/ϖ where neither is given and ϖ/σ ≥ 5; else 1 kpc,
flagged `assumed`.  The choice only moves a star along its line of sight:
its absolute magnitude is taken from the same distance, so from the solar
system its brightness is Gaia's whatever the distance.  It matters when the
camera travels to another star.  The build reports how many stars took each
source.

## Frame and epoch

**Frame.**  ICRS is the J2000 mean equator and equinox to the frame bias
(17-23 mas), left out, as it was for the bundled catalogue.  The catalogue
frame is the mean ecliptic of J2000 with the scene's axes (X the equinox,
Y the north ecliptic pole, Z minus ecliptic Y; DESIGN.md
[frames and time](../../DESIGN.md#frames-and-time)), reached by turning
through the J2000 obliquity, 84381.448″ (`celestialFrame.js`
`J2000_OBLIQUITY_DEG`, Celestia's 23.4392911°).  `galacticFrame.js` has
its own 23.4392811°, 0.036″ off, which doesn't matter for the galaxy's
orientation and is left alone.

**The bundled catalogue is at Hipparcos's epoch, J1991.25, not J2000.**
stars.dat is Hipparcos-2's ICRS positions at their own epoch, turned into
the ecliptic: Sirius carried from its J2000.0 place (van Leeuwen 2007)
back to J1991.25 by its proper motion lands 0.003″ from its stars.dat
position, and 0.33″ off a quarter of a year either side; left at J2000 it
is 11.7″ off.  Barnard's Star, from Gaia DR3's astrometry, lands 0.25″
from it at J1991.25 (two catalogues' difference) and 91″ off at J2000
(`astrometry.test.js`).  Its distances are Celestia's light-years
(3.26167 a parsec) of the Hipparcos-2 parallaxes.

**Gaia's epoch to J2000.0, and on to the date.**  Gaia's positions are at
J2016.0.  Each star is carried by uniform space motion
(`astrometry.js`; ESA 1997, *The Hipparcos Catalogue* vol. 1 §1.2.8;
Butkevich & Lindegren 2014, A&A 570, A62): its position r = d·u and
velocity v = d·(μα*·p + μδ·q) + vr·u, with r(t) = r + v·Δt, so the proper
motion, the radial velocity where Gaia measured one (most of these stars:
DR3 has 34 million, to G_RVS 14) and the perspective acceleration they
make together are all in; the light-time factor (vr·Δt/c, under 10^-6) is
not.  A star with no radial velocity has none, which over 16 years misses
at most a few mas of perspective acceleration.  The tiles hold each star's
position at **J2000.0** and its velocity (km/s, catalogue axes), and the
renderer moves it to the simulation date in the vertex shader
(`stars.vert`, `POINT_MOTION`: `eyePos += velocity × years × 3.15576e10 m`),
so Gaia's stars are where they are on the date shown, across the supported
±6,000 years (Barnard's Star moves 17° in that time; its straight line is
exact to the model the positions were carried by).

The bundled catalogue has no velocities and stays at J1991.25 at every
date; its stars and Gaia's agree at 1991.25, within each one's proper
motion times the years from it (typically under an arcsecond today; tens
of arcseconds for the fastest stars).  Giving the catalogue Gaia's motions
through the cross-match is a follow-up; see [follow-ups](#follow-ups).

## Photometry

The star field is calibrated in V (`exposure.js` `LIMITING_MAGNITUDE`;
[HDR.md, physical stars](HDR.md#physical-stars)) and coloured by Teff
through the blackbody table ([Stars.md, colour](Stars.md#colour)).

**V from G and BP−RP**: Riello et al. 2021 (A&A 649, A3), Table C.2, the
EDR3 relation to Johnson V, G − V = −0.02704 + 0.01424x − 0.2156x² +
0.01426x³ with x = G_BP − G_RP, σ = 0.03 mag, over −0.5 < x < 5.0 (x held
to that range outside it).  DR3's photometry is EDR3's.  A star with no
BP−RP takes the Sun's, 0.82 (Casagrande & VandenBerg 2018).  The build
checks it on the stars both catalogues have: the median and MAD of Gaia's
V against the catalogue's (`report.vMinusCatalogue` in the manifest).

**Teff from BP−RP, on the catalogue's own scale.**  The catalogue's
colours come from Teff by spectral class (de Jager & Nieuwenhuijzen 1987,
Levesque et al. 2005; [Stars.md](Stars.md#temperature-from-class)).  A
second, published colour-temperature relation would put a Gaia star and a
catalogue star of the same colour at different temperatures.  So the build
calibrates one from the stars in both: every catalogue star Gaia
cross-matches (about 100,000, from O to M), binned by Gaia's BP−RP (0.05
mag, merged until a bin has 25), each bin's median log Teff, held
non-increasing in colour (pool adjacent violators;
`calibrateColourTemperature`).  A Gaia star's Teff is read off that table,
interpolated in log T and held at its ends.  The table goes in the
manifest.  The colour is the observed one, reddening included, as the
magnitude is the observed one, extinction included: the sky as seen from
here, as the catalogue's magnitudes are.  A Gaia star with no BP−RP is
drawn at the Sun's temperature.

**Light**: a star's lumens from its absolute V through the Sun's, as
`StarsCatalog.read` does, and its radius by Stefan-Boltzmann
(`starParams.js`), which only matters within a few AU of it, where the
point fades into a disc (`starTile.js`).  So a Gaia star goes through the
same exposure-unit photometry as a catalogue star: the limiting magnitude,
`sm=`, a telescope's field patch, the bloom and glare cap
([HDR.md](HDR.md#physical-stars)).

## The merge

The catalogue keeps every star it has, with its names, labels, asterisms
and picking; a Gaia star that is one of them is left out of the tiles
(`dedup.js`):

1. **By Hipparcos number**: Gaia's best neighbour is a HIP the catalogue
   has.
2. **By position and magnitude**: a catalogue star within 2″ of it at
   J1991.25 (the Gaia star carried back by its own motion), and the Gaia
   star not more than 0.75 mag brighter than it.  This takes the stars the
   cross-match missed (it has none for some bright stars and close pairs)
   and a close pair's second star, whose light the catalogue's single entry
   already holds.  The catalogue's 106,747 circles of 2″ cover 2.5 × 10^-6
   of the sky, so a few chance matches in a million.

The build reports both counts, and the position matches by separation, in
the manifest (`report.dropped`, `report.positionMatchesWithin`).  Gaia has
no source for the brightest stars (G ≲ 3), which are all in the catalogue.

## Tiling

**HEALPix cells by magnitude**, as a hierarchical progressive catalogue
(the HiPS catalogue scheme; Fernique et al. 2015, A&A 578, A114;
`tileTree.js`).  The 12 order-0 cells each hold the brightest 4,096 stars
in them (`TILE_CAP`); the rest go to the cell's four children at order 1,
each of which holds its brightest 4,096, and so on, until a cell has 4,096
or fewer left, or order 9 (7′ cells) takes all that remain.  The cells are
cut in ecliptic coordinates, the catalogue frame's own.

- **The brightest load first, whatever the view**: a tile's stars are all
  fainter than its parent's, and the 12 roots are the brightest 49,152 of
  the sky (about 1.5 MB).
- **Tiles are about the same size** where the sky is dense and where it is
  sparse: the tree goes deeper along the plane.
- **A narrow field needs only the tiles over it**, down to the order whose
  stars reach the limit there.

**Why not an octree by magnitude** (as Gaia Sky's LOD): an octree's nodes
bound stars in space, so any camera position gets a correct brightness
bound, at the cost of a deeper tree, more tiles over any one direction, and
no simple "brightest of the sky first".  This app's views of Gaia's stars
are nearly all from the solar system, where apparent magnitude from the Sun
is the order to load in, exactly.  The HEALPix tree keeps that, and gets the
octree's one advantage with two numbers per tile: the nearest star in it
and in its subtree.  From a camera D light-years from the Sun a star d out
is at least d − D away, so at most 5·log10(d / (d − D)) brighter, and its
direction within asin(D / d) of the Sun's view of it.  `selection.js`
widens each tile's magnitude and cone by those, so the selection is right
from anywhere (and from inside a tile's reach, every star of it is wanted
in every direction); from the solar system both are nothing.
`selection.test.js` checks it against brute force from 40 light-years out.

**The tile format** (`tileFormat.js`): columns, little-endian, sorted by
magnitude from the Sun: positions (float32 light-years, catalogue frame,
J2000.0), source_ids (two uint32), velocities (float16 km/s: 0.05%),
absolute V (int16, 1/1024 mag), Teff (uint16 K); 30 bytes a star, so a
million is about 30 MB, in the data policy's bundled range.  The manifest
(`index.json`) has a row per tile: order, pixel, count, brightest and
faintest magnitude from the Sun, nearest star and nearest in its subtree
(rounded outward), and whether it has children; plus the population's
provenance: the query, the archive's counts, the cut, the colour table,
the build's report and the magnitude histogram.  `public/large/gaia/v1/`,
in Git LFS, loaded through `dataUrl()`.

## The engine

`PointPopulation` is one population: a `Group` under `Stars` (so in the
StellarFrame, the catalogue's frame), whose children are one `Points` per
loaded tile sharing one material.  A population brings its tiles and
manifest under a base URL, a `decode(buf)` that turns a tile into its
points' attributes and sorted magnitudes, a material that takes the RTE
camera uniforms, and its epoch; nothing in the engine is about stars.
For asteroids or satellites, `decode` gives orbital elements as
attributes and the material propagates them (a Kepler step in the vertex
shader, as `POINT_MOTION` is a linear one); the manifest's magnitudes
become H, and the bounds the brightest a body can be at its nearest.

**Every frame** (`preAnimCb`, from the animation callback):

1. The view in the population's frame: the camera's position (light-years
   from the Sun) and axis, the field's half diagonal, the limit,
   `ThreeUi.limitingMagnitude()` + `DEFAULT_MARGIN_MAG` (1 mag: a star a
   magnitude under the limit has 40% of a just-visible star's light,
   which still lifts its pixel off black through the tone map's toe).
2. `selectTiles` walks the tree brightest first (a heap keyed on each
   tile's brightest magnitude from the camera): a tile is drawn if it can
   be in the field and its brightest star can pass the limit; its children
   are visited if its subtree's can; and it stops at the **budget**,
   `DEFAULT_BUDGET` = 500,000 points (`?pointBudget=N`).
3. Each loaded tile drawn gets a draw range, its stars to the cut (a
   binary search of its sorted magnitudes), within the budget's share: the
   magnitude cut is exact, per tile, at no cost in the shader.  The rest
   are hidden.
4. Wanted tiles not loaded are fetched, brightest first, four at a time.
5. Past `DEFAULT_MEMORY_POINTS` (1,000,000) loaded, the tiles wanted
   longest ago are dropped.

**One shader for every star**: `starsMaterial.js` makes the catalogue's
material and the populations', from the same `stars.vert` and
`stars.frag`, so a Gaia star's light, size, bloom and colour follow the
catalogue's law exactly; `POINT_MOTION` adds the velocity attribute and
`uMotionYears`.  The tiles carry the attributes `StarsBufferGeometry`
gives the catalogue (position and its float64 residual for RTE, colour,
radius, lumens), decoded on load (`starTile.js`).

## Checks

**Unit tests** (bun, no data): HEALPix against its definition (every
pixel's centre found again to order 6, children, equal areas, cones);
float16; the tile format's round trip; the tiling's invariants (every
star in one tile, caps, children fainter than parents, each star in its
cell and cone); the selection against brute force, from the Sun and from
40 light-years, at every field, and the budget; the engine with a
synthetic population (progressive loading, the cut, the budget, eviction,
the motion's years); the epoch against stars.dat (above); the
propagation, the photometric conversions, the colour calibration, the
distance choice, the queries and the CSV, the merge by number and by
position across cell boundaries; the build end to end on hand-written
rows.  The synthetic population (`points/syntheticPoints.js`) and every
fixture row are made up and labelled so; none is Gaia's.

**In the app** (`tools/gaia/skyCheck.mjs`, headless Chromium on
SwiftShader): the bundled catalogue run through the same tile pipeline
(`yarn gaia catalogue --out DIR`: a **test population**, not Gaia data,
never committed), served in place of `large/gaia/v1/`, from deep space
4.7 AU over the Sun's north, 480×300, labels, orbits and the galaxy off.

RESULTS_PLACEHOLDER

## Rebuilding

With `gea.esac.esa.int` reachable:

    yarn gaia all                 # = counts, fetch, tile
    git lfs install               # once per clone
    git add public/large/gaia/v1  # LFS (.gitattributes: public/large/**)
    git lfs ls-files | head       # check they went in as LFS objects

`yarn gaia counts` alone prints the archive's counts and the cut;
`--target N` asks for another size, `--cut G` skips the counts.  The fetch
caches each chunk in `tools/gaia/.cache/` (git-ignored), so a second run
fetches only what failed.  `tile` reads the cache and stars.dat and
rewrites `public/large/gaia/v1/` whole, with `LICENSE.txt`; its report
(rows, kept, dropped by number and by position, distance sources, stars
with no colour, V against the catalogue) prints and goes in the manifest.
Then:

- check the sky: `yarn build`, then `node tools/gaia/skyCheck.mjs --out
  DIR` (it serves `docs/`, real tiles and all), and compare the manifest's
  histogram with the archive's counts (`counts.json`) less the catalogue's
  stars;
- the PR that adds the tiles gets a full preview copy (they are under
  `public/large/`; DESIGN.md [data policy](../../DESIGN.md#data-policy)).

## Follow-ups

- **The data run**, once the archive is reachable: the tiles, the cut and
  counts, the colour table and the merge's numbers in this doc, the real
  sky checked (counts per magnitude bin against the archive's).
- **The galaxy's hole round the Sun** (MilkyWay.md,
  [double counting](MilkyWay.md#double-counting)): Gaia's stars resolve
  more of the model's light, farther out; `RESOLVED` is refitted from the
  catalogue's and Gaia's stars together, by the same measurement.
- **Motion for the bundled catalogue**: Gaia's proper motions and radial
  velocities for the ~100,000 stars both have (a side file from the same
  build), so the constellations move with the date and agree with Gaia's
  stars at every epoch.
- Picking, labels and search for Gaia's stars (`Gaia DR3 <source_id>`);
  `goTo` a Gaia star (its disc from `starParams`, as a catalogue star's).
- Intrinsic colours (GSP-Phot's `teff_gspphot` and A_G) for views from far
  off, where the reddening seen from here is wrong.
- Deeper cuts (tens of millions) over the network, on the same tiling
  (the data policy's network case).
- Decoding tiles in a worker, if a laptop shows the decode's few ms.
