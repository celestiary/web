# Models and spacecraft

3D models (glTF) for bodies that aren't spheres, and the first body that
uses one: the James Webb Space Telescope at its real place
([#25](https://github.com/celestiary/web/issues/25), in
[#120](https://github.com/celestiary/web/issues/120)).

- `js/scene/model.js`: the loader, `loadModel`.
- `js/scene/Spacecraft.js`: a `type: "spacecraft"` body: a model at its
  place along a trajectory table, turned to the Sun.
- `js/scene/trajectory.js`: a trajectory table, interpolated.
- `Animation.placeOnTrajectory`, `Animation.turnToSun`: placing and turning
  it each frame.
- `tools/models/build.sh`: rebuilds the bundled models from their sources.
- `tools/spacecraft/fetchHorizons.mjs`: rebuilds the trajectory tables and
  their test fixture from JPL Horizons.

## The loader

```js
import {loadModel} from './model.js'

const model = await loadModel('large/models/jwst/jwst.glb', {doubleSided: true})
node.add(model)
```

That is the whole API, and it's meant to stay small for the bodies that
come next: Earth's satellites ([#50](https://github.com/celestiary/web/issues/50)),
a flyable spacecraft ([#2](https://github.com/celestiary/web/issues/2)), the
irregular moons and asteroids ([#30](https://github.com/celestiary/web/issues/30)).

- **Paths are under the site's data**, through `dataUrl` (DESIGN.md [data
  policy](../../DESIGN.md#data-policy)): a model over about 1 MB goes in
  Git LFS under `public/large/models/<name>/`.
- **Metres.**  glTF's unit is the metre and the model is drawn as it is;
  `scale` converts one that isn't (Celestia's models are in km).
- **Lit by the Sun**, as the planets are: three's PBR materials under the
  Sun's `PointLight` (the inverse square, in candela), rendered into the
  HDR buffer at the target-keyed exposure ([Planet.md, lighting and
  exposure](Planet.md#lighting-and-exposure)).  A sunlit surface of albedo
  a shows at a·1.5 in the buffer when the craft is the target, like a
  planet's texture.  Nothing new is display-referred, so nothing needs
  `sceneReferred`.  There is no ambient light: the far side is black but
  for the stars behind, as a planet's night side.
- **Emissive is dropped** unless `emissive: true`.  NASA's models carry
  their authoring tool's ambient colour as emissive (JWST's is 0.04-0.13),
  which lit the craft's shaded side at a tenth of its sunlit side.
- **`doubleSided`** draws back faces too.  Thin shells are often modelled
  one-sided: JWST's sunshield faces only the telescope side, so from the
  Sun it was culled and the craft was a thin strip.
- **Loaded once.**  Each path is fetched and parsed once for the page
  (concurrent asks share the request; a failure is forgotten, so the next
  ask tries again); each call gets a clone that shares geometry and
  materials.
- **Off the first load.**  `GLTFLoader` and three's meshopt decoder are
  dynamic imports, chunks of their own (47 KB and 23 KB minified);
  the first load grew by 6 KB minified, 2 KB gzipped (the body class, the
  table's interpolation and the loader's stub).
- **`modelRadius(model)`** is a model's bounding sphere about its origin:
  what to put in a descriptor's `radius`.

**Precision.**  A model under `WorldGroup` is an ordinary three.js object,
like the planets: three forms each object's model-view matrix in doubles
on the CPU and the GPU gets camera-relative positions, so a 20 m craft
1 AU from the origin is drawn sharp from a few metres (checked in
headless Chromium, below).  The camera's near plane follows the body
(`zoom.js` `dynamicNear`): its floor is 100 m for a body over 10 km in
radius, as before, and a hundredth of the radius for a smaller one, so
JWST's floor is 17 cm.

## A spacecraft's descriptor

`public/data/earth/spacecraft/webb/index.json`, listed in its parent's `system`
(`earth/index.json`) and
built into `bodies.json` by `yarn bodies`:

| Field | |
|---|---|
| `type` | `"spacecraft"` (`Scene.objectFactory` builds a `Spacecraft`) |
| `parent` | The body its trajectory is relative to |
| `radius` | Its model's bounding sphere about its centre, with units (`"17 m"`): the zoom's floor, the arrival distance (10 radii), the label's lift, the meter's disc |
| `albedo` | For the meter's sunlit-body anchor (`ThreeUI._sunlitBodies`) |
| `aliases` | Search tokens ("jwst") |
| `model` | `{path, scale?, rotation?, doubleSided?}`: `loadModel`'s, and an XYZ Euler turn in degrees into the attitude frame below |
| `trajectory` | The table, under `data/` (`earth/spacecraft/webb/trajectory.json`, in its own directory) |
| `attitude` | `{sun: [x, y, z]}`: the model's axis kept toward the Sun |

The body is called `webb` rather than `jwst` so its name reads well
wherever a body's name is capitalised (the breadcrumb, the label, the
search); "JWST" finds it.

**Its scene graph** is a planet's down to the body's node
(`scene.objects.webb`, with `.props` and `.orbitPosition`), so targeting,
`goTo`, follow, the search, permalinks (`#sun/earth/webb`) and the label's
double click work as for any body:

```
earth.orbitPosition
  └── Spacecraft
        └── webb.group
              └── webb.orbitPosition       ← Animation.placeOnTrajectory
                    └── webb               (hidden off the table's span)
                          ├── model LOD
                          │     ├── [near] attitude   ← Animation.turnToSun
                          │     │           └── model (centred on its box)
                          │     ├── [far]  far point  (a moon's marker)
                          │     └── [past the label's reach] nothing
                          └── label LOD
```

- **The model is loaded when it's first drawn** (the LOD's near level, by
  the canvas's pixels, as a planet's mesh), or when the craft is targeted
  (`preloadNear`).  A view of the Earth with Webb's label in it fetches the
  table, not the model.
- **The label** shows from 30 radii (510 m) out to `labelDistance`
  (default 1e10 m), so Webb is named beside the Earth from a few million
  km.  Its rank is by radius, under every moon's.
- **Not a landing site**: double click and AR don't land on its bounding
  sphere (`Scene.onDblClick`, `landableBodyName`).

## The models

| Model | File | Source | Licence | Built |
|---|---|---|---|---|
| James Webb Space Telescope (A), deployed | `public/large/models/jwst/jwst.glb`, 2.38 MB (LFS) | NASA 3D Resources, NASA Goddard: [the page](https://science.nasa.gov/3d-resources/james-webb-space-telescope-a/), [the glb](https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model/james-webb-space-telescope-(a)/James%20Webb%20Space%20Telescope%20(A).glb) (4.71 MB, md5 `fd616ecfd267dd60f62fba4f9d30cc7c`); [bldrs-ai/test-models](https://github.com/bldrs-ai/test-models/tree/main/glb) holds a byte-identical copy | NASA 3D Resources are "free and without copyright" ([the collection's README](https://github.com/nasa/NASA-3D-Resources)), under NASA's [media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media) (no endorsement implied) | `tools/models/build.sh` |
| Vera C. Rubin Telescope (the Simonyi Survey Telescope on its pier) | `public/large/models/rubin/simonyi.glb`, 567 KB (LFS; 250 KB gzipped) | NOIRLab's 3D models, [model3d004](https://noirlab.edu/public/products/models3d/model3d004/): [the OBJ](https://noirlab.edu/public/media/archives/models3d/model_3d_obj/model3d004.obj) (8.4 MB, md5 `0b235571cafb1cb1c3f4d32c739e2a9c`; a Cinema 4D export, 2020, in centimetres; the .mtl it names isn't served) | Credit Rubin Observatory/NSF/AURA, mandatory and visible (NOIRLab's [usage terms](https://noirlab.edu/public/copyright/): CC BY 4.0 for its images and videos, and "crediting this 3D Model with the full credit line, in a visible way, is MANDATORY"); the app's panel carries it | `tools/models/build.sh`, through `tools/models/obj2glb.py` |

**The recipe** (`tools/models/build.sh <downloads dir>`): glTF-Transform's
`optimize`, pinned (`@gltf-transform/cli@4.5.1`, run with npx, not a
dependency), with meshopt compression and no simplification or texture
work.  NASA's file is Draco-compressed, 1,600 meshes and 46 materials
(1,600 draw calls); the build is 3 meshes (one instanced), the materials
merged into a 128×4 palette texture, 2.38 MB, 1.16 MB gzipped.  Meshopt
rather than Draco because its decoder is a JS module that bundles (no wasm
file to serve beside the page).  The model is metres already: its box is
27.4 × 12.0 × 14.8 m, the sunshield 21 × 14 m in its XZ plane, the
telescope on +Y, the bus on −Y (the Sun's side).

**The telescope's recipe** (`tools/models/build.sh`, for
[js/scene/rubin/Rubin.md](rubin/Rubin.md)): `tools/models/obj2glb.py`, a
dependency-free OBJ reader, writes a binary glTF with one node per OBJ
object (the file's 130, named: `mirror`, `circle_upper`, `camera_structure`,
`stairs_base_telescope_12`...), each polygon fanned into triangles with the
file's normals, a flat material per `usemtl` from a palette on the command
line (there's no .mtl; the mirror glossy and dark, the steel grey), and
the objects gathered by name under three nodes the app turns: `pier`
(`peer_*`), `azimuth` (the base, platforms, rails, stairs and fork) and
`elevation` (the rest: the rings, the mirror cell, the truss, the camera
and top end).  Then glTF-Transform's `optimize` with meshopt, keeping the
hierarchy (`--flatten false --join false`) and the materials' colours
(`--palette false`): 39,493 triangles, 2.19 MB raw to 567 KB.  The
model's units are centimetres (`--scale 0.01`); its elevation axis is 7.8
m over its origin, along X, and its tube is posed 45° up toward +Z
(`rubinModel.js` `assembleTelescope` re-hangs it for the mount); its pier
runs 20 m below the origin.  Which of the file's objects belong to the
elevation structure was read off their bounding boxes and checked by
rendering the groups parked and at 20° (the first cut's probes): the
parts turn as one.  NOIRLab also offers the complete scene, dome and
building ([model3d003](https://noirlab.edu/public/products/models3d/model3d003/)),
as a 2 GB OBJ and a 472 MB Cinema 4D file: the dome stays primitives for
now.  Neither file carries animation (OBJ can't); the pointing is the
app's own.

**Celestia's models.**  The task pointed at github.com/celestiaorg; that is
the Celestia *blockchain* project.  The space simulator's content is
[CelestiaProject/CelestiaContent](https://github.com/CelestiaProject/CelestiaContent):
spacecraft (Apollo, Cassini and Huygens, Galileo, Hubble, the ISS, Mir,
Skylab, Gemini, Mercury, Mars Global Surveyor and Odyssey) and ~70 small
bodies' shapes (Phobos, Deimos, Eros, Itokawa, Bennu, Ryugu, 67P, Vesta and
more), in Celestia's `.cmod` and `.3ds`, each with an SPDX licence file
(the ISS's CC0 from NASA, Shrox's spacecraft CC BY 4.0, some
CC BY-NC-SA: check each).  Using them needs a `.cmod` → glTF converter;
the asteroid shapes are #30's natural source.

## Positions

**From JPL Horizons, as a table interpolated in the app** (the
alternative, a few bundled vectors with an integrator between them, waits
on [#11](https://github.com/celestiary/web/issues/11)'s integrator, and
couldn't follow the burns anyway).

- **The query** (`tools/spacecraft/fetchHorizons.mjs`, recorded in the
  table): JWST, Horizons `-170`, centred on the Earth (`500@399`), VECTORS,
  the ecliptic and equinox of J2000, km and km/s, TDB.  A dense sample:
  every 10 minutes from 13:02 TDB on 2021-12-25 (Horizons starts 41 minutes
  after launch, past the Ariane's separation) to 28 December, hourly to
  15 February 2022, then daily to 4 October 2031, where Horizons'
  five-year schedule ends: 5,049 states.  Horizons' trajectory is Goddard's
  reconstructed (definitive) solution to the latest tracking, a 28-day
  prediction, then the five-year plan.
- **Thinned** to the fewest states whose cubic Hermite between neighbours
  (both ends' positions and velocities) reproduces every state of the
  dense sample within 5 km: 1,196 states, 99 KB, 43 KB gzipped
  (`public/data/earth/spacecraft/webb/trajectory.json`).  The Earth's monthly wobble about
  the Earth–Moon barycentre is in a geocentric table, and is what limits the
  step: 1 km would take 1,848 states (66 KB gzipped), 10 km 1,016.  5 km is
  3 parts in a million of Webb's 1.5 million km from the Earth.
- **Checked** against 12 Horizons states at times off the dense sample's
  grid, from five hours after launch to 2031 (`trajectory.webb.horizons.json`,
  `trajectory.test.js`): within 6 km at every one.
- **Into the scene**: the clock's UTC to TT (for TDB, within 2 ms), the
  axis remap, and J2000 to the date's ecliptic (`precessionQuaternion`;
  26 years of it move Webb ~9,500 km), relative to the Earth's centre as
  the scene has it (VSOP87C, or the mean elements before it loads).
- **Over its span only**: before launch and past the table's end the craft
  is hidden.
- **Loaded after the first frame**: the table is asked for when the
  ephemeris is (the reveal, or the safety net a few seconds after the first
  frame; `Animation.placeOnTrajectory`), or at once when the craft is
  targeted.  Until it's in the craft is hidden.  On the homepage it is one
  request, 43 KB, after the scene is in.

**Attitude.**  JWST keeps its sunshield between the Sun and the telescope:
the model's −Y, the bus's side, is turned to the Sun each frame by the
shortest turn from the scene's axes (`turnToSun`).  Its roll about the
Sun line and the pitch it's allowed off it (−5° to +45°, for pointing) are
not modelled, so the telescope points wherever that turn leaves it.

## In front of the Sun

The planets and moons occult the Sun as spheres (`SunLayers._occlusion`):
its glare, the disc's point and the meter's luminous disc all take the
disc's visible share past them.  A spacecraft is nothing like a sphere, and
it wasn't in that list, so from Webb's shade side the Sun's glare showed
straight through the sunshield (the maintainer's review of #288).

- **Its silhouette** (`modelOccluder.js` `buildOccluder`): every triangle
  marked in a voxel grid in the model's own frame, 128 cells along its
  longest side (JWST: 17 cm cells, 129 × 73 × 87, 41,054 filled), each
  triangle sampled at half a cell.  Built once, in an idle moment after the
  model loads (358 ms for JWST's 494,000 triangles in headless Chromium).
  Not its largest triangles: JWST's surface is spread over many small ones
  (its largest 4,096 are 29% of its area, 65,536 are 80%), too many to test
  every ray against each frame.
- **The share it hides** (`sunBlocked`): 31 rays from the camera across the
  disc (its centre and rings at 0.4, 0.75 and 0.95 of its radius), each
  walked through the grid (Amanatides and Woo) in the model's frame, so the
  attitude's turn is in it.  `Spacecraft`'s `node.sunBlocked` first checks
  the craft's bounding sphere is in front of the disc, so a frame without
  the Sun behind it tests nothing.  Its resolution is the cell: from closer
  than about 20 m the disc is within one cell at the sunshield's rim, which
  hides all of it or none.
- **Into the Sun's layers**: the visible share is the spheres' times the
  craft's (1 − hidden), and a craft over the disc's centre hides the
  point, as a body does.
- **Cost**: 0.03 to 0.27 ms a frame for the rays while the craft is over
  the disc, nothing otherwise; the grid is 0.8 MB.
- **Checked** (`modelOccluder.test.js`, and in the browser): from 12 m
  behind Webb on the Sun's line the disc is all hidden, the meter goes to
  the dark-adapted gain and the corona shows round the silhouette; 9 m to
  the side the Sun is back and the gain returns to 1 within about 9 s.  At
  that gain a few sunlit edges past the sunshield's rim show as specks.
- **Not**: limb darkening across the rays (each counts the same), and
  Webb's shadow on other bodies.

## Checked in the browser

Headless Chromium on SwiftShader, `CESIUM_ION_TOKEN= yarn build`, at
2026-10-23 12:00 UTC, clock paused:

- `#sun/earth/webb`: Webb 1,527,055 km from the Earth's centre, the model
  in, the camera at the arrival distance (170 m), the near plane 15.3 m.
- From 55 m on the Sun's side the sunshield shows face-on, lit, its Kapton
  pink; from 110° off the Sun the telescope side is in shadow.  The meter's
  gain is 1 (the craft anchors it as a sunlit body), the keyed exposure
  Earth's.
- From beside the Earth, 2 million km off the Earth–Webb line, Webb's label
  and marker sit near the Sun–Earth L2 mark, and the page fetched
  `data/earth/spacecraft/webb/trajectory.json` and not the model.
- No shader errors.

## Not yet

- **More craft**: LRO (`-85`), CAPSTONE (`-1176`), Artemis I's Orion
  (`-1023`) are a descriptor, a table (`fetchHorizons.mjs`'s list) and a
  model each.
- **The path**: the craft's track over its mission, as an orbit line.
- **The real attitude**: JWST's pitch and roll, from its pointing.
- **Celestia's models**: a `.cmod` → glTF converter, for #30's shapes and
  the historic spacecraft.
- **Satellites** (#50) will reuse `loadModel`; their positions come from
  SGP4, not a table.
