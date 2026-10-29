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
| `../../ui/RubinApp.jsx` | The app's panel: the views, a night's observing, the readout, the optics, the shell's and the path's switches |
| `../../store/rubinApp.js` | The app's ID, the `apps.rubin` token and the field's readout |
| `../observer/instrument.js` | `RUBIN`, the instrument the app makes the observer, and the field range (`instrumentFieldRange`, `clampField`) |
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

**The model** (`rubinModel.js`).  The enclosure and the dome are
primitives in metres, by the published sizes: the enclosure a 32 m
cylinder 14 m high, the 30 m dome a hemisphere with an 11 m slit from its
rim to the top, and a shutter that slides aside by the slit's width to
open (eased over a couple of seconds of wall clock,
`RubinObservatory._slideShutter`).  The telescope is **NOIRLab's model of
the Vera C. Rubin Telescope** (model3d004, credit Rubin Observatory/NSF/AURA,
mandatory and shown in the app's panel; [models.md](../models.md) has the
source, the licence and the recipe): the Simonyi Survey Telescope on its
pier, 130 named parts, 39,500 triangles, 567 KB with meshopt under
`public/large/models/rubin/simonyi.glb`, loaded through `loadModel` when
the observatory is built (the dome stands meanwhile, the mount empty).
`tools/models/obj2glb.py` groups the file's parts into `pier`, `azimuth`
and `elevation` nodes by their names, and `assembleTelescope` re-hangs
them for the mount: the model turned 180° about Y (its tube leans toward
+Z, ours toward −Z at azimuth 0), its elevation axis (7.8 m over its
origin, along X) put at the origin of the azimuth and elevation groups,
15 m over the ground (`AXIS_HEIGHT_M`, the dome's centre is 14), and the
elevation structure turned from the model's pose (45° up) to the park,
the tube along +Y, 9.6 m to its top end.  The pier runs 20 m below the
model's origin, under the enclosure and the ground.  Its paint is a
dielectric (build.sh's palette: metalness 0.05, the mirror 1): a first
cut gave it 0.4 to 0.6, and a half-metal under the Sun's one point light,
with no environment to reflect, was near black by day from 175 m with the
shell off.  And `obj2glb.py` winds each face to the file's normals, which
faced the other way from the winding on half of them: with the two-sided
material those faces were lit from the wrong side, black from both, a
speckled silhouette by day.  Its materials join
the night glow's list as they arrive.  `rubinModel.test.js` checks the
re-hang on a model of three points.  Lit by the Sun as the planets and
Webb's model are (models.md): PBR under the Sun's point light, in the HDR
buffer at the keyed exposure.  At night nothing lights it, and an unlit
surface is black, so the materials carry
a faint glow of their own colour, `NIGHT_GLOW` = 3e-6 in exposure units
over Earth's keyed exposure (a tenth of a city's lights, HDR.md: at the
dark-adapted gain of 1.4e5 beside the dome it shows at 0.4, a grey; at a
city's level it was a white blob, at a thirtieth a shadow), set
each frame as emissive over the target-keyed exposure (`ThreeUI._exposureGoal`,
without the meter's gain, which then lifts it at night as it lifts the
stars; the renderer's `toneMappingExposure` has the gain in it, and over
that the glow was absolute at the display, black): a
stand-in for the moonlight and sky glow the scene doesn't cast on it.
By day it is under a millionth of the sunlit paint and invisible.  And
**by night every mesh wears an unlit twin of its material** (`_light`:
a `MeshBasicMaterial` of the same colour and side, its colour the glow;
the Sun's own materials come back at sunrise): three's point light
doesn't know the Earth is in the way, and at midnight it lit the pier's
underside and the slid shutter from below the horizon; and a lit material
can't be made dark, since its Fresnel goes to white at a grazing angle
whatever its colour (`specularF90` is 1): black and metal, the enclosure's
rim was still a white slab at the dark gain, and the meter keyed on it
(a gain of 867 for 1.4e5).

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
the zenith).  By day, or with the body down, it parks at the zenith and
the shutter slides shut.  A 400 m beam out along the tube from its top
end shows while it tracks, so the pointing reads from beside the dome.  `rubin.test.js`
checks the frame, the angles and that the tube's +Y lands on the body;
`RubinObservatory.test.js` the group in a scene graph, with a stub model.

**The seat** (`SEAT_M`, the model's `seat` node): a viewpoint on the
telescope's elevation structure, in its frame, so it rides the pointing
and looks parallel to it, as the maintainer asked (an "astronomer's
seat").  It stands on the walkway NOIRLab's model carries on the
structure's +Z side (its `platform` and `rails1` parts: a floor at 7 to
8 m from the elevation axis, a metre above it, with rails to 3 m), at a
standing eye's height, 2.8 m over the axis and 7.3 m out, which is
outside the structure's rings (radius 6 m) and clear of the view.  The
model's bounds were measured from its vertices in the park frame
(a `Box3` of the posed parts inflates: the 45° pose turns each part's
box); the test holds the seat off the rings and inside the dome.
`Scene.rideSeat(seat, {lookAt, up})` lands the camera on Earth as `land`
does (the platform on the spun node, a drag looks around), takes it
there over the go tween looking along the tube with the site's zenith
up, and from then on puts the camera at the seat's world position each
frame (`Scene._syncSeat`, from `syncFollow`, before tracking faces the
target), so the view rides the mount as the telescope turns, with the
orientation the user's or tracking's.  In the seat ThreeUI sets the near
plane to 0.3 m (`SEAT_NEAR_M`; the floor of 100 m on Earth would clip
the parts a metre off) and leaves the ground floor alone (the seat
stands on the observatory's own ground); a wheel zoom leaves the seat
(`SEAT_ZOOM_LEAVES`), as do a go, a landing and the app's stop.  From
inside, the dome and the enclosure don't show: their materials are
front-sided, and from the seat only their backs face the camera.

**The shell** (`setShell`): the enclosure and the dome, which the app's
switch hides to show the telescope on its mount from outside (the
maintainer's ask, until the complete scene's enclosure is in).  The
`shell=0` token carries it.

## The apparent path

`ApparentPath`: for each day of the run (1 March to 1 August 2026) the
body's position from Earth's centre, in the ecliptic of J2000 (the body
by `orbitAt`, Earth by the app's ephemeris precessed back), at its true
distance (45 to 47 au), as a wide line strip on the overlay layer with the
orbit lines, the first of each month named, and a ring where the body is
at the clock's time while it's in the span.  Hung from Earth's
`orbitPosition`, turned to the date by the precession each frame as the
orbit lines are, so it stays on the stars.  A first cut laid the
directions out at a fixed 1e12 m (6.7 au), where from the ground the ring
was 1.1″ off the body, the parallax of Earth's radius at 6.7 au against
47 au, and the two came apart in a 20″ field on the preview; at the true
distance the ring is on the body from anywhere.

## The app

`RubinApp.jsx`, "Rubin Observatory" in the drawer's tray.  Opening it
asks the scene for both (`Scene.getRubin`, which polls until Earth and
the body are in, then imports `install.js`); its X, or closing the drawer
unpinned, removes them (`Scene.removeRubin`).

- **Observatory**: lands 170 m south-east of the dome, 2 m up
  (`Scene.land`), and turns to it when landed (`tweenNextFn`, a look
  tween).  170 m because the near plane's floor on Earth is 100 m
  (zoom.js `dynamicNear`); from nearer the dome clips.  It lands on the
  observatory's own ground (`land`'s `groundHeight` option, the
  observatory's `altitude`): on the preview with ion, the layer's sample
  at the viewpoint and the observatory's differed by a tile's level, and
  the visitor arrived 1.2 km over the dome (the camera at 2.954 km, the
  model at 1.717 km).  The seat sidesteps it altogether: the camera is
  on the model.
- **Astronomer's seat**: `Scene.rideSeat` to the seat, looking along the
  tube, 2026 ED138 targeted; arriving, tracking goes on if the telescope
  is tracking, so the view holds the object as the telescope does, and
  the field-of-view keys zoom into the sky it sees.  By day the seat
  looks up the parked tube at the zenith.  Targeting the body from the
  ground keyed the exposure to it, 2,200× Earth's (its sunlit surface at
  47 au), and Earth's night ground then keyed the meter at a gain of 10,
  with no stars in the sky: landed, the exposure is now keyed to the body
  the camera stands on, whatever is targeted ([HDR.md](../HDR.md#metered-exposure)).
- **2026 ED138**: targets the body and goes to it (10 radii out: a
  mottled grey ball; from there the Sun is a star of −19).
- **Its orbit**: to the Sun, 100 au out, where the line shows beyond
  Pluto's.
- **A night's observing**: a slider over the run's nights; *Watch the
  night* sets the clock to 03:00 UTC that night (23:00 at the site), runs
  it at 256× (a night in about two minutes) and takes the seat.  A
  readout a few times a second: the time, the body's altitude, the Sun's,
  the dome, the telescope's azimuth and elevation or "parked".
- **Rubin's optics**: the switch that holds the field to the camera's
  ([below](#the-optics)), and the field's readout.
- **The dome and the building**: the shell switch (`setShell`).
- **Its path on the sky**: the switch for the arc.

**From the search**: "Watch 2026 ED138 from the Rubin Observatory"
(`store/appViews.js`, [the search's views](../../search/DESIGN.md#views)):
Go opens the app and watches the night (`askRubinWatch` marks `watch` in
the app's state; the panel runs `watchNight` once the observatory is in
and clears it; it's not in the link).  "rubin" finds, in order, the
crater on the Moon, the observatory (a place on Earth), the view and the
body (the view's aliases leave out "rubin" itself, which put it first);
the places were lost to the index's rebuilds on the first search before
(search/DESIGN.md, "Places in the index").

**State in the link** (`apps.rubin`, design/URLs.md): `path=0` with the
path off, `night=<days since 1970>` for a night other than 15 May,
`shell=0` with the shell off, `optics=0` with Rubin's optics off.  The
clock is the `t=` token's, as ever.

## The optics

While the app runs, Rubin's camera is the observer: the panel makes
`RUBIN` (`observer/instrument.js`) ThreeUI's active instrument
(`ThreeUi.setInstrument`, [HDR.md](../HDR.md#the-instrument)), and the
app's stop puts the naked eye back (`Scene.removeRubin`, and the panel's
own unmount).  #334 is why: zoomed with the field keys to 0.00016°, 0.6″
across the frame, the view was 20 times past Rubin's own pixels, at a
field no telescope on Earth resolves, and there float32 at 47 au breaks
the body's disc and the lines (#338, #340).  The maintainer's direction:
the instrument's real limit, as an optional limit in the app, and the
same path for later optics (binoculars, another telescope).

**The instrument.**  An 8.4 m primary (6.4 m effective), a field 3.5°
across (9.6 deg², `fieldMaxDeg`), 0.2″ pixels (`pixelScaleArcsec`), and a
delivered image quality of about 0.7″ FWHM, seeing-limited on Cerro
Pachón (`resolutionArcsec`).  Only its field is its own for now: its
light and point spread function are the eye's, copied, so the star field
doesn't change when the app opens (a collecting area of 1, and the user's
`sm=` is still the sensitivity); the optics' PSF and the view as the
instrument sees it are #340's.

**The range.**  From the widest field, 3.5°, down to where one of the
camera's pixels is one screen pixel: with the canvas `h` device pixels
high (`renderer.domElement.height`; the camera's field is vertical),

    minimum field = pixelScaleArcsec × h = 0.2″ × h

200″ (0.056°) on a 1,000 px canvas, 100″ on a 500 px one.  Narrower than
that only magnifies pixels.  (Seeing blurs a point over 0.7″, 3.5
pixels, so a pixel is finer than anything the camera resolves; the limit
is the pixel's because the camera samples at it, and #339 draws both.)
`instrumentFieldRange(instrument, h)` gives `{minDeg, maxDeg}`, null for
an instrument with no range (the naked eye's field is free), and the
minimum never passes the maximum.

**The clamp.**  `ThreeUi.setFov` holds the field to `fieldRange()` while
the instrument has a range and its limit is on, so everything that sets
the field stops at each end: `,` and `.` (`multFov`, ×0.9 and ×1.1), `/`
(`resetFov`: 45° is past the range, so it resets to the widest field), a
link's `fov=`, the arrival of a flight.  Setting the instrument, turning
the limit on and a resize (the minimum is in the canvas's pixels) apply
it to the field already there, so opening the app at 45° takes the view
to 3.5°, and a link's field past the limit is held to it whichever comes
first, the view or the app.  The panel sets the limit before the
instrument, so a link with `optics=0` keeps its field.

**The switch**, "Rubin's optics" (`ThreeUi.setFieldLimit`), on by
default, `optics=0` in the `apps.rubin` token when off: off, the field is
free as before, through the keys and links alike, for the views from
outside (the dome from 170 m is 10° across, and the orbit from 100 au
far wider).

**The readout**, under the switch, a few times a second
(`store/rubinApp.js` `fieldReadout`): the field in degrees, arcminutes or
arcseconds as fits (`formatAngle`), with "at the widest field" or "at the
pixel limit" when the field is at an end of the range; the magnification
over the eye's 45° field (`instrumentMagnification`, 14× at 3.5°); and
one of Rubin's pixels on the screen, `0.2″ × h / field` in screen pixels
(0.0079 px at 3.5° on a 500 px canvas, 1.0 at the limit).

**Rubin's pixel** (#339, `PixelMarker.js`), a second switch, off by
default, `pixel=1` in the `apps.rubin` token when on.  The readout gives
the pixel as a number; this draws it.  At the body's place (a child of
2026 ED138's `orbitPosition`, so Animation moves it with the body each
frame, `preAnimCb` sizing it) a blunt square the active instrument's
`pixelScaleArcsec` across (Rubin's 0.2″), and round it a fainter square
outline the `resolutionArcsec` across (0.7″, the seeing), in amber, a
colour of its own (the path is teal, the orbit line blue), on the overlay
layer, drawn without a depth test over the body (at 47 au its depth is the
sky's, #334).  From the seat at the pixel limit the body's disc, 0.03″, is
a point well inside the one pixel the camera has there: the square says so
without a number.  Its size law is a pure function, `pixelMarkerSize(fovDeg,
heightPx, angleArcsec)`:

    raw     = angle / 3600 / field × canvas height      (screen pixels)
    side    = max(raw, 1)
    opacity = min(raw, 1)

so at the pixel limit the pixel is one screen pixel and the resolution
3.5, both opaque; narrower (the optics off) they grow with the field;
wider they hold one pixel and fade by the fraction, so the marker never
claims more than the instrument has (0.028 at 1° on 500 px: a ghost;
0.008 at the widest field: gone).  The resolution fades by its own
fraction, 3.5 times later.  The pixel is a filled square and the
resolution a one-pixel outline, and each is a quad whose corners the
vertex shader offsets from the body's clip position by its side in
screen pixels, so the size is exact and no GPU's point-size limit caps it
(a point sprite, as the path's ring is, would at the narrower fields); the
centre is held to a pixel's centre, so the one-pixel square covers exactly
one pixel and the 3.5 px outline is the ring of eight round it.  The
colour is a display value (`LinearSRGBColorSpace`, as the far point's), not
a hex, which the unencoded scene draws darker and redder.  An instrument
with no `pixelScaleArcsec` (the naked eye) hides it; one with no
`resolutionArcsec` has the pixel's.  `install.js` builds it with
`sceneReferred` handed in (`deps`, as the others), the panel's switch sets
`pixel.enabled`, and the app's stop disposes it with the rest.  The switch
and the token's field are the only parts in the first load.

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
KB, esbuild/budget.js: 732 then, 733 with the seat and the shell switch, 734 with the search's view, 735 with the optics: the clamp in ThreeUI, `RUBIN`, the switch and the readout, 1.1 KB; 736 with the pixel's switch and token field, 0.6 KB: 735.03 without the extra KB).  Loading the panel lazily too cost more,
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
    (the test's check, and the state's numbers).  From 170 m at bearing
    125°, into the slit, at a 22° field: the gain settled at 1.5e5, the
    enclosure and dome a grey over the black sky at the glow's 0.4, the
    shutter slid aside, NOIRLab's telescope in the slit with its top-end
    ring and camera toward the camera.  Before the unlit twins, the set
    Sun's grazing Fresnel on the enclosure's rim was a white slab that
    keyed the meter at 867.  The ground is the night floor's lavender at
    that gain, as the homepage's hold has it (AGENTS.md): not this
    feature's.
  - **The path**, from the dome up the beam at a 12° field: the arc beside
    Corona Australis and Telescopium, Kaus Australis at the edge, as
    Rubin's picture frames it; the months' names crowd at that field (the
    arc is 2° long) and separate when zoomed in.
  - **The body**: `setTarget('ed138')` and `goTo` arrive at 10 radii
    (5,000 km), 47.18 au from the Sun; the panel reads "2026 ED138, Dwarf
    planet candidate, 42.9485 AU from the Sun"; the title "2026 ED138 —
    Celestiary".
  - No shader errors.
- The seat and the field, headless as above, 2026-10-28 (the night of 15
  May, 03:00 UTC, the clock paused; the probe rode the seat at once,
  looked along the tube with the site's zenith up and tracked):
  - **The seat rides the pointing**: tracking at azimuth 123°, elevation
    35°, the camera on the elevation structure, the tube's +Y 0.0° from
    the body, 46.4 au off; the near plane 0.3 m; landed, the drag mode pan.
  - **Tracking holds the body at the frame's centre at every field**: its
    projection is within 1e-13 of the centre in normalised device
    coordinates at 45°, 5°, 0.5° and 0.05° (the `setFov` steps).  At 45°
    the telescope's upper ring is an arc across the bottom of the frame at
    the glow, the constellations and the path's crowded months above; at
    5°, a Rubin field's width, a star field to Gaia's depth, the arc with
    its months apart, the body's orbit line and the beam up the pointing;
    at 0.5° the ring at the body, the arc and its 1 May tick, one star; at
    0.05° (3′) the ring and the lines alone.  So a projection of Rubin's
    imagery over the patch (#333) has a frame to land in at any of these.
  - **The exposure**: with the body targeted the keyed exposure went to
    its, 2,200× Earth's, over the ease; now landed it stays Earth's
    (3.8e-5), and the meter settles at 5.4e5 at 45° (the glow and the
    ring in the frame) and the dark-adapted cap, 3.9e6, in the narrower
    fields, where the sky is the airglow's grey through the eye's response.
  - **The probe's own lesson** (AGENTS.md): the meter's readback lands
    between tasks.  Driven inside one task the gain sat at 37 and the
    frame was black but for the overlays, which looked like a pipeline
    fault for hours (the overlays, the near plane, the far point and the
    model were each suspected and cleared).

- Rubin's pixel (#339), headless as above at 800×500 (500 device pixels
  high), the clock paused on 15 May 03:00 UTC, in the seat tracking the
  body, a link with `apps.rubin:pixel=1` (the app opens with the switch on,
  `pixel.enabled` true, the instrument Rubin's), state read with
  `page.evaluate` and the canvas in the frame's own task, no shader errors:
  - **At the pixel limit** (0.0277778°): the pixel 1.00 px, the resolution
    3.50 px, both opacity 1; the marker's projection and the body's agree to
    1e-12 in normalised device coordinates (0 px).  The frame's centre has
    one amber pixel (the display value 0xedb665 over the blue orbit line)
    inside the faint outline's ring of eight, beside the path's teal ring;
    with the switch off the same frame has neither.
  - **At 1°**: both squares one pixel, opacities 0.028 and 0.097, no
    visible mark; **at the widest field** (3.5°) 0.0079 and 0.028.
  - The switch off sets `visible` false at once; `pixel=1` is in the
    rewritten link.  No shader errors.  Not seen on a real GPU or a phone.

- Rubin's optics (#337), headless as above at 800×500 (the canvas 500
  device pixels high, so the pixel limit is 100″, 0.0278°), 2026-10-28:
  - **Opening the app** from `#sun` at 45°: the instrument Rubin's, the
    field 3.5°.  In the seat on the night of 15 May (03:00 UTC, paused):
    "Field 3.50°, at the widest field; Magnification 14× the eye's;
    Rubin's pixel: 0.0079 px on screen"; `.` leaves it at 3.5°.
  - **`,` to the limit**: 47 presses from 3.5° to 0.0277778° (1.7′), where
    the readout says "at the pixel limit", 1,709×, 1.0 px; another `,`
    leaves it there; `/` goes back to 3.5°.  `setFov(10)` gives 3.5,
    `setFov(1e-4)` 0.0277778.
  - **The switch off**: `setFov(1e-4)` and `setFov(20)` are honoured, the
    readout loses its ends, and the link takes `apps.rubin:optics=0`; on
    again, the field goes from 20° to 3.5°.
  - **The app's stop**: the naked eye again, and `setFov(1e-4)` honoured.
  - **A link past the limit** (#334's first capture, `fov=0.0001615deg`,
    from `sun/ed138` landed at the site, `apps:open,view=rubin`): held to
    0.0277778° with the optics on; with `;apps.rubin:optics=0`, 0.0001615°
    as written, the readout "Field 0.581″", 172 px a pixel.
  - No page errors.

## Not yet

- **Rubin's light and PSF.**  The instrument has the eye's collecting
  area and point spread function (#340).  Its pixel and its seeing are
  drawn on the sky (#339, above), but only as a marker: the star field and
  the body aren't blurred to them.

- **The dome from NOIRLab's complete scene** (model3d003: the enclosure,
  dome and site, a 2 GB OBJ or a 472 MB Cinema 4D file), decimated to
  what a page can carry; the dome and enclosure are primitives until then,
  and the auxiliary telescope and the support buildings aren't drawn.
- **Animation.**  Neither NOIRLab file carries any (OBJ can't; the Cinema
  4D file might, but nothing here reads it).  The mount's motion and the
  shutter's are the app's own; the real dome's shutter and wind screen, and
  the slew between fields, are more of the same.
- **The real cadence.**  Rubin doesn't stare at one object: it surveys
  the sky in 30-second visits, and the discovery came from the
  pipeline's detections across many visits.  The demo tracks the object
  all night, to show where it is; a scheduler's pattern of visits is a
  follow-up.
- **Moonlight on the model**, in place of the glow.
- **The near plane outside the seat.**  From under 100 m the dome clips;
  a lower floor near a small object on a large body (as spacecraft get a
  hundredth of their radius) would let the visitor walk up to it.  The
  seat has its own (0.3 m); first-person controls round the telescope
  (#330) want the floor too.
- **The slit is a wedge.**  The dome's slit is a cut in the sphere's
  longitude, 11 m wide at the rim and closing at the top, where the real
  slit runs over the top at its full width; and the dome's inside isn't
  drawn (front-sided materials), so from the seat the shell is see-through
  whatever the shutter does.  The complete scene's dome (#331) replaces
  both.
- **The object's own size and albedo**, when they're measured, and its
  rotation.
- **Float32 at 47 au** ([#334](https://github.com/celestiary/web/issues/334)).
  The body's disc is a far point past 2^22 radii (`FAR_BODY_RATIO`, #338:
  its mesh blinked and drew as a crescent at a 0.00016° field), whatever
  the field.  Left: the path's ring, which jumps between frames (its points
  are a `Float32Array` at the body's distance, quantised to 5e5 m), the
  path and the orbit line missing each other by a step, and depth, which at
  the seat is 1.0 like empty sky, so the orbit line draws across the
  point.  The general fix is relative-to-eye placement, option 3 in
  [#340](https://github.com/celestiary/web/issues/340).
