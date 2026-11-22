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
| `install.js` | The surveys' layers in the scene, one per survey, shared (`skyLayers`); the control's rows (`skyRows`, `followControl`), the fields' directions and the turn to one (`surveyFields`, `turnToSkyField`) |
| `../../ui/SkyImagery.jsx`, `../../ui/SkySection.jsx` | The layers control's sky section: the loader in the first load, the section lazy |
| `footprint.js` | An image's rectangle on the sky from its AVM, to its HEALPix cells (Rubin's coverage) |
| `../../../tools/hips/coverage.mjs` | Writes a manifest's coverage, from its footprints or the survey's `Moc.fits` |

All of it is lazily loaded, with the Rubin feature (`rubin/install.js`
imports it), the layers control's sky section, or a link that has a survey
on; in the first load are only the section's loader, the `sky:` token and
the store's list (see [the control](#the-control)).

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
| Rubin's First Look, the Virgo Cluster, `rubinobs/SVImages_v2/color_ugri` | Rubin's own (`images.rubinobservatory.org/hips/`) | 3 to 11 (0.2″) | webp, colour | 5.79e-4 of the sky (24 deg²) | the Rubin app's "Rubin's image"; the control (`rubin-virgo`) |
| Rubin's First Look, `CDS/P/Rubin/FirstLook` | CDS (`alasky`, mirror `alaskybis`) | 0 to 12 (0.1″) | png, webp | 7.07e-4 of the sky (29 deg²) | the Rubin app's "Rubin's image", for the Trifid and Lagoon only |
| JWST NIRCam, `ESAVO/P/JWST/NIRCam_Imaging` | ESA's ESASky (`skies.esac.esa.int`) | 0 to 15 (drawn to 13) | png (with alpha), grey | 5.75e-5 | the control (`jwst-nircam`) |
| JWST MIRI, `ESAVO/P/JWST/P/MIRI_Imaging` | ESASky | 0 to 13 | png (with alpha), grey | 3.48e-5 | the control (`jwst-miri`) |
| Hubble ACS, `ESAVO/P/HST/ACS-blue` | ESASky | 3 to 14 | jpeg, grey, inverted | 5.97e-4 | the control (`hst-acs`) |
| Hubble WFC3, `ESAVO/P/HST/WFC3` | ESASky | 3 to 14 | jpeg, grey, inverted | 2.04e-4 | the control (`hst-wfc3`) |
| Hubble WFPC2, `ESAVO/P/HST/WFPC2` | ESASky | 3 to 13 | jpeg, grey, inverted | 7.79e-4 | the control (`hst-wfpc2`) |

**Rubin's First Look, the Virgo Cluster** is Rubin's own HiPS, the one
its [SkyViewer](https://skyviewer.app/) draws (found in that page's
source): LSSTCam's coadd of the Virgo field in u, g, r and i ("LSSTCam:
Virgo", built by `lsst.pipe.tasks.hips.GenerateHipsTask`, 8 June 2025),
24 deg² about RA 188.2°, Dec +7.1°, wider than the press image, orders 3
to 11, webp only, served with `access-control-allow-origin: *`.  Its
coverage is its own `Moc.fits` (455 cells at order 8, its
`moc_sky_fraction` to four figures).  Its `properties` call it
`hips_status = private`: served openly, not listed in the registries
(**drawing it straight from Rubin's server is the maintainer's decision**,
2026-11-20, over a pyramid of our own from the press image).  It
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

