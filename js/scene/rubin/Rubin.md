# The Rubin Observatory and 2026 ED138

A demo of a discovery: the NSF–DOE Vera C. Rubin Observatory on Cerro
Pachón, its Simonyi Survey Telescope following **2026 ED138**, the first
dwarf planet candidate found in Rubin's images, and the object's path on
the sky over the nights that found it.  An app in the widgets drawer
(DESIGN.md [widgets drawer and dock](../../../DESIGN.md#widgets-drawer-and-dock)),
and a body in the Sun's system.

| File | Holds |
|---|---|
| `public/data/ed138/index.json` | The body: JPL's elements, its label and kind, the discovery's facts |
| `rubin.js` | Pure: the site, the frame there, altitude and azimuth, the mount's angles, when the dome is open |
| `rubinModel.js` | The dome, enclosure and telescope from primitives, in metres |
| `RubinObservatory.js` | The model on Earth's ground, turned each frame to follow the body |
| `ApparentPath.js` | The body's apparent path on Earth's sky over the run, the months named, a ring at the clock's time |
| `install.js` | Builds both in the scene (`Scene.getRubin`), a dynamic import |
| `../../ui/RubinApp.jsx` | The app's panel: the views, a night's observing, the readout, the path's switch |
| `../../store/rubinApp.js` | The app's ID and the `apps.rubin` token |
| `../ed138.horizons.json`, `../ed138.test.js` | JPL Horizons' vectors and sky positions, and the test against them |

## The object

2026 ED138 was found by Matthew Holman (Center for Astrophysics | Harvard
& Smithsonian) on 13 October 2026, running Rubin's images of March to July
2026 through a search code of his and Kevin Napier's, and traced back
through other surveys' archives to February 2016.  The Minor Planet Center
announced it on 27 October 2026.  About 46 au from the Sun (Pluto averages
40), estimated at roughly 1,000 km across from its brightness (Mario
Jurić); a candidate until its size is measured.

**The elements** are JPL's Small-Body Database orbit solution 1 (74
observations over 3,789 days, DE441), osculating at JD 2461200.5 TDB,
heliocentric, ecliptic and equinox of J2000: a = 42.948 au, e = 0.1417,
i = 24.47°, Ω = 322.50°, ω = 167.95°, M = 128.34°, a period of 102,806 days
(281.5 years), perihelion 36.86 au (last in 1926), aphelion 49.04 au, H =
2.92.  They go in the descriptor's `orbit` in the satellite form
`meanElements.js` reads (`argumentOfPericenter`, `meanAnomaly`, `period`,
`periodOf: "meanAnomaly"`, no apsidal or nodal motion, `referencePlane:
"ecliptic"`), so the body is placed and its orbit line laid as Pluto's
are, precessed to the date each frame.

- **Against Horizons** (`ed138.test.js`): two-body motion from one epoch
  drifts from the integrated orbit as the planets' perturbations accrue,
  within 20,000 km in 2026, 5 million km by 2016 and 4 million by 2036
  (0.03 au at 47 au: 0.04° seen from the Sun).  In the discovery months
  the direction from VSOP87C's Earth is Horizons' astrometric RA and Dec
  to a ten-thousandth of a degree: RA 18h 12m to 18h 20m, Dec −42.4° to
  −42.9°, on the Sagittarius–Corona Australis border, magnitude 19.7.
- **The name** is `ed138` (a path segment and a scene name: `#sun/ed138`),
  and the descriptor's `label`, "2026 ED138", is what the label, the info
  panel and the search show.  `label` is new with this body, and
  `Spacecraft` had it already; `kind` is the panel's badge ("Dwarf planet
  candidate"), where `kindOf` had only Pluto's special case.  The search
  finds it by its aliases ("2026 ED138", "ED138").
- **Unknown, so left out**: its rotation and pole (the descriptor has no
  `siderealRotationPeriod`, and `axialInclination` is now optional, 0),
  its albedo (0.12 is what 1,000 km at H 2.92 implies) and its colour (a
  reddish-grey mottle, `public/textures/ed138.jpg`, generated: no image of
  its surface exists).

### The arc in Rubin's picture

Rubin's press image shows the object's positions from April to July
along an arc about 2° long that turns round at 1 April.  That is not a
share of its orbit: at 46 au the body moves 360° in 281 years, half a
degree in those five months, and that motion is along the arc, not
across it.  What the arc shows is **Earth's motion reflected**: the Earth
moves 1 au across the line of sight in about three months, and seen from
46 au away that shifts the object's apparent place by up to 1/46 radian,
2.5° peak to peak over a year.  Near opposition (June, with the Sun in
Gemini and the object in Sagittarius) the Earth overtakes it and it
appears to move backwards, west, through the stars: the retrograde loop
every outer body makes.  The turn at 1 April is the stationary point,
where the parallax's westward motion catches up with the object's own
eastward crawl; the run ends before the turn back east in September.
`ed138.test.js` holds the numbers: 2.1° of retrograde in RA between 1
March and 1 August against 0.5° of heliocentric motion.

The app's **apparent path** draws exactly that (below), so from the dome
you can see the arc on the sky with the orbit lines on and the body
itself at the ring.

## The observatory

**The site**: latitude −30.2446°, longitude −70.7494°, 2,663 m (Rubin's
own figures).  It's a place on Earth too (`public/data/earth/places.json`,
"Rubin Observatory", kind `observatory`, 2,663 m), so `#sun/earth/rubin-observatory`
lands there and the search finds it.

