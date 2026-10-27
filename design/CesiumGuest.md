# Cesium as a cross-origin guest

*Proposed 2026-10-24.  Phase 0 measured; phase 1 built: Earth's Cesium from
the guest page, behind `?cesium=iframe` (below).*

**Decided (2026-10-24; hosting revised 2026-10-27):**
- the guest is served from a site of its own, so it runs in a process of
  its own: pablo-mayrgundter/cesium-portal's Pages,
  `https://pablo-mayrgundter.github.io/cesium-portal/` (Hosting, below).  A
  subdomain of celestiary.org, the first choice, would be the same site,
  and the M2's numbers (phase 1) showed a guest on celestiary's thread only
  adds the wait;
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
origin as production, so they compare the same way.

**The choice (2026-10-27): another site.**  celestiary.github.io itself is
no good: every path there answers 301 to celestiary.org's (the org's user
page holds the custom domain), so an iframe pointed at it ends on
celestiary.org.  pablo-mayrgundter.github.io has no custom domain, and each
`*.github.io` is a site of its own (the public suffix list), so the guest
gets a process of its own there, as netmap's orbits do the other way
round.  The repository `pablo-mayrgundter/cesium-portal` holds only what
CI deploys to its `gh-pages`:

- `.github/workflows/cesium-guest.yml` builds celestiary and pushes the
  guest's files (`cesium-guest.html`, `cesium-guest/`, `cesium/`, no source
  maps) with the `CESIUM_GUEST_DEPLOY_KEY` secret, a deploy key with write
  access there.  Without the secret it deploys nothing.
- main goes to the root: `https://pablo-mayrgundter.github.io/cesium-portal/cesium-guest.html`,
  the default for `?cesium=iframe`.
- A PR goes to `pr-preview/pr-<n>/`, removed when it closes.  A celestiary
  preview loads its PR's guest with
  `?cesium=iframe&cesiumGuest=https://pablo-mayrgundter.github.io/cesium-portal/pr-preview/pr-<n>/`.
- ion's token must allow `https://pablo-mayrgundter.github.io/` (the
  guest's requests carry that Referer), or the guest has no terrain.

**The guest page's source is celestiary's** (`js/cesium-guest/`, its own
esbuild build into `docs/cesium-guest/`, as layer mode's page is), and only
its hosting is elsewhere.  This proposal first put the source in the fork.
Building phase 1 showed why not: the guest runs the same code as
celestiary's own Cesium layer, its widget set-up, imagery, ion requests,
heights and shaders (relief, the encoding, the distance in alpha), with
bun tests beside it.  So that code is one module, `cesiumBody.js`, which
both paths drive.  In the fork it would be a copy, or a package to
publish, and the two layers would drift.  What the guest's site serves is
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

**Lockstep.**  `beforeRender` posts the view.  ThreeUi's `renderLoop` then
renders celestiary's scene into `_sceneRT` and stops before the composite
while a guest's view is out (`CesiumLayers.awaitingGuests`).  The guest's
frame is needed only from the composite on, so the GPU draws celestiary's
scene while the guest computes its frame.  Before #310 the wait came before
the scene's render, and the two ran one after the other.  The receiver's
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

**Not yet, in iframe mode** (as phase 1 left it; phase 4 below does the
first four):
- the night lights: their frame is a second render with other settings.
  It needs the receiver to drain one sub-frame at a time;
- New York;
- the Moon and Mars, which stay on the page;
- the terrain height at a landing place (`groundHeightAt`), which needs a
  request and a reply.  The height under the camera comes with each
  status;
- the sky's crossfade for a body that draws its own atmosphere (none does);
- the `?perf=1` rows of the guest's own cost (#310 added the round trip's
  split, `scene.cesiumGuests`).

**On a real GPU** (the maintainer's machine, PR #309's preview, guest page
on the same origin, 2026-10-27): Earth from the guest page with ion's
World Terrain and the preview's ion token: the Grand Canyon by day, with
celestiary's clouds over Cesium's terrain, and by night looking up, the
horizon's glow and the stars.  Mars beside it, at the same time, is still
Cesium on celestiary's own page (only Earth goes to the guest in phase 1),
its terrain under celestiary's atmosphere.  No night lights on the guest's
Earth, as expected.