**Hubble and JWST: none in colour that can be reached.**  The maintainer
asked for Hubble's and JWST's colour surveys (#360, 2026-11-20).  What
exists and what answers:

- **Every colour HiPS of Hubble or JWST is CDS's**: `CDS/P/HST/EPO`,
  `CDS/P/HST/color`, `CDS/P/HST/GOODS/color`, `CDS/P/HST/PHAT/color`,
  `CDS/P/JWST/EPO`, `CDS/P/JWST/First-Images` and the single images
  (Carina's Cosmic Cliffs, the Cartwheel, SMACS 0723, the Southern Ring,
  Stephan's Quintet), served from `alasky` and its mirror `alaskybis` only
  (the MocServer's records, `dataproduct_subtype=color`, every
  `hips_service_url*`).  CDS's tile host answers each with a 404, to the
  sandbox and to a visitor's browser; its mirror resets the connection.  So
  none is offered: a switch that shows nothing isn't.
- **ESASky's Hubble surveys say "color" and are grey.**  Their records
  (`dataproduct_subtype = color live`, `isColored = true`, jpeg) are
  HipsGen's: an RGB jpeg.  But every tile fetched, 98 of them at 19 fields,
  orders 8 and 11, has R = G = B to the count, and they're stretched
  dark-on-light (the sky about 225, stars black; no data exactly 0).  Each
  is one mosaic of all its camera's filters (the `hipsgen_params_*`
  CONCAT the BLUE, RED, UV and IR runs into it), so no bands to combine
  either: the one stray per-band survey left, `HST/WFC3-UV`, is ultraviolet
  alone.  They're shown as their negative (`invert`), labelled "in grey".
- **ESASky's JWST surveys are grey too**: one HiPS per instrument (NIRCam,
  MIRI, NIRISS and two coronagraphic), every filter merged, png, R = G = B
  in every tile looked at.  NIRCam and MIRI are offered, labelled so; no
  false colour is made of them (two instruments, each all its filters
  merged, aren't bands to map honestly).
- **ESASky's own list** (the JSON its web app at `sky.esa.int` loads) is
  refused by the sandbox's proxy, so it wasn't read; `skies.esac.esa.int`'s
  directory listings answer 403, and the obvious paths for an outreach or
  colour survey there (`HST/EPO`, `JWST/EPO`, `JWST/color`, per-filter
  NIRCam) 404.
- **Rubin's Virgo field is in colour** (u, g, r, i), and the control has it.

So the control has Hubble and JWST in grey and Rubin in colour.  When CDS's
tiles answer again, `CDS/P/JWST/EPO` and `CDS/P/HST/EPO` are a manifest
each (their coverage from `Moc.fits`, which is on the same host).

**A link turns a survey on** too: **`?sky=<key>[,<key>]`** in the
query string (the first form, still read), or the `sky:` token in the
fragment ([the control](#the-control)), the key a manifest's `key`.  The
Pillars of Creation in JWST NIRCam, from the Rubin site's night sky at a
0.12° field:

```
https://celestiary.org/?sky=jwst-nircam#sun/ed138@-30.2446,-70.7494,2.684km;from=sun/earth;t=9630.783523jd;cq=0.014,0.9593,0.1209,-0.2547;fov=0.12deg;s=LF;time:pause
```

**A stand-in survey** labelled as not Rubin's, for the fields Rubin has
nothing public on (DSS2 colour is all-sky, and CDS's), is the
maintainer's to decide (#360).

### Black as no data, on jpeg

A HiPS tile covers its whole cell, and a survey with no alpha is black
where it has no data, so the tile material keys black out (`keyBlack`).
Rubin's webp tiles are exactly 0 there, and the default ramp (clear at 0,
opaque from 2/255) suits them.  ESASky's Hubble jpegs ring round the edge
of their data: measured over 46 tiles with no-data regions, the pixels
within 4 px of a no-data block (a run of exact zeros) take values 1 to 16
(about 40% at 1 or 2, 98% under 16, almost none from 16 to 64); the data's
own sky, served dark-on-light, is 100 counts and more.  So a manifest
gives its own ramp in counts, `"keyBlack": [16, 24]` (clear to 16, opaque
from 24: `HipsLayer.js` `tileKey`), and `"invert": true` shows the tile's
negative after the key, which reads the texel as served.

### Saturated cores

A saturated star or nucleus is 0 as served too (white in the negative), and
the key cut it out with the no data: the Sombrero's nucleus and the bright
of its bulge showed the sky under them, in patches that changed with the
order (the maintainer's look at the preview), and so did Eta Carinae's core
in WFPC2.  The texel can't tell the two; its neighbourhood can.  So an
inverted survey's tile is read once as it loads (`noData.js`
`clearNoData`, 3 to 18 ms a 512² tile): each connected black region (16
counts and under) is a saturated core if the data 2 px out from its edge
has a median under 72 counts, the dark of a bright object (the survey's sky
is 100 and more), or if it is under 100 px and clear of the tile's edge (a
star's core); otherwise it is no data, widened 4 px for the rim the blend
at the data's edge makes in the negative, and given alpha 0 over white.
The material then draws the tile by its alpha, with no key.  A tile black
all over is no data: inside a core wider than a tile, the coarser tile
drawn under it (3 orders up) holds the core whole.  Where the pixels can't
be read (no DOM), the key as before.  Checked on ACS's tiles of the
Sombrero at orders 8 to 14: the no data clear (208,241 px of the order-8
tile), the nucleus and the bulge's cores kept (7,967 px at order 10).

### Showpieces

A survey covers a ten-thousandth of the sky or less, so switched on with
nothing in view it shows nothing.  Each manifest in the control lists its
showpiece `fields` (`key`, `label`, RA and Dec, J2000, and the field of view
that frames it), and the control has a button for each while the survey is
on.  Each was checked on its tiles (2026-11-20): the tiles at the order its
field draws (its field over 400 px) within its radius fetched from ESASky,
all answered 200 bar edge cells outside the data (404, marked missing), and
the data's centroid within a few hundredths of a degree of the place.

| Survey | Fields |
|---|---|
| JWST NIRCam | Pillars of Creation, Cosmic Cliffs (Carina), Stephan's Quintet, SMACS 0723, Southern Ring Nebula, Cartwheel Galaxy |
| JWST MIRI | Pillars of Creation, Stephan's Quintet, Southern Ring Nebula, Cartwheel Galaxy |
| Hubble ACS | Ultra Deep Field, Whirlpool (M51), Sombrero (M104), Antennae, Orion Nebula |
| Hubble WFC3 | Pillars of Creation (2014), Westerlund 2, Ring Nebula (M57), Whirlpool (M51) |
| Hubble WFPC2 | Pillars of Creation (1995), Eta Carinae, Cartwheel Galaxy, Southern Ring Nebula, Crab Nebula |
| Rubin's First Look, Virgo | Virgo Cluster, M49 |

Rejected, for no tiles or little data there: ACS at the Pillars (its order-11
tile 404s), the Crab and the Carina Nebula's centre in ACS (a tenth of the
field), the Cosmic Cliffs in MIRI (a sixth), the Helix in every survey.

## The control

The **layers control** (top right; the phone dock's *Layers*) is there
everywhere now: a Cesium body's render layers and New York while the
camera is near one, as before, and under them, or alone, **Sky imagery**: a
switch per survey with a line saying what it is (`about`: "all filters
merged, in grey", "in colour"), and while one is on, its showpiece buttons.
A button turns the view to the field at its field of view, out of a seat's
ride and off tracking (`turnToSkyField`, which the Rubin panel's field
buttons use too); landed, with the field under the horizon, the section
says so ("… is below the horizon here now.").

- **State:** the store's `skyOn` (store/LayersSlice.js), the keys in the
  order switched on.  Celestiary follows it: `Scene.setSkySurveys` holds
  each survey's layer for the control and lets go of the rest
  (`followControl`).
- **One layer per survey, shared** (`skyLayers`): the control, a link's
  `?sky=` and the Rubin app's "Rubin's image" each hold a survey by name
  (`control`, `link`, `rubin`); the layer is made by the first and freed
  when the last lets go, so Rubin's Virgo tiles on from the app and the
  control are one layer, drawn once, credited once (`sky-rubin-virgo`).
- **In the link:** the `sky:` token, the keys on, sorted
  (`sky:hst-acs,jwst-nircam`; design/URLs.md, "Sky token").  It's
  canonical: `?sky=<key>[,<key>]` still works and joins the same list,
  and the fragment then carries the token.  As the `layers:` token, a link
  only turns surveys on.
- **The first load** holds the Layers button, the section's loader
  (`SkyImagery.jsx`: half a KB), `LayerSwitch` (the New York toggle's row,
  shared), the token and the store's list.  The section itself
  (`SkySection.jsx`), the manifests and the layer are one lazy chunk, which
  imports nothing of the first load's: it's handed React and the MUI
  components, since a lazy chunk sharing MUI's modules re-split the first
  load's chunks (5 KB more gzipped, measured), and so did one importing
  `react/jsx-runtime` (the section's JSX is the classic runtime's, on the
  React handed in).
- **Credits:** each survey's in the footer while its tiles are drawn
  (`sky-<key>`), from its record: ESASky's say whose data (eHST/ESA,
  eJWST) and that the HiPS is ESA/ESDC's, under ESASky's terms (no
  `hips_license` in their records).

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

## Zooming a picture at infinity

A survey's picture is on the sky like the stars: moving the camera
doesn't change it, only the field of view does.  The wheel, and a
trackpad's two fingers, move the camera (the controls' zoom), so over a
survey they did nothing a visitor could see, where the `,` and `.` keys
narrowed and widened the field (the maintainer's report on #370's
preview: "i can't zoom").  So **while a survey's tiles are in the frame**
(`Scene.skyInView`: a layer under the stellar frame with tiles drawn, a
HiPS layer's or the discovery image's) **the wheel changes the field**
(`ThreeUi.wheelField`: a factor of e^(0.002 × the wheel's pixels), a
notch about a fifth, one event counting for at most 120 px), caught before
the controls' own listener and kept from it; with no imagery in the frame
the wheel moves the camera as ever.  An instrument's range still holds
the field (the Rubin app's optics).  A phone's pinch goes through the
controls' pointers, not the wheel, and still moves the camera: not done.

Checked headless on the build, 800 × 500, five notches in and five out
with the pointer over the sky: JWST NIRCam and Hubble WFC3 from 0.07° to
0.0258° and back with the camera's distance unchanged; the Rubin app's
Virgo view from 3.5° to 1.29° and back; the same view with no survey on,
the field unchanged and the camera moved, as before.

## A picture's black

A picture is a photograph of its sky, display-referred: its black is the
screen's.  The sky's own diffuse light is drawn over the scene (the
zodiacal light, the galaxy's march and airglow in the atmosphere pass; the
Sun's corona from inside its shell), and the eye adapts to a dark frame, so
from the default seat, riding the Sun's orbit 24 Gm out, the corona and the
zodiacal light at the dark-adapted gain (8.5e5) put 200 of 255 over the
Pillars of Creation and the stars round them; at 60 Gm the zodiacal light
alone 70, and 6 by 150 Gm.  Within 100° of the Sun the eye's glare veils
the frame too: 207 of 255 over Stephan's Quintet, 93° from the Sun at 56 Gm,
at a gain of only 9.  So while a picture is in the frame
(`ThreeUi.pictureInView`: `Scene.skyInView`, at any field; a cut at 10°
popped to grey on the way out) that light isn't drawn:
`_updateNightSkyShown` reads it, and `SunLayers.underPicture` hides the
corona and the glare.  The stars and the bodies are drawn as ever, and the
meter reads what's left.

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

- **The control, headless** (Chromium on SwiftShader, 800 × 500, ESASky
  and Rubin's host through the proxy, 2026-11-20), from `#sun` with the
  Sun's glare off and the clock paused, driven as a visitor would: the
  Layers button, a survey's switch, a showpiece's button, for each survey
  in turn, then the switch off.  The store's `skyOn` and the layer held
  followed each switch, the link gained `sky:<key>` and lost it, and after
  the last switch off no layer was held.  Per survey at one field, the
  tiles every one answered (ESASky's 404s for edge cells outside the data
  come without CORS headers, so the console reports them as CORS errors;
  the layer marks them missing), and the image against the sky:
  - JWST NIRCam, the Southern Ring at 0.03° (0.216″ a pixel): order 11,
    21 tiles, none missing; HD 87892, the nebula's bright central star,
    0.10″ from its catalogue place projected through the camera.
  - JWST MIRI, the same view: order 11, 11 tiles, 1 missing; against the
    NIRCam frame by phase correlation, 0.22″ (one pixel); the scene's two
    catalogue stars there 1.0″ and 1.9″ from the image's (the mid-infrared
    nebula round them).
  - Hubble ACS, the Sombrero at 0.12° (0.86″ a pixel): order 9, 8 tiles,
    3 missing; the one catalogue star in the frame 2.8″ (3 px) from the
    image's.  The nucleus is saturated, 0 as served, so keyed (below).
  - Hubble WFC3, the Ring Nebula at 0.03°: order 11, 14 tiles, 9 missing
    (the WFC3 pointings are small); the ring's light centred 1.1″ from the
    central star.
  - Hubble WFPC2, Eta Carinae at 0.03°: order 11, 27 tiles, none missing;
    eight catalogue stars 0.4″ to 1.0″ from the image's.
  - Rubin's Virgo, M49 at 0.2° (1.44″ a pixel): order 9, 20 tiles, none
    missing; the nucleus 0.07″ from its place.
- **A link opened in a fresh page restores the control**: the Pillars in
  JWST NIRCam (`…;fov=0.07deg;…;sky:jwst-nircam`) came up with the switch
  on, the layer held for `control`, order 10, 10 tiles drawn; and
  `?sky=hst-wfc3` with the same view, the switch on and the fragment
  rewritten with `sky:hst-wfc3`.
- **The jpeg key, rendered**: the Sombrero in ACS with the first key
  (16 to 24 counts on the texel alone) had a bright rim, two or three
  pixels, along every edge of the data, the blend of the no-data black and
  the sky under the negative; keyed on the darkest neighbour too, it's
  gone.  Saturated cores show as holes (the Sombrero's nucleus and a star
  to its west).
- From `#sun` at these narrow fields the meter raises the gain on a frame
  with nothing bright in it, and the scene's faint diffuse light shows as
  grey round the image, and through MIRI's and Hubble's keyed sky: the
  scene's, not the layer's; from a dark site it's black.

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
- **The field buttons** (Rubin.md, "The app"), headless at 900 × 900,
  landed at the site on 15 May 2026 02:00 UTC with the app open: no
  buttons with "Rubin's image" off; on, *Discovery field* and *Virgo
  Cluster* (CDS's `properties` a 404, so no Trifid and Lagoon); *Virgo
  Cluster* leaves the view 0.000° from the field at 3.5°, tracking off,
  its tiles ready; *Discovery field* 0.000° at 2°; and at 10:00 UTC, with
  Virgo set, the note "Virgo Cluster is below the horizon here now."
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