**The model** (`rubinModel.js`) is primitives in metres, by the published
sizes and the shapes the building is known by, not a survey: the
enclosure, a 32 m cylinder 14 m high; the 30 m dome, a hemisphere with
an 11 m slit from its rim to the top and a shutter that fills it; the
pier, the azimuth ring and fork; and the telescope about its elevation
axis, 15 m up: the mirror cell with the 8.4 m primary, a six-bay truss to
the top ring, the camera at the top.  About 40 meshes, five materials.
Lit by the Sun as the planets and Webb's model are (models.md): PBR under
the Sun's point light, in the HDR buffer at the keyed exposure.  At night
nothing lights it, and an unlit surface is black, so the materials carry
a faint glow of their own colour, `NIGHT_GLOW` = 3e-6 in exposure units
over Earth's keyed exposure (a tenth of a city's lights, HDR.md: at the
dark-adapted gain of 1.4e5 beside the dome it shows at 0.4, a grey; at a
city's level it was a white blob, at a thirtieth a shadow), set
each frame as emissive over the target-keyed exposure (`ThreeUI._exposureGoal`,
without the meter's gain, which then lifts it at night as it lifts the
stars; the renderer's `toneMappingExposure` has the gain in it, and over
that the glow was absolute at the display, black): a
stand-in for the moonlight and sky glow the scene doesn't cast on it.
By day it is under a millionth of the sunlit paint and invisible.

**On the ground** (`RubinObservatory.js`): a child of Earth's spun node
(`scene.objects.earth`), so it turns with the Earth, at the site in the
local frame there (`localFrameQuaternion`: +X east, +Y up, −Z north, from
the body-fixed frame of coords.js).  Its height over Earth's sphere is
the site's 2,663 m until a Cesium layer knows the terrain's height there
(`CesiumLayers.groundHeightAt`, asked about once a second, from the
tiles loaded so far), then that: the camera keeps the same height over
Cesium's ellipsoid as over the sphere (CESIUM.md), so a model at the
terrain's height over the sphere stands on Cesium's ground.  Without the
ion token the layer's ground is the ellipsoid at 0 m, and the model stands
on that.

**Pointing**, each frame before the bodies move (`preAnimCb`): the body's
direction from the dome and the Sun's (the world origin), turned into the
local frame; `pointingState` gives the altitude and azimuth, whether it can
be observed (over 20°, the Sun under −12°: nautical twilight, when the
dome opens), and the mount's angles.  The azimuth group and the dome turn
about +Y, the elevation group about its +X, the tube along +Y at the
park, so `mountAngles(el, az)` is −az about Y and −(90° − el) about X,
held to 20°–86.5° (the Simonyi telescope's range: it can't track through
the zenith).  By day, or with the body down, it parks at the zenith with
the shutter shown.  A 400 m beam out along the tube shows while it
tracks, so the pointing reads from beside the dome.  `rubin.test.js`
checks the frame, the angles and that the tube's +Y lands on the body;
`RubinObservatory.test.js` the group in a scene graph, with a stub model.

## The apparent path

