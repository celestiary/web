# Cesium layers — plan

A **Cesium** layer for bodies Cesium can render (Earth, and the Moon and
Mars with an ion token), and the default for them: Cesium's globe,
terrain, imagery and datasets, composited in place of celestiary's body.
Celestiary's own rendering (Bruneton atmosphere, surface textures, night
lights) stays one click away in the layers control, and is what a body
falls back to if its Cesium layer can't load.

## UX

- A Cesium-capable body is *in range* when the camera is within its mesh
  range: as far out as celestiary draws the body as a mesh rather than a
  point (the distance of the next level in its `planet LOD`,
  Planet.newPlanet; 500 radii, where it's ~1.6 px across).  Every body
  in range that can show (on screen, a few pixels across, not behind
  another body's ground: [Activation](#activation)) shows its layer,
  target or not: at the Moon with Earth targeted, both are Cesium's.
- When the target is in range, a **Layers** button for it appears in the
  top-right control stack, under the drag-mode toggle.
- Clicking it expands (Google-Maps-style) to two tiles: **Celestiary** and
  **Cesium** (default, `DEFAULT_BODY_LAYER` in LayersSlice.js). Choosing one
  applies it to that body; the choice is remembered per body for the
  session.  A body whose Cesium layer fails to load drops back to
  Celestiary, and the control shows the error.
- A body's layer is only *active* while it's in range and can show;
  otherwise celestiary draws it (Cesium is not rendered for it at all).
- While the homepage shows (DESIGN.md [homepage](DESIGN.md#homepage)) the
  layers are suspended (`CesiumLayers.suspended`, which `_wanted` reads): its
  tour passes Earth with celestiary's own Earth, and nothing of Cesium
  loads until the visitor leaves it.
- Loading (Cesium's import, the body's widget) starts when the body, or a
  moon of it, is targeted, not only once it's in range.  So does loading
  celestiary's own surface (Planet `preloadNear`), which is otherwise
  built when the camera first comes within its mesh range; until its
  colour map is in, neither the surface nor its atmosphere is drawn (a
  black ground under the haze read as a blue disc first; a flat blue disc
  with the body *behind* the camera is another bug, neither layer's: the
  atmosphere pass's shell mirrored through the eye, [composition.md, the
  ray's end](js/scene/atmos/composition.md#the-rays-end)).  In range, Cesium
  first renders unseen (no stencil) until its tiles for the view are
  loaded, and celestiary's surface and atmosphere show meanwhile; only
  then does the layer go active.  Tiles can't be fetched ahead of that:
  Cesium requests them from its render loop, for the view it renders.
- Going active, the layer crossfades in over a second (`FADE_MS`):
  celestiary's surface is drawn again over Cesium's, fading out (on its
  own three.js layer, `FADE_LAYER`, with the scene's lights).  A body whose
  Cesium layer drew its own atmosphere (`atmosphere: true` in bodies.js;
  none now) would also fade celestiary's atmosphere pass out
  (`uAtmStrength`) as Cesium's sky fades in (its `brightnessShift`).
- The button is HTML chrome, so it follows the `v` visibility group.
- Cesium's credits (required data attribution) show as a small overlay
  while a layer is active: the nearest active body's only.  Each body's
  widget writes its credits into its own container inside the overlay (one
  shared container stacked a copy per body visited).  Every widget carries
  the same ion logo and links; with two bodies on screen, the farther
  one's data attribution isn't shown.  The overlay is HTML chrome too:
  `v` hides it with the other panels.
- <a id="credits"></a>**Credits stand back after a few seconds**
  (`creditsReveal.js`): in full as a body comes into view (none to one,
  or one nearest body to another), then after 6 s compact, the ion logo
  alone at 55% opacity; a hover, a focus or a tap brings the text and the
  data attribution back for another 6 s (a tap on the compact logo doesn't
  follow its link).  While ion's data is on screen the credits stay, as
  ion's and Bing's terms want; while none of the body's ground is in the
  frame (from the ground looking up into the sky) they go entirely, and no
  logo brightens a night sky (`_creditedBody`, `visibility.js`
  `groundInView`: the view's angle to the body's centre against the
  ground's angular radius, the frame's half-diagonal and 10° for land
  standing over the horizon, so it errs toward showing them).  Back in
  view, they show in full again.  The credited body is the nearest active
  one with ground in view.  On a phone the overlay rides
  above the widgets drawer's sheet and the info panel's peek
  (`--sheet-height`, `--info-sheet-bottom`).

## Architecture

Same-page NetGL (portal-netgl ≥ 0.2.0, `makeNetGLImmediateLink`). No
iframe: Cesium runs in celestiary's page against a *shadow* WebGL2 context
on its own hidden canvas; its GL calls are recorded and replayed into
celestiary's context at a chosen point in celestiary's frame.

```
ThreeUi.renderLoop
  layers.beforeRender()          pick the active bodies; hide/show their
                                 celestiary surfaces
  render(scene) → _sceneRT       celestiary as usual (body surfaces hidden);
                                 linear, half-float, exposure units (HDR.md)
  layers.composite()             ↓ per active body, far to near
    depth _sceneRT → _cesiumRT     a copy of celestiary's depth; _cesiumRT's
                                   colour and stencil cleared
    stencil pass → _cesiumRT       WGS84-shaped shell, depth-tested against
                                   celestiary's depth: stencil = 1 where the
                                   body is visible
    link.frame(() => {             Cesium renders synchronously; each GL call
      set Cesium camera              replays into celestiary's context now
      widget.render()              ← screen draws redirected into _cesiumRT,
    })                               clipped to stencil = 1, premultiplied-
    renderer.resetState()            over blended, colour clears dropped
    decode → _sceneRT              Cesium's 8-bit frame into exposure units
                                   (decodeOf), premultiplied-over
    night lights → _sceneRT        Earth: a second frame, added (Night lights)
  ground-sphere depths           each active body, depth-tested
  _drawClouds() → _sceneRT       Earth's cloud shell, over whichever surface
                                 is there (Clouds, below)
  _updateAtmUniforms()
  render(atm pass) → screen      sky + scene × T, tone-mapped once
```

Under `?perf=1` each step is a timed pass (`cesium.blit`, `.shell`,
`.replay`, `.decode`, `.nightlights`, `.ground`; `cesium` is the
composite's own remainder), and the shadow context, the second GL context
Cesium's draws also run on, gets a timer and counts of its own
([DESIGN.md, Perf overlay](DESIGN.md#perf-overlay)).  With the `Cesium
layer` toggle off no body is wanted, so celestiary draws its own.

Why these pieces:

- **In `_cesiumRT`, then decoded into `_sceneRT`.** Celestiary's depth
  lives in `_sceneRT` (its atmosphere post-pass reads it), so the stencil
  shell depth-tests against a copy of it in `_cesiumRT`, which has its own
  depth-stencil texture; `replay.screenFramebuffer` maps Cesium's default
  framebuffer onto `_cesiumRT`.  Cesium's frames reach celestiary through
  Cesium's own 8-bit buffers (with `highDynamicRange` off, its globe-depth
  framebuffer is `UNSIGNED_BYTE`, and its final draw is a copy of it), so
  they can't hold exposure units above 1: each body's frame holds its
  imagery's stored values × Lambert, at most 1, with its distance in alpha,
  and a fullscreen pass decodes it into `_sceneRT`'s linear HDR units
  ([HDR.md](js/scene/HDR.md#cesium-in-the-same-units)).
- **One path for every body.** What Cesium loads is the data's fork: Earth
  is a globe (terrain and imagery layers), the Moon and Mars are ion 3D
  tilesets with their imagery baked in, so a globe is lit by Cesium's own
  lighting with its extras off (`litSurfaceOnly`, and
  `depthTestAgainstTerrain` for its depth), a tileset by `sunlitShader`.
  After that every body is the same: stored × Lambert, the distance stage,
  one decode (× `bodyGain`: `DISPLAY_GAIN` × `textureGain` /
  `imageryScale`, times the renderer's exposure over the body's keyed one,
  `ThreeUi.exposureOf`, so the metered gain and the easing between
  targets move Cesium's side with celestiary's; HDR.md), the terrain's
  depth from below 20 km, and celestiary's atmosphere pass where the body
  has an atmosphere.  The per-body
  differences are data in `bodies.js` (`textureGain`, `imageryScale`,
  `nightFloor`, `atmosphere`, `shellScale`).  Until #141's review the
  tilesets returned PBR Neutral of their exposure-unit value and the decode
  inverted it, and only Earth carried its distance; the Neutral round trip
  through 8 bits lost highlights, and Mars's horizon kept the bugs Earth's
  had lost.
- **Stencil, not depth, decides visibility.** Cesium's depth convention
  (log depth, multi-frustum) doesn't match celestiary's; the shell pass
  resolves occlusion against celestiary's objects (the Moon in front of the
  Earth keeps its pixels; behind it, it's covered). Cesium's final pass
  then only fills stencilled pixels.
- **No OIT.** Premultiplied-over needs Cesium's alpha to be coverage.
  Cesium's order-independent translucency composite sets alpha to 1 on
  every non-background pixel, so the faint upper sky atmosphere (alpha
  ≈ 0.01) went opaque and blacked out celestiary's stars. The widgets are
  built with `orderIndependentTranslucency: false`; they draw nothing
  translucent.
- **Zero lag.** `link.frame` renders Cesium in the same frame, from the same
  camera, as the stencil shell. A postMessage/iframe guest lags a frame and
  slides against its stencil.
- **State.** The guest's state checkpoint restores Cesium's GL state at the
  start of each frame; celestiary calls `renderer.resetState()` after.

### Camera and light coupling

Celestiary body frame (see `coords.js`): +Y north pole, +X prime meridian,
east longitude toward −Z. Cesium ECEF: +Z north, +X prime meridian, +Y 90°E.
So `ecef = (x, −z, y)`, a proper rotation. Both are in metres, scale 1.

Per frame: camera world pose → body frame (inverse of the rotating planet
node's world matrix, in JS doubles) → ECEF → Cesium's camera `position`,
`direction`, `up` and `right`, set directly; Cesium's `frustum.fov` from
celestiary's vertical fov (Cesium's fov spans the wider canvas dimension).
Cesium's globe therefore takes its position and orientation from
celestiary's body and computes neither itself: the Moon's (Meeus ch. 47
position, Cassini-law orientation; DESIGN.md
[orbital mechanics](DESIGN.md#orbital-mechanics)) carries straight over.

- Not `camera.setView`: it converts direction and up to heading, pitch
  and roll in the local east-north-up frame and back, and near pitch −90°
  (looking at the body's centre, as on arrival with `g`) that turned the
  camera several degrees.  Cesium's body then sat off the stencil shell
  and celestiary's atmosphere: a halo off to one side of Mars, and the
  Moon clipped to a lens when off-centre on screen.
- The camera's position keeps its direction from the body's centre, at the
  same height over Cesium's ellipsoid as over celestiary's sphere
  (`frames.ellipsoidCameraPosition`).  Placing it by the sphere's latitude,
  longitude and altitude instead (`Cartesian3.fromRadians`, geodetic) put
  it up to ~16 km off on the flattened Earth and Mars, about a pixel from
  orbit.

Ground: Cesium's terrain rises kilometres over celestiary's sphere (Earth's
mountains ~9 km, Olympus Mons ~21 km over Mars's datum), and zoom used to
approach the sphere, taking the camera into the ground.  While a layer is
active, the terrain height under the camera (Earth's `globe.getHeight`,
the Moon's and Mars's `tileset.getHeight`, from loaded tiles) is sampled
every 200 ms within 100 km of the surface (`groundHeight`).  Zoom
approaches that ground instead (zoom.js `groundRadius`), and after every
camera move (pan, tween, keys) the camera is lifted back to 1 m over it
(ThreeUI `_keepAboveGround`), so it rides over hills rather than through
them.  Landing on a place adds the terrain height there
(`groundHeightAt`).  The height over the sphere is the height over
Cesium's ellipsoid, since the camera keeps the same height over both
(`frames.ellipsoidCameraPosition`).  While the height is still to come
(the layer is wanted and loading, or loaded but without tiles for the
view yet: `groundPending`), the floor waits rather than lift the camera
to the sphere: a permalink from under a datum (Valles Marineris is 4-7 km
under Mars's, the Dead Sea 430 m under Earth's) was lifted to the sphere
before the tiles were in and stayed there, hundreds of metres over the
ground, so the user's below-datum views never restored (they zoomed back
down each time).  Until the tiles are in, a camera under the sphere sees
celestiary's sky over the horizon's haze (composition.md).

Lighting: celestiary's Sun is at the world origin. Its direction in the
body frame, mapped to ECEF, drives a Cesium `DirectionalLight` and
`atmosphere.dynamicLighting = SCENE_LIGHT`, so Cesium's day/night
terminator matches celestiary's no matter how celestiary's sidereal phase
relates to real time.

The Sun's falloff never reaches Cesium: its light is a direction at a
fixed intensity, its frame holds stored value × the lighting law (at most
1), and the decode scales that by the body's gain and by `exposureOf`, the
body's irradiance (`irradianceAt`) times the renderer's exposure over
π·`DISPLAY_GAIN`, which is 1 at the body's own keyed exposure whatever the
falloff.  So the inverse square (#192; Planet.md, [the Sun's
light](js/scene/Planet.md#the-suns-light-the-inverse-square)) left every
Cesium body as it was: Earth and the Moon are within 0.003 AU of 1 AU, and
Mars, at its own keyed exposure, is unchanged too; `yarn parity` before and
after agrees within its noise.

### Activation

A Cesium frame costs the same whether its body fills the screen or none
of it shows: Cesium's JS, the recording and replay, the shadow context's
draws and its checkpoint (for the Moon, headless: 22 draws, 6 full-screen
passes and 13 framebuffer switches in the replay and its decode, 21 draws
in its shadow, 79 synchronous queries; about 5 ms of the M2's frame).  So a body is active, and
Cesium renders it, only when it can show (`CesiumLayers._visibleAt`):

- **in range** (UX, above);
- **at least `MIN_PIXEL_RADIUS` (2 px) in radius**, its stencil shell's:
  under a few pixels across celestiary's own mesh shows the same;
- **not hidden behind another Cesium body's ground**
  (`visibility.hiddenBehind`): the whole shell inside that body's
  silhouette cone and past its tangent distance.  The ground is taken
  0.6% under the body's smallest radius (`OCCLUDER_SCALE`: under its
  Cesium ellipsoid's poles and its deepest land), so a body is dropped
  only when it is behind the ground whichever side of the swap draws it;
  a Moon rising is Cesium's a few degrees before it clears the horizon;
- **in the camera's frustum**, its shell's bounding sphere: not off
  screen, nor behind the camera.

Before #189 the occlusion test wasn't there, and from Earth's surface
looking down the Moon under the horizon was active (`[moon, earth]` on
the user's M2, 28 full-screen passes a frame against 15-17).  A body that
stops being active stays `shown`, so when it comes back into view it
swaps in at once, with whatever tiles Cesium still holds, as one coming
on screen always did; a body never shown warms up first (UX, above).

### What changes while a Cesium layer is active

- The body's celestiary surface group (surface, atmosphere shell, axes) is
  hidden.  Earth's cloud shell isn't in it: it's drawn after the composite,
  over Cesium's globe as over celestiary's sphere (Clouds, below).  Its place labels stay: they draw in the overlay pass
  after the composite (no depth test, a back-hemisphere discard in the
  shader), so they sit over Cesium's globe and drop off its far side
  ([#172](https://github.com/celestiary/web/issues/172); `_hideSurface`
  hid them until then, from when they drew in the main pass, under
  Cesium's globe).  The declutter that thins touching labels
  ([DESIGN.md](DESIGN.md#declutter)) runs on the sheets as they are, once a
  frame before the overlay pass, and doesn't read the layer's state, so the
  same labels are drawn with a layer on and off, from the same catalogues
  ([places.md](js/scene/places.md#the-gazetteer)).
- Earth and Mars keep celestiary's atmosphere post-pass, over Cesium's
  surface (see Atmospheres).

### Data

- Earth: the globe starts on the plain ellipsoid with the simulation
  month's Blue Marble as its base imagery, bundled with celestiary and cut
  from the same mosaics as its own Earth texture (bodies.js
  `monthlyImagery`; Planet.md), so the two match across the swap.  Two
  layers: the month's 4096×2048 map, the file celestiary's own Earth is
  textured with (given as a `blob:` URL of the download celestiary's Earth
  and the clouds already share, `sharedImage.js`, so no request of its own),
  over the whole globe, and over it the 512 px tiles, levels 0-3, only from globe
  level 3 (`fromLevel`; the tiles' levels 0-2 are no sharper than the map,
  and took ten requests, popping in as they came).  When the month changes,
  the new month's two layers go in above the old, which are dropped once
  the tiles and the map are in.  With a Cesium ion token, ion's World
  Terrain loads with the globe, and ion's world imagery (Bing) adds detail
  from globe tile level 5 (`detailFromLevel`), below which the base's ~5 km
  texels would show: from orbit the Earth is Blue Marble.  Bing is
  requested only once the camera is near ([Cesium ion
  sessions](#cesium-ion-sessions)); the terrain is not, since it gives the
  globe its lighting ([Earth's lighting needs the terrain](#earths-lighting-needs-the-terrain)).
  If the token can't reach one (no network, a token scoped to other assets,
  or a 401 or 403 from the account's quota) the globe keeps its offline
  surface.  (Sentinel-2 was the choice for the detail layer, but isn't in
  ion's asset depot for this account.)  (Passing CesiumWidget
  `terrain: Terrain.fromWorldTerrain()` instead leaves the globe with no
  terrain, drawing nothing, until ion answers, and forever if it fails.)
- Earth's city lights: NASA GIBS's VIIRS Black Marble (the 2016 composite),
  WMTS in Web Mercator, levels 0-8 of 256 px PNG tiles (~600 m a pixel at
  the equator), as a Cesium imagery layer on the globe (bodies.js
  `nightImagery`).  Needs no token, and is public domain (NASA); fetched
  from `gibs.earthdata.nasa.gov`, which sends CORS headers.  Drawn by a
  pass of its own, not through the globe's lighting: see Night lights.
- Earth's clouds: NASA GIBS's daily true-colour mosaics, fetched and drawn
  by celestiary, not Cesium (Clouds, below; Planet.md).
- Moon, Mars: Cesium ion 3D-tiles datasets, token only (see Phases).
- Token: build-time `CESIUM_ION_TOKEN` env var → `__CESIUM_ION_TOKEN__`,
  set from the repository secret of the same name.  It ships in the page,
  so restrict it on ion to celestiary's URLs, with World Terrain, the
  default imagery, Moon Terrain and Cesium Mars in its assets.
- Cesium is dynamically imported the first time a Cesium layer comes into
  range, so views away from Earth, the Moon and Mars don't load it. Its static assets (Workers, Assets,
  ThirdParty) are copied into `docs/cesium/` by the build;
  `window.CESIUM_BASE_URL` points there.

### Cesium ion sessions

Cesium ion bills two ways, and the account's monthly quota counts both:

| Asset | What | Billed by |
|---|---|---|
| 2 | World Imagery (Bing Maps Aerial), Earth's detail layer | **sessions**: every viewer that requests the asset's endpoint (`/v1/assets/2/endpoint`) opens one, however little it draws |
| 1 | Cesium World Terrain, Earth | data streamed |
| 2684829, 3644333 | Cesium Moon Terrain, Cesium Mars (3D tiles) | data streamed |

In October the account hit 1038 imagery sessions of a 1000 quota in a week
(data was 4.8 of 15 GB).  Earth's layer used to request Bing as soon as
Earth, or the Moon, was targeted, so nearly every page load near Earth,
and every headless test run, cost a session.

The rule: **Bing is requested only when the camera is close enough to
need it, and kept for the page's life** (`CesiumLayers._requestIon`,
`cesium/ionImagery.js`).  Earth's base is the bundled Blue Marble, whose
finest level has 8192 texels around the equator (~4.9 km, `baseTexelMeters`),
and Bing adds nothing until those spread over more than a couple of
screen pixels:

- The threshold altitude is `texel / (MAX_BASE_TEXEL_PX × pixel angle)`
  (`ionImageryAltitude`): where the ground a pixel spans at the nearest
  ground (altitude × angle) is a texel over `MAX_BASE_TEXEL_PX` (2).  The
  pixel angle is the field of view over the canvas's height, so it is
  derived, not fixed: about 2,400 km at 45° on an 800 px canvas (890 km
  at 300 px, 6,400 km at 2,160 px), and ~85 km at 170°.  It starts roughly
  2x before Cesium itself switches to the detail layer (tile level 5), for
  ion's answer and the first tiles to arrive.
- **Narrow fields use the pixel's ground size, not the altitude alone.**
  The angle is floored at `MIN_PIXEL_ANGLE` ([detail at narrow fields of
  view](#detail-at-narrow-fields-of-view), #176), the finest Cesium is
  asked for, so the threshold rises no higher than ~24,000 km however
  narrow the field.  A telescope on Earth from the Moon (~400,000 km, a
  21″ pixel spans ~38 km) never asks for Bing: Blue Marble's 4.9 km texels
  are far under a pixel.
- Terrain is not deferred: it is billed by data, not sessions, and it is
  what lights the globe ([below](#earths-lighting-needs-the-terrain)).  It
  was requested with the imagery in the first version of this change, and
  the night side then showed the day surface.
- Once requested, the imagery stays, however the camera moves: a
  re-request may open another session.  The layer is inserted under the
  night lights layer, above the base.
- A failure degrades quietly to the base.  ion refusing the endpoint
  (a 401 or 403 from the token or the quota, or no network) fires the
  layer's `errorEvent`, which removes the layer; Bing's tile errors do not
  retry, and a 401 or 403 from them removes it too.  One `console.warn`
  line says the HTTP status and nothing else: ion's error bodies echo the
  access token, so the error object is never logged.  The globe keeps the
  Blue Marble, and the ellipsoid if terrain failed.
- Without a token (`CESIUM_ION_TOKEN` empty at build time) none of it is
  requested, and the Moon and Mars aren't offered.

Counts of requests to `api.cesium.com/v1/assets/2/endpoint` per page load,
with ion stubbed in Playwright (a dummy-token build; 480x300):

| View | Before | After |
|---|---|---|
| Default landing (`#sun`) | 0 | 0 |
| Earth targeted (`#sun/earth`, 57,000 km) | 1 | 0 |
| Earth from 20,000 km | 1 | 0 |
| Telescope (0.01°) on Earth from the Moon | 1 | 0 |
| Earth from 1,500 km | 1 | 0 |
| Earth from 600 km | 1 | 1 |
| Landed, 10 km | 1 | 1 |

Testing doesn't need the token: AGENTS.md ("Build for testing without the
ion token") has builds made without it, and `yarn parity` for PRs that
change Cesium rendering only.  To test the ion paths for free, build with
a dummy token and answer `api.cesium.com` with a stub in `page.route`.

### Earth's lighting needs the terrain

The first version of the ion-sessions change deferred the World Terrain
with the imagery, and from orbit the Earth's night side showed the day
surface, dimly, with the city lights gone under it
(PR #202's review).  Cesium lights a globe two ways
(GlobeFS.glsl):

- With terrain that has vertex normals (ion World Terrain, requested with
  `requestVertexNormals`), `ENABLE_VERTEX_LIGHTING`: colour × `clamp(Lambert ×
  lambertDiffuseMultiplier + vertexShadowDarkness)`, which `litSurfaceOnly`
  sets to Lambert × 1 + 0: dark on the night side, as celestiary's own.
- On the plain ellipsoid, `ENABLE_DAYNIGHT_SHADING`: colour × `clamp(5 ×
  Lambert + 0.3)`, hard-coded in Cesium 1.145.  The 0.3 is the floor that
  the surface shows by, all over the night side, and, as the meter takes the
  night side's brightness for the scene's, it dims the exposure the lights
  are seen at.  No globe setting reached it, so we patch Cesium (Patching
  Cesium, below): the floor is `vertexShadowDarkness` and the multiplier a
  new `dayNightLambertDiffuseMultiplier`, which `litSurfaceOnly` sets to 0
  and 1, Lambert on the ellipsoid's smooth normal.

So the terrain isn't a detail layer: its normals are what the globe's
lighting is.  It is requested with the globe (`_createWidget`), as before the
change; it is billed by data, and coarse terrain tiles from orbit are a
few hundred KB.  Until it answers, and for good if ion refuses it (a token
not scoped to asset 1), the globe is on the ellipsoid and shows the floor:
a dark night side, lit as the terrain's is but without its slopes.  (Before
the patch it was a 0.3 night side.)

Measured (headless Chromium, 640×400, 30,000 km, Earth's own imagery from
the bundle and ion's imagery refused):

| View | Terrain deferred (the PR's first version) | Terrain with the globe |
|---|---|---|
| Night side, from the anti-solar side | the day surface, lit all over, no lights | the lights over Europe and North Africa; matches celestiary's Earth |
| Terminator, Sun at 90°: mean luma of the night half's disc | 5.3 of 255 (continents visible 50° into the night) | 0.0 |

The Blue Marble layers have no gap or seam round the globe: eight views 45°
apart at 20,000 km, by day and by night, are continuous, and match
celestiary's (the sphere's) side.  What the review saw as the texture not
reaching round was this lit surface.

Blue Marble's first load, the requests for `blue-marble/` files (the
browser's cache live; 640×400 unless said):

| View | Before | After |
|---|---|---|
| Earth targeted, 57,000 km | 1 (celestiary's map) | 1 |
| 20,000 km | 3: the map and the two level 0 tiles | 1: the map |
| 20,000 km, 1280×800 | 3 | 1 |
| 4,000 km | 11: levels 0, 1 and 2 | 12: level 3 |
| 4,000 km, 1280×800 | 23: levels 0 to 3 | 24: level 3 |

(And the level 1 tiles, four a hemisphere, that the review saw popping in on
the first zoom, come with a closer or a larger view.)

### Atmospheres

- Earth: celestiary's Bruneton pass runs over Cesium's globe, as it does
  over Mars's tiles: one atmosphere, in celestiary's exposure units, on both
  sides of the swap ([HDR.md](js/scene/HDR.md#cesium-in-the-same-units)).
  Cesium's globe draws only its lit surface: stored value × Lambert
  (`litSurfaceOnly`: light intensity 1, `lambertDiffuseMultiplier` 1,
  `vertexShadowDarkness` 0), no ground atmosphere, fog or water effect,
  and the composite applies `DISPLAY_GAIN`.
- **Terrain depth.**  The pass needs to know where Cesium's terrain is and
  how far: its terrain rises over celestiary's sphere, and a ridge seen
  from a valley sits above the sphere's horizon, where the pass took it
  for sky and painted it over (the first cut of #141 did, with a straight
  "horizon" across the mountains).  Cesium's depth doesn't reach
  celestiary (its frames arrive through its 8-bit colour buffer), so a
  Cesium post-process stage (public API, with the scene's depth texture)
  writes each pixel's distance from the camera into alpha, which is
  otherwise always 1 on the opaque globe or tileset, for the bodies under
  celestiary's atmosphere (Earth's globe, Mars's tileset; bodies.js
  `terrainDistance`), encoded as 1 − e^(−d/D) in 8
  bits and dithered (`cesium/distance.js`; D grows with the camera's
  height).  The composite's decode pass turns it back into celestiary's
  depth (written whatever the depth buffer holds: the stencil shell has
  already admitted only pixels where nothing celestiary drew is nearer; a
  real depth test there let lines and points behind Earth show through
  the globe), and the atmosphere pass hazes the terrain for that
  distance (aerial perspective; composition.md), with the camera below
  20 km: from higher up the ridges that matter are a pixel or two, and 8
  bits over the ground in view are too coarse (from 37 km, the first cut
  drew rings of speckle in the ground's haze), so the ground sphere's
  exact depth serves, as before.  The globe needs
  `depthTestAgainstTerrain`: without it Cesium clears the globe's depth
  once drawn and draws the ellipsoid's instead (its depth plane), so the
  stage read the ellipsoid below the horizon and the cleared far plane
  above it, and every ridge came out at the encoding's limit (7 D, ~310 km
  from 6.5 km up, where they were 3 to 25 km off).  Not during the
  crossfade, while celestiary's own surface, at the sphere, is drawn over
  it: a ridge above the sphere's horizon shows as sky until the crossfade
  ends (1 s), then as terrain.  While the terrain's depth is written, the
  body's ground sphere's isn't (`_writeGroundDepths`): Mars's terrain lies
  mostly below its datum, and the sphere's depth, nearer, had covered it,
  and the band between the terrain's horizon and the sphere's, where
  Cesium draws nothing, read as ground with the stars through it.  Left
  without depth, the pass takes that band for a gap in the ground and
  draws the horizon's haze there.  A pixel whose terrain is too far to
  encode (the top two levels, 5.5 D and up: 220 km from the ground) is a
  surface 5.5 D away, hazed as one, which at that distance is the
  horizon's haze.  The first cut gave it the ground sphere's depth where
  the ray met it: from 6 m up a ray under the sphere's horizon meets it
  170 m off, so mountains 150-280 km away on Mars's horizon were drawn
  dark and near, in fragments with dithered edges where the code crossed
  into the top level, and more of them as the camera dropped (D shrinks
  with height; `horizon-terrain-far` in the parity views).  A camera below
  the datum is the atmosphere pass's to handle: it marches the ray to
  where it leaves the sphere and takes the tables from there, and the
  band between the terrain's horizon and the sphere's is the horizon's
  haze on the sky side of the tables by construction, not by rounding
  (composition.md, "The tables' domain"; on a real GPU it flickered black
  while that was rounding).  The volumetric clouds read this depth too:
  their half-size march ends each ray at it, and the composite reads
  their target depth-aware, taking only the texels whose ray ended on the
  same surface within 10% (the dither's level is a few percent), so cloud
  light doesn't cross a ridge's silhouette
  ([atmos/clouds.md](js/scene/atmos/clouds.md#in-the-air)).  A float or 16-bit depth from Cesium would do better than 8 bits:
  portal-netgl could expose the host object a guest texture replays to
  (Cesium's globe depth texture), or give screen draws a depth attachment
  of their own (its "guest-private depth" roadmap item).
- Until #86's PR A, Earth used
  Cesium's own sky and ground atmosphere (`atmosphere: true`): from orbit it
  applied `1 − e^(−2x)` to the lit surface plus its haze, and below
  `lightingFadeOutDistance` (10,000 km from the centre) it faded its ground
  atmosphere out altogether, so from 400 km the ground showed unhazed and
  brown where celestiary's was blue; and its translucent sky covered the
  daytime Moon.  The mechanism was already checked on Earth for Mars
  (Phase 4, below).
- Mars: Cesium has no Mars atmosphere (its sky atmosphere is Earth's and
  its ground atmosphere needs a globe), so celestiary's Bruneton pass runs
  over the Cesium layer, as over Earth's globe (one path, above).
- The pass reads `_sceneRT`'s depth: where each ray ends (an object in
  front of the atmosphere, like Phobos before Mars, gets none of it), and,
  inside the atmosphere, ground from sky (ground-ray pixels whose depth
  reads as background are taken for mesh gaps and hazed over).
- Each Cesium frame clears its target's whole depth buffer: `_cesiumRT`'s,
  a copy of celestiary's, so `_sceneRT` keeps celestiary's depth.  Then
  each active body's ground sphere (its celestiary radius, the sphere the
  pass integrates against) is drawn into `_sceneRT` depth-only,
  depth-tested: whatever celestiary drew in front of the body keeps its
  depth.
- Active bodies still composite far to near: a body's own pixels hold no
  depth until the ground spheres go in at the end, so a nearer body is
  drawn after, and over, a farther one.
- The pass's lookup-table path used to ignore where the ray ends, so
  Phobos in front of Mars was hazed by Mars's atmosphere, over
  celestiary's Mars too.  It now passes the scene through when the pixel
  is nearer than the ray's atmosphere entry, with the linearised depth
  (view-space z) divided by the ray's cosine off the view axis to compare
  distances along the ray.

### Night lights

Earth's city lights are the same data as celestiary's, NASA's Black Marble
(Planet.md, texture_night), at the same scale, as emitted light in exposure
units: `NIGHT_LIGHT_RADIANCE` (`exposure.js`) of a sunlit white for a texel
of full white, times the renderer's exposure, times `smoothstep(−0.05, 0.05,
−N·L)`.  Celestiary adds them in its surface shader; Cesium's side is its
own frame (`CesiumLayers._drawNightLights`).

**Why not Cesium's `nightAlpha`.**  The plan was a night layer shown only
by dark: `dayAlpha` 0, `nightAlpha` 1.  It can't work here, for two reasons
(GlobeFS.glsl):

- Cesium blends the imagery, choosing between a layer's day and night alpha by
  `1 − clamp(5·N·L, 0, 1)`, and then multiplies the *blend* by its lighting:
  `clamp(N·L · lambertDiffuseMultiplier + vertexShadowDarkness, 0, 1)`
  (0.3 more on the plain ellipsoid).  The night alpha only picks which
  imagery is there to be lit; and the lit surface here is `stored × Lambert`
  with no ambient (`litSurfaceOnly`), 0 on the night side.  The lights are
  multiplied away, or, with an ambient to carry them, tinted and capped by
  it, and the day side's Lambert is bent with them.
- Cesium's frame reaches celestiary through 8 bits ([HDR.md](js/scene/HDR.md#cesium-in-the-same-units)),
  the lit surface up to 1, where the lights are 4.5e-5 of a lit white: a
  light that is bright after the night's gain (up to 4e6) is under a level
  of the day's.  They can't share the frame's channels, and the alpha holds the
  terrain's distance.

**What it does.**  The Black Marble is an imagery layer on the globe at
alpha 0 (`addNightLights`): the day frame skips it (Cesium draws no layer at
alpha 0), and its tiles load all the same.  After the body's day frame is
decoded into the scene buffer, a second Cesium frame renders the globe with
lighting off, every other layer at alpha 0 and the night layer at 1, on a
black base: the layer's stored values, opaque where the globe is.  Only its
colour clears from `_cesiumRT`, so the day frame's stencil still limits it,
and it runs after the day decode, not before: the decode wrote the terrain's
depth, which the stencil shell's depth test would otherwise hit from inside
the shell (below 64 km).  A second decode adds it to `_sceneRT`
(`newLightsMaterial`, blending One, One, no depth): `texel × nightFactor ×
nightLightRadiance() × toneMappingExposure`, with the stored value read as
celestiary reads it (no sRGB decode), and `nightFactor` from the same
smoothstep on each pixel's N·L, taken from the view ray against the body's
sphere, as celestiary's surface does from its sphere's normal.  So the lights
join the scene before the atmosphere pass, which dims them by the same
transmittance on both sides, and before the meter, which reads them as scene
luminance.

**When.**  The pass is a second Cesium frame of the globe (on the user's M2,
7-11 ms of CPU and 64 draws, in every view), so it runs only where it can
show (`CesiumLayers._lightsShow`):

- **Some of the night side is in the frame** (`frames.nightInView`).  The
  pass computes each pixel's normal from its view ray against the sphere,
  and that normal depends only on the ray's angle off the nadir and its
  azimuth about it; the frustum's range of both bounds every normal the
  pass can compute, and so the least N·S, against the band's edge at N·S
  0.05.  Conservative (a test checks it against a dense grid of rays from
  random views), and tighter than the cap test it replaced
  (`frames.nightVisible`, which ignored the frustum and still serves a
  camera under the datum): facing a low Sun by day, or from orbit with only
  the day side in the frame, no night is in view.
- **The lights can reach half a display step**: the brightest a full-white
  texel fully on the night side can add, `nightLightRadiance()` × the
  exposure, is at least 0.5/255.  The atmosphere pass only dims it (T ≤ 1)
  and the tone map's slope is at most 1, so under that no pixel moves by
  more than a level.  By day, at the keyed exposure, the lights are 4.5e-5:
  from orbit over a gibbous Earth they're there, and invisible.  Except on
  the frames the meter samples (every `METER_EVERY_FRAMES`, as
  `ThreeUi.isMeterFrame` says: `MeterCadence` in `meterReadback.js`, which
  `ThreeUi._meter` advances, so the two can't drift; a test holds them
  together): it takes each pixel's log, and on black ground a light far
  under a display step is far over its floor, so skipping them there would
  move the gain.  Those frames draw them, and the meter reads what it did
  before; its asynchronous readback takes that frame's pixels a frame or
  more later ([HDR.md, the meter's readback](js/scene/HDR.md#the-meters-readback)).

Where it must run, it runs at full resolution and every frame.  Its cost
is a whole Cesium frame's CPU (Cesium's JS, the recording and replay, the
checkpoint's queries), which a smaller viewport doesn't change, and a
lower rate would let the lights lag the ground as the camera moves, a
visible smear at a city's scale.  Its full-screen distance stage is
wasted in it (the decode reads alpha only to drop empty pixels), but
turning a Cesium post-process stage off and on each frame makes Cesium
release and recreate its post-process framebuffers both times, which
costs more than the pass.

During the crossfade the surface fading over Cesium's layer carries
celestiary's lights, and the blend does the rest.

**Resolution.**  GIBS's level 8 is ~600 m a pixel; celestiary's texture is
3600×1800 (11 km).  From 4,000 km they agree pixel for pixel; from 400 km
Cesium's lights are sharp (Rome, Naples) where celestiary's are a blur, and
the two agree in the region's mean (`earth-night-dusk`) and not in its
pixels' median (0.69).

**Clouds** dim the lights under them, on both sides alike: the cloud shell
is drawn over the scene buffer after this pass (Clouds, below).

**Not done.**  The layer isn't offline (GIBS is a network host, like ion's imagery, and a failed tile
is black: no lights there, a warning logged once); GIBS's imagery is a
picture, not calibrated radiance, so the scale is calibrated by eye
(Planet.md, brightness).

### Clouds

Earth's clouds (#88) are one shell, celestiary's, drawn over both sides of
the swap: the simulation date's NASA GIBS true-colour mosaic, unmixed into
cloud coverage over the month's Blue Marble, on a sphere 6 km up, lit by
the Sun in exposure units (Planet.md, "Clouds", for the data and the
drawing).  ThreeUi draws it into `_sceneRT` after `layers.composite()`,
before the atmosphere pass, so:

- there is one cloud renderer and nothing to match: not a Cesium imagery
  layer, which would come through Cesium's lighting and its 8-bit frame
  (the night lights' problem) and would need matching to celestiary's;
- it covers Cesium's globe, celestiary's sphere and the crossfade between
  them alike, and the night lights both sides drew under it;
- it depth-tests against the depth the composite left (the ground sphere,
  or the terrain's from below 20 km), and writes none: the atmosphere pass
  hazes a cloud as the ground under it;
- its alpha is coverage, premultiplied-over (portal's alpha contract),
  though nothing composites `_sceneRT`'s alpha after it.

The shell fades out below 30 km and is gone at 10 km (the far field).
Across that band the volumetric clouds take over (#169;
[js/scene/atmos/clouds.md](js/scene/atmos/clouds.md)): a ray march into a
target of its own, seeded by the same map, which the atmosphere pass
composites in the air over whichever surface is there.  It reads the
scene's depth after the composite, so Cesium's terrain (and from below 20
km its own depth) ends its rays and takes its shadow as celestiary's sphere
does; the `earth-clouds-volume` parity view (below) holds the two sides
together at 12 km over the Gulf.  The low views that predate it (the
terrain and the twilight ones) are on dates and places without cloud in
the map, so they are unchanged.

### Tiles and lighting (ion 3D tiles)

- Celestiary's bodies turn under its camera, so Cesium's camera moves
  every frame.  The tilesets' `foveatedScreenSpaceError` and
  `cullRequestsWhileMoving` optimizations wait for the camera to stop
  before requesting detail, so they're off: detail loads at any distance.
- `maximumScreenSpaceError` 8 (Cesium's default is 16): sharper imagery
  and terrain, for about four times the tiles.
- The tilesets are unlit.  A custom shader lights them by celestiary's
  Sun (Cesium's `scene.light`) on the smooth sphere, for the terminator:
  Mars by Lambert's law, the Moon by the lunar photometric function its
  mesh in celestiary has too (`photometry: 'lunar'`; `lunarPhotometry.js`,
  one GLSL chunk in both shaders; Planet.md, [the Moon's
  photometry](js/scene/Planet.md#the-moons-photometry)): lunar-Lambert
  with its phase function fitted to Horizons' V(1, α), μ and the phase
  angle from the fragment's position in eye space, and the Moon's normal
  with its slopes from the LOLA normal map (Relief on the Moon's tiles,
  below).  Not on the terrain: the tilesets have no normals, and
  normals from screen-space derivatives of position are flat per triangle.
  The terrain meshes are much coarser than their imagery, so lighting them
  outlined every triangle, from orbit (worst at the terminator) down to
  46 km on the Moon, while the imagery already carries the craters'
  shading.
- From out of range down to the surface, Cesium's camera far plane is
  raised past the body (its default, 5e8 m, would clip the Earth beyond
  ~80 radii).

### Relief on the Moon's tiles

The Moon's tileset shader lights the sphere with the slopes of the same
LOLA normal map celestiary's own Moon uses (`moon_normal.jpg`, #199;
[Planet.md, Relief](js/scene/Planet.md#relief)), so the terminator seen from
Earth is rough with crater walls in light and shade on both sides of the
swap (#192).  `js/scene/cesium/relief.js` holds it: the shader function
`reliefNormal`, and its JS mirror that the unit tests run at known points.
`sunlitShader` takes the map as a `TextureUniform` (`u_reliefMap`, from
`CESIUM_BODIES.moon.relief`, mipmapped, 4× anisotropic), loaded by Cesium
when the shader is made, so no image load is on a path a test drives; until
it is in, Cesium binds a 1×1 default and the shader keeps the smooth
sphere's normal.  `u_reliefScale` (0 to 1, 1 by default) scales the effect
as a whole, for before-and-after renders; at 0 the frame is the same,
pixel for pixel, as without this.  Mars has no map and its shader is
unchanged.

- **Coordinates.**  A fragment's `positionWC` is in the Moon's ECEF frame,
  the one `frames.js` maps celestiary's body frame to (+X through 0°,
  +Y through 90°E, +Z north; Cesium's Moon ellipsoid is a 1,737.4 km
  sphere, as the map's).  Longitude is `atan2(y, x)` and latitude
  `asin(z / |p|)`, planetocentric as the map is; the map is
  equirectangular with -180° at its left edge and +90° at its top, so its
  centre column is the prime meridian and east runs right, like
  `moon.jpg`.  Cesium uploads a texture flipped, so the shader's v counts
  from the bottom.  The tangent frame is east = Z × p (normalized), up =
  p / |p|, north = up × east; a texel's x, y, z (as in the map: east,
  north, out) are along those.
- **Checked on craters.**  The map's own texels at Tycho (43.3°S, 11.2°W),
  Copernicus (9.6°N, 20.1°W) and Aristarchus (23.7°N, 47.4°W) show the
  crater signature with the convention above (a wall rising east has its
  normal tilted west: mean x -0.17, -0.11, -0.12 on the east half of each
  rim, +0.14, +0.11, +0.17 on the west; `relief.test.js` holds the texel
  positions, 960/758, 909/457).  In the render, Tycho sits on its
  imagery's crater, its walls and central peak shaded where the imagery
  draws them, and every lit rim and shadowed wall along the terminator in
  the user's view of #192 lands on the same one in celestiary's own
  Moon, which takes the map through three's tangent frame, an independent
  implementation.  Over the `moon-quarter` view the detail (a 5 px
  high-pass) of the two renders correlates 0.86, 0.76 and 0.75 where
  celestiary's luma is 12-60, 60-120 and 120-255 of 255, from 0.76, 0.65 and
  0.70 before.
- **Both lights.**  The shader's `normal` (the map's normal in view space)
  replaces the smooth `up` as `sunlitLaw`'s `n` for the Sun and for
  earthshine (`_setEarthshine`'s direction, unchanged), so the earthlit
  side shows its craters too.  For the Moon that law is the lunar
  photometric function (The Moon's photometry, below), and both its
  cosines, μ0 and μ, are taken against the map's normal, as celestiary's
  Moon takes them against its normal-mapped one; the phase angle is the
  fragment's, which relief doesn't change.  The log encoding after it is
  untouched.
- **Mip levels, not the geometry.**  The map is read with `textureGrad`, its
  gradients taken from the continuous unit position, not from `atan`'s
  seam at ±180°, which a plain `texture` would take for a huge
  minification and show as a line.  Where a pixel spans several texels
  (the whole disc at 45°) the mip chain gives the average slope, renormalized.
- **Scale.**  The tiles' own geometry plays no part: the shader never took
  a normal from it (above; the tilesets have none), so there is no
  geometric normal to blend the map out against and nothing is counted
  twice.  The scale limit is the map's: 5.3 km texels, which at the user's
  views (4.6-6.7 km a pixel) are about a pixel, and which, magnified,
  would show as bilinear blocks over imagery that stays sharp.  So the
  effect fades with magnification (`reliefStrength`): full to 2 pixels a
  texel, gone from 8.  At 45° over a 625 px canvas a pixel is 0.0013 of the
  altitude, so from 700 km up it is 0.9 km (6 pixels a texel: 15% of the
  slopes), and from 100 km, 40 pixels a texel: none.  Near the surface the
  imagery's own shading is what carries the craters, as before.  (A
  4096×2048 map, Planet.md, would hold the same fade to twice the
  nearness.)  The imagery has the WAC mosaic's own lighting baked in, so
  where both show, the two add; the same holds for celestiary's own Moon.
- **Parity.**  `yarn parity --only moon-quarter,moon-labels`: `moon-quarter`
  ratio 0.985 (it was 1.000 on `main`, measured the same day), profile
  19.0 / 5.07 (was 18.4 / 4.90), inside the 0.97-1.03 and 30 / 8 bounds;
  `moon-labels` passes (3,608 label pixels).  The profile's absolute
  differences rise a little where the terminator's relief is now in both
  renders, a few pixels apart: the features are 1-2 px at 300 px, and a
  feature misregistered by a pixel counts against both.  Over the lit disc
  relief brightens the mean by 0.8% on either side (a 480×300 render of
  the view); the median per-pixel ratio, relief over smooth, is 1.007 on
  celestiary's Moon and 1.000 on Cesium's, so Cesium over celestiary at the
  median goes from 1.000 (smooth against smooth) to 0.987 (relief against
  relief).  It is within the band and not chased; `imageryScale` stayed 0.78.
  With the lunar photometric function on both sides (#205; The Moon's
  photometry, below), measured the same day against #205 alone:
  `moon-quarter` median 1.000 on both (the fit's criterion), the ratio of
  the lit disc's means 1.017 (1.008 without the tiles' relief), profile 5.2
  / 1.83 (5.2 / 1.71); `moon-labels` 3,608.  Taken from the PNGs at finer
  steps than the 8-bit median, the geometric mean of the per-pixel ratio
  over the lit disc moves 0.994 → 0.995, and 1.008 → 1.017 over its
  brighter half: with relief on both sides, Cesium's lit disc comes out
  about 1% brighter in the mean, at the median not at all.  (Its relief
  is also the sharper at the terminator, below: three reads celestiary's
  normal map without anisotropic filtering, the tiles' shader with 4×,
  which is likely why.)  A refit to centre the mean (0.822) would take
  the median off 1.000, so `imageryScale` stays 0.815.
- **The swap at the user's ev+10 view (#205's report).**  From Ohio, at
  0.75°, with ion up: the meter settles on celestiary's own Moon first
  (gain 1 → 2.095 under the EV, from the Moon's anchor), and the tiles
  arrive after (25-30 s later on SwiftShader, a few seconds on a GPU),
  when the layer goes active and crossfades in over `FADE_MS`.  Nothing
  else moves: `toneMappingExposure` 2.853e-13 and the meter's goal 2.095
  before and after, the anchor's `highlight` (0.0353) the same, as it is
  the scene's, not the pixels'.  The change seen was the surface: without
  the tiles' relief the terminator went smooth (the lit edge's rows about a
  cubic fit: 2.9 px RMS on celestiary's Moon, 1.0 on Cesium's), and with it
  it keeps its relief (5.1 px).  The two Moons' earthlit sides agree (mean
  display level 19.4 and 19.2-19.5; the median 18.2 against 17.3, Cesium's
  sharper imagery spreading it), and the crescent is saturated on both
  (11.6% of the disc at 250 or more).
- **Not done: cast shadows.**  The slopes light each texel by its own
  tilt, but a rim doesn't shadow a floor (Planet.md, Relief, the horizon
  map).  The tileset has no vertex normals still.

### Precision: a log encoding, and the Moon's earthshine

**A tileset's frame is log-encoded** (`encoding.js`, `sunlitShader`, the
decode's `uLogEncoded`).  The frame holds stored value × light, 0 to 1, and
reaches celestiary through Cesium's 8-bit buffers.  Linear, the night side
and the terminator's last degrees of Sun had a few codes.

The user's view of the Moon at a telescope's field (#192) showed what the
decode and the metered gain then made of them:
- a night side in three or four flat olive levels, with black holes where
  the dark maria rounded to 0;
- a terminator that was a hard step, with flat bands along the lit edge.

The shader now writes the value's log over 20 stops down from 1, with ±½
code of interleaved-gradient dither, and the decode inverts it. That gives
12.7 codes a stop, a step of 5.6% at every level, and the dither turns it
into noise under a display step. The floor, 2⁻²⁰, is under the darkest
earthlit mare (~4e-6).
- A square root would give 1.5e-5 its first code; sRGB's linear toe would
  give it none.
- A float target in portal-netgl would be the general fix (Cesium's
  globe-depth buffer is 8-bit with `highDynamicRange` off), but every body
  would pay for it. The tilesets' own shader is the one place the value
  exists in float before the 8-bit write.
- Earth's globe, lit by Cesium's own shader (`litSurfaceOnly`), stays
  linear (`uLogEncoded` 0). Its night lights have a pass of their own.

**The Moon's night side is lit by earthshine, not a floor.**
- Before, the tilesets had `nightFloor` 0.02: 2% of full sun over the whole
  night side, "dark, but not a hole in the sky".
- On the Moon that is ~300× earthshine. With the crescent in frame it was
  under a display step at the anchored gain. At the EV a camera needs for
  Jupiter's moons (+8 to +10) it went white, with the 8-bit holes black.
- The Moon now has `earthshine`: each frame `_setEarthshine` sets Earth's
  direction in the Moon's frame and its light there, and the shader adds
  that light through the lunar photometric function toward Earth (it was
  Lambert's law until the Moon's photometry, below).
- The light is Earth's geometric albedo (0.367) × Lambert's phase law at
  Earth's phase seen from the Moon × (R⊕/d)² (`earthshineFraction`): 1.0e-4
  of sunlight at full Earth, 6.9e-5 at #192's crescent.
- The regolith's opposition brightening for light returned toward its
  source was left out by Lambert's law (μ0 toward Earth, darkening to the
  limb); through the lunar photometric function the earthlit side seen
  from Earth (a phase of ~1°) is flat to the limb, as the full Moon is.
  Its surface brightness at #192's view is 13.7 mag/arcsec² (median;
  13.8-14.4 expected; HDR.md).
- The floor had lit the day side too (+2% at full sun, +11% by the
  terminator), and the Moon's `imageryScale` (ion's copy of the mosaic
  against Trek's) had been measured with it, at 0.82.  Measured again
  without it, it is 0.78: parity's `moon-quarter` median ratio 1.00 (it was
  0.97, and 0.93 with the floor gone and the old scale) and its terminator
  profile 18.8 / 4.9 (was 23.6 / 6.9).  Its ratio band moved to 0.97-1.03
  to centre on that.  With the lunar photometric function on both sides
  it is 0.815 (below, the Moon's photometry).
- Mars keeps its floor.
- At EV +10 the earthlit side of #192's view shows its maria and craters
  smoothly, at 10-40 of 255 (10-32, median 20, at the user's later view
  through the lunar photometric function; HDR.md).
- Celestiary's own Moon mesh has the same earthshine (`lunarSurface.js`),
  so below the swap's range (no ion, or before the tiles) the night side
  is lit as Cesium's is.

### The Moon's photometry

Both Moons are lit by one lunar photometric function (Planet.md, [the
Moon's photometry](js/scene/Planet.md#the-moons-photometry);
`lunarPhotometry.js`), not Lambert's law, which made them 3.25 stops too
bright at #192's crescent (HDR.md, [a star beside the
Moon](js/scene/HDR.md#a-star-beside-the-moon)).

- `sunlitShader(Cesium, nightFloor, {lunar, reliefUrl})` evaluates
  `lunarReflectance` (the shared GLSL chunk `LUNAR_PHOTOMETRY_GLSL`) for
  the Sun and for earthshine, through `sunlitLaw(n, l, v)`, with μ0 and μ
  on the relief's normal (`reliefNormal`, Relief on the Moon's tiles,
  above; the smooth sphere's until the map is in), the eye's direction
  from `positionEC`, and the fragment's own phase angle.  Celestiary's
  Moon takes both cosines from its normal-mapped normal the same way
  (`lunarSurface.js`, three's `geometryNormal`).
- `textureGain` is 0.4448, moon.json's `texture_gain`: the stored values
  to normal albedo, so the near side's disc at full is the geometric
  albedo, 0.121.  The frame still holds stored value × light; the decode's
  `bodyGain` carries the albedo scale.
- `imageryScale` is 0.815 (it was 0.78): celestiary's Moon lost its
  Fresnel sheen, which had lit its disc 4.5% over Cesium's, and the 0.78
  had been fitted against it.  With both sides on one function, parity's
  `moon-quarter` reads 1.000 (mean 1.008) and its terminator profile 5.2 /
  1.7 levels (it was 18.8 / 4.9, Lambert against Lambert with the sheen);
  at 0.78 it read 1.077.  Hiding celestiary's relief (its normal map)
  changes neither ratio: the relief moves single pixels, not the median.
- At #192's view (1000×597, the user's `cq`, ev=10), forced on and off in
  one page: the whole Moon V −8.32 (Cesium) and −8.32 (celestiary), the lit
  part's mean 6.05 and 6.07 mag/arcsec², the earthlit side's median 13.72
  and 13.72, against Horizons' −8.42, 5.97 and 13.8-14.4 (HDR.md).

### Detail at narrow fields of view

The rule: **Cesium is never asked for finer detail than a pixel of
`MIN_PIXEL_ANGLE` (1e-4 rad, ~21″) would get**, whatever the field of
view (`cesium/detail.js`, applied each frame in `_setCesiumView`).  Where
a pixel spans less, the globe's `maximumScreenSpaceError` (2, Cesium's
default) and the tilesets' (8) are multiplied by how much less
(`detailScale`), so every tile's screen-space error against the limit is
what it would be with pixels of that size.  The tiles Cesium walks and
loads are then at most those of that wider field from the same place, of
which the narrow view sees a part.  The night lights' second frame
(#179) renders the same globe from the same camera within the frame, so
it walks the same bounded tiles.  Every ordinary field is untouched: at
45° a pixel spans 5 to 28 times the floor (on a 1,500 to 300 px tall
canvas); the floor is a 1.7° field at 300 px, 5.7° at 1,000 px.

Why (#176): Cesium's screen-space error is the tile's geometric error ×
the canvas height / (distance × 2 tan(fovy / 2)), so at a telescope's
field it asked for sub-metre detail kilometres off.  The user's view:
156 m over the sphere in Amapá, Brazil, 13 m over World Terrain's ground,
Jupiter tracked (`t`) at 0.01-0.04° as it sets.  Headless on main
(480x300), at 0.1° with Jupiter 4-6° up, Earth's globe visited 210,000 to
230,000 tiles a frame, down to level 27, and the heap went to 1.4-1.8
GB; at 0.04° and 0.01° the tab died of V8 out of memory before Jupiter
was down to 6°.  None of those tiles was drawn: the frustum passed over
the ground's tiles near the camera, whose bounding boxes reach their
ancestors' terrain heights until they load, and World Terrain has no data
past level ~15 there, but the globe only learns a tile is upsampled from
its parent once it has loaded it, so it walked the subtree under each
first.  As Jupiter crossed the horizon and the ground came into the
frame, the count rose again, from ~400 to 6,700 a frame at 0.1° (more on a
larger canvas, and at a narrower field).  From that spot, per frame, the
globe visited 75 tiles at 45°, 420 at 5°, 1,000-1,500 at 2°, 3,000-4,500
at 1°, 5,000-18,000 at 0.5°: faster than 1 / fov.  With the floor, setting
from 6° to -1.25° at 0.1°, 0.04° and 0.01°: at most ~1,500 tiles a frame,
and the heap peaks at 141, 193 and 178 MB (166 MB at 0.01° on 1280x800),
against ~150 MB at 45°.  At night, with the lights' frame too (Jupiter
rising, before dawn), 155 MB at 0.01° and 190 MB at 0.04°.  `node tools/narrow-fov/narrowFov.mjs <fov>`
reruns it (its header has the options); the counts are the globe's
`_surface._debug.tilesVisited` and its replacement queue, which say what
Cesium did that frame rather than what it drew.

The cost: below the floor, the terrain is no sharper than at the floor's
field, so through a telescope's field a ridge on the horizon is magnified
but no more detailed.  `tileCacheSize` and the load queues were not the
problem (the cache trims only tiles unused this frame; these were all in
use), and clamping the frustum handed to Cesium would have widened what it
draws, not just what it selects.

## New York

[Slop New York](https://github.com/pablo-mayrgundter/slop-newyork), a
three.js city of Manhattan (WebGPURenderer on its WebGL2 backend), drawn
at its place on Earth's Cesium layer, standing on Cesium's terrain and
composited with it by depth.  A layer you switch on: *New York (3D city)* in
the layers control, offered over Manhattan with Earth's Cesium layer active;
`layers:nyc` in the permalink, and `?nyc=1` as before.

```
celestiary (three.js 0.171)              the host
  ← Earth's link (makeNetGLImmediateLink, CesiumLayers._createWidget)
Cesium (Earth's widget, NetGL guest)     its context._gl is a NetGL recorder
  ← the city's link (newYorkGuest.js), replaying into that recorder
New York (three.js dev, NetGL guest)     drawn by Cesium in its own frame
```

**The hook.**  Cesium draws the city through `scene.externalRenderers`
(our patch, [Patching Cesium](#patching-cesium)): a renderer's `render(p)`
is called once per depth frustum its bounding volume overlaps, after the
frustum's opaque geometry and before the translucent, with Cesium's pass
framebuffer bound, its viewport set and its depth holding the globe; `p`
has the view and projection in doubles, the frustum's near and far, and
the log-depth constants.  slop-newyork's `cesiumExternalRenderer`
(`js/guest-cesium.mjs`) takes Cesium's view times the city's frame into the
guest's camera, sets its log depth, points its link's replay at `p`'s
framebuffer and runs one guest frame on the link.  Every call of the
city's frame replays into Cesium's recorder while Earth's own `link.frame`
is replaying Cesium into celestiary's context, so it lands in Cesium's
globe-depth framebuffer, in the same frame, depth-tested against the
terrain: three levels, each GL call executed three times (the city's
shadow context, Cesium's, celestiary's).  Cesium's state tracker sees the
city's calls (they go through its recorder) and its `resetState()` after
each renderer goes the same way, so Cesium's checkpoint stays right.  Its
handles compose: the city's objects are created through Cesium's
recorder, which interns them as it does its own.

**The switch and the load** (`newYork.js`, `CesiumLayers._updateNewYork`):

- **The control.**  The layers button (top right, under the navigation
  controls) opens Earth's renderer picker, *Celestiary | Cesium*.  Under its
  tiles, a switch, *New York (3D city)*, shows only while the city can be
  drawn: Earth's Cesium layer in use (Cesium chosen, loaded and in view, its
  tiles in or still coming) and the camera in the city's range, `newYorkRange` 'show' (below).  Elsewhere it is hidden,
  not disabled: it's a place's layer, and the picker everywhere else stays as
  it was.  Its caption is the cost while off ("Manhattan's buildings, about
  140 MB"), and while on the city's state: a spinner and "Building the
  city…" from the switch until the guest has built and its staged set-up has
  replayed into the frames (`newYorkStatus`: the guest's `createNewYork`,
  then `stage.chunks` > 0; a chunk a frame the city is in view, since Cesium
  calls its renderer only then, so a city built out of view finishes once
  it's looked at), then "Slop New York, on Cesium's Earth", or "The
  city couldn't load" (off and on again retries).  Off by default.
- **The state** is the store's (`LayersSlice`): `newYorkOn`, the switch,
  which the control, the permalink and `?nyc=1` set and CesiumLayers follows
  each frame (`_syncNewYork`); `newYorkNear` and `newYorkStatus`, which
  CesiumLayers publishes (`_publishNewYork`) for the control.
  `layers.setNewYork(on)` from the console writes the store too.
- **The permalink**: `layers:nyc` while it is on (design/URLs.md [layers
  token](design/URLs.md#layers-token)), read on every link with a view, which
  only turns it on.  `?nyc=1` turns it on at load (into the store on the
  first frame: CesiumLayers is made before the store is set).
- Off, nothing of it loads or runs: frames are bit for bit main's (Checked
  headless, below).
- Loaded the first time the camera is over the city with the switch on and
  Earth's layer active: within `SHOW_WITHIN_M` (60 km) of 5th Avenue and 42nd Street and
  under `SHOW_BELOW_M` (30 km).  Drawn there (`renderer.show`), not drawn
  farther out, and freed past `FREE_BEYOND_M` (300 km), or when the switch
  goes off, Earth's layer stops being wanted (the user chose celestiary's
  Earth, or the homepage) or fails.  Freeing removes the renderer, deletes
  the city's GL objects through the links (so in Cesium's shadow and
  celestiary's context too), resets Cesium's state cache and loses the
  city's shadow context.
- The code is two dynamic imports: `newYorkGuest.js` (celestiary's
  wiring, 4 KB) and the guest itself, from slop-newyork's site,
  `https://pablo-mayrgundter.github.io/slop-newyork/` (its main), with
  `js/guest-entry.mjs` and `js/guest-cesium.mjs`.  Not bundled: it's a
  separate app with its own release cycle, on three.js's dev build (its
  WebGPURenderer and TSL), where celestiary bundles three 0.171; bundling
  it would put two three.js builds and the city's 20 scripts in
  celestiary's build to version by hand.  The guest's modules import three
  by bare names, so `public/index.html` has an import map for `three`,
  `three/webgpu`, `three/tsl` and `three/addons/`, to jsDelivr pinned at a
  three.js commit (not `@dev`, which would change under production).
  Celestiary's own bundle imports nothing by name, so the map is inert
  until the city loads.  The browser warns "Multiple instances of Three.js
  being imported" then: by design, the city's three is its own.
- `?nycGuest=<url>` loads another copy, e.g. slop-newyork's PR preview
  (`.../slop-newyork/pr-preview/pr-1/`).  Only slop-newyork's site and
  localhost are accepted: the guest's code runs in celestiary's page.
  A copy older than slop-newyork's
  [PR #1](https://github.com/pablo-mayrgundter/slop-newyork/pull/1) (merged
  2026-10-23) has no `composite` or `logDepth`, and the city fails to load
  with that said in the console.
- `?nycShadows=1` turns on the city's sun shadows (two more renders of it
  a frame).
- `?nycLean=0` loads the city as it comes, not lean ([What it
  costs](#what-it-costs-and-the-lean-city)), for comparing.

**The ground.**  The guest is built flat and drapes itself over its host's
terrain (`guest.groundSamples`, `setGround`).  Its heights come from
`scene.terrainProvider` by `sampleTerrain` at level 12 on a 100 m grid
(8,000 points, about a dozen World Terrain tiles over the island, a few
hundred KB of ion data, billed by data: no imagery session), not
`sampleTerrainMostDetailed`, which would fetch the finest tiles.  On the
plain ellipsoid (no token, or before World Terrain answers) every height
is 0 and nothing is fetched: the city stands on the ellipsoid, curving with
it.  When the provider changes (World Terrain arriving), it is sampled
again.  The city's flat ground layers are then split to follow it, to
`LEAN_DRAPE`'s detail (10 cm, a 1.5 million triangle budget): a few seconds
of main thread each time ([What it costs](#what-it-costs-and-the-lean-city)).

**The Sun** is Cesium's light (`p.lightDirectionWC`), which celestiary
sets each frame from its own Sun ([camera and light
coupling](#camera-and-light-coupling)), not Cesium's sun, which follows
Cesium's clock: the renderer is made with `sun: false` and the light's
direction is handed to `guest.setSun` once a Cesium frame.

**Black in the night lights' frame.**  That frame is the night imagery's
stored values on black (Night lights, above).  The city is drawn in it
black (`setOccluding`, the `occlude` switch: its output selected to
black, its alpha and depth as ever), so its buildings hide the imagery's
lights on the ground under and behind them; it was hidden there, and the
lights showed through it ([found on a real GPU](#found-on-a-real-gpu)).
It costs a second draw of the city in each frame the lights draw (at
night, every frame).

**Checked headless** (SwiftShader, no ion token: Earth on the bundled Blue
Marble and the ellipsoid, the city at height 0 over it; slop-newyork and
three.js served from local copies):

- The city at Manhattan from 3 km over the Upper Bay (480x300) and 1.5 km
  (800x500): Lower Manhattan's towers, the street grid, Central Park, the
  piers, in Cesium's frame and through the atmosphere pass.  Cesium calls
  the renderer once a frame (one log-depth frustum), with its globe-depth
  framebuffer bound; the city draws 226 meshes a frame; no replay error on
  either link, and no shader or WebGL error in the console.
- The city's distance reaches alpha: its pixels encode a median of 36
  (nearer) against the ground's 41, from the log depth it wrote.
- The switch off: celestiary's frame is bit for bit main's, the canvas and
  the float scene buffer, in the same view with the clock paused (portal-
  netgl 0.3.0 and the patched Cesium included).
- The control (800x500, the aerial of Lower Manhattan from 780 m, the clock
  paused; slop-newyork served locally by `?nycGuest=`): the switch offered
  once Earth's layer was in use there, off, its caption the cost; switched
  on, "Building the city…" with its spinner, the link rewritten with
  `layers:nyc`; the city in 3.5 minutes on SwiftShader, the caption then
  "Slop New York, on Cesium's Earth".  The same view opened with
  `;layers:nyc` loaded the city with no click (2.5 minutes).
- Freed (`setNewYork(false)`): no external renderer left, the city's shadow
  context lost, and the next frame equal, in Cesium's frame and the scene
  buffer, to the frame with the city hidden; on again, it loads and draws
  again.

### What it costs, and the lean city

The first preview (`?nyc=1`, PR #287) crashed a Chrome tab on an Apple
GPU.  Measured headless (SwiftShader, 480x300, no ion: Earth on the Blue
Marble and the ellipsoid; the hero view, 3 km over the Upper Bay looking
up the island; the probe wraps each context's uploads, reads CDP's heap
and the processes' RSS):

| | Without the city | The city as it came | Lean (now) |
|---|---|---|---|
| JS heap + ArrayBuffers, settled | 49 + 89 MB | 295 + 320 MB | 160 + 280 MB |
| ... at the city's ready, before its first frame | | 298 + 447 MB | 163 + 298 MB |
| Renderer process RSS | 394 MB | 941 MB | 739 MB |
| GPU process RSS (SwiftShader: the GPU's memory) | 510 MB | 1,162 MB | 829 MB |
| City's GPU buffers + textures: its shadow / Cesium's shadow / celestiary's | | 112+23 / 112+23 / 112+23 MB | 0.3+23 / 0.4+23 / 112+23 MB |
| City's draws a frame: its shadow / Cesium's / celestiary's | | 182 / 182 / 182 | 0 / 0 / 183 |
| Set-up calls copied into the link's queue (held to the first frame) | | 20,273 calls, 133 MB | 0 (19 MB of small calls copied in the stage) |
| The city's first frame | | 2.6-4.2 s (every queued call, both host contexts) | 0.27 s, after 23 chunks of 0-1.3 s over as many frames |
| A frame (aerial; JS) | 36 ms | 71 ms (city 14 ms) | 63 ms (city 15 ms) |
| A frame at street level, 25 m up on 5th Ave (JS; SwiftShader waits on its GPU here) | | 10.5 s (city 9.4 s; its update 7.8 ms) | 89 ms (city 25 ms; its update 4.5 ms) |
| 60 s at 30 frames | flat | flat | flat (0 GL handles a frame) |
| Drape on real terrain (Terrarium heights on the 100 m grid) | | never ended (13 min, 1.4 GB, then killed) | 4.5 s, 1.67 M triangles |

**What most likely killed the tab: the ground's drape on real terrain.**
On the preview, with ion, `setGroundFrom` samples World Terrain, and
`setGround` splits the city's flat ground layers until each triangle is
within 4 mm of the ground (slop-newyork guest.js, THE GROUND).  Real
terrain bends a little everywhere, so that split the island down to 2 m
triangles (the deck alone 2.9 million, 140 s), and slivers along the shore
(triangles with their corners in a line) never stopped splitting: the page's
main thread was pinned for good with its memory climbing.  Headless runs
never saw it: no ion there, so every height was 0 and only the Earth's
curve was draped.  On top of that, the city's ~135 MB of geometry and
textures lived three times on the GPU, each frame drew three times, and its
first frame replayed 20,000 queued calls and 133 MB into two contexts at
once, every program linked in that one frame.

**Lean** is the default; `?nycLean=0` loads the city as it comes, for
comparing.  It looks the same: at the hero view 263 of the city's 16,467
pixels differ from the city as it came, by at most 59 codes summed over rgb
(the cars, placed at random).  What it changes:

- *The drape* (`LEAN_DRAPE`, newYorkGuest.js, the guest's `drape` option):
  within 10 cm, no edge under 8 m, a budget of 1.5 million triangles
  shared by area (the flat layers are 0.93 million).  slop-newyork's split
  also leaves slivers alone now.  On real heights: 4.5 s and 1.67 million
  triangles, against 12 s and 3.1 million at 2 cm (no visible difference
  over Central Park from 350 m).
- *Lean shadows* (netglLean.js `leanShadow`): the city's shadow context, and
  Cesium's while the city's calls run through it, keep the city's objects,
  state and programs (they still answer the recorder's queries and mint its
  handles) but allocate none of its buffers' storage, write no contents and
  draw nothing.  Only celestiary's context holds and draws the city.  Own
  properties on each shadow, which the recorder (a Proxy over it) reaches
  first.  The city's shadow is on a 1x1 canvas (three sizes the city by
  its own).  Nothing reads either shadow's pixels for the city: three
  doesn't, and Cesium's picking doesn't call external renderers.
- *A staged set-up* (netglLean.js `stageLink`): the city's calls made while
  its link is closed (its whole build and compile) are queued by
  celestiary, not cloned by the link: uploads by reference (the attribute's
  or texture's own array, which nothing rewrites before the replay), the
  rest copied as the link does.  The queue is cut into chunks (8 MB of
  uploads, 4 programs or 4,000 calls) by asking the guest for a frame end,
  whose checkpoint restores its state at the next chunk; the external
  renderer replays one chunk a frustum, the city undrawn, then draws it.
- *What isn't built* (slop-newyork): the other boroughs (built and then
  removed before), the shadow stand-ins (shadows are off), and with
  `crowds: false` the pedestrians, never drawn on WebGL2 but walked and
  skinned (5 ms of the city's update at street level).  And two
  build-time scratch arrays the city's closures kept alive (~130 MB of the
  JS heap: the waterfront's accumulators, the facade boxes) are let go.

What's still expensive, and what it would take:

- *The city's programs compile three times* (64 each: its shadow, Cesium's
  shadow, celestiary), since its uniform locations come back through
  Cesium's recorder.  portal-netgl could *flatten nested links*: replay an
  inner guest's calls straight into the outermost context through the outer
  link's handle table, so Cesium's recorder and shadow never see the city
  (one encode-decode pass and one shadow fewer).
- *Lean shadows and staging belong in portal-netgl*: a shadow mode for
  `makeNetGLGuestContext` (`shadow: 'lean'`), a policy for calls an outer
  recorder replays from an inner link, and a link that queues uploads by
  reference and replays its set-up in chunks (`link.step()`), cutting at
  its own checkpoints rather than asking the guest for frame ends.
- *The city itself*: 1.6-1.7 million triangles of ground layers, ~1.25 million
  of buildings and 3.4 million of street details (most instanced and culled
  by distance), 112 MB of buffers on celestiary's context and 280 MB of
  ArrayBuffers in JS (three keeps every attribute's array; the drape keeps
  the flat layers, 23 MB).  The compile (64 programs, 17 s on SwiftShader)
  is the longest step of the load; then the facade blocks (2.7 s) and the
  ground grid (2 s).  The highway traffic's update is ~3 ms a frame.
- *The drape* is still seconds of main thread on real terrain (at load, and
  again when World Terrain replaces the ellipsoid).
- Not measured on a real GPU: ask for a `?perf=sync` snapshot over the city
  (below, What's left).

### The colour and alpha contract

The city's pixels land in Cesium's frame, which the composite decodes as
one body ([Architecture](#architecture), HDR.md [Cesium in the same
units](js/scene/HDR.md#cesium-in-the-same-units)), so they must be in the
frame's encoding:

| | The decode expects (Earth) | The guest wrote (`composite: true`, as shipped) |
|---|---|---|
| rgb | stored value × the Sun's light (Lambert, at intensity 1), linear in the light, 0 to 1: a white Lambertian wall facing the Sun is 1 | its preset lights (the Sun at 5.8-6.6 in three's units, a white wall at 2.1; a sky light at 1-1.6; its baked sky for reflections), on linear albedo, sRGB-encoded at the end, with lit windows, lamps and signals emitting into it; under the horizon, a moon of its own |
| alpha | anything over 0 where it draws; Cesium's distance stage replaces it with the encoded distance from Cesium's depth texture (`distance.js`) | its materials' alpha, 1 for the opaque city: right |
| depth | Cesium's log depth (the stage and the decode turn it into celestiary's depth for the atmosphere pass's haze) | `logDepth: true`: Cesium's, from the renderer's constants: right |

The decode multiplies rgb by `bodyGain` (`DISPLAY_GAIN` for Earth) and
`exposureOf`.  So the guest's light was 2-3 times the scale and clipped in
the 8 bits, its shading went through sRGB's curve (a wall at 15% of the
Sun showed at 42% of its sunlit value), and its emission, under a code of
the frame by day, became a sunlit white at night's gain (up to 4e6).

What celestiary does now (`newYorkGuest.js`, a stopgap through the guest's
public objects and three's node-material hooks, before its programs
compile):

- `inCelestiaryFrame`: each material's diffuse colour is sRGB-encoded
  back to its stored value before it is lit, and the output is linear, so
  the frame holds stored value × light, linear in the light.  Unlit
  materials scale with the daylight; `emissiveNode`s and emissive colours
  are multiplied by 0.
- `inCelestiaryUnits`, after every `setSun` (which switches presets): the
  Sun white at π (three's Lambert is albedo / π, so a white wall facing it
  is 1), 0 once it is down; the sky's hemisphere light at 15% of it and the
  baked environment at 0.15, fading with the Sun; the guest's light switch
  (`cityUniforms.uInteriorGlow`) at 0.

Measured headless (no ion: Blue Marble on the ellipsoid; 480x300, 3 km
over the Upper Bay looking up the island, 2026-06-21 16:00 UTC, the Sun 69°
up, the meter off at the keyed exposure): over the 16,348 pixels the city
covers, Cesium's frame reads a median luma of 0.209 (10th and 90th
percentiles 0.080 and 0.542, 0.25% clipped), against 0.277 (0.163, 0.318)
for the Blue Marble ground around it; in the scene buffer, 0.314 against
0.416 exposure units.  The guest's own output in the same view is 0.539
(0.296, 0.791), twice the ground.  At night (03:00 UTC, gain 1.9e6) the
city is black with the ground (0 in Cesium's frame, the gain 1.9e6),
but for 5 of its pixels (of 144,000), at 4-7 codes of 255, white specks at
that gain: shading outside the hooks, likely the guest's preset sky colours
(`cityUniforms`).  Before the lamps went through the switch there were 11,
six clipped orange.  At 800x500, 1.5 km over the Upper Bay, the city covers
50,101 pixels at a median of 0.183 (0.068, 0.510) against the ground's
0.269; the guest's own, 0.505.

**What slop-newyork needs**, so celestiary can drop the stopgap (an option,
say `units: 'stored'`, for a host that hands it a frame in stored values):

1. Light stored values: in its material pass (`prepareMaterials`), after
   three's `setupDiffuseColor`, `diffuseColor.rgb =
   sRGBTransferOETF(diffuseColor.rgb)` (vertex and instance colours
   included), and output linear (`setLinearOutput(true)`), with no tone
   map.
2. Take the host's light, not its presets': `setLight({direction,
   intensity, sky})`, the Sun at π × intensity (1 = the host's sunlit white,
   white: the host's atmosphere colours it), 0 below the horizon (no moon of
   its own), the sky light and the environment at the host's fraction.
3. Emission out of the lit frame: `setEmission(0)` for every
   `emissiveNode`, emissive colour and unlit material, and a second mode
   for the night lights' frame (below) that draws only emission, in units
   of the host's night imagery.

**What's left.**

- *Night.*  The city is black in the night lights' frame, hiding Black
  Marble's lights under it, but it has no lights of its own.  The guest's
  emission (windows, lamps, cars) belongs in that frame, drawn alone
  (lighting off, emission on) at the Black Marble's scale (a full-white
  texel is `NIGHT_LIGHT_RADIANCE` of a sunlit white), with its surfaces
  black as now; the decode is already the lights' (`newLightsMaterial`).
  That's item 3's second mode.
- *Ground.*  The camera's floor (`groundHeight`, `_keepAboveGround`) is
  Cesium's terrain under it, so over the city it flies through the
  buildings, 1 m over the street.  The city would need to be the ground
  there: `guest.groundOffsetAt` gives the draped deck's height, and the
  buildings' heights would need a query of the guest (its colliders, or a
  height field of its roofs) at the camera's (x, z), the larger of the two
  taken as `groundHeight` while the city is drawn.  Picking against it
  (Cesium's `scene.pick` doesn't call external renderers) is the same
  question.
- *Cost.*  Lean now ([What it costs](#what-it-costs-and-the-lean-city)):
  the city held and drawn by celestiary's context only, its set-up staged
  over frames.  Its checkpoint (~107 calls a frame) is still copied,
  into the stage's queue: portal-netgl 0.4.0's `subFrame()`
  ([portal#34](https://github.com/pablo-mayrgundter/portal/pull/34))
  replays it without the copy, and its `clear: 'none'` would let the
  screen policy, not the guest's `composite`, keep its clears off Cesium's
  frame.  Neither is needed for a fix (the flicker was the stage's, below),
  so neither is used yet, though celestiary is now on portal-netgl 0.6.0
  (PR [#304](https://github.com/celestiary/web/pull/304), for layer mode),
  until slop-newyork's `cesiumExternalRenderer` ends its frames with
  `subFrame()`.  0.6.0's wire 2 doesn't reach these layers: the immediate
  link acks without a version, so their calls still replay as they're
  made.  Its recorder does copy what a call reads when that's part of a
  bigger buffer (a ranged upload, a view into a pool), where 0.3.0 passed
  the whole buffer by reference: a little CPU on the same-page link, for
  which `?perf=1` is the check.  Not measured on a real GPU.
- *Ion.*  The terrain path (`sampleTerrain` on World Terrain) and the
  city on real ground haven't run here: the session's ion token is
  refused.  Check on the PR preview over Manhattan: the piers at the
  water, no gap under the buildings.
- *Its long-term home.*  The layer is wired here for now: celestiary's
  `newYorkGuest.js` loads slop-newyork's guest from its site at run time and
  hangs it on Earth's widget through our Cesium patch, with the colour
  stopgaps on celestiary's side.  It belongs longer term with Earth's other
  extended assets (3D cities and the like) outside celestiary: in our custom
  Cesium ([celestiary/cesium](https://github.com/celestiary/cesium), next to
  the external renderers it rides on), or in a new repo that gathers them.
  From there it would be imported first as an intermediate dependency (a
  package celestiary pins, in place of the guest URL and the wiring here),
  and finally loaded by celestiary as a dynamic layer: discovered with its
  range and cost from that package or a manifest, offered in the layers
  control by where the camera is, and fetched only when switched on, as it
  is now.  The control, the `layers:` token and `newYorkRange` are written to
  carry more such layers (a flag each).

### Found on a real GPU

The user's preview on a Mac (Apple GPU, Brave: ANGLE Metal), with ion.

**The city vanished for a frame every couple of seconds**, almost
periodically, with the clock paused too.  The lean link's stage
(`netglLean.js` `stageLink`) cut its queue into chunks by the calls,
bytes and programs queued while the link was closed, counted since the
last cut, and never reset them once the set-up was in.  After the city's
first frame the closed calls are each frame end's checkpoint (107 calls
at the aerial view; ~80 in portal's three.js test), so every
4,000 / 107 = 37 frames the count reached `CHUNK_CALLS`, the stage asked
the guest for a frame end, and the next frame's external renderer saw a
chunk waiting, replayed it and returned without drawing the city.  At
the preview's 20-25 fps, every 1.5-2 s; the jitter is the frame rate's.
Measured headless (320x200, the aerial view from 780 m, the clock paused,
the app's own loop; per celestiary frame: Cesium's renders, the external
renderer's calls, whether each replayed a chunk, and the city's draws on
celestiary's context): 101 frames, two with no city draw (frames 29 and
66, each a staged call, Cesium rendering and the renderer shown and
called as in every other frame, which drew 187), 37 frames apart.  Not
the renderer's `show`, Cesium's culling, `frameNumber` or the night
lights' frame (the same in the frames before and after), nor the ground,
the range check or the meter (no cadence of 37).  Now the stage cuts only
the set-up: from the first `frame()` on, the calls between frames are
replayed whole at the next frame, as the link does (`stageLink`'s
`framed`; `netglLean.test.js` reproduces the period on the old code).
After: 143 frames, every one with the city's 187 draws.  A side effect
of the old behaviour: the layers control's status (`newYorkStatus`) read
'loading' on those frames.

**"READ-usage buffer was written, then fenced, but written again before
being read back"** (3-4 a second in the console) is celestiary's meter,
not the city's links: headless it shows before the city loads.  Its
asynchronous readback (`meterReadback.js`) dropped the older of two
readings that finished at one poll unread, so that buffer's next read
wrote it again; and it allocated every buffer up front, which Chrome
counts as a write.  Now every finished reading is copied out and each
buffer is allocated at its first read: headless, 7-9 warnings a session
before, none after (HDR.md, the meter's readback).  Its cadence (every
fourth frame) has nothing to do with the flicker's.

**Blue blocky bands on the buildings at night** (Central Park from the
ground, the night of 2026-10-23): the atmosphere pass, not the city, and
not New York's only.  The user's `newYorkDebug()` on an M2 (camera
−29.8 m, under the ellipsoid; Manhattan's ground lies ~30 m under it,
where the geoid is −32.7 m) had the city's pixels clean in Cesium's frame
(8 of 66,770 lit), no night lights added and no holes; its `sceneMean`
(now `sceneLitMean`) was over those 8 lit pixels only, not the city's.
So the light came after the composite.

*The cause.*  The pass marches the air in front of a surface it sees
from inside the atmosphere (`marchSegment`, Atmosphere.js), and at each
sample decides whether the Sun is behind the planet.  From above the
sphere it asked whether the ray to the Sun meets the sphere ahead
(`rsi`).  Within a metre of the sphere that is a difference of squares of
~6.4e6 m in float32: the near hit came out on either side of the sample
at random, and with the Sun 33° under the horizon the sample read the
Sun's transmittance table as if lit.  From an eye under the sphere every
ray crosses it, a few tens of metres out, and the samples that landed
within that metre lit the night's air with daylight: speckled, in bands
of the rows whose samples fall there, Rayleigh blue, fixed while the view
is.  Headless, with a flat terrain at −31.5 m and the camera at −30 m
(Cesium's frame then fills the view, the city's deck and trees within
160 m): 2,665 pixels in horizontal blue bands, all of them gone with the
atmosphere pass off and none with the cloud shell, the volumetric clouds,
the night sky or the airglow off.  The bands' light, metered, held the
gain at 0.01 where the dark frame wants ~150 (the user's was 0.001 against
a goal of 27).

*The fix.*  The Sun is behind the planet where it is under the sphere's
horizon at the sample: its zenith cosine under −√(1 − R²/r²), from
(r − R)(r + R), which keeps its bits near the sphere; under the sphere,
under the local horizontal, as before (`rayEnd.js` `sunBelowHorizon`,
its float32 mirror and tests; the GLSL in the atmosphere pass's march and
narrow-lobe depth, and the volumetric clouds' light).  The same view after:
0 pixels lit, at a gain of 148.  It holds wherever the camera is under
or within a metre of the sphere, the city or not: the Dead Sea, the
Netherlands, any coast where the geoid is negative.  The precomputed
tables (AtmospherePrecompute.js) still decide by `rsi`, at their own
sample points; their bottom row is the same question, not seen yet.

Also fixed on the way, and kept: the night lights' frame draws the city
black, not hidden.  Hidden, wherever Earth's globe is behind or under its
buildings, Black Marble's ~500 m texels drew through them: at the user's
12 km view at night (21:35 EDT), on 1,373 of its 1,374 pixels; drawn
black, on none.

The 12 km view also has 3 of the city's pixels lit in Cesium's frame at
night (one at codes 129, 113, 82), and the user's Central Park view 8:
something of the guest's still shines with every light and emission at 0
(the white specks of the colour contract, above), not yet found.

`c.ui.layers.newYorkDebug({seconds})` (newYorkDebug.js), in the console
with the city in view, watches the app's frames for `seconds` (default
10) and logs `[new york] debug: {...}`:

- `frames`: fps, the frames that drew no city and the frames between
  them, staged calls, Cesium's renders a frame;
- `pixels` and `pixelsLightsHidden`: two frames read back, with the city
  and without, with the night lights' frame drawing it black and hidden:
  the city's pixels (`city`), those its day frame lit (`dayLit`,
  `dayCodes`), those the lights added to (`lightsAdded`), those lit in the
  scene buffer (`sceneLit`, `sceneMax`, `sceneLitMean` over them only),
  holes;
- `passes`: the final frame over the city's pixels and the ground's, as
  drawn and with each pass after the composite off in turn (`noCloudShell`,
  `noCloudVolume`, `noNightSky`, `noAirglow`, `noAtmosphere`): `lit` is how
  many are over 0, `mean` the byte over all of them.  The pass whose
  absence takes the light away is the one adding it;
- the GPU, the gain, the camera's height and whether Cesium has it
  underground, the terrain provider, and the guest's lights.

## Patching Cesium

Some of what celestiary needs from Cesium is a change to Cesium itself, not
a setting.  Those changes live as branches of our fork,
[celestiary/cesium](https://github.com/celestiary/cesium), and reach the
app as [patch-package](https://github.com/ds300/patch-package) patches on
`@cesium/engine`, applied by `postinstall` on every `yarn install`.  Each
is also proposed upstream, and its patch goes when a Cesium release that
has it does.

- **Why patches, not a published fork.** `@cesium/engine` ships its
  `Source/` as ES modules and its shaders as `Source/Shaders/*.js`
  strings, and esbuild bundles them from there (`import('cesium')` →
  `cesium/Source/Cesium.js` → `@cesium/engine`).  So a patch to the engine
  reaches the bundle without building Cesium.  What it can't reach is the
  prebuilt web workers in `cesium/Build/Cesium/Workers` (copied by
  `esbuild/cesiumAssets.js`): a fix there needs a built fork.
- **The fork's branches.** Each fix is a branch off the release tag we pin
  (`1.145` for `cesium@1.145.0`, `@cesium/engine@26.3.0`), named
  `celestiary/<fix>`, with its Cesium specs, and the same commit
  rebased on Cesium's `main` for the upstream PR (with its `CHANGES.md`
  line).
- **Making the patch.** Copy the branch's changed files into
  `node_modules/@cesium/engine` (a shader edit means copying the generated
  `Source/Shaders/<Name>.js`, from `npx gulp build` in the fork), then
  `npx patch-package @cesium/engine`.  One patch file holds every fix for
  the engine version.  A new module also needs its exports: the engine's
  `index.js` and the `cesium` package's `Source/Cesium.js` (what
  `import('cesium')` reads) are generated by Cesium's build, so add its
  lines to both by hand, as the fork's build writes them, and run `npx
  patch-package cesium` too (`patches/cesium+1.145.0.patch`, the
  external renderers' exports).  `js/scene/cesium/cesiumPatches.test.js` checks the
  patched lines are in `node_modules`, so a checkout installed without
  the hook (`--ignore-scripts`) fails a test rather than rendering
  Cesium's unpatched behaviour.
- **Upgrading Cesium.** patch-package refuses a patch for another
  version, loudly.  Drop the fixes the new release has; rebase the
  others' branches onto its tag, rerun their specs, regenerate the patch.
- **Running a fork branch's specs** (headless): `npm install
  --ignore-scripts` (Cesium keeps no lockfile; pin `draco3d@1.5.7` if the
  spec build can't resolve `node:fs`), `npx gulp build` (the test task
  doesn't rebuild the workspace's spec bundle), then
  `CHROME_BIN=<chromium> npx gulp test --workspace @cesium/engine
  --includeName Scene/GlobeSpec --browsers <launcher>` with a
  `ChromeHeadless` launcher in `Specs/karma.conf.cjs` that passes
  `--use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`
  (local only; not committed).

| Patch | Fork branch | What it fixes | Upstream |
|---|---|---|---|
| The ellipsoid's lighting follows the globe's settings | `celestiary/globe-daynight-lighting` | Without vertex normals the globe's day-night shading was a hard-coded `clamp(5 × Lambert + 0.3)`: its floor is now `vertexShadowDarkness`, its multiplier a new `dayNightLambertDiffuseMultiplier` (defaults unchanged) | [CesiumGS/cesium#13974](https://github.com/CesiumGS/cesium/pull/13974), from `upstream/globe-daynight-lighting`; drop the patch's hunks once a release has it |
| External renderers: renderers outside Cesium drawing into its frame | `celestiary/external-render-pass` | `scene.externalRenderers` and `ExternalRenderer({boundingVolume, show, render(p)})`: `render` is called once per depth frustum the volume overlaps, after the opaque passes, with Cesium's framebuffer bound and the view, projection, near and far and log-depth constants in `p`; `Context.prototype.resetState()` after each.  For [New York](#new-york).  Exported from `cesium` too, so a second patch, `patches/cesium+1.145.0.patch` | not yet proposed |

Candidates for later patches, by how much celestiary code each would
remove: a tone-map-free HDR output (the log encoding and the sRGB
pre-compensation, Precision above); an emissive night imagery layer (the
night lights' second frame); a per-scene ellipsoid in place of the global
`Ellipsoid.default`; OIT that keeps coverage alpha; a narrow-field detail
cap with a traversal that reads terrain availability (#176); an ion
imagery layer that asks for its endpoint only when a tile needs it.

## Phases

1. **Earth** — layer infrastructure, UI, Earth. *Done; verified in
   headless Chromium without an ion token (Natural Earth II imagery):
   in-place composite, coastlines coincide with celestiary's texture,
   terminator matches, works from orbit down to 150 km, switching back
   restores celestiary's Earth and atmosphere.*
2. **Moon, Mars** — `Ellipsoid.MOON` / `Ellipsoid.MARS` with the Cesium
   ion Moon Terrain (asset 2684829) and Cesium Mars (asset 3644333)
   3D-tiles datasets, no globe. These need an ion token; without one the
   layer control doesn't appear for them. *Done; seen running on the PR
   preview with the production token, as was Earth's ion path.*
3. **Fixes after first use** — Earth's globe no longer goes empty when ion
   can't serve World Terrain; tiles load full detail while the camera
   moves; Moon and Mars lit by the Sun.
4. **Mars atmosphere** — celestiary's Bruneton pass over Cesium's Mars
   (see Atmospheres).  *The mechanism is checked on Earth in the sandbox
   (Cesium's offline globe under celestiary's atmosphere): from orbit and at
   20 km it matches celestiary's own Earth; without the depth rewrite, at
   20 km the ground is hazed white.  Seen on Mars on the PR preview.*
5. **Cesium by default** — the Cesium layer is the default for Earth, the
   Moon and Mars, in range out to celestiary's mesh range; Moon and Mars
   lit by the sphere alone, so no terrain facets; every body in range and
   on screen shows its layer, not only the target; one body's credits at
   a time.
   *Checked in the sandbox (Earth, offline globe): active with no click at
   2,500 km and at 1,000,000 km (past Cesium's default far plane); one
   credits container, shown.  On the preview: on by default for all
   three, one set of credits; a first shader, which faded terrain relief
   out with distance, still showed facets on the Moon at 46 km, so relief
   lighting was dropped.  The Moon went back to celestiary's with Earth
   targeted; in the sandbox, at the Moon, Earth is now Cesium's with
   either the Moon or Earth targeted.  Mars arriving with a halo off to
   one side, and the Moon clipped to a lens off-centre: reproduced in the
   sandbox with a local Moon tileset (Cesium's Moon centre 65 px off
   three's); with the camera set directly, both centres project to the
   same pixel.*

## Follow-ups

- Picking / inspection through Cesium (click → lat/lng, entity info):
  forward celestiary's clicks to `scene.pick` on the active widget.
- Night lights: done in #93 (Night lights, above).  Left: a bundled low-level
  copy of the Black Marble for offline use.  Clouds dim them since #88.
- Persist the layer choice in the permalink: the `layers:` token has New
  York's switch (`layers:nyc`); the renderer chosen per body
  (`layers:earth=default`) is left.
- At a telescope's field the narrow-field clamp (Detail at narrow fields
  of view) keeps the Moon's tiles at a 21″ pixel's detail: at 0.91° over
  879 px the lit limb is as round as celestiary's sphere (0.47 px rms
  against 0.43), but the tiles' error grows as 1 / fov, and at narrower
  fields their chords facet the limb (the user's screenshot on #192).
  Celestiary's sphere (512 segments) stays round.
- Perf: the shadow context executes every Cesium draw as well as the
  replay (2× GPU for the globe). Cesium needs the shadow's pixels only
  for readback (picking, camera collision); a no-draw shadow mode in
  portal-netgl would halve the cost when those aren't in use.
  Celestiary reads none of the shadow's pixels: its terrain heights
  (`globe.getHeight`, `tileset.getHeight`) are CPU picks on loaded tiles.
- Perf, done: the shadow contexts' synchronous GL calls in a settled frame
  were all portal-netgl's state checkpoint, at each Cesium frame's end (53
  `getParameter`, 16 `getVertexAttrib` and 10 `isEnabled`, 79 a Cesium
  frame; Cesium itself makes none), each a round trip to the GPU process
  waiting for the shadow's queued frame.  portal-netgl 0.3.0
  (pablo-mayrgundter/portal#33) tracks that state from the recorded calls,
  as it tracks bindings, so the checkpoint makes none: headless, Earth from
  20 Mm, the shadow's `getParameter` calls went from 56.7 a frame to 0,
  the frame unchanged.  What's left (`getUniformLocation` and the like)
  comes only with a new shader's link.  Celestiary sets no GL state on the
  shadow itself (the perf overlay only counts, times and, with
  `barrier=read`, reads a framebuffer of its own), which the tracked mode
  relies on; something that did would need `scalarState: 'queried'`.

## Files

New:

- `js/scene/cesium/frames.js` (+ test) — body frame ↔ ECEF, camera/light
  conversion. Pure.
- `js/scene/cesium/bodies.js` — per-body config (ellipsoid radii, data).
- `js/scene/cesium/encoding.js` (+ test) — a tileset frame's log encoding
  through 8 bits, and the Moon's earthshine (Precision, above); it
  re-exports the earthshine's level from `js/scene/lunarPhotometry.js`.
- `js/scene/cesium/relief.js` (+ test) — the Moon's LOLA normal map in the
  tileset's shader: longitude and latitude, tangent frame, fade
  (Relief on the Moon's tiles, above).
- `js/scene/cesium/CesiumLayers.js` (+ test) — lazy Cesium + NetGL link, stencil
  shell, per-frame coupling, activation.
- `js/scene/cesium/newYork.js` (+ test) — New York's switch, where its
  guest loads from, when it's wanted and its load state for the control. Pure.
- `js/scene/cesium/newYorkGuest.js` — New York loaded and wired into Earth's
  widget: its link, ground, external renderer, colour stopgaps, the lean
  options (New York).
- `js/scene/cesium/netglLean.js` (+ test) — lean NetGL plumbing for a nested
  guest: shadow contexts that hold and draw nothing of it (`leanShadow`), and
  its set-up queued without copies and replayed a chunk a frame
  (`stageLink`). Pure.
- `js/scene/cesium/ionImagery.js` (+ test) — the altitude under which Earth
  asks ion for Bing imagery (Cesium ion sessions). Pure.
- `js/store/LayersSlice.js` — `layerBody` (in-range capable body or
  null), `bodyLayers` (per-body choice; `bodyLayer()` applies the
  default), New York's `newYorkOn`, `newYorkNear`, `newYorkStatus`.
- `js/ui/LayersButton.jsx` (+ test) — the control, with New York's switch
  (`NewYorkToggle`, `newYorkControl`).

Changed:

- `js/ThreeUI.js` — depth-stencil, half-float `_sceneRT`; layer hooks in `renderLoop`;
  atmosphere disabled for a Cesium-layered body; publish `layerBody`.
- `js/App.jsx` — mount `LayersButton`.
- `js/store/useStore.js` — add the slice.
- `esbuild/build.js`, `esbuild/common.js`, `esbuild/serve.js` — copy
  Cesium assets, define the token.
- `package.json` — `cesium`, `@pablo-mayrgundter/portal-netgl`.
- CI workflows — Node 22 (Cesium requires it; yarn enforces engines).

## Verification

- `yarn precommit` (lint, bun tests, bundle check).
- frames.test.js: round trips, known points (lat/lng → ECEF matches Cesium's
  `Cartesian3.fromDegrees` on a sphere), handedness.
- In a browser: with Earth targeted the button appears and the Cesium
  layer is on without a click; targeting a body Cesium can't render, it
  doesn't.
  Choosing Cesium swaps the globe in place with no visible offset or lag
  while orbiting; the Moon occludes/is occluded correctly; the terminator
  matches celestiary's; switching back restores celestiary's Earth and
  atmosphere exactly.

## Parity check

`yarn parity` compares celestiary's rendering of a body with its Cesium
layer, numerically, for a list of permalink views.  It's the by-hand
procedure of AGENTS.md as one command, and what the "done when" of the
Earth-appearance issues (#92 imagery, #93 night lights, and #86 exposure,
#88 clouds) cite.

Not part of `yarn precommit`: it takes minutes (30 to 80 s a view on
SwiftShader, four cores) and needs the network (ion).  The arithmetic is in
`tools/parity/measure.mjs`, with bun tests that do run in precommit.

### Running it

```
CESIUM_ION_TOKEN=... yarn build     # the Moon and Mars need the token, Earth's terrain too
yarn parity                         # every view in tools/parity/views.json
yarn parity --only moon-quarter --out parity-out
```

- It serves `docs/` itself and doesn't build: without a build it says so
  and exits 2.  The token is read at build time, so it isn't needed to run
  the script.  Never print it: ion's error bodies echo it, and the script
  logs ion answers by status only.
- ion is fetched through Node with celestiary's production Referer, the
  token being restricted to it (AGENTS.md, Secrets), and answered to the
  page with CORS open.  If ion answers 401 the token in the build is stale
  or not scoped to the site; the Moon and Mars then never load and their
  views fail as "not settled", saying so.
- NASA GIBS (Earth's night lights) is fetched through Node too, with no
  headers: a sandbox's Chromium doesn't trust its egress proxy's CA
  (`ERR_CERT_AUTHORITY_INVALID`), so direct, the tiles never load and the
  night views show Cesium's Earth black.
- Options: `--only id,id`, `--out dir` (a PNG pair per view and
  `report.json`; `parity-out/` is gitignored), `--views file`, `--docs dir`,
  `--viewport WxH`, `--timeout seconds` (per view, default 1800),
  `--abort regex` (ion URLs the page's requests to are refused, e.g.
  `api\.cesium\.com/v1/assets/2/` when the account's imagery sessions
  (Bing) are used up), `--list`.
- Exit code: 0 all pass, 1 a check failed, 2 couldn't run.

### What it does

Per view, in headless Chromium (SwiftShader), in a fresh page:

1. Loads the view's permalink, forces the layer on
   (`c.ui.layers.fadeOf = () => 1`), and waits, with no fixed sleep, until
   the app has restored the view, the body's layer is `ready`, `shown` and
   in `layers.active` (its tiles were in: `tilesReady`), Cesium's tiles read
   loaded, no request is in flight, and six more frames have gone by.
2. Pauses the simulation clock, then renders twice in one task with
   `c.ui.renderLoop` and reads the frame back with `readPixels`: the layer
   forced fully on (`fadeOf = () => 1`), then fully off (`() => 0`, so
   celestiary's own surface and atmosphere draw over Cesium's).
3. Measures, over the lit part of the body's disc (its inner 90%, so the
   limb, where silhouettes and atmospheres differ, is left out; pixels
   under luma 12 of 255 in the off render, the night side, are left out):
   - the median per-pixel ratio on/off of the luma, and of R, G and B.  Per
     pixel first, then the median, so coastlines, craters and a pixel of
     misregistration don't move it.
   - a brightness profile across the terminator: 40 samples (each a 5-pixel
     strip) along the Sun's direction on screen through the disc's centre,
     dark side to lit, on both renders; the max and the mean of the
     absolute difference, in luma levels of 255.
4. Prints a table of view, metric, value, tolerance and PASS/FAIL, and adds
   a check that the layer was active when the frames were read.

The values are display values (sRGB, after tone mapping), as a viewer sees
them.  Ratios are Cesium over celestiary: below 1 is Cesium darker.

### Views and tolerances

`tools/parity/views.json`: `defaults` (viewport, region, profile) and a list
of `views`, each:

| Field | Meaning |
|---|---|
| `id`, `description` | name in the table and `--only`; what the view exercises |
| `body` | `earth`, `moon` or `mars`: the layer to force and the disc to measure |
| `hash` | the permalink, with `cq=` (js/permalink.md; without it the time and view aren't restored).  Include `s=alpoU` to turn off labels, lines and the Milky Way, which are drawn on both renders and dilute the ratios |
| `region` | `{"disc": true, "inner": 0.9}` (the body's disc, computed from the camera) or `{"box": [x0, y0, x1, y1]}` in fractions of the image; `minLuma` (default 12) |
| `profile` | `{"across": "terminator", "samples": 40, "band": 5, "reach": 0.9}`, or `{"from": [x, y], "to": [x, y]}` in fractions of the image; omit for none |
| `labels` | `true` for a view that checks the body's place labels draw over Cesium's render: parity renders it once more with the body's `places` hidden and counts the pixels that differ (`label pixels`, tolerance `labelPixels` `{min}`).  Its hash leaves `p` out of `s=` (the places' toggle, on by default), as the `*-labels` views do (`s=aloU`: no star labels, asterisms, orbits or Milky Way).  Such a view has no ratio tolerance, as it checks the labels, not the surface.  It exists because the other views' `s=alpoU` turns the labels off, so none of them could see the layer hiding them (#172) |
| `freeze` | `true` stops the simulation clock as soon as the app is up, not once the tiles have settled: for views low over relief, where the ground turning under the camera while tiles load (hundreds of m/s) would frame different mountains each run |
| `reference` | optional `{"box": [x0, y0, x1, y1]}`: a second region of the same render, for what has no counterpart in celestiary's render (Cesium's terrain above celestiary's sphere), measured against the ground beside it in Cesium's render |
| `tolerance` | `ratio` `[lo, hi]`; `channelRatio` `[lo, hi]` or `{r, g, b}`; `meanRatio` `[lo, hi]` (the ratio of the region's mean luma and of each channel's mean, on/off: for views where the two renders differ in resolution, which moves the per-pixel medians but not the energy); `profileMax`, `profileMean` (luma levels); `luma` `[lo, hi]` (each render's own median luma, on and off: for views where both sides could go wrong alike, as they share the atmosphere pass); `reference` `{luma, blueRed}`, each `[lo, hi]` (the on render's median luma, and median blue/red, over the region over the same over `reference`: the ridge looks like ground, not sky); `labelPixels` `{min}` (a `labels` view: the pixels the place labels add); `minPixels` (default 200) |

To add a view: fly to it in the app (the URL follows the camera, one second
after it settles) and copy the hash; pick a **partial phase**, as colour
mismatches hide near full; check the body's Cesium layer is engaged there
(in range, above); add an entry with loose tolerances, run `yarn parity
--only <id> --out parity-out`, look at the images, and set the tolerances
from the numbers.  The camera should be about 90 degrees from the Sun for a
half-lit disc; the app's Sun direction is at the origin, so the phase is the
angle between the camera's and the Sun's directions from the body.

The tolerances are **baselines, not targets**: each is the measured value
with margin (runs differ by about 0.002 in ratio and a few levels in the
profile max, which sits at the limb), so a change that moves the two
renderings apart fails, and one that brings them together shows as a value
well inside its range.  When #92, #93 or #86 close a gap, tighten that
view's tolerance to the new value with the same margin.  Ratios ought to
come to about 1 (0.95 to 1.05); since #86's PR A all four views are within
that, see below.

### Baselines and what they show

SwiftShader, 480x300, `t=9233.1234jd`, ion token from the repository
secret.  Cesium over celestiary; runs repeat to about 0.002 in ratio.

| View | Luma | R / G / B | Profile max / mean (of 255) |
|---|---|---|---|
| `earth-orbit-gibbous` | 0.990 | 0.976 / 0.988 / 1.000 | 29.5 / 2.4 |
| `moon-quarter` | 0.967 | 0.967 / 0.967 / 0.967 | 19.4 / 5.5 |
| `mars-gibbous` | 0.988 | 1.000 / 0.985 / 0.986 | 9.5 / 1.8 |
| `earth-low-dusk` | 1.001 | 1.000 / 1.000 / 1.000 | 3.2 / 1.2 |
| `earth-night-europe` | Europe at night from 4,000 km (#93; `t=9851.4722jd`): median ratio 1.004 over the lit land (pixels of 6 or more), 1.000 / 1.000 / 1.000 per channel, mean 0.983 / 0.974 / 0.985 / 0.997 (luma, R, G, B); median luma 54.4 on, 54.3 off.  Cesium's side was black (0.000) before | (no profile) |
| `earth-clouds-katrina` | 1.000 (#88: the clouds of 2005-08-28 over the Gulf from 8,000 km, one shell on both sides); median luma 114.3 on, 115.0 off, about 75 without clouds | 1.000 / 1.000 / 1.000 | 15.5 / 2.0 |
| `earth-night-dusk` | Italy from 400 km straight down, Sun 16° under the horizon (#93): mean ratio 0.973 luma, 0.946 (0.894 once) / 0.979 / 1.006 (R, G, B) over the whole frame, GIBS's 600 m tiles sharp against celestiary's 11 km texture (the median pixel ratio there is 0.69, which is why the view is judged by the mean).  Before: 0.918 and 0.672 (red), Cesium's frame showing the twilight glow and no lights | (no profile) |
| `earth-low-land-day` | 0.938-0.972 | median luma 80 on, 85 off since the surface's segment is marched (73-75 and 77-78 with the table's; 55, washed out, before #141's fix) | (no profile) |
| `earth-ridge-day` | ridge over valley ground, on: luma 0.971, blue/red 0.992 (was 0.69 and 2.24, sky over the ridge) | (no off comparison) | (no profile) |
| `mars-low-horizon` | 0.952 over the ground; median luma 42.0 on, 43.8 off | (no profile) | (no profile) |
| `mars-low-horizon-band` | horizon band over the sky above it, on: luma 0.801, blue/red 1.038 (was 0.484 and 0.901, ground with the stars through it) | (no off comparison) | (no profile) |
| `mars-near-ridge` | the rows on the sphere's horizon line across a near ridge, over the ridge below them, on: luma 1.069, blue/red 1.040 (was 1.114 and 1.093, a seam through the ridge); 1.078 / 1.038 since the exact step integral (#145) | (no off comparison) | (no profile) |
| `mars-below-datum-band` | from 658 m under the datum, away from the Sun: the band between the terrain's horizon and the horizontal over the sky above it, on: luma 0.792, blue/red 1.113 (#145; the band flickered black on a real GPU before it) | (no off comparison) | (no profile) |
| `mars-below-datum-sunward` | the same spot facing the Sun, the band on the right over the sky above it, on: 0.996 / 1.000 (#145) | (no off comparison) | (no profile) |
| `earth-dead-sea-band` | from 16 m under the datum at the Dead Sea, the band (two rows) over the sky above it, on: 0.985 / 0.914 (#145) | (no off comparison) | (no profile) |
| `horizon-terrain-far` | from 6 m on Mars, mountains 150-280 km off on the horizon (past the distance code's range) over the sky above them, on: 0.992 / 0.996 (#145; before it, dark fragments at the sphere's depth, ~0.2); 0.835 / 0.958 with the new Mars sky (#147: the mountains' haze is tan and thinner, the sky above it less bright) | (no off comparison) | (no profile) |
| `mars-sky-zenith` | Mars's day sky looking up, the zenith over the sky 35° lower: luma 0.277, blue/red 0.897 (#147; tan, with a gradient) | (no off comparison) | (no profile) |
| `mars-sky-antisolar` | the sky over the anti-solar horizon over the sky 30° up: 1.643 / 1.078 (#147; before it the anti-solar sky was nearly black) | (no off comparison) | (no profile) |
| `mars-sky-aureole` | the aureole within 10° of the Sun over the sky 40° off: 2.418 / 1.768 (#147: bluer, as the rovers see it; before, white across the frame) | (no off comparison) | (no profile) |

With #88's clouds (one shell over both sides of the swap) every Earth
view passes as before: `earth-orbit-gibbous` 1.000 in luma and per channel
(profile 24.2 / 1.2; its date, 2025-04-12, has VIIRS clouds over the
disc), `earth-night-europe` 1.001 (median luma 55.8 on and off; its date
is in the future, so the bundled clouds), `earth-night-dusk` 0.973 mean,
`earth-low-dusk` 1.002; the views below 10 km have no clouds (the shell's
far-field fade) and read as before.  Nothing re-baselined.

The `*-labels` views (#172) measure no ratio: label pixels (what the
place labels add over Cesium's render; the tolerance is at least 400) read
`earth-labels` 3280, `moon-labels` 3614, `mars-labels` 1939 at 480x300,
and 0 with the layer hiding the places, as `_hideSurface` did.

With #147 (multiple scattering for every body; Earth's gain 30 → 21):
`earth-orbit-gibbous` 0.991, `mars-gibbous` 0.995 (profile max 5.1),
`earth-low-land-day` 0.940 with luma 71 on and 76 off (77.9 / 80.8 before),
`mars-low-horizon` 0.949 (42.8 / 44.0), `mars-low-horizon-band` 0.903 /
1.001, `mars-near-ridge` 1.054 / 1.028, `mars-below-datum-band` 0.928 /
1.016, `mars-below-datum-sunward` 0.846 / 0.977, `earth-dead-sea-band`
1.006 / 0.897; nothing re-baselined.

With #188 (Mars's dust forward peak; composition.md, "The dust's forward
peak") every Earth view reads as before to run-to-run noise (rerun
together: `earth-low-land-day` 0.932 / 0.932, `earth-low-dusk` 1.002 /
1.002, `earth-orbit-gibbous` 1.000 / 1.000; Earth's tables are
unchanged), and the Mars views move with the sky.  Re-baselined:
`mars-low-horizon` 0.947 → 0.835 (luma 55.6 / 57.7 → 37.9 / 44.0): the
haze over the ground is about a third less and the brighter aureole meters
the frame darker, so Cesium's darker ground shows through; the ground
under the haze is 0.71 of celestiary's before and after (linear, the
composite less the sky, `uDebug` 7 and 2).  `mars-sky-antisolar` 1.515 →
3.088 / 1.093: the anti-solar horizon over the sky 30° up, 2.3-3.8 in a
Monte Carlo of the dust's radiance, 1.29 in the old method's (its
isotropic excess) and 2.7 in the new.  `mars-sky-aureole` 2.407 / 1.759 →
1.879 / 1.415: the compact core is white after the tone map and the blue
ends about 6° out, where the old flat disc was blue to 18°.  The rest
pass as they were: `mars-sky-zenith` 0.247 / 0.812 (0.334 / 0.966),
`mars-below-datum-sunward` 0.967 / 0.988 (0.847 / 0.977),
`horizon-terrain-far` 0.941 / 0.978 (0.802 / 0.966),
`mars-near-ridge` 1.003 / 1.017, `mars-low-horizon-band` 0.889 / 0.995,
`mars-below-datum-band` 0.964 / 1.000, `mars-gibbous` 0.993.

With #96 (the IAU prime meridians) Mars turns differently at every date,
and a permalink holds the camera in the body frame, so the Mars views'
`t` moved back by under half a sol (0.011 d for `mars-gibbous`, 0.41-0.44 d
for the rest), to where the new orientation matches the old one to
0.001°: the same ground, the same camera, the Sun within 0.25° of where it
was.  The Moon's orientation moved to the IAU model, 0.04° from Cassini's
laws, and its view kept its `t`.  Measured then: `moon-quarter` 0.967
(profile 18.8 / 5.6), `mars-gibbous` 0.995 (4.9 / 1.1), `mars-low-horizon`
0.948 (42.3 / 43.8), `mars-low-horizon-band` 0.918 / 1.001,
`mars-near-ridge` 1.050 / 1.024, `mars-below-datum-band` 0.907 / 1.016,
`mars-below-datum-sunward` 0.847 / 0.977, `horizon-terrain-far` 0.836 /
0.958, `mars-sky-zenith` 0.271 / 0.896, `mars-sky-antisolar` 1.643 / 1.086,
`mars-sky-aureole` 2.396 / 1.768; nothing re-baselined.

With the lunar photometric function on both Moons (#192): `moon-quarter`
1.000 in luma and per channel (mean 1.008), profile 5.2 / 1.7, at
`imageryScale` 0.815 (1.077 at the old 0.78, the sheen gone from
celestiary's side; above, the Moon's photometry); the view's median lit
luma is 40 of 255 on and off (21 before the meter's anchor took the Moon's own highlight).  `moon-labels` 3608 label pixels.  The
ratio's band stays 0.97-1.03 and the profile's bounds 30 / 8: the profile
is now well inside them.  Run with ion's world imagery (asset 2) aborted,
the account being over its imagery quota; the Moon views don't use it.
With the tiles' relief too (#192's relief, on top of the photometry):
`moon-quarter` 1.000 (mean 1.017), profile 5.2 / 1.83; `moon-labels` 3608
(Relief on the Moon's tiles, above); nothing re-baselined.

Measured after #86's PR A (one HDR buffer; Earth under celestiary's
atmosphere pass on both sides), with #137's IAU poles (Mars's turned the
view: its profile max went from 5.5 to 9.5).  Earth's orbit profile max
ranged 29.5 to 36.6 over runs.  Before it, on the same machine:

| View | Luma | R / G / B | Profile max / mean |
|---|---|---|---|
| `earth-orbit-gibbous` | 0.975 | 1.125 / 0.973 / 0.736 | 23.1 / 9.4 |
| `moon-quarter` | 0.967 | 0.967 / 0.967 / 0.967 | 19.4 / 5.5 |
| `mars-gibbous` | 0.992 | 1.000 / 0.991 / 1.000 | 5.9 / 1.1 |
| `earth-low-dusk` | 0.899 | 1.198 / 0.866 / 0.511 | 25.0 / 8.8 |

(The Moon measured 0.905 when the check was written; by the time #134
merged, #130's new lunar orientation had turned a different face to this
view, and it read 0.967 on main, outside its first tolerance.)

- **Mars matches**: its Cesium tiles under celestiary's atmosphere pass are
  within 1.5% and 5 levels of celestiary's own.
- **The Moon is 3% darker** in Cesium, equally in all channels, and the
  whole difference is at the bright limb (the profile agrees to 1-3% from
  the terminator to the disc's middle, then falls to 0.75 at the limb).  It
  is celestiary's specular: its Moon is a `MeshPhysicalMaterial` (F0 0.04,
  roughness 0.8), whose Fresnel term brightens grazing views, while
  `sunlitShader` is Lambert only.  With the Moon's `specularIntensity` set to
  0, celestiary's lit disc is 4.5% darker and Cesium's is 1.4% brighter
  than it.  Whether the Moon should have that sheen is a lighting question,
  separate from #86.  (It doesn't: the lunar photometric function, on both
  sides since #192's photometry, is the regolith's whole reflectance.)
- **Earth matches**, since #86's PR A put its Cesium globe under
  celestiary's atmosphere pass: within 1% in luma, 2.4% in red, from orbit
  and from 400 km; profile means of 1-2.5 levels.  Before, Cesium drew its own sky and ground atmosphere:
  from orbit, its `1 − e^(−2x)` curve over the lit surface plus its haze
  made the disc 12% redder and 26% less blue than celestiary's; from 400 km
  its ground atmosphere had faded out (Cesium's `lightingFadeOutDistance`,
  10,000 km from the centre), leaving the lit imagery unhazed and brown
  where celestiary's Bruneton pass gives a blue haze.  Neither was
  celestiary's atmosphere failing to reach Cesium's ground: the pass stood
  down for Earth by design (`atmosphere: true`).  The remaining profile
  maximum, from orbit, is one sample where the coast meets the lit limb,
  and moves by several levels between runs.
- **Earth at twilight, metered** (`earth-twilight-metered`, 3 km over the
  outback, Sun 5° under the horizon, landed): the metered exposure lifts
  the frame about 14× with Cesium's terrain in it (#86's PR B), and the
  decode, scaled by the exposure over Earth's keyed one, keeps Cesium's
  side with celestiary's: the sky band on against off 1.000.  Rendered
  before the exposure had settled, the two sides differed by a third, so
  parity now waits for the gain to reach its goal before its two renders;
  and the view's `cq` is in the landed frame (the `L` in `s=`), without
  which the restore looked up at the zenith.  The ground under the band
  is left out: at night it is two models, Cesium's night floor against an
  unlit sphere.
- **Earth low over land by day** (`earth-low-land-day`, 7.5 km, Sun 8° up):
  Cesium's ground is 3-6% darker than celestiary's (its imagery and terrain
  Lambert against celestiary's texture), under the same haze.  Until #141's
  fix the atmosphere pass washed the day ground out on both sides alike,
  which the ratio (1.0) couldn't see, so the view also bounds each render's
  own median luma (`luma`, 65-90; it read 55).  The eye-adaptation boost,
  since removed (#86 PR B),
  covered the ground (T 0.094 over it from 7.5 km), and below 1.3 km the
  in-scatter table's ground slice gave the ground the horizon's glow; see
  [composition.md](js/scene/atmos/composition.md).  A 16 m view isn't in
  the list: at ground level Cesium's tiles never all read loaded, so it
  never settles.
- **Terrain over the sphere's horizon** (`earth-ridge-day`, 6.5 km near
  Everest, looking up a valley at a ridge): celestiary's sphere has no
  ridge there, so the view checks Cesium's ridge against the valley ground
  below it in the same render (`reference`).  Before #141's terrain depth
  the atmosphere pass drew sky over the ridge (luma 0.69 of the ground's,
  blue/red 2.24 of it); now 0.97 and 0.99.  The view stops the clock at
  load (`freeze`): with the clock running while tiles load, the ground
  turned under the camera and each run framed different mountains.
- **Mars low** (`mars-low-horizon`, 232 m in Valles Marineris, Sun low on the
  left): Cesium's Mars terrain lies mostly below the datum, under
  celestiary's sphere.  Over the ground both sides get the table's haze to
  the sphere (0.942, Cesium's imagery a little darker); the band on the
  right between the terrain's horizon and the sphere's
  (`mars-low-horizon-band`) read as ground with the stars through it until
  #141's Mars fix, and is now the horizon's haze.
- The night side is left out of the ratios (under luma 12), so #93's city
  lights, which only celestiary draws, don't enter them; only the
  profile's dark end sees them.

### Caveats

- Numbers are SwiftShader's; a real GPU may differ a little.  Keep
  baselines from one machine, and re-measure them if the environment
  changes.
- The views are at 20,000 km and below, where Blue Marble is Earth's whole
  surface: ion's world imagery (Bing) only comes in from globe tile level 5.
  In the sandbox `dev.virtualearth.net` is also denied, so that path is
  unchecked here.  Add a low, terrain-level Earth view (with Bing reachable)
  when #92 lands.
- At low altitude the disc fills the frame, so the "disc" region is the
  whole image and the profile runs to the image's edge, not the limb.
- The page's own time is paused, so both renders are the same instant;
  celestiary's animation frames carry on around the two forced ones.
