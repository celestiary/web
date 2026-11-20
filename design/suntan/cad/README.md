# Suntan — CAD concept model

A STEP (AP214) assembly of the Suntan concept: a Parker Solar Probe-derived
relay orbiter carrying a rotating "sling wheel" that releases four landers
from its rim. It is a proportions-and-packaging model for looking at in
[Bldrs Share](https://github.com/bldrs-ai/Share) — part tree, selection, cut
planes through the lander's nested shells — not an engineering design.

| File | What it is |
|---|---|
| `suntan.step` | The model. Generated; do not edit by hand. |
| `suntan.glb` | The STEP as Bldrs Share exports it to GLB (Draco). The app draws it, re-encoded with meshopt, from `public/large/models/suntan/suntan.glb` (js/scene/models.md). |
| `make_suntan.py` | The generator (CadQuery / OpenCascade). All dimensions are constants at the top. |
| `suntan.parts.json`, `suntan.parts.md` | Generated with the model: per-part volume, area, density and mass from the kernel. |
| `validate_conway.mjs` | Loads the STEP in Conway (Share's engine) and checks every part's tessellated area and volume against the kernel's. |
| `check_clearances.py` | Kernel interference check over every placed part. |
| `share-suntan*.png` | Screenshots in Share, captured separately from the generator. Re-capture after regenerating. |

## Regenerate

```
python3 -m venv .venv && .venv/bin/pip install cadquery   # CadQuery 2.8, OpenCascade 7.9
.venv/bin/python make_suntan.py                           # suntan.step + suntan.parts.{json,md}
.venv/bin/python check_clearances.py                      # ~40 s
node validate_conway.mjs suntan.step <path/to/node_modules/@bldrs-ai/conway>
```

Conway isn't a celestiary dependency: `validate_conway.mjs` takes the
`@bldrs-ai/conway` package directory as its second argument, or `CONWAY`,
e.g. a Bldrs Share checkout's `node_modules/@bldrs-ai/conway`. If you change a dimension,
run all three: the generator does not check for collisions itself.

## Frame and layout

Millimetres. **+Z points at the Sun.** The origin is the centre of the heat
shield's sunward face, so everything is at negative Z.

| Station | Z (mm) |
|---|---|
| TPS heat shield | 0 to -115 |
| TPS truss | -115 to -715 |
| Bus | -715 to -2015 |
| Yoke crossbeam | -2015 to -2165 |
| Rim of the wheel's swept volume, nearest the bus | -2323 |
| Hub centre | -7000 |
| Rim of the wheel, furthest aft | -11677 |

The wheel turns in the **XZ plane about an axle along Y**. That is the
"rolling down a road" orientation: the axle is parallel to the Sun's surface
and the rim point nearest the Sun is the one moving backwards along the orbit.
Lander centres are 3996.9 mm from the hub centre; the outermost thing on a
lander is a magnet coil, so the wheel sweeps a 4677 mm radius. Solar arrays are
on the bus's ±X flats, the yoke arms at Y = ±870.

## Assembly tree

Each line is one STEP `PRODUCT`; `xN` is N `NEXT_ASSEMBLY_USAGE_OCCURRENCE`s of
it under that parent. There is one `Lander` product, placed four times.

```
Suntan
  Orbiter
    TPS heat shield
    TPS truss
    Bus
    Solar array x2
    Cooling radiator x4
    High-gain antenna
    FIELDS antenna x4
    Magnetometer boom
  Sling wheel
    Yoke
    Axle
    Hub
    Spoke x4
    Lander x4
      Ablator shell
      HfCN hull
      Coolant plenum
      Insulation
      Instrument core
      Diamond window
      Magnet coil x3
      Vent nozzle x6
```

24 products, 43 occurrences, 82 placed leaf parts. Share's part tree shows the
product name, so the four landers all read "Lander"; the occurrence names
("Lander 1", "Solar array +X", "Magnet coil A", "FIELDS antenna V1" …) are in
the file as the occurrences' names.

## Parts

Volumes are the kernel's (`Shape.Volume()`), for the solid as modelled. Mass is
volume × the density in the table, and **every density is an assumption**:
where a part is drawn solid but would be built hollow or as a lattice, the
density is the material's times the solidity named in the material column.

| Part | Count | Key dimensions (mm) | Intended material | Density (kg/m3) | Volume each (m3) | Mass each (kg) | Mass total (kg) |
|---|---:|---|---|---:|---:|---:|---:|
| TPS heat shield | 1 | disc dia 2300 x 115 | carbon-carbon facesheets on carbon foam, alumina white coat | 150 | 0.4778 | 71.7 | 71.7 |
| TPS truss | 1 | cone frustum shell dia 2000 -> 1080 x 600, wall 6 | Ti-6Al-4V (closed shell standing in for an open truss, 20% solidity) | 886 | 0.01735 | 15.4 | 15.4 |
| Bus | 1 | hex prism 1000 across flats x 1300 | aluminium honeycomb bus with avionics and propellant (effective) | 400 | 1.126 | 450.3 | 450.3 |
| Solar array | 2 | 1120 x 690 x 25 | cells on a water-cooled titanium platen (effective) | 1100 | 0.01932 | 21.3 | 42.5 |
| Cooling radiator | 4 | 560 x 480 x 20 | aluminium panel with titanium coolant tubes (effective) | 1000 | 0.005376 | 5.4 | 21.5 |
| High-gain antenna | 1 | dish dia 600 x 100 deep, mast dia 60 x 220 | CFRP reflector and mast | 1600 | 0.003424 | 5.5 | 5.5 |
| FIELDS antenna | 4 | whip dia 10 x 2000 | niobium C-103 (modelled solid) | 8850 | 0.0001571 | 1.4 | 5.6 |
| Magnetometer boom | 1 | dia 60 x 3500 | CFRP tube (modelled solid, 20% solidity) | 320 | 0.009896 | 3.2 | 3.2 |
| Yoke | 1 | U frame 2240 wide x 5135 long, 200 deep | Ti-6Al-4V box beam (10% solidity) | 443 | 0.2666 | 118.1 | 118.1 |
| Axle | 1 | dia 160 x 1640 | Ti-6Al-4V tube (25% solidity) | 1107 | 0.03297 | 36.5 | 36.5 |
| Hub | 1 | cylinder dia 800 x 400, bore dia 164 | aluminium (15% solidity) | 405 | 0.1926 | 78.0 | 78.0 |
| Spoke | 4 | dia 100 x 3000 | CFRP tube (20% solidity) | 320 | 0.02356 | 7.5 | 30.2 |
| Ablator shell | 4 | sphere dia 1200 / 900 | carbon-phenolic, sacrificial | 1450 | 0.5199 | 753.9 | 3015.5 |
| HfCN hull | 4 | sphere dia 896 / 840 | hafnium carbonitride | 12700 | 0.06578 | 835.4 | 3341.8 |
| Coolant plenum | 4 | sphere dia 836 / 700 | refractory lattice flooded with coolant (effective) | 1500 | 0.1252 | 187.8 | 751.1 |
| Insulation | 4 | sphere dia 696 / 616 | zirconia fibre / aerogel | 200 | 0.05353 | 10.7 | 42.8 |
| Instrument core | 4 | solid sphere dia 600 | instruments and avionics (effective) | 1000 | 0.1131 | 113.1 | 452.4 |
| Diamond window | 4 | disc dia 120 x 40 | CVD diamond | 3515 | 0.0004524 | 1.6 | 6.4 |
| Magnet coil | 12 | ring major dia 1300, square section 53.2 x 53.2 (area of a dia 60 round) | copper (modelled solid) | 8960 | 0.01155 | 103.5 | 1241.6 |
| Vent nozzle | 24 | hollow cone dia 40 -> 110 x 120, wall 6 | tungsten | 19300 | 0.0001561 | 3.0 | 72.3 |
| **Total** | 82 | | | | | | **9802** |

Roll-up: orbiter 616 kg, wheel structure 263 kg, one lander 2231 kg,
four landers 8924 kg, total 9802 kg. Read that as a finding, not a
budget: as drawn, the landers outweigh the orbiter that carries them by about
14 to 1 (the real Parker Solar Probe was 685 kg at launch), and about 70%
of each lander is the ablator and the HfCN hull.

## Validation against Conway

Conway is the engine Share loads STEP with. Its own command-line entry point is
the `step` bin of `@bldrs-ai/conway` (`compiled/examples/cli-step-bundled.cjs`).
Run from this directory, `-g` extracts geometry and `-n` writes no files:

```
node $CONWAY/compiled/examples/cli-step-bundled.cjs suntan.step -g -n
```

```
[Nov 20 2026 08:24:57 AM]: Load Status: OK, Writer: ap214-cli, Project Name: undefined, Version: AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }, Conway Version: 1.1651.790-ga975ff6f-NodeMT, Parse Time: 43 ms, Geometry Time: 306 ms, Total Time: 363 ms, Geometry Memory: 1.176 MB, WASM Heap High-Water: 23.125 MB, Preprocessor Version: 'Open CASCADE 7.9', Originating System: 'Unknown', Representation Extent: 315 faces, 0 unreached, 1 degenerate
```

That proves the file parses and tessellates, but the CLI merges all geometry
into one mesh per colour, so it cannot say which part lost a face. (The one
"degenerate" face in its extent count is the Instrument core's full sphere:
a probe file with no sphere reports 0 and each untrimmed sphere adds 1. The
sphere tessellates correctly — see below.)
`validate_conway.mjs` drives the same parser and extractor through Conway's
API and walks the scene by occurrence path:

```
header parse: COMPLETE; data parse: COMPLETE
geometry extraction: COMPLETE
representation extent: 315 faces measured, 0 unreached, 1 degenerate
products: 24, occurrences (NAUO): 43, leaf occurrences: 82, placed geometry instances: 82, triangles: 150353
checked against kernel area/volume (±3%): 82 leaf occurrences, 0 mismatch(es)
Conway complaints during extraction: 0
RESULT: PASS
```

```
Assembly tree as Conway reads it (NEXT_ASSEMBLY_USAGE_OCCURRENCE):
Suntan [assembly, 2 children] — 150353 triangles
  Orbiter [assembly, 15 children] — 3806 triangles
    TPS heat shield — 134 triangles, area 9.0430 m2, volume 4.7483e-1 m3 (vs kernel: area -1.07%, volume -0.62%)
    TPS truss — 846 triangles, area 7.3184 m2, volume 1.7284e-2 m3 (vs kernel: area -0.36%, volume -0.37%)
    Bus — 20 triangles, area 6.2354 m2, volume 1.1258e+0 m3 (vs kernel: area +0.00%, volume +0.00%)
    Solar array — 12 triangles, area 1.6361 m2, volume 1.9320e-2 m3 (vs kernel: area +0.00%, volume +0.00%)
    Solar array — 12 triangles, area 1.6361 m2, volume 1.9320e-2 m3 (vs kernel: area +0.00%, volume +0.00%)
    Cooling radiator — 12 triangles, area 0.5792 m2, volume 5.3760e-3 m3 (vs kernel: area +0.00%, volume +0.00%)
    Cooling radiator — 12 triangles, area 0.5792 m2, volume 5.3760e-3 m3 (vs kernel: area +0.00%, volume +0.00%)
    Cooling radiator — 12 triangles, area 0.5792 m2, volume 5.3760e-3 m3 (vs kernel: area +0.00%, volume +0.00%)
    Cooling radiator — 12 triangles, area 0.5792 m2, volume 5.3760e-3 m3 (vs kernel: area +0.00%, volume +0.00%)
    High-gain antenna — 2294 triangles, area 0.6775 m2, volume 3.4033e-3 m3 (vs kernel: area -0.71%, volume -0.61%)
    FIELDS antenna — 88 triangles, area 0.0628 m2, volume 1.5513e-4 m3 (vs kernel: area -0.31%, volume -1.24%)
    FIELDS antenna — 88 triangles, area 0.0628 m2, volume 1.5513e-4 m3 (vs kernel: area -0.31%, volume -1.24%)
    FIELDS antenna — 88 triangles, area 0.0628 m2, volume 1.5513e-4 m3 (vs kernel: area -0.31%, volume -1.24%)
    FIELDS antenna — 88 triangles, area 0.0628 m2, volume 1.5513e-4 m3 (vs kernel: area -0.31%, volume -1.24%)
    Magnetometer boom — 88 triangles, area 0.6633 m2, volume 9.7734e-3 m3 (vs kernel: area -0.32%, volume -1.24%)
  Sling wheel [assembly, 11 children] — 146547 triangles
    Yoke — 43 triangles, area 7.6100 m2, volume 2.6660e-1 m3 (vs kernel: area +0.00%, volume -0.00%)
    Axle — 88 triangles, area 0.8615 m2, volume 3.2566e-2 m3 (vs kernel: area -0.35%, volume -1.24%)
    Hub — 276 triangles, area 2.1603 m2, volume 1.9142e-1 m3 (vs kernel: area -0.65%, volume -0.62%)
    Spoke — 88 triangles, area 0.9551 m2, volume 2.3270e-2 m3 (vs kernel: area -0.33%, volume -1.24%)
    Spoke — 88 triangles, area 0.9551 m2, volume 2.3270e-2 m3 (vs kernel: area -0.33%, volume -1.24%)
    Spoke — 88 triangles, area 0.9551 m2, volume 2.3270e-2 m3 (vs kernel: area -0.33%, volume -1.24%)
    Spoke — 88 triangles, area 0.9551 m2, volume 2.3270e-2 m3 (vs kernel: area -0.33%, volume -1.24%)
    Lander [assembly, 15 children] — 36447 triangles
      Ablator shell — 6477 triangles, area 7.0856 m2, volume 5.1674e-1 m3 (vs kernel: area -0.11%, volume -0.61%)
      HfCN hull — 7544 triangles, area 4.7145 m2, volume 6.5380e-2 m3 (vs kernel: area -0.11%, volume -0.61%)
      Coolant plenum — 6104 triangles, area 3.7287 m2, volume 1.2442e-1 m3 (vs kernel: area -0.11%, volume -0.61%)
      Insulation — 5712 triangles, area 2.6993 m2, volume 5.3206e-2 m3 (vs kernel: area -0.10%, volume -0.61%)
      Instrument core — 2208 triangles, area 1.1269 m2, volume 1.1229e-1 m3 (vs kernel: area -0.36%, volume -0.71%)
      Diamond window — 134 triangles, area 0.0374 m2, volume 4.4958e-4 m3 (vs kernel: area -0.81%, volume -0.62%)
      Magnet coil — 276 triangles, area 0.8680 m2, volume 1.1476e-2 m3 (vs kernel: area -0.08%, volume -0.62%)
      Magnet coil — 276 triangles, area 0.8680 m2, volume 1.1476e-2 m3 (vs kernel: area -0.08%, volume -0.62%)
      Magnet coil — 276 triangles, area 0.8680 m2, volume 1.1476e-2 m3 (vs kernel: area -0.08%, volume -0.62%)
      Vent nozzle — 1240 triangles, area 0.0568 m2, volume 1.5558e-4 m3 (vs kernel: area +0.03%, volume -0.32%)
      Vent nozzle — 1240 triangles, area 0.0568 m2, volume 1.5558e-4 m3 (vs kernel: area +0.03%, volume -0.32%)
      Vent nozzle — 1240 triangles, area 0.0568 m2, volume 1.5558e-4 m3 (vs kernel: area +0.03%, volume -0.32%)
      Vent nozzle — 1240 triangles, area 0.0568 m2, volume 1.5558e-4 m3 (vs kernel: area +0.03%, volume -0.32%)
      Vent nozzle — 1240 triangles, area 0.0568 m2, volume 1.5558e-4 m3 (vs kernel: area +0.03%, volume -0.32%)
      Vent nozzle — 1240 triangles, area 0.0568 m2, volume 1.5558e-4 m3 (vs kernel: area +0.03%, volume -0.32%)
    Lander [assembly, 15 children] — 36447 triangles   (children identical to the first Lander)
    Lander [assembly, 15 children] — 36447 triangles   (children identical to the first Lander)
    Lander [assembly, 15 children] — 36447 triangles   (children identical to the first Lander)
```

PASS means: the parse completes, extraction completes, Conway logs no dropped
face, every leaf occurrence has triangles, and each one's mesh area and
enclosed volume are within 3% of the kernel's exact values. The small negative
differences are the chord error of a triangulated curve.

Kernel interference check (`check_clearances.py`):

```
EXPECTED Sling wheel/Lander 1/Magnet coil A  <->  Sling wheel/Lander 1/Magnet coil B: common volume 299746.8 mm3
EXPECTED Sling wheel/Lander 1/Magnet coil A  <->  Sling wheel/Lander 1/Magnet coil C: common volume 299746.8 mm3
EXPECTED Sling wheel/Lander 1/Magnet coil B  <->  Sling wheel/Lander 1/Magnet coil C: common volume 299746.8 mm3
82 placed parts, 86 pairs with overlapping boxes checked in 41 s: 23 in contact, 3 interpenetrating by design (coil nodes), 0 interpenetrating by mistake
```

## What Conway tessellates correctly, and what was substituted

Measured on 2026-11-20 against Conway 1.1651.790 by exporting each candidate
from OpenCascade and comparing Conway's mesh with the kernel (area / volume):

| Representation | Conway's mesh vs the kernel |
|---|---|
| Plane, cylinder, tube, cone frustum, hollow frustum | within -1.1% / -1.3% |
| Full sphere, untrimmed | -0.36% / -0.71% |
| Full torus (one `TOROIDAL_SURFACE` face) | face dropped: "boundary straddles both branch cuts" |
| Torus split into 90° patches | +25% / +250% |
| Hollow sphere as `BREP_WITH_VOIDS` | -36% area: the void shell is not tessellated |
| Sphere shell with a port through it | spherical faces lost or mangled: volume -33% to -99.7% |
| Hemisphere; sphere cut by a box | face dropped; the whole sphere emitted |
| Cone running to its apex | +0.5% / -7.5% |
| Ring of revolved 12-gon section (15 mm cone bands at r = 650) | +7.3% / -0.6%: closed, but skewed triangles |
| Ring of revolved 8-gon / 6-gon section | +2.9% / +1.4% area |
| Ring of revolved square section | -0.08% / -0.62% |

So three substitutions were made:

1. **Lander shells** (Ablator shell, HfCN hull, Coolant plenum, Insulation)
   are not `SPHERICAL_SURFACE`s. Each is one solid made by revolving a closed
   polygon: latitude bands 6° wide, which are cone frustums, with a cylinder at
   the equator, a cylindrical port at +Z and a flat pad at -Z. The stated
   radii are at the band edges, so each shell's volume is about 0.3% under a
   true spherical shell's.
2. **Magnet coils** are not tori. Each is a ring of square section 53.2 mm on
   a side — the same cross-sectional area as a Ø60 round, so the volume and
   mass are a torus's.
3. **High-gain antenna** is a revolved polygon too (mast plus a parabolic
   dish in six cone bands), and every cone in the model is a frustum; flat
   caps are used wherever a profile meets the axis.

The **Instrument core is the one true sphere**: untrimmed, which Conway
handles.

## Assumptions

- Parker Solar Probe figures used as given in the brief (shield Ø2300 × 115,
  arrays 1120 × 690, 2 m FIELDS whips, 3.5 m boom); the bus, truss, radiator
  and antenna sizes are in proportion, not from drawings.
- The shield's 150 kg/m3 is chosen so a shield this size weighs about what the
  real one does (roughly 73 kg). HfCN is taken as 12,700 kg/m3, between HfC and
  HfN. The ablator is carbon-phenolic at 1,450 kg/m3; a low-density ablator
  would be about a fifth of that.
- Spokes, boom, axle, hub, yoke and truss are drawn solid and weighed at a
  stated solidity. Nothing is sized for load; a spoke carrying a 2.2 t lander
  at any useful rim speed is not a Ø100 tube.
- Colours are opaque and chosen to tell parts apart in a cut: white shield,
  charcoal ablator, silver hull, blue plenum, cream insulation, green core,
  pale-blue window, copper coils.

## Deviations from the brief, and why

- **Nested shells do not share radii.** Each inner shell's outer radius is
  2 mm under the brief's (hull Ø896, plenum Ø836, insulation Ø696), because
  two coincident surfaces of different colours flicker in a cut view. Inner
  radii, the ablator and the core are exactly as specified.
- **Insulation shell added** (the brief's option), sphere dia 696 / 616. Its inner
  diameter is 616 rather than ~600 so that the flat pad at its -Z pole clears
  the spherical core; the first build had the core 16.7 cm3 through that pad,
  which the interference check caught.
- **Magnet coils pass through each other at six nodes.** Three equal rings on
  mutually orthogonal planes about one centre cannot avoid it. A build would
  join them there or use three diameters (which would be three products).
- **Coil axes are tilted, not on the lander's axes.** They lie on the cube
  diagonal about the window axis (each 54.7° from it), so no coil crosses the
  window port, the spoke or a vent.
- **Vent nozzles (6) sit on the ablator's outer surface** at the equator,
  midway between coil crossings, not on the hull; the feed-throughs through
  the ablator are not modelled.
- **Diamond window is seated in the hull**, where it would survive ablation;
  the port continues outward through the ablator as an open well and inward
  through the plenum and insulation to the core.
- **Every shell has a flat Ø122 pad at -Z**, the mirror of the port; the spoke
  lands on the ablator's.
- **TPS truss is a closed cone shell**, wall 6 mm (the brief allowed shell or
  struts).
- **Yoke and Axle are additions.** A wheel whose plane contains the Sun line
  has to be held from the sides, so the Sling wheel gains a U-shaped yoke
  bolted under the bus and an axle through a bored hub (2 mm running
  clearance).
- **The hub is 4985 mm aft of the bus**, making the craft 11.7 m long: with
  3 m spokes the rim has to clear the yoke crossbeam (it does, by 158 mm).
- **Magnetometer boom hangs from the yoke crossbeam's -Y end**, not the bus's
  aft face: that face is inside the wheel's swept volume. It still points
  anti-sunward.
- **Choices the brief left open:** arrays canted 35° aft; FIELDS whips swept
  10° aft at 45°/135°/225°/315°; radiators at 60°/120°/240°/300°; antenna on
  the 240° flat.
- **Product structure is written through XCAF**, not `cq.Assembly`, which
  copies a sub-assembly on every `add` and would have exported four Lander
  products. Solids are still CadQuery/OpenCascade.

## Not modelled

Wheel drive and lander release, propulsion, harness, the cooling loop's
plumbing. Share clips at a cut plane rather than capping it, so a cut through
a lander shows the shells as nested bowls, each in its own colour, not as
filled sections.