**Its cost on the M2** (`?perf=1`, the Grand Canyon from 2.5 km, 1470×838,
the guest on the preview's own origin, portal-netgl 0.6.4, 2026-10-27;
ANGLE Metal times the GPU per encoder, so only the CPU columns and the
counts are read):

| | iframe | same page |
|---|---|---|
| Frames a second (mean; 5th percentile) | 24.7; 7.4 | 27.8; 8.2 |
| Frame interval, mean | 40.6 ms | 36.0 ms |
| `cesium.replay` CPU, on celestiary's thread | 1.3 ms | 6.3 ms |
| Waiting for the guest's frame (`other` CPU) | 12.6 ms | 0.1 ms |
| Cesium's draws replayed | 177 | 177 |

- Cesium's own work left celestiary's thread: 5 ms a frame.  The wait for
  the guest's frame costs more, 12.6 ms, so the frame is 4.6 ms longer.
- On the preview the guest is same-origin, so it shares celestiary's
  thread: the wait is Cesium's work done there anyway, plus the copy.  A
  subdomain (`cesium.celestiary.org`, the first plan) is the same *site*, and Chromium keeps
  a site's pages in one process, so it would be the same.  Cesium runs in
  parallel with celestiary only from another site.
- Even then the frame waited in the wrong place: celestiary posted the view
  and idled until the guest's frame landed, before drawing its own scene.
  It now waits only before `composite()` (Lockstep, above).  On SwiftShader
  that changes little (the wait 5.8 ms a frame before, 5.2 ms after, at 7.1
  to 7.2 frames a second): issuing the scene costs the CPU about half a
  millisecond, and SwiftShader's "GPU" is CPU threads competing with the
  guest.  What it buys is the real GPU drawing celestiary's scene during the
  wait, which needs the M2 with a guest on another site to see.
  `ThreeUi.guestWait` (frames held and ms waited) and `yarn
  cesium-guest-check`'s `waitMs` measure it.
- On 0.6.4 the shadow still draws (the same-page snapshot's
  `cesium.shadow.earth` has all 177 draws); 0.6.6 takes them out, on either
  page.
- Not the guest's: in both, the meter's CPU time is 18.6 to 20.2 ms on
  average, but 107 to 115 ms at the 95th percentile, about one frame in
  four.  That accounts for most of the mean interval and the 8 fps 5th
  percentile.

**On the M2 with the guest on a site of its own** (#310's preview, the
guest from `pablo-mayrgundter.github.io/cesium-portal/pr-preview/pr-310/`,
portal-netgl 0.6.6, the overlap; the same view, 2026-10-27):

