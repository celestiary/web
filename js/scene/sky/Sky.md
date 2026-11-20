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
- **Format:** webp if the survey offers it, then png, then jpeg.

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
| Rubin's First Look, `CDS/P/Rubin/FirstLook` | CDS (`alasky`, mirror `alaskybis`) | 0 to 12 (0.1″) | png, webp | 7.07e-4 of the sky (29 deg²) | the Rubin app's "Rubin's image" |
| JWST NIRCam imaging, `ESAVO/P/JWST/NIRCam_Imaging` | ESA's ESASky (`skies.esac.esa.int`) | 0 to 15 (drawn to 13) | png (with alpha) | 3.4e-5 | the real-tile check; no control yet |

**Rubin's First Look** is CDS's HiPS of two of the images of Rubin's
First Look of 23 June 2025, NOIRLab's
[noirlab2521a](https://noirlab.edu/public/images/noirlab2521a/) (the
southern Virgo Cluster, 5.4° × 2.9°) and
[noirlab2521b](https://noirlab.edu/public/images/noirlab2521b/) (the
Trifid and Lagoon nebulae, 4.7° × 2.9°).  The HiPS is ODbL-1.0
(CNRS/Unistra); the images are RubinObs/NOIRLab/SLAC/NSF/DOE/AURA under
[Rubin's use policy](https://rubinobservatory.org/media/design-resources/use-policy).
The credits footer carries both, timed, while its tiles are drawn.

**JWST NIRCam** is ESASky's HiPS of the eJWST archive's NIRCam images,
single band, transparent where there is no data.  It's in the manifests
as the proof that the layer is general and as the survey its check runs
on; nothing in the interface switches it on yet.  From the console:

```js
const m = await c.scene.loadRubin()
const sr = (await c.scene.getRubin()).image  // after "Rubin's image" once: its layers hold sceneReferred
const layer = new m.HipsLayer({survey: m.SURVEYS[1], sceneReferred: sr.firstLook.sceneReferred,
  view: () => ({camera: c.ui.camera, fovDeg: c.ui.camera.fov, aspect: c.ui.camera.aspect,
    heightPx: c.ui.renderer.domElement.height})})
c.scene.stellarFrame.add(layer)
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
- The Rubin app on the cadence at the Trifid/Lagoon visit (night 9 April
  2026, `apps.rubin:night=20552,cadence=1,image=1`): the readout's third
  line reads "Rubin's image covers this field: First Look, the Trifid and
  Lagoon nebulae"; the First Look layer asks CDS (404 here) and its mirror
  (reset) once each per tile and marks them missing.