`ApparentPath`: for each day of the run (1 March to 1 August 2026) the
unit direction from Earth's centre to the body, in the ecliptic of J2000
(the body by `orbitAt`, Earth by the app's ephemeris precessed back),
laid `SKY_RADIUS_M` (1e12 m, 6.7 au) out, as a wide line strip on the
overlay layer with the orbit lines, the first of each month named, and a
ring where the body is at the clock's time while it's in the span.
Hung from Earth's `orbitPosition`, turned to the date by the precession
each frame as the orbit lines are, so it stays on the stars.  From the
site the parallax of 1e12 m against Earth's radius is nothing.

## The app

`RubinApp.jsx`, "Rubin Observatory" in the drawer's tray.  Opening it
asks the scene for both (`Scene.getRubin`, which polls until Earth and
the body are in, then imports `install.js`); its X, or closing the drawer
unpinned, removes them (`Scene.removeRubin`).

- **Observatory**: lands 170 m south-east of the dome, 2 m up
  (`Scene.land`), and turns to it when landed (`tweenNextFn`, a look
  tween).  170 m because the near plane's floor on Earth is 100 m
  (zoom.js `dynamicNear`); from nearer the dome clips.
- **2026 ED138**: targets the body and goes to it (10 radii out: a
  mottled grey ball; from there the Sun is a star of −19).
- **Its orbit**: to the Sun, 100 au out, where the line shows beyond
  Pluto's.
- **A night's observing**: a slider over the run's nights; *Watch the
  night* sets the clock to 03:00 UTC that night (23:00 at the site), runs
  it at 256× (a night in about two minutes) and lands by the dome.  A
  readout a few times a second: the time, the body's altitude, the Sun's,
  the dome, the telescope's azimuth and elevation or "parked".
- **Its path on the sky**: the switch for the arc.

**State in the link** (`apps.rubin`, design/URLs.md): `path=0` with the
path off, `night=<days since 1970>` for a night other than 15 May.  The
clock is the `t=` token's, as ever.

**The first load.**  The feature loads with a dynamic import
(`install.js`), and imports nothing of the first load's but three: a
module shared between the entry and a dynamic import is split into a
chunk of its own by esbuild (AGENTS.md; the flights' lesson), and a first
cut that imported coords.js, meanElements.js, celestialFrame.js and the
marks took the first load from 11 scripts to 14, one over the homepage's
request budget.  So `Scene.getRubin` hands `installRubin` the functions
(`orbitAt`, the precession and TT, the rings, labels and line strips,
`latLngAltToBodyFixed`, the layer and the AU), and the modules here take
them as `deps`; `rubin.js` has its own radians and its own radial (the
test holds it to coords.js's).  The panel, its icon and the token's codec
are in the first load, 2 KB gzipped, which was at its budget (729 of 730
KB, esbuild/budget.js: 732 now).  Loading the panel lazily too cost more,
735 and three scripts: what it shares with the App (MUI's controls, the
camera's tweens, the store) was split out the same way.  The panel
repeats the few numbers it needs of `rubin.js` (`store/rubinApp.js`)
rather than import it; `rubin.test.js` holds them equal.

## Checked

- The tests above, and `ed138.test.js`.
- Headless Chromium on SwiftShader (640×400, `CESIUM_ION_TOKEN= yarn
  build`, the app opened from `#sun`, the clock paused), 2026-10-27:
  - **By day** (2026-05-15 15:00 UTC, the Sun at 35°): parked, the dome
    shut, the telescope at the zenith.  From 170 m on the Sun's side (the
    probe landed instant and waited for the layer's ground, 0 m without
    ion, then looked at the dome with the world's up): the lit dome and
    enclosure, the shutter's dark wedge on the north face, the horizon
    level, 2026 ED138's label 6° up where the body was.  From the shaded
    side the dome is black: nothing lights that side, so the app stands on
    the Sun's side by day.
  - **By night** (03:00 UTC, the Sun at −65°): tracking, azimuth 123°,
    elevation 35°, the dome open, the beam shown; the tube's +Y on the body
    (the test's check, and the state's numbers).  The gain settled at
    1.4e5, the dome a grey silhouette over the black sky at the glow's
    0.4.  The ground is the night floor's lavender at that gain, as the
    homepage's hold has it (AGENTS.md): not this feature's.
  - **The path**, from the dome up the beam at a 12° field: the arc beside
    Corona Australis and Telescopium, Kaus Australis at the edge, as
    Rubin's picture frames it; the months' names crowd at that field (the
    arc is 2° long) and separate when zoomed in.
  - **The body**: `setTarget('ed138')` and `goTo` arrive at 10 radii
    (5,000 km), 47.18 au from the Sun; the panel reads "2026 ED138, Dwarf
    planet candidate, 42.9485 AU from the Sun"; the title "2026 ED138 —
    Celestiary".
  - No shader errors.

## Not yet

- **A measured model.**  Rubin has published drawings and a NOIRLab 3D
  model would do better than primitives; neither was reachable from the
  sandbox (noirlab.edu and rubinobservatory.org are refused).  The
  auxiliary telescope and the support buildings aren't drawn.
- **The real cadence.**  Rubin doesn't stare at one object: it surveys
  the sky in 30-second visits, and the discovery came from the
  pipeline's detections across many visits.  The demo tracks the object
  all night, to show where it is; a scheduler's pattern of visits is a
  follow-up.
- **Moonlight on the model**, in place of the glow.
- **The near plane.**  From under 100 m the dome clips; a lower floor near
  a small object on a large body (as spacecraft get a hundredth of their
  radius) would let the visitor walk up to it.
- **The object's own size and albedo**, when they're measured, and its
  rotation.