| | Cross-site guest (#310) | Same-origin guest (#309) | Same page (#309) |
|---|---|---|---|
| Frames a second (mean; 5th percentile) | 28.1; 12.6 | 24.7; 7.4 | 27.8; 8.2 |
| Frame interval (mean; p95) | 35.6; 79 ms | 40.6; 135 ms | 36.0; 122 ms |
| Main-thread CPU, the frame's | 32.1 ms | 38.0 ms | 32.2 ms |
| `cesium.replay` CPU | 1.2 ms | 1.3 ms | 6.3 ms |
| Waiting for the guest (`other`) | 13.7 ms | 12.6 ms | 0.1 ms |
| `meter` CPU (mean; p95) | 11.6; 58 ms | 18.6; 115 ms | 20.2; 107 ms |

- The page's frame rate, and steadier: the slowest frames run at 12.6 fps,
  not 8.2, and the 95th percentile interval is 79 ms, not 122.  The meter's
  readback stalls halved, which fits the GPU catching up on celestiary's
  scene during the wait.
- Three things changed at once: the overlap, the guest's own site, and
  0.6.6 (the shadow no longer draws; the same-page baseline's shadow drew
  all 177 draws on the same GPU).  Production on 0.6.6, the same page, is
  the baseline that separates them (below).
- The wait, 13.7 ms, is the guest's own frame in its process plus the trip
  both ways.  `?perf=1`'s snapshot now splits it: `scene.cesiumGuests` has,
  per guest page, over its last 240 round trips (mean and p95), `tripMs`
  (the view posted to the guest's frame in), `toGuestMs` (the view's way
  in), `guestMs` (the view in to the frame's batch posted, by the guest's
  clock), `backMs` (the batch's way back, decoded and in), and `waitMs`
  (what the frames waited).  The guest's `cesium:status` carries the timing
  (`receivedAt` on the wall clock, `performance.timeOrigin + now`, which
  both pages share, and `renderMs`); `yarn cesium-guest-check` reports it
  as `split`.  Two processes' clocks agree to about a millisecond, so a way
  shorter than that can read a little under 0.  On SwiftShader, cross-site:
  a trip of 10.8 ms was 3.3 in, 7.6 the guest's frame, and −0.15 back (the
  batch, posted at the frame's end, is in by the time its frame-end is).

The baseline and the split, on the M2 (the same view, 2026-10-27, `?perf=1`;
production is the same page on 0.6.6, #310's preview the cross-site guest):

| | Same page, 0.6.6 (production) | Cross-site guest (#310) |
|---|---|---|
| Frames a second (mean; 5th percentile) | 33.0; 10.5 | 27.8; 12.6 |
| Frame interval (mean; p95) | 30.3; 95 ms | 36.0; 79 ms |
| Cesium's work on celestiary's thread (`cesium.replay` CPU) | 6.0 ms | 1.2 ms |
| Waiting for the guest (`other`) | 0.1 ms | 14.0 ms |
| `meter` CPU (mean; p95) | 15.6; 82 ms | 11.8; 55 ms |
| The shadow's draws | 0 | (no shadow) |

`scene.cesiumGuests` on the guest: a trip of 14.3 ms (p95 17.6) was 1.1 ms
in, 9.9 ms the guest's frame (p95 12.9) and 3.3 ms back; the frames waited
13.7 ms.

- 0.6.6 was the same page's big gain: 27.8 to 33.0 fps, with the shadow's
  177 draws gone from the GPU.
- Against that, the guest costs 5.7 ms a frame on the mean: 4.8 ms of
  Cesium's work leaves celestiary's thread, a 14 ms wait comes in, and the
  meter's stalls shrink by about 4 ms.  Its slowest frames are still faster
  (12.6 fps at the 5th percentile, not 10.5), by the meter.
- The overlap hides almost nothing: the wait is the whole trip less half a
  millisecond, because issuing celestiary's scene costs the CPU that much,
  and the camera's update (3.8 ms) comes before the view can be posted.
  Lockstep keeps the trip on the frame's critical path.
- The guest's frame takes 9.9 ms for what costs about 4.8 ms on the same
  page: Cesium's render, plus recording and encoding the batch, in another
  process.  The way back, 3.3 ms, is the batch's clone across processes and
  its decode.  Those two are what a faster lockstep would cut; a frame of
  lag would hide the trip whole, at the cost of Cesium's frame being a
  frame behind the camera.
- `?perf=sync` timed no GPU work here: its rows were the issue times, so
  `finish` didn't wait; `&barrier=read` is the way.

With `?perf=sync&barrier=read` (each pass's wall time with the GPU waited
on, so 20.8 fps, not 28; the same view and preview), the 48 ms frame:

| Pass | Wall ms, mean | |
|---|---|---|
| `other` (waiting for the guest) | 17.4 | the guest's frame and the trip |
| `clouds.volume` | 8.1 (p95 15) | the volumetric clouds: celestiary's heaviest pass |
| `cesium.replay` | 5.2 | the GPU drawing Cesium's 177 replayed draws |
| `update` | 4.0 | CPU |
| `atmosphere` | 2.6 | |
| `cesium` | 2.5 | |
| `overlay` | 1.7 | |
| `scene` | 1.5 | |
| everything else | 5.0 | each under 1.1 ms; `meter` 0.5 |

- The meter's stalls are gone when the GPU is waited on after every pass
  (0.5 ms), so in the unsynced snapshots they were the GPU's backlog
  arriving at the meter's readback, not the meter's own cost.
- Moving Cesium out moved its scene's CPU work off celestiary's thread, but
  not the replay's GPU work: 5 ms of celestiary's GPU frame is still
  Cesium's.  A guest that drew its own frame and handed over the pixels
  and depth instead of draws would take that too, at the cost of a copy
  across processes each frame; not planned.

**On a PR preview**, before the guest has a host of its own: celestiary's
build serves the guest page too, and `https://celestiary.org` is on the
list of guest origins, so a preview can load its own.  It's the same
origin, so the same process (not the cross-site case the check runs), but
the same wire, lockstep and ion (the token allows celestiary.org):
`https://celestiary.org/web/pr-preview/pr-<n>/?cesium=iframe&cesiumGuest=https://celestiary.org/web/pr-preview/pr-<n>/cesium-guest.html#<permalink>`.

## Phase 4: the rest

Built 2026-10-28, still behind `?cesium=iframe`.

**The night lights.**  On the page they're a second render of Earth's
widget: only the night layer, unlit, on black, which the host decodes
after the day frame (CESIUM.md, "Night lights").  From the guest page both
renders come in one drain, so each needs a target of its own.
- portal-netgl 0.6.8 ([portal#48](https://github.com/pablo-mayrgundter/portal/pull/48))
  tags a frame-end with a `part`, and the receiver calls `beforeFrame(end)`
  before each frame's calls replay, a re-run's too.  The replay asks for
  the screen's framebuffer at each bind, so `_replayConfig` returns
  the lights' target (`GuestPages.lightsTarget`) while the part is
  `'lights'`.
- The host asks for the lights (`lights` in the view) where they can show
  (`_lightsShow`, as on the page), once the guest says it has them (its
  status's `night`) and the receiver has called `beforeFrame` (0.6.8).
  Before an older receiver or guest nothing changes.
- The guest renders the lights after the day frame
  (`cesiumBody.renderNightLights`, the page's settings, shared), and ends
  it with `part: 'lights'`, even if it fails.  The view lands with that
  part.
- Before the drain, the host clears that target and copies the shell's
  stencil and the depth into it, as the page's lights render finds
  `_cesiumRT`.  After it, `_decodeLights` decodes it as the page's.

The guest pages' code on the host (the iframes, the receivers, the views
and the waits, the lights' target, the messages and the timing) is
`js/scene/cesium/guestPages.js`, which CesiumLayers imports with its first
guest page: none of it is in the first load.

**The Moon and Mars** load from guest pages of their own: `_load` takes
the guest page for every body, so with `?cesium=iframe` celestiary's page
loads no Cesium at all.  The guest page already took any body (`?body=`).
They need ion, so they're untested here: check them on the preview.

**The landing height.**  `groundHeightAt` is synchronous, and a guest
page's tiles are in its own page.  `Scene.land` aims at the sphere when it
has no height, and asks `CesiumLayers.requestGroundHeight`, which posts
`cesium:height {id, lat, lng, radius}`; the guest answers with `terrainHeight` from the
tiles it has (as the page does), or the host gives up after a second.  If
the answer comes within half a second and the same landing is still under
way, the landing is aimed again over the terrain (`Scene._reaimLanding`);
later, the ground floor lifts the camera as it arrives, as with coarse
tiles on the page.

**New York.**  The city is drawn by Earth's Cesium through its external
renderers, and its calls are replayed into Cesium's NetGL recorder
(`newYorkGuest.js`), which the guest page has too.  So the guest page runs
it as the host's page does: the view carries the switch (`nyc`), the guest
loads, shows and frees the city by the view's range, and its state comes
back in the status for the layers control.  Its options go in the guest
page's URL (`nycGuest`, checked against the same list; `nycShadows`,
`nycLean`), and it has the same import map for three.js's dev build.  Each
of the city's calls is now recorded twice, by the city's context and by
Cesium's, and crosses to celestiary's process; its set-up is millions of
triangles, staged a chunk a frame.  Unmeasured: see the check below.

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
   default or stays an option.  *Built (above).*

## Open questions

- Does New York move with Earth, or stay on the same page (which would
  keep the same-page Cesium for Earth while New York is on)?
