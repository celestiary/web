# Sky imagery: HiPS surveys on the sky

A layer that draws a sky survey's images on the celestial sphere, where
their stars are: [#360](https://github.com/celestiary/web/issues/360),
under the epic [#321](https://github.com/celestiary/web/issues/321).  The
surveys are IVOA **HiPS** (Hierarchical Progressive Surveys, HiPS 1.0,
2017): the sky cut into HEALPix cells, NESTED, each cell a square tile
image at each order.  A survey is a manifest, so Rubin's First Look is the
first and Hubble's and JWST's are a manifest each.

| File | What it does |
|---|---|
| `hips.js` | Pure: tile paths, the order for a view, the cells in view, a cell's grid on the sphere and its tile's orientation, frames, coverage (MOC) |
| `HipsLayer.js` | The layer: a `Group` under `Scene.stellarFrame`, its tiles chosen and loaded from `preAnimCb` |
| `tileMaterial.js` | The tile's material, shared with Rubin's discovery image (`rubin/RubinImage.js`) |
| `surveys.js`, `surveys/*.json` | The manifests, and `surveyCovers` (does a field hold any of a survey) |
| `footprint.js` | An image's rectangle on the sky from its AVM, to its HEALPix cells (Rubin's coverage) |
| `../../../tools/hips/coverage.mjs` | Writes a manifest's coverage, from its footprints or the survey's `Moc.fits` |

All of it is lazily loaded with the Rubin feature (`rubin/install.js`
imports it); nothing is in the first load.

## HiPS in brief

A survey's directory holds a `properties` record and the tiles,
`Norder{k}/Dir{D}/Npix{n}.{ext}`, where `n` is the NESTED cell at order
`k` (12 × 4^k cells) and `D` is `n` rounded down to 10,000s.  A tile is
`hips_tile_width` pixels a side (512 for every survey here), so order
`k`'s tile pixel is 58.63° / (2^k × 512).  `hips_order` is the deepest
order, `hips_order_min` the coarsest (3 if the record doesn't say),
`hips_frame` the sky frame of the cells (`equatorial`, ICRS, or
`galactic`), `hips_tile_format` the image formats.  The survey's coverage
is a MOC (Multi-Order Coverage map, IVOA MOC 1.1): the cells, at several
orders, that hold data.

## The layer

Each frame (`preAnimCb`), while the layer is visible:

- **The order** is the coarsest whose tile pixel is no bigger than a
  screen pixel (`selectOrder`: the camera's vertical field over the
  canvas's device pixels), clamped to the survey's orders and to
  healpix.js's deepest (13, 0.05″ a texel).
- **The cells in view** (`cellsInDisc`) are a descent from the 12 base
  cells, each kept while its bounding cone (healpix.js `pixelCone`) meets
  the view's disc (the half diagonal) and the coverage meets it.  It's
  conservative: every cell that meets the disc is in, and a few that
  nearly do (checked against brute force at order 4).  The cells are kept
  while the view moves less than a twentieth of its radius.
- **Coarse under fine:** the cells three orders up (or the survey's
  coarsest) are drawn under the detail while it loads, each tile's render
  order its order, so finer tiles cover coarser ones.
- **Loading:** at most 6 tiles at a time, nearest the centre first,
  through a loader handed in (three's `TextureLoader` with CORS by
  default), at most 128 kept, the least recently used dropped first.  A
  tile that fails from the survey's first service is asked of its mirror
  once (and the mirror is asked first from then on, if it answered); one
  that fails from every service is marked missing and never asked again
  (4,096 remembered).
- **Format:** webp if the survey offers it, then png, then jpeg.  Until
  a tile has loaded in the preferred format, a tile that fails in it on
  every service moves the survey to the next listed format, once, and is
  asked again in it (a record can list a format the host doesn't serve:
  Rubin's First Look lists png and webp, and its tiles can't be tried from
  here).  Once a tile has loaded, the format is kept.

Each tile is an 8 × 8 grid on the unit sphere in the survey's frame,
turned to the scene's J2000 frame (`frameMatrix`: wcs.js's
`equatorialToScene` for `equatorial`, the IAU's galactic rotation then
that for `galactic`).  It is drawn as Rubin's image is (Rubin.md, "The
imagery"): at the camera by the model-view's turn alone
(`mat3(modelViewMatrix)`, so no shake from the camera's large position),
its depth at the far plane as the stars' is, after the bodies and the
stars, its texels display-referred sRGB through `sceneReferred`, and its
alpha honoured (a HiPS PNG's blank sky is transparent).

### The tile's orientation

A HEALPix cell is not a flat quad, and a tile image has a defined layout
in its cell, the classic place to get a mirror or a turn wrong.  The
layout (Aladin's; HiPS 1.0 §4.2): the image's **top-left** pixel is the
cell's **south** corner, (x, y) = (0, 0) in healpix.js's face
coordinates; its top-right the **west** corner (0, 1), its bottom-left the
**east** corner (1, 0), its bottom-right the **north** corner (1, 1).  So
the image's column runs along the face's y and its row along x
(`tileUvToLoc`).  As a plain image, a tile looks mirrored against the sky;
on the inside of the sphere it reads right.

Settled on real tiles: ESASky's JWST NIRCam HiPS over the Pillars of
Creation (M16), tile `Norder10/Npix7542617`.  Three Gaia DR3 stars' centroids
in the tile's 512 px lie 0.06 to 0.27 px (0.02″ to 0.11″, a pixel being
0.40″) from where this layout puts their catalogue places; the other seven
ways to lay the image on the cell put at most one of them on a star
(`hips.test.js` keeps the three as a fixture).

## Surveys

A manifest (`surveys/<name>.json`) is:

```json
{"id": "CDS/P/Rubin/FirstLook", "title": "Rubin's First Look",
 "serviceUrls": ["<primary>", "<mirror>"], "minOrder": 0, "maxOrder": 12,
 "tileWidth": 512, "formats": ["png", "webp"], "frame": "equatorial",
 "skyFraction": 7.068e-4, "credit": "...", "licence": "...", "source": "<URL>",
 "record": "<the properties record's URL>", "coverage": {"8": [...]}}
```

**To add a survey:** read its `properties` (or the MocServer's record,
below), write the manifest from it (`hips_service_url` and its mirrors,
`hips_order_min` (3 if absent), `hips_order`, `hips_tile_width`,
`hips_tile_format`, `hips_frame`, `moc_sky_fraction`, `obs_copyright` and
`hips_copyright` for the credit, `hips_license`), add its coverage with
`bun tools/hips/coverage.mjs fits <manifest> <service>/Moc.fits --order 8`,
and list it in `surveys.js`.  The manifest test checks every manifest's
fields and that its coverage is near its sky fraction.

| Survey | Service | Orders | Format | Coverage | Used by |
|---|---|---|---|---|---|
| Rubin's First Look, the Virgo Cluster, `rubinobs/SVImages_v2/color_ugri` | Rubin's own (`images.rubinobservatory.org/hips/`) | 3 to 11 (0.2″) | webp | 5.79e-4 of the sky (24 deg²) | the Rubin app's "Rubin's image"; `?sky=rubin-virgo` |
| Rubin's First Look, `CDS/P/Rubin/FirstLook` | CDS (`alasky`, mirror `alaskybis`) | 0 to 12 (0.1″) | png, webp | 7.07e-4 of the sky (29 deg²) | the Rubin app's "Rubin's image", for the Trifid and Lagoon only |
| JWST NIRCam imaging, `ESAVO/P/JWST/NIRCam_Imaging` | ESA's ESASky (`skies.esac.esa.int`) | 0 to 15 (drawn to 13) | png (with alpha) | 3.4e-5 | the real-tile check; no control yet |

**Rubin's First Look, the Virgo Cluster** is Rubin's own HiPS, the one
its [SkyViewer](https://skyviewer.app/) draws (found in that page's
source): LSSTCam's coadd of the Virgo field in u, g, r and i ("LSSTCam:
Virgo", built by `lsst.pipe.tasks.hips.GenerateHipsTask`, 8 June 2025),
24 deg² about RA 188.2°, Dec +7.1°, wider than the press image, orders 3
to 11, webp only, served with `access-control-allow-origin: *`.  Its
coverage is its own `Moc.fits` (455 cells at order 8, its
`moc_sky_fraction` to four figures).  Its `properties` call it
`hips_status = private`: served openly, not listed in the registries.  It
is the survey that draws in the Rubin app today.  The same host has two
more of the viewer's, not used: `hips/asteroids/color_ugri` (the same
field) and `hips/oceancosmosm18/color_gri` (35 deg² about RA 221.7°, Dec
−40.5°).

**Rubin's First Look** from CDS is its HiPS of two of the images of Rubin's
First Look of 23 June 2025, NOIRLab's
[noirlab2521a](https://noirlab.edu/public/images/noirlab2521a/) (the
southern Virgo Cluster, 5.4° × 2.9°) and
[noirlab2521b](https://noirlab.edu/public/images/noirlab2521b/) (the
Trifid and Lagoon nebulae, 4.7° × 2.9°).  The HiPS is ODbL-1.0
(CNRS/Unistra); the images are RubinObs/NOIRLab/SLAC/NSF/DOE/AURA under
[Rubin's use policy](https://rubinobservatory.org/media/design-resources/use-policy).
The credits footer carries both, timed, while its tiles are drawn.  **In
the Rubin app it draws the Trifid and Lagoon only** (`FIRST_LOOK_REST`,
rubin/install.js: its coverage less the Virgo footprint): Rubin's own
tiles draw Virgo, and two layers over one field draw turn about, their
tiles sorted by when they loaded.  **CDS answered a visitor's browser
with 404 too** (the maintainer's, on the preview, 2026-11-20:
`Norder0/Dir0/Npix7.webp`), as it answers the sandbox, so the Trifid and
Lagoon aren't drawn until CDS serves its tiles again; nothing else of
Rubin's public imagery holds that field.

**JWST NIRCam** is ESASky's HiPS of the eJWST archive's NIRCam images,
single band, transparent where there is no data.  It's in the manifests
as the proof that the layer is general and as the survey its check runs
on.  No control switches it on yet; a link does: **`?sky=<key>`** in the
page's query string (`Scene.showSky`, `sky/install.js` `showSurvey`: the
layer under the stellar frame, loaded lazily, its credit in the footer
while its tiles are drawn), the key a manifest's `key` (`jwst-nircam`,
`rubin-first-look`).  The Pillars of Creation in M16, from the Rubin
site's night sky at a 0.12° field:

```
https://celestiary.org/?sky=jwst-nircam#sun/ed138@-30.2446,-70.7494,2.684km;from=sun/earth;t=9630.783523jd;cq=0.014,0.9593,0.1209,-0.2547;fov=0.12deg;s=LF;time:pause
```

**Next surveys:** Hubble and JWST in colour.  CDS's registry lists 68
image HiPS for them, 12 in colour, among them `CDS/P/HST/EPO` and
`CDS/P/HST/color` (Hubble's outreach images and colour mosaics) and
`CDS/P/JWST/EPO` and `CDS/P/JWST/First-Images` on CDS, and 11 on
ESASky (`ESAVO/P/HST/ACS-blue`, `WFC3`, `WFPC2` and the rest, jpeg, and
JWST's NIRCam, NIRISS and MIRI).  A control to pick one, and a stand-in
survey labelled as not Rubin's for the fields Rubin has nothing public
on (DSS2 colour is all-sky), are the maintainer's to decide (#360).

### Coverage

The coverage is committed in the manifest as a MOC at order 8 (0.23°
cells), merged into coarser cells where all four children are in.  The
layer asks for no tile outside it, at any order: a cell is in if it holds
a coverage cell or a coverage cell holds it (`newCoverage`).

- JWST NIRCam's is from its own `Moc.fits` (576 cells at order 8; the
  survey's own MOC is order 15).
- **Rubin's First Look's is from the two images' footprints**, since
  CDS's MocServer answered every MOC request with a 413 from here
  (2026-11-20; its records answered) and its `Moc.fits` is on the tile
  host, which doesn't answer here.  Each footprint is the press image's
  AVM, from its NOIRLab page: the centre, the field of view, and the
  position angle of its up (minus the page's `spatial_rotation`: "North is
  49° left of vertical" is up at PA −49°), taken as a rectangle on its
  tangent plane, padded by 0.05° (`footprint.js`,
  `tools/hips/coverage.mjs footprints`).  697 cells at order 8, 8.9e-4 of
  the sky against the survey's 7.07e-4: a little over, so a tile at an
  edge may be asked for and 404 (marked missing).  The rectangle's turn
  was checked on noirlab2521b's screen-size image: the Trifid's centre
  measured at 1.075° right and 0.518° up of the image's centre, the
  footprint's frame puts it at 1.084° and 0.515°.  When the MocServer
  answers, replace it with the survey's own:
  `curl "https://alasky.cds.unistra.fr/MocServer/query?ID=CDS/P/Rubin/FirstLook&get=moc&order=8&fmt=json"`.

## In the Rubin app

"Rubin's image" (`apps.rubin:image=1`) turns on the discovery composite
and Rubin's First Look together (`install.js` `newImageSwitch`).  The
survey cadence's readout adds a line when the current visit's field holds
Rubin imagery (`imageryLine`, asked once a field a night): "Rubin's image
covers this field: First Look, the Trifid and Lagoon nebulae" (or the
southern Virgo Cluster), from the coverage, or "...: the discovery image"
once the composite's manifest is in, from its footprint.  The model's
nights visit the First Look fields: the Trifid and Lagoon on 9 April 2026
(visit 734 at RA 271.6°, Dec −24°) and in late June and July, the Virgo
field in April and May.

## Hosts, and what the sandbox reaches

- **CDS** (`alasky.cds.unistra.fr`): from the sandbox its static HiPS
  paths (properties, tiles, `Moc.fits`, DSS's too) answer a "Page
  unavailable" 404, with `Access-Control-Allow-Origin: *`; the mirror
  `alaskybis.cds.unistra.fr` resets the connection.  Its MocServer
  answers records, but every MOC with a 413 (2026-11-20).  A visitor's
  browser asks CDS itself, so Rubin's First Look is checked on the
  preview, not here.
- **Rubin's own** (`images.rubinobservatory.org`, and `skyviewer.app`
  for the viewer's page): reachable, with `access-control-allow-origin:
  *` on `properties`, `Moc.fits` and the tiles.
- **ESA's ESASky** (`skies.esac.esa.int`): reachable, with
  `access-control-allow-origin: *`.  A page in headless Chromium reaches it
  through the proxy with its CA pinned (AGENTS.md).

## Checked

- `hips.test.js`, `HipsLayer.test.js`, and the Rubin tests (`RubinImage`'s
  switch and First Look credit, the readout's line in `SurveyCadence`).
- Headless Chromium on SwiftShader, 640 × 400, 2026-11-20: JWST NIRCam at
  M16 (RA 274.705°, Dec −13.855°), a 0.12° field (1.08″ a pixel) through
  `HipsLayer` from ESASky: order 9 and its fallback order 6, 5 tiles asked,
  5 answered, none missing, no console errors.  Gaia DR3's stars to G 13
  projected through the camera on the CPU against their centroids in the
  frame: 6 found, 4 within 0.06″ to 0.23″ (0.06 to 0.22 px), two faint
  ones at 2.6″ and 4.6″ (blends at 1″ a pixel); the scene's own two
  catalogue stars in the frame, drawn without the layer, lie 0.8″ from the
  same Gaia places, so the image and the scene's stars agree to about a
  pixel.
- `?sky=jwst-nircam` with the link above, in a fresh headless page with
  ESASky reached through the proxy: the layer on from the link, order 9,
  its tiles ready and drawn, none missing, no console errors, the Pillars
  in the frame (the maintainer's ask on the preview: how to see them).
- **Black as no data** (the maintainer's look at the preview: zoomed
  out, a dark surround to the Virgo image hid the stars round it).  A
  HiPS tile covers its whole cell, and Rubin's webp tiles have no alpha:
  exactly 0 where the survey has nothing (95% of the order-3 tile, 6% to
  19% of the order-5 ones), and the layer draws over the star points.  So
  a HiPS tile's black is keyed out (`tileMaterial.js` `keyBlack`: no
  alpha at 0, full from 2/255; the darkest real sky in those tiles is a
  few counts over that); the discovery image, whole to its edges, isn't
  keyed.  The same 23° view rendered with the layer off, with the key and
  without it, 800 × 500: without the key 896 pixels are darker than with
  no layer (stars hidden), with it 22 (the scene's stars under the image
  itself); the image's own pixels are the same either way.
- **Rubin's own Virgo tiles in the Rubin app**, headless as above
  (800 × 500, the tile host through the proxy), "Rubin's image" on, the
  clock paused on 15 May 2026 02:00 UTC with Virgo near the meridian: at a
  3.5° field aimed at M49 (RA 187.4449°, Dec +8.0004°) order 5, 16 tiles
  ready; at 0.2° order 9, 36 tiles ready, every request a 200, none
  missing, no console errors, the credit in the footer.  The frame is the
  galaxy in colour, its core's centroid 2.1 px each way from the frame's
  centre (4″ at 1.44″ a pixel, a saturated core 30 px across against the
  catalogue's place), so the layer puts Rubin's tiles where the sky is.
  The same link in a fresh page restores the switch and draws.  CDS's
  layer beside it asked its two coarse tiles at the Trifid's cell, got
  404s, and asked no more.
- Rubin's First Look with CDS answered by a test pattern (the tile host
  refuses the sandbox): from a link aimed at the Trifid and Lagoon (RA
  271.0°, Dec −23.9°, a 6° field, `apps.rubin:image=1`) the layer asks
  `Norder0/Dir0/Npix7.webp`, `Norder1/Dir0/Npix28.webp` and five tiles of
  order 4 (`Npix1804` to `1807`, `1816`), and draws them over the field,
  with the credit in the footer.  So what a visitor's browser asks CDS for
  is known; whether CDS has those tiles, in webp, is the preview's to show.
- The Rubin app on the cadence at the Trifid/Lagoon visit (night 9 April
  2026, `apps.rubin:night=20552,cadence=1,image=1`): the readout's third
  line reads "Rubin's image covers this field: First Look, the Trifid and
  Lagoon nebulae"; the First Look layer asks CDS (404 here) and its mirror
  (reset) once each per tile and marks them missing.
