# Cesium as a cross-origin guest

*Proposed 2026-10-24.  Phase 0 measured; phase 1 built: Earth's Cesium from
the guest page, behind `?cesium=iframe` (below).*

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
2. **Cesium out of celestiary's page.**  Celestiary's page keeps only the
   composite: the stencil, the decode, depth, the atmosphere.  Cesium, its
   assets and the ion token are served from the guest's origin.  Later,
   the guest can be built against the fork's own engine rather than
   patched npm packages (Hosting, below), which would retire patch-package
   and reach Cesium's prebuilt workers, which a patch can't ([CESIUM.md,
   Patching Cesium](../CESIUM.md#patching-cesium)).

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

**The guest page's source is celestiary's** (`js/cesium-guest/`, its own
esbuild build into `docs/cesium-guest/`, as layer mode's page is), and only
its hosting is the fork's.  This proposal first put the source in the fork.
Building phase 1 showed why not: the guest runs the same code as
celestiary's own Cesium layer, its widget set-up, imagery, ion requests,
heights and shaders (relief, the encoding, the distance in alpha), with
bun tests beside it.  So that code is one module, `cesiumBody.js`, which
both paths drive.  In the fork it would be a copy, or a package to
publish, and the two layers would drift.  What the fork's Pages serve is
the build: `cesium-guest.html`, `cesium-guest/` and Cesium's assets
(`cesium/`), deployed from celestiary's CI as `deploy-prod.yml` deploys
to celestiary.github.io.  The Cesium in it is still npm's 1.145 with
`patches/`; building it against the fork's branches instead is a later
step.

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

## Phase 1: Earth from the guest page

Built 2026-10-27, behind `?cesium=iframe` (`?cesiumGuest=<url>` for a copy
on another allowed origin; `?cesiumWait=<ms>` for the wait, 100 by
default).  The same-page layer stays the default and is unchanged.

**One code path, two transports.**  `js/scene/cesium/cesiumBody.js` is
everything done to a body's Cesium widget: `createWidget` (the imagery,
ion's terrain, the lighting, the distance stage), `applyView` (the
camera, the frustum, the detail, ion's imagery, the month, the Sun, the
earthshine), `sampleGround` and `tilesReady`.  CesiumLayers computes a
frame's view as plain data (`_viewOf`).  On the page it calls `applyView`
and renders through the immediate link, as before.  For the guest it
posts the same view.

**The page** (`public/cesium-guest.html`, `js/cesium-guest/guest.js`):
- It loads Cesium and portal-netgl, takes messages only from an allowed
  host (`origins.js` `CESIUM_GUEST_HOSTS`: celestiary.org,
  celestiary.github.io, local development), and pins
  `parentTransport` to it.
- It makes the body's widget at once, with `shadowDraws: false`, and says
  NetGL's `netgl:ready`.  Wire 2 and the port are agreed in the handshake.
- On each `cesium:view {viewId, view}` it applies the view and renders.
  The frame-end carries the `viewId`.  Then it sends `cesium:status
  {viewId, tilesLoaded, groundHeight, credits?}` on the port, after the
  frame.  The credits go only when they change, as plain items
  (`credits.js`: text, http(s) links, https or data images), never HTML.
- `?data=` is celestiary's data base (the Blue Marble), taken only on an
  allowed host (`dataUrl.js` `setDataBaseUrl`).  `?month=` is the
  first view's month.

**The host** (CesiumLayers `_loadGuest`):
- The iframe is laid out at the frame's size but hidden.  The guest's
  Cesium sizes its canvas from its page, which `display: none` would leave
  at 0.
- portal-netgl's `makeNetGLHostReceiver` runs on `iframeTransport`, pinned
  to the guest page's origin.  It has the same replay config as the link
  (`_replayConfig`: `_cesiumRT` for the screen, the stencil, premultiplied
  over, depth-only clears).
- At the end of `beforeRender` it posts the view (`_postGuestViews`), one
  in flight a body.  `composite()` drains the receiver where it would
  render Cesium.
- The status sets `tilesLoaded` (the warming and the fade), the height
  under the camera, and the credits, drawn with celestiary's own elements.

**Lockstep.**  ThreeUi's `renderLoop` stops after `beforeRender` while a
guest's view is out (`CesiumLayers.awaitingGuests`).  The receiver's
`onFrame` for that view's id calls `ThreeUi.resumeFrame`, which draws the
frame in the message's task.  After `guestWaitMs` the next loop draws with
the last frame in, and the view stays out: the next is posted only when it
lands.  So a slow guest gives "latest frame", never a backlog of views.

**Checked** (`yarn cesium-guest-check`: headless Chromium on SwiftShader,
480×300, the app on 127.0.0.1 and the guest on localhost, two sites, so
another process; ion, GIBS and analytics refused; 2026-10-27):

- **The same frame.**  Earth from 20,000 km at the permalink's instant,
  pinned: 0 of 115,680 pixels differ between Cesium on the page and Cesium
  from the guest page.  At 12 km over the Gulf, where the guest streams the
  Blue Marble's tiles from celestiary's origin, 585 differ, by one level:
  less than two runs of one build differ.
- **In step under motion.**  With the camera orbiting Earth every frame for
  20 s, every frame drew the guest's frame of its own view: from 20,000 km
  147 of 147 with a 100 ms wait, 141 of 141 with 3 s; at 12 km 107 of 107.
  A view's round trip, posted to its frame in, was 5 to 7 ms from orbit and
  9 ms at 12 km.  celestiary drew 7.0 to 7.4 frames a second from orbit,
  against 6.65 to 6.8 with Cesium on the page, and 5.35 against 6.2 at
  12 km.  The frame rate is celestiary's own drawing on SwiftShader, not the
  wait.
- **The wire.**  Version 2 with the port open; each guest frame is one
  batch.
- **The refactor.**  The same-page layer is unchanged: Earth from orbit is
  bit for bit the same before and after, at a pinned instant.  At 12 km the
  two builds differ by at most one level, as two runs of one build do.

**Not yet, in iframe mode:**
- the night lights: their frame is a second render with other settings.
  It needs the receiver to drain one sub-frame at a time;
- New York;
- the Moon and Mars, which stay on the page;
- the terrain height at a landing place (`groundHeightAt`), which needs a
  request and a reply.  The height under the camera comes with each
  status;
- the sky's crossfade for a body that draws its own atmosphere (none does);
- the `?perf=1` rows of the guest's own cost.

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
   two-origin harness.  *Built (above); checked with `yarn
   cesium-guest-check` against the same-page layer.*
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
