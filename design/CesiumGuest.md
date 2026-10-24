# Cesium as a cross-origin guest

*Proposed 2026-10-24; phase 0 measured (below).*

**Decided (2026-10-24):**
- the guest is served from the fork's Pages on a subdomain of its own
  (`cesium.celestiary.org`): cross-origin, same site;
- the aim is a demo of Cesium cleanly hosted and minimally modded: the
  guest page is stock Cesium plus the fork's few patches, with
  celestiary's look carried by settings and its own shaders, and nothing
  of celestiary's reaching into Cesium;
- lockstep first (A, below); reprojection later.

## What and why

Today Cesium runs in celestiary's own page, against a shadow context, and
`makeNetGLImmediateLink` replays each call into celestiary's context as it is
recorded ([CESIUM.md, Architecture](../CESIUM.md#architecture)).  The
proposal is to move Cesium into a page of its own:

- served from our Cesium fork's GitHub Pages (celestiary/cesium), not
  celestiary's;
- embedded by celestiary as an iframe on another origin;
- talking to it over portal-netgl 0.6.x's cross-origin wire.

Two reasons:

1. **Evaluate 0.6.x on a heavy guest.**  Wire 2, the port, slices,
   `shadowDraws: false` and host reprojection (0.6.0 to 0.6.4) have been
   tested with one guest: celestiary's orbits inside netmap's deck.gl globe,
   about 120 calls and 12 to 50 KB a frame ([LayerMode.md,
   Cost](LayerMode.md#cost)).  Cesium is that reversed: celestiary hosts, and
   the guest streams tiles, textures, a log depth buffer and full-screen
   passes.  It is also the guest that portal's DESIGN.md calls the reason
   the same-page link exists.
2. **Cesium out of celestiary's build.**  The guest page would be built from
   the fork itself.  That has three effects:
   - patch-package and `patches/` go, since the fixes are the fork's own
     source;
   - a fix in Cesium's prebuilt workers becomes possible, which patching
     can't reach ([CESIUM.md, Patching
     Cesium](../CESIUM.md#patching-cesium));
   - the ion token goes to the fork's deploy.

   Celestiary keeps only the composite.

## What crosses today, synchronously

Everything below is a direct call from `CesiumLayers.js` into the widget,
inside celestiary's frame.  Across an iframe each one becomes a message,
and most of it moves into the guest page.

| Today (same page) | Across the iframe |
|---|---|
| `_setCesiumView`: camera position, direction, up, right, fov, far; light direction; `skyAtmosphere.brightnessShift` (the crossfade); screen-space error (`detail`) | One per-frame view message, in ECEF, computed in doubles by celestiary as now (`frames.js` stays in celestiary). |
| `link.frame(() => widget.render())`, then `resetState()` | The guest renders on the view message; its batch is replayed in `composite()` with the same screen policy (stencil, premultiplied-over, depth-only clears, `screenFramebuffer` onto `_cesiumRT`). |
| The night-lights frame: layer alphas, `baseColor`, `enableLighting` flipped, a second `render()` | The guest renders both in one batch, as two [sub-frames](https://github.com/pablo-mayrgundter/portal/blob/main/packages/portal-netgl/DESIGN.md#sub-frames), tagged; the host replays the first before its decode and the second into the lights target. |
| `globe.getHeight` / `tileset.getHeight` every 200 ms; `groundHeightAt` on landing | A request and a reply.  The 200 ms sampling is already asynchronous in effect; landing's height (`Scene.js` `goTo`) would use the last answer, or wait for one. |
| `tilesLoaded`, the warming and the fade | A status message per frame. |
| Credits written into a DOM container | Credits sent as data (text, link, logo URL) and drawn by celestiary.  Never the guest's HTML. |
| `Ellipsoid.default` switched per body | Gone: one iframe per body, each with its own realm. |
| Imagery choices (ion or bundled, the month's Blue Marble, Bing below its altitude) | Guest-side, driven by the view (date, altitude). |
| New York, nested in Earth's widget (`newYorkGuest.js`, `netglLean.js`) | Moves into the guest page with Earth.  See the risks below. |
| `?perf=1`'s `cesium.shadow.<body>` timer | The guest's own stats, reported as layer mode's `layer:stats` are. |

What stays in celestiary: `frames.js`, the stencil shell, the depth save and
restore, the decode into exposure units (`bodyGain`, `exposureOf`), the
ground proxies, the clouds, the atmosphere pass, activation
(`_visibleAt`), and the layers control.  `bodies.js` splits: the radii and
gains stay with the host, the data sources go with the guest.  `relief.js`
and `encoding.js`'s shader halves go with the guest.

## The hard part: lag

CESIUM.md and portal's lessons both name lag as the reason for the
same-page link.  The host draws its stencil shell, atmosphere, clouds and
labels at the current camera.  A guest frame drawn for the previous view
slides against all four.  There are two ways to close the gap, and they
can be combined.

**A. Lockstep.**  Celestiary updates its camera at the start of its frame,
posts the view, and draws the frame when the guest's batch for that view
lands (netmap's `requestGuestFrame` measured 21 ms view → shown at rest,
on SwiftShader).  There is no lag at all, but celestiary's frame rate
becomes the guest's, plus one round trip.  Celestiary can't block on a
message, so this means splitting `renderLoop` into "post the view" and
"draw on arrival", with a time-out that falls back to the last frame.

**B. Host reprojection** (0.6.3 to 0.6.4).  It is exact for geometry, which
is what a globe is, but 0.6.x's rule doesn't fit Cesium in four ways.
Each one is a portal change to make and test:

1. **Which draws to correct.**  0.6.x applies C to draws to the screen,
   and the identity to the guest's own framebuffers.  Cesium draws its
   scene into its own framebuffer (the globe-depth target) and then copies
   it to the screen with a full-screen quad.  So the rule corrects the
   copy (moving it) and none of the globe.  Cesium needs the reverse:
   - correct draws into its screen-sized scene framebuffers;
   - leave its viewport-quad passes alone.

   0.6.4's opt-in, where a shader that declares `netgl_reproject` isn't
   wrapped, lets the fork opt its viewport quads out.  The framebuffer
   rule needs a new hint: the guest names its screen-equivalent targets,
   or the replay treats a target at the drawing buffer's size as the
   screen.
2. **Whose projection.**  C = VP_now · VP_f⁻¹ assumes that the guest
   projects with the matrix the host sent.  Cesium makes its own frustum
   (its near and far, and several frustums when log depth is off), so
   the host needs the guest's projection for each sub-frame.  The frame-end
   (or each sub-frame's) would carry it.
3. **Log depth isn't corrected** (DESIGN.md, Host reprojection, Limits).
   This matters only inside Cesium's frame and in the terrain depth
   celestiary reads below 20 km, and it is off by one frame's camera move.
4. **Uncovered edges.**  Cesium culls tiles by the old frustum.  On a pan,
   the strip that comes into view has no tiles.  Inside the stencil, that
   strip is a hole: celestiary's own surface is hidden there.  Overscan
   helps: the guest renders a slightly wider field, and C already
   carries the projection change.  The cost is a little resolution, or a
   larger guest canvas.

Screen-space content gets no correction, as the DSN's lines didn't
(fixed for celestiary's own shaders in 0.6.4).  Cesium draws little of
it here: the sky atmosphere, and labels it doesn't draw.

Recommendation: build A first, because it is correct by construction and
measures the round trip honestly.  Then add B for when the guest falls
behind, which is what 0.6.x's reprojection is for.

## Risks

- **Tile streaming over the wire.**  At rest a Cesium frame should be small:
  checkpoint and draws, no uploads.  While tiles stream, every imagery tile
  is an `ImageBitmap` posted at once in a batch of its own (`urgent`), plus
  terrain vertex buffers.  Nobody has measured how many bytes a second
  that is.  Phase 0 measures it.
- **New York.**  The city's set-up is millions of triangles, staged a chunk
  a frame (`stageLink`).  Today none of that is copied.  Across the iframe,
  every chunk crosses, and a New York call then runs on three contexts
  and crosses two encodings ([portal DESIGN.md, Nested
  guests](https://github.com/pablo-mayrgundter/portal/blob/main/packages/portal-netgl/DESIGN.md#nested-guests-cesium-drawing-new-york)).
  It should move last, and only if the measurement allows.
- **Several bodies.**  One receiver serves one transport, and one
  iframe per body is the simple fit.  It loads Cesium once per body
  (memory), which an iframe per body *in range* limits.
- **The shadow.**  `shadowDraws: false` needs a guest that reads none of
  its pixels.  Cesium reads them for picking and camera collision.
  Celestiary turns Cesium's inputs off and takes heights from CPU picks,
  so it should hold, but that is to be checked.  It is also a win on the
  same page now, halving the GPU work of a globe (CESIUM.md's perf
  follow-up).  `makeNetGLCesiumGuest` doesn't pass the option through
  yet.
- **Credits.**  ion's terms want them shown.  Rendered by the host from
  data, they stay correct only if the guest sends them each time they
  change.
- **Trust.**  The host executes the guest's GL.  Celestiary takes a guest
  only from origins on a built-in list (as `js/layer/origins.js` does for
  hosts).  A `?cesiumGuest=` URL for previews picks from that list, and
  can't add to it.

## Hosting

celestiary/cesium's Pages would serve at `celestiary.github.io/cesium/`,
which redirects to **`celestiary.org/cesium/`**: celestiary.github.io has
the custom domain, so the org's project sites inherit it (checked with
curl, 301).  That is the *same origin* as production celestiary, so the
fork's Pages alone don't give a cross-origin guest.  The options:

| Where | Origin vs celestiary.org | Process (Chromium) | ion token | Notes |
|---|---|---|---|---|
| `celestiary.org/cesium/` (the default) | same origin | same | works as is (Referer under `celestiary.org/`) | The iframe could even link synchronously (`contentWindow`), with zero lag.  It doesn't test the wire. |
| A subdomain, e.g. `cesium.celestiary.org` (the fork's Pages with a CNAME) | cross-origin, same site | same process | add the subdomain to the token's allowed URLs | Wire 2 and the port, with no cross-process IPC.  Needs a DNS record. |
| Another site (e.g. a `*.github.io` without a custom domain) | cross-site | separate process | add it to the token, or a separate token | The netmap case: the heaviest transport.  It is already being measured there for a light guest. |

celestiary's PR previews (`celestiary.org/web/pr-preview/…`) sit on the same
origin as production, so they compare the same way.  The fork's own PR
previews would follow its domain.

The guest page's source: in the fork (for example `Apps/Celestiary/`), built
against the fork's engine with all `celestiary/*` fix branches merged,
and deployed with a Pages workflow from a `celestiary/pages` branch.  The
celestiary-specific shaders (relief, the encoding) move there, with their
tests.

## Phase 0: what was measured

Headless Chromium on SwiftShader, 480×300, 2026-10-24.  The probe wraps
Earth's link transport.  It counts each call the recorder posts (sliced,
as wire 2 would ship it), each argument's own bytes, and the images.  It
also counts every readback on every WebGL2 context from page load.  Earth
ran on its bundled imagery and the plain ellipsoid: this session's ion
token was stale (ion answered 401), so World Terrain, Bing, the Moon and
Mars weren't measured.

| View | Calls a frame | KB a frame (clock running; held) | Set-up to settled |
|---|---|---|---|
| Earth from 20,000 km | 208 (199 held) | 3.8; 3.4 | 32 MB in 10 to 17 s, all one `texImage2D` |
| Earth at 12 km, over the Gulf | 263 (259) | 5.9; 5.6 | 33 MB, 2 images |
| Earth at 6.5 km, Everest | 530 (497) | 15.5; 14 | 35 MB, 3 images |

- **At rest Cesium's frame is light**, the size of the orbits layer's
  frame in netmap (about 120 calls, 12 KB).  On wire 2 it is one message a
  frame of a few KB.  It has no uploads, only the checkpoint, uniforms and
  draws.
- **The set-up is one big image.**  The month's Blue Marble goes up whole,
  in one 32 MB upload.  Across an iframe that is a 32 MB
  `ImageBitmap` clone, in a batch of its own, at load and at each month's
  change.  Streaming imagery tiles from ion would be many small images
  instead.  That is still to be measured with a working token, on the
  preview or locally.
- **No readbacks.**  Nothing read Cesium's shadow, in any view, with or
  without the shadow's draws.  This held from page load, Cesium's
  construction included.
- **`shadowDraws: false` holds.**  With the instant pinned
  (`c.time.setTime`, paused, the tiles settled again), Earth from orbit
  is bit for bit the same with and without the shadow's draws (0 of 115,680
  pixels).  At 12 km 4 pixels differ, by 1 (an earlier run, with the clock
  unpinned).  At Everest the frame is celestiary's volumetric cloud deck, and
  differs by at most 8 levels; that isn't Cesium's.  SwiftShader drew 4 to 7%
  more frames without the shadow's draws.  A real GPU's gain needs `?perf=1`
  on the preview.  So celestiary turns them off (`?cesiumShadowDraws=1`
  turns them back on), on portal-netgl 0.6.5.
- **New York isn't measured.**  The city's set-up stages a chunk a frame,
  and only in frames that draw it.  After 25 minutes on SwiftShader, 24,388
  of its queued messages were still waiting: the probe's camera, landed
  over Lower Manhattan, wasn't looking at the city.  The city is about
  140 MB built (CESIUM.md), which bounds what its set-up would carry across.

## Phases

0. **Measure on the same page, change nothing users see.**
   - Meter Cesium's stream as wire 2 would carry it (the recorder's slices
     into a counting transport, as `js/layer/wire.js` does).  Count calls,
     bytes and `ImageBitmap`s per settled frame, and per second while tiles
     stream, for Earth from orbit, Earth near the ground, the Moon, and New
     York.
   - Try `shadowDraws: false` on the same-page link (a pass-through in
     `makeNetGLCesiumGuest`, a portal patch release).  Keep it if frames
     match and nothing reads back.
1. **Earth in an iframe, behind a flag** (`?cesium=iframe`), on a local
   two-origin harness as `yarn layer-host` is.  Use the view, status,
   heights and credits messages above, and lockstep (A).  The same-page
   link stays the default.  Check: `yarn parity`'s views match the
   same-page layer.
2. **Reprojection for Cesium** (B): the portal changes in its four points,
   with tests in portal and a pan-and-zoom check like netmap's.
3. **Deploy:** the fork's Pages workflow, the domain, the token's allowed
   URLs, and `?cesium=iframe` on celestiary's preview.  Then `?perf=1` on
   the M2 against the same-page layer, at the views CESIUM.md's perf
   notes use.
4. **The rest:** the Moon and Mars, the night lights, then New York if
   phase 0's numbers allow.  Decide then whether the iframe becomes the
   default or stays an option.

## Open questions

- Does New York move with Earth, or stay on the same page (which would
  keep the same-page Cesium for Earth while New York is on)?
