# Layer mode: celestiary's orbits inside another app's globe

*Proposed 2026-10-23, and phase 1 built on the same branch (see
[Status](#status)).  Builds on PR [#294](https://github.com/celestiary/web/pull/294)
(the space networks) and the spike `spike/satellites-layer`.*

## What and why

Each engine draws what it knows. Cesium draws the globe, celestiary draws
orbits, and netmap draws internet topology. Each appears inside the others
as a layer, through portal's NetGL
([portal-layers.md](https://github.com/pablo-mayrgundter/portal/blob/main/docs/portal-layers.md)),
with no code reaching from one codebase into another.

**Layer mode** is celestiary drawing only its orbit overlays: Earth's
satellites, and the Starlink, Iridium and DSN networks
([Networks.md](../js/scene/networks/Networks.md)). The host app owns the
camera and the clock. Everything else is left out: stars, planets, the
atmosphere, the HUD and Cesium.

The first host is netmap's deck.gl GlobeView, which shows the ground
stations and ASes that the satellites link to.

## The page

- **`layer.html` and its entry `js/layer/layer.js`**, built by the same
  esbuild run into `docs/`. So a PR preview serves it at
  `https://celestiary.org/web/pr-preview/pr-<n>/layer.html`, and production
  at `https://celestiary.org/layer.html`.
- **The host embeds it as a cross-origin iframe.** Its URL query picks what
  to draw (`?nets=S,I,D&sats=1`). The host's origin comes from the
  browser, and `?host=` is the last resort.
- **It loads what it needs and nothing else:**
  - three, satellite.js, the network classes and portal-netgl;
  - no React, MUI, Scene, ThreeUi or ephemeris;
  - its own budget in `esbuild/budget.js`, checked by `yarn bundle-check`.
- **It draws into the host's context through NetGL**, with a
  transparent frame and no clears. It tests against the host's depth
  (shared depth: the host's exact projection, LEQUAL, no depth writes), so
  the host's globe hides what's behind it.

## The contract (host ↔ guest)

The guest is portal-netgl 0.6.0's (pinned), and wire-compatible with its
deck.gl host from 0.4.0 on (`attachNetGLDeckLayer` and `iframeTransport`,
portal #36). Its messages are shaped as portal RFC 0001 has them
([docs/rfcs/0001-globe-orbit-layers.md](https://github.com/pablo-mayrgundter/portal/blob/claude/rfc-globe-orbit-layers/docs/rfcs/0001-globe-orbit-layers.md):
§6 the view, §7 time, §8 anchors, §10 the handshake). They ride beside
NetGL's call stream, in order with it.

**The wire** is agreed in NetGL's handshake, as portal-netgl 0.6.0 has it
([its README, protocol](https://github.com/pablo-mayrgundter/portal/blob/main/packages/portal-netgl/README.md#protocol)):

- **Wire 2**, with a 0.6.0 host. The guest's `netgl:ready` offers `wire:
  2` and `port: 'stream'`; the host's `netgl:ready-ack` answers `wire: 2`
  and transfers one end of a `MessageChannel`. From then on a frame goes
  as one `netgl:batch` (the checkpoint, the calls, the frame-end) on the
  port. The guest's own messages (`layer:hello`, `layer:anchors`,
  `layer:status`, `layer:stats`) go on the port too, in order with the
  stream, through the guest context's `transport`. The host's messages
  stay on the window. The recorder sends only what each call reads (a
  ranged `bufferSubData`'s range, a view's own bytes), in copies of its
  own that it transfers.
- **Wire 1**, with a 0.4 or 0.5 host (netmap's, today): its ack has no
  `wire`, so the guest posts a message a call on the window, as before.
  The recorder still slices.
- The host hands its port only to an exact origin, which the guest is
  (`iframeTransport`).
- `layer.html?wire=1` offers only wire 1, to compare.
- **No draws on the shadow** (portal-netgl 0.6.2's `shadowDraws: false`):
  the guest context's shadow answers three's queries and mints its
  handles, but doesn't run the draws and clears, which only the host's
  replay needs. The layer reads none of its own pixels. The shadow's
  canvas stays 1×1 (three keeps the size it's given, and never reads the
  drawing buffer's). `layer.html?shadowDraws=1` draws on a full-size
  shadow as before, to compare ([Cost](#cost)).

| Direction | Message | Carries |
|---|---|---|
| guest → host | `netgl:ready` | NetGL's handshake (`guest.announce`), repeated every 500 ms until `netgl:ready-ack`, with `wire: 2, port: 'stream', seq, session`. The host sends no view before it. |
| host → guest | `netgl:ready-ack` | `{wire?, port?}`: the wire it will read (absent: 1), and wire 2's port, transferred. |
| guest → host | `layer:hello` | `{version: 1, adapter: 'celestiary-orbits', capabilities: {kinds: ['overlay'], depth: ['shared'], projections: ['matrix'], frames: ['ecef'], warp: false, anchors, time, labels: false}, contracts: {alpha: 'coverage', color: 'display'}, extent: {frame: 'ecef', sphere: {center: [0, 0, 0], radius: 5e7}, beyond: 'clamp-to-far', farthest: 3e13}, ext: {'portal.anchors/1': {publish: ['norad', 'dsn', 'dsn-sc', 'naif'], near: true}}}`. `near` says the subscription takes nearest-anchor patterns (below); a host asks for them only when it's there. Repeated every 500 ms until `layer:hello-ack` (#36 acks every hello, and re-sends its anchor subscription on each), or a first view from a host that doesn't ack (0.4.0 as published). |
| host → guest | `layer:hello-ack` | `{accepted, reason?}` (optional; RFC §10.6) |
| host → guest | `layer:view` | 0.4.0's `NetGLLayerViewMessage`: `{type, viewId, view: {frame: 'ecef', viewMatrix, projectionMatrix, viewport, pixelRatio, timeMs, earth?: {model: 'sphere', radius}}}`. `viewMatrix` maps ECEF metres to eye metres and is rigid. `projectionMatrix` is the host's own, with its scale folded in. Both are column-major arrays of 16, composed in doubles. `viewport` is `[x, y, w, h]` in drawing-buffer pixels. A flat view (this PR's first shape) is ignored. |
| guest → host | `netgl:batch` (wire 2), or `netgl:*` a call each (wire 1) | the frame's GL calls, ending in `netgl:frame-end`. This is the frame's receipt: the host sends its next view on it (`receiver.onFrame`; one view in flight, re-sent after 1 s). |
| guest → host | `layer:invalidate` | `{reason}`: what's drawn changed with no new view: the snapshots loaded (`'loaded'`), the DSN's feed changed (`'dsn feed'`, at most every 5 s, and not for the same feed again), a subscription (`'anchors subscribed'`). #36's host re-sends its current view with a new `viewId`, keeping one in flight, so a still camera on a pinned clock still sees the DSN's links arrive. |
| host → guest | `layer:time` | `{timeMs, rate, paused?}` (RFC §7.1; `utcMs` is accepted too): the clock's state, for a view with no `timeMs`. A view's `timeMs` wins. |
| host → guest | `layer:anchors-subscribe` | `{patterns: ['norad:25544', 'dsn:*', ...]}`, which replaces the subscription. Patterns are exact ids, `prefix:*`, `*`, or (proposed, below) `{near: {p: [x, y, z], n}, pattern}`. |
| guest → host | `layer:anchors` | `{viewId, timeMs, anchors: [{id, kind, name, p: [x, y, z], geo?, aliases?}]}`, after each frame while something is subscribed. **Nothing is published until then** (RFC §8.1). |
| guest → host | `layer:status` | `{status: 'loading'}`, `{status: 'ready', partial?: [what failed]}`, or `{status: 'error', message}` |
| host → guest | `layer:visibility`, `layer:dispose` | throttle, or tear down |
| host → guest | `layer:stats-subscribe` | `{intervalMs?}` (default 1000, at least 250); `{enabled: false}` or `intervalMs: 0` stops them. Off until asked. |
| guest → host | `layer:stats` | `{frames, intervalMs, updateMs, renderMs, recordMs, anchorsMs, calls, messages, bytes}`: the guest's own cost, the mean per frame over the interval, sent after the frame that ends it ([Cost](#cost)). |

- **Anchors** use RFC 0001 §8.2's ids, made only in `js/layer/anchors.js`:
  - `norad:<catalogue number>` (`norad:25544`);
  - `dsn:<antenna>` (`dsn:DSS-43`);
  - `dsn:<complex>` (`dsn:GDSCC`);
  - `dsn-sc:<DSN Now code>` (`dsn-sc:VGR1`), aliased to `naif:<id>` from
    the feed's `spacecraftID` (`naif:-31`). It's published only for a live
    link with a range, and subscribing to either id gets it.

  `p` is ECEF metres where the layer draws it, at the frame's time. For a
  thing on the ground, `geo` is its own `[lat, lon, h]` (WGS84).

  The subscription is compiled by scheme (`compileSubscription`). A
  scheme nobody asked for isn't walked, and exact ids are looked up by
  number. `dsn:*` alone never touches the ~11,600 satellites, and
  `norad:25544` reads one. Only `norad:*` or `*` walks them all.
- **Nearest anchors (a proposal for RFC #39 Q15).** Offered in the hello
  (`near: true` under `ext['portal.anchors/1']`). A pattern can be
  `{near: {p: [x, y, z], n}, pattern: 'norad:*'}`: the `n` anchors
  (at most 256) nearest `p`, ECEF metres at the frame's time, of those
  `pattern` matches (default `*`). It is ranked by where each is drawn
  this frame (Starlink's and Iridium's carried circles, the population's
  points), and the n chosen get their exact positions. A host can then ask
  for "the satellites over this city" without the whole constellation. It
  joins with the other patterns, so ids that two patterns match come once.
  Its cost is the walk over the scheme: about 1.5 ms in bun for 8 nearest
  of 11,643.
- **The Earth** (RFC §6.3). Orbits are in true ECEF. What's tied to the
  ground (the DSN's antennas and complexes) goes on the host's Earth:
  `view.earth`'s sphere, with latitude and longitude put on it as
  spherical, as deck does (`sphereToEcef`). On deck's 6,370,972 m globe the
  dishes sit on its surface, not 7 km above it. Without `earth`, the
  sphere is WGS84's equatorial 6,378,137 m.
- **Origins** (RFC §10.2). The guest takes messages only from an
  allow-list, `ALLOWED_ORIGINS` in `js/layer/origins.js`:
  - `https://pablo-mayrgundter.github.io`, `https://celestiary.org` and
    `https://celestiary.github.io`;
  - `http://localhost:*` and `http://127.0.0.1:*` for development;
  - more from `LAYER_ORIGINS` at build time, never at run time.

  The host's origin is found as 0.4.0's `resolveParentOrigin` finds it:
  `location.ancestorOrigins[0]`, else the referrer's origin, else
  `?host=`. Each counts only if it's on the list: the URL may pick an
  allowed origin, never add one. The guest posts only to that origin, and
  drops anything not from `parent` and that origin. That's portal-netgl's
  `parentTransport({hostOrigins: [origin]})`, given the one origin found:
  its list takes exact origins only, so the allow-list's `localhost:*`
  entries are matched here first. Wire 2's port then needs no origin
  check: the host hands it only to that origin.
- **Frames.** Satellites and networks hang in Earth's equator frame of
  date, the same frame as Satellites.md, turned to ECEF by GMST from the
  host's time:
  - `ECEF = bodyToEcef · Ry(−GMST) · equator`;
  - vertices are float32 metres, about 4 m at GEO.

## Cost

What the guest sends a frame, measured in the guest (`js/layer/wire.js`
`meteredTransport`, which `layer:stats` reports). The check host ran with
S, I, D and the satellites, at 640×400 on SwiftShader, on 2026-10-24.

| | Calls a frame | Bytes a frame (median; max) | `anchors()` |
|---|---|---|---|
| Before, clock running | 186 | 505 KB; 905 KB on a re-base | 2.1 ms |
| After, clock running | 170 | 49 KB; 50 KB | 0.1 ms |
| Before, clock held | 179 | 504 KB | 2.0 ms |
| After, clock held | 119 | 12 KB | 0.1 ms |

The subscription in each was `norad:25544, dsn:*, dsn-sc:*`. The bytes
count what crosses: buffers whole, strings and numbers. The frames drawn
are pixel-identical to main's (same draw order).

**portal-netgl 0.6.0 and wire 2** (the same check host, now on 0.6.0's
receiver, 2026-10-24; the guest's own `layer:stats`):

| | Messages a frame | Calls a frame | Bytes a frame |
|---|---|---|---|
| 0.3.0 as recorded (`compact=0`), clock running | 173 | 170 | 471 KB |
| 0.3.0 with `compactCall`, clock running | 172 | 170 | 48 KB |
| 0.6.0, wire 2, clock running | 2.1 | 170 | 47 KB |
| 0.6.0, wire 1 (a 0.5 host), clock running | 172 | 170 | 47 KB |
| 0.3.0 with `compactCall`, clock held | 121 | 119 | 12 KB |
| 0.6.0, wire 2, clock held | 2.1 | 119 | 12 KB |

- A wire-2 frame is two messages on the port: its batch, and its
  anchors. About once a second a third, `layer:stats`.
- The recorder's slicing carries the same bytes as `compactCall` did.
- The frames are pixel-identical to the 0.3.0 build's, at a pinned time
  over the GEO belt and over North America.
- What crosses per message no longer depends on the call count. The rest
  is the bytes: the population's whole-buffer uploads (below).

- **The recorder's arrays.** Most of the 505 KB wasn't three's.
  - Three uploads ranges: Starlink's 1/20 slice, and the used part of
    the line buffers. It does this with `bufferSubData(target, dst, array,
    srcOffset, count)`.
  - portal-netgl 0.3.0's recorder encodes a typed array as its whole
    `ArrayBuffer`, so every ranged upload crossed `postMessage` at the
    attribute's full size.
  - `compactCall` (`wire.js`) cut each call's arrays to what it reads.
    That alone took a running frame from 505 KB to 54 KB.
  - It was interim, and it's gone: portal-netgl 0.6.0's recorder slices
    (`trimSource`) on any wire.
- **Lines** (`wideLines.js` `setWideLineSegments`): only the span that
  changed goes up, per attribute, and nothing when nothing did.
  - The DSN's beams upload nothing between feeds while the clock holds.
    While it runs, they upload only their starts (the dishes turn with
    Earth).
  - Iridium's links upload what moved.
- **A held clock** (a view at the same time as the last):
  - Constellation propagates and uploads nothing (Networks.md);
  - Iridium's links stand.
- **What's left a running frame:**
  - Starlink's slice, about 20 KB (556 satellites, 36 bytes each);
  - Iridium's points and links;
  - the beams' starts;
  - the population's points, which go up whole each frame (Population.js);
  - about 120 state and draw calls, one message a frame on wire 2.
- **The shadow's draws** (portal-netgl 0.6.2, 2026-10-24). Before, the
  guest's shadow context ran every draw, at the host's full viewport,
  and the host's replay ran them again. Timed on the check host on
  SwiftShader, where a frame's wall clock up to a 1-pixel `readPixels`
  stands in for GPU time, each context timed with the other idle (the
  clock held, medians of 20 to 40 frames):

  | Viewport | Guest render, shadow drawing | Not drawing | Host's replay of the draws | Without them |
  |---|---|---|---|---|
  | 1280×720 | 10.2 ms | 0.8 ms | 11 ms | 0.9 ms |
  | 2560×1440 | 11 ms | 0.8 ms | 19 ms | 1.1 ms |

  So the shadow was a third to a half of the overlay's GPU work; with
  `shadowDraws: false` the replay is the only one that draws. With the
  published 0.6.2, the guest's render (to the same sync) went from 16.2
  ms to 0.7 ms at 640×400, and from 15.2 ms to 0.9 ms at 1280×720. The
  host's frames are pixel-identical with and without it at both sizes
  (the clock held at 2026-10-20 12:00 UTC), on wire 2 and the port, with
  the same 117 calls and 7 KB a frame, no clears, and the ISS anchor 3.3
  m from satellite.js's. On a real GPU it's unproven: an Apple M2 A/B on netmap
  gave medians that didn't repeat (133 ms, then 17.5 ms, with the
  overlay on; 16.7 ms off).
- **Draw order.** The renderer doesn't sort, so the root's children are
  hung in a fixed order (satellites, S, I, D). Before, the order was
  whichever loaded first, so Starlink's dots covered Iridium's links on
  some loads and not others.

## What changes in existing code

- **Labels off.** DeepSpaceNetwork takes `labels: false`, and the
  satellites' population gets a label budget of 0: their SpriteSheets want
  ThreeUi's uniforms. The satellites leave out Starlink, which only its
  network draws here, and, with `I` on, Iridium (`loadSatelliteRecords`'
  `skip`): the networks' files are the population's too, so a group left
  out isn't fetched for it. Layer mode draws no
  names; it publishes anchors, and the host names them.
- **No Scene.** The network classes already take `layer`, `camera` and a
  `jd` passed to `update`. The layer builds them through `loadNetworks.js`
  without Scene.
- **Display-referred colours.** `hdr.js` `sceneReferredUniform` is a module
  global. It stays 0 in the layer, because there's no HDR buffer, and the
  separate iframe realm keeps it from colliding with the host's.
- **Host-set matrices.** The camera's and the root group's
  `matrixAutoUpdate` are false, with `matrixWorldNeedsUpdate` set after
  each write (the spike's finding).
- **satellite.js's WASM stub** (`esbuild/common.js`) applies to the new
  entry as it does to the app.

## Phases

1. **This PR:**
   - the page, the guest, the contract above, the origin allow-list;
   - the host-driven view and time;
   - satellites and S/I/D in ECEF;
   - anchors;
   - a local two-origin host page for checks, with screenshots of
     alignment (ISS, the GEO belt at a pinned time) and occlusion.
2. **netmap's host:** a deck.gl layer that embeds `layer.html` and sends
   the views. It's built on portal's cross-origin host and luma adapter
   (in progress, `claude/luma-host`), with `device.pushState`/`popState`
   around the replay.
3. **Links across engines:** netmap draws arcs from its nodes to
   celestiary's anchors, for example a Starlink satellite to its gateway's
   AS, or a DSN dish to its complex's network.
4. **Into the NetGL spec:**
   - shared-depth mode;
   - extent negotiation (`radiusM` sizes the host's far plane);
   - the overlay layer kind;
   - time and frame epoch;
   - the Earth model;
   - restore vs invalidate.

## Open questions

- **Anchor paths**: composing ids with layer paths (RFC §8.3), for example
  `portal:/celestiary#norad:25544`.
- **Anchor volume.** Starlink's 11,000 anchors are about 1 MB a frame.
  Subscribe to some, ask for the nearest (proposed above), or publish
  their elements once and let the host propagate?
- **Labels:** drawn by the guest (decoupled from ThreeUi), or only by the
  host from the anchors?
- **Picking:** a host click mapped to the nearest anchor, or the guest
  answering `layer:pick`?
- **The DSN feed:** each guest polls it, or the host relays it so several
  embeds make one request?
- **Earth model:** WGS84 heights for the dishes, which needs the DSN
  handbook's coordinates (Networks.md).

## Status

Phase 1 is in (branch `claude/layer-mode`):

- **Files:** `public/layer.html` and `js/layer/`:
  - `layer.js`, the page's entry;
  - `OrbitsLayer.js`, the scene with no Scene or ThreeUi;
  - `protocol.js`, the control plane;
  - `origins.js`, the allow-list and the host's origin;
  - `anchors.js`, the ids;
  - `frames.js`, equator of date and body-fixed to ECEF;
  - `wire.js`, the transport's meter, wire 2's port included
    ([Cost](#cost)).

  Tests: `js/layer/layer.test.js`.
- **The check host:** `yarn layer-host` (`tools/layer/serve.mjs`) serves
  `docs/` at `http://127.0.0.1:5480` as the guest's origin. It serves a
  small three.js host at `http://localhost:5481/host.html` with its own
  references, computed without celestiary's code: satellite.js's ECI→ECF
  for the ISS, the geostationary circle, and the DSN complexes from their
  latitudes and longitudes. It replays the guest's frames into its own
  depth.
  - `?depth=0` clears the depth first, for the occlusion comparison.
  - `?t=<ISO>&lat=&lng=&altKm=&fov=&near=&far=&nets=S,I,D&sats=0|1` sets
    the view.
  - `&rate=1` runs the clock from `t` (0, the default, holds it).
  - `&stats=1` asks for `layer:stats`, kept in `hostState.guestStats`.
  - `&anchors=` sets the subscription (comma-separated, `none` for none).
  - The receiver is portal-netgl 0.6.2's, on `iframeTransport` (so it
    offers the port). `&wire=1` passes on to the guest, which then offers
    only wire 1; `&hostWire=1` makes the host answer as a 0.5 host does;
    `&shadowDraws=1` passes on too, and the guest draws on its shadow.
  - `hostState.perFrame` holds what arrived per frame, on the window and
    the port: messages, calls, and buffer bytes.
  - `hostState.ready` is the guest's `netgl:ready`, and `hostState.wire`
    the receiver's view of the wire (`version`, `port`, counts).
- **Checked** (headless Chromium, SwiftShader, 2026-10-23 20:17 UTC):
  - On the three.js check host: the ISS anchor is 2.6 m from
    satellite.js's own ECF, and its dot sits in the host's ring.
  - The geostationary sample lies on the host's circle.
  - The guest's frames hold no `clear` calls.
  - With the host's depth, Starlink behind the globe is hidden; with
    `depth=0` it shows through.
  - The DSN's beams leave Goldstone and Madrid, and from 400 AU one
    reaches out to a Voyager.
- **Size:** the page's static load is 607 KB minified, 169 KB gzipped
  (600 and 167 on 0.3.0), against `esbuild/budget.js` `LAYER_BUDGET`'s
  650 / 180 KB; the snapshots load after.
- **Its own build** (`esbuild/common.js` `layerConfig`, into `docs/layer/`),
  not a second entry of the app's. As a second entry, esbuild's splitting
  cut the code the two share into chunks of their own. That changed the
  app's first-load chunks, so a page shares none of the other's files.
- **portal-netgl 0.6.0, pinned** (0.3.0 before; the app's Cesium layers
  moved with it, through its three-free `/core` entry):
  - its `makeNetGLGuestContext` with checkpoints, so each frame replays
    from the guest's own GL state, offering wire 2 and a port;
  - its `parentTransport`, pinned to the host's origin (the 0.3.0 guest
    had an origin-checking transport of its own in `origins.js`);
  - imported from `@pablo-mayrgundter/portal-netgl/core`, which leaves out
    the helpers that import three.
- **Against portal #36's real host** (portal-netgl 0.4.0's
  `attachNetGLDeckLayer`, `iframeTransport` and a deck.gl 9.4 GlobeView,
  modelled on its `apps/host-netgl-deck`; served from `localhost:5490`, the
  guest from `127.0.0.1:5480`):
  - The ISS dot sits in deck's own ring. deck's `ScatterplotLayer` puts
    the ring at satellite.js's ECF, by geocentric lat/lng/alt over deck's
    sphere. The anchor is 2.6 m from it.
  - The DSN dishes sit in deck's rings at the complexes, on its
    6,370,972 m surface (`view.earth`).
  - deck's globe hides the Starlinks behind it; with deck's depth cleared
    before the guest, they show through.
  - deck's receiver became ready on `netgl:ready`, and views flowed on
    frame-ends.
- **On #36's latest host** (`claude/luma-host` @ 7a73309, with
  `layer:invalidate`, `layer:hello-ack` and `subscribeAnchors`): with a
  still camera and a pinned clock, the DSN's links appear once the feed
  arrives. The host sent three views: the first, one after `'loaded'`,
  and one after `'dsn feed'`. Before `layer:invalidate`, that view kept
  the dishes and no links until the camera moved.
- **On portal-netgl 0.6.0** (2026-10-24, this check host): wire 2 with
  the port open (`hostState.wire`: version 2, port `open`), two messages
  a frame, the hello's `near: true`, the ISS anchor 3 to 8 m from
  satellite.js's ECF, no `clear` calls, no replay errors. With
  `hostWire=1` (a 0.5 host) and with `wire=1` the guest fell back to a
  message a call, with the same calls and bytes.
- **Left:**
  - take 0.6.0's `isNetGLLayerViewMessage` and types;
  - put the `viewId` on `netgl:frame-end` once portal-netgl carries it
    (RFC open question 18);
  - the population's whole-buffer uploads (most of a real GPU's 505 KB
    a frame), a follow-up.
