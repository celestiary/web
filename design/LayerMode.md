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

The guest is wire-compatible with portal-netgl 0.4.0's deck.gl host
(`attachNetGLDeckLayer` and `iframeTransport`, portal #36). Its messages
are shaped as portal RFC 0001 has them
([docs/rfcs/0001-globe-orbit-layers.md](https://github.com/pablo-mayrgundter/portal/blob/claude/rfc-globe-orbit-layers/docs/rfcs/0001-globe-orbit-layers.md):
§6 the view, §7 time, §8 anchors, §10 the handshake). They ride beside
NetGL's call stream on the same `postMessage` channel.

| Direction | Message | Carries |
|---|---|---|
| guest → host | `netgl:ready` | NetGL's handshake (`guest.announce`), repeated every 500 ms until `netgl:ready-ack`. 0.4.0's host sends no view before it. |
| guest → host | `layer:hello` | `{version: 1, adapter: 'celestiary-orbits', capabilities: {kinds: ['overlay'], depth: ['shared'], projections: ['matrix'], frames: ['ecef'], warp: false, anchors, time, labels: false}, contracts: {alpha: 'coverage', color: 'display'}, extent: {frame: 'ecef', sphere: {center: [0, 0, 0], radius: 5e7}, beyond: 'clamp-to-far', farthest: 3e13}, ext: {'portal.anchors/1': {publish: ['norad', 'dsn', 'dsn-sc', 'naif']}}}`. Repeated every 500 ms until `layer:hello-ack` (#36 acks every hello, and re-sends its anchor subscription on each), or a first view from a host that doesn't ack (0.4.0 as published). |
| host → guest | `layer:hello-ack` | `{accepted, reason?}` (optional; RFC §10.6) |
| host → guest | `layer:view` | 0.4.0's `NetGLLayerViewMessage`: `{type, viewId, view: {frame: 'ecef', viewMatrix, projectionMatrix, viewport, pixelRatio, timeMs, earth?: {model: 'sphere', radius}}}`. `viewMatrix` maps ECEF metres to eye metres and is rigid. `projectionMatrix` is the host's own, with its scale folded in. Both are column-major arrays of 16, composed in doubles. `viewport` is `[x, y, w, h]` in drawing-buffer pixels. A flat view (this PR's first shape) is ignored. |
| guest → host | `netgl:*` | the frame's GL calls, ending in `netgl:frame-end`. This is the frame's receipt: 0.4.0's host sends its next view on it (`receiver.onFrame`; one view in flight, re-sent after 1 s). |
| guest → host | `layer:invalidate` | `{reason}`: what's drawn changed with no new view: the snapshots loaded (`'loaded'`), the DSN's feed changed (`'dsn feed'`, at most every 5 s, and not for the same feed again), a subscription (`'anchors subscribed'`). #36's host re-sends its current view with a new `viewId`, keeping one in flight, so a still camera on a pinned clock still sees the DSN's links arrive. |
| host → guest | `layer:time` | `{timeMs, rate, paused?}` (RFC §7.1; `utcMs` is accepted too): the clock's state, for a view with no `timeMs`. A view's `timeMs` wins. |
| host → guest | `layer:anchors-subscribe` | `{patterns: ['norad:25544', 'dsn:*', ...]}`, which replaces the subscription. Patterns are exact ids, `prefix:*`, or `*`. |
| guest → host | `layer:anchors` | `{viewId, timeMs, anchors: [{id, kind, name, p: [x, y, z], geo?, aliases?}]}`, after each frame while something is subscribed. **Nothing is published until then** (RFC §8.1). |
| guest → host | `layer:status` | `{status: 'loading'}`, `{status: 'ready', partial?: [what failed]}`, or `{status: 'error', message}` |
| host → guest | `layer:visibility`, `layer:dispose` | throttle, or tear down |

- **Anchors** use RFC 0001 §8.2's ids, made only in `js/layer/anchors.js`:
  - `norad:<catalogue number>` (`norad:25544`);
  - `dsn:<antenna>` (`dsn:DSS-43`);
  - `dsn:<complex>` (`dsn:GDSCC`);
  - `dsn-sc:<DSN Now code>` (`dsn-sc:VGR1`), aliased to `naif:<id>` from
    the feed's `spacecraftID` (`naif:-31`). It's published only for a live
    link with a range, and subscribing to either id gets it.

  `p` is ECEF metres where the layer draws it, at the frame's time. For a
  thing on the ground, `geo` is its own `[lat, lon, h]` (WGS84).
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
  drops anything not from `parent` and that origin. On the wire this is
  0.4.0's `parentTransport({hostOrigins})`. The guest switches to it once
  0.4.0 is published; it pins 0.3.0 until then.
- **Frames.** Satellites and networks hang in Earth's equator frame of
  date, the same frame as Satellites.md, turned to ECEF by GMST from the
  host's time:
  - `ECEF = bodyToEcef · Ry(−GMST) · equator`;
  - vertices are float32 metres, about 4 m at GEO.

## What changes in existing code

- **Labels optional.** Satellites and DeepSpaceNetwork take `labels:
  false`: their SpriteSheets want ThreeUi's uniforms. Layer mode draws no
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
- **Anchor volume.** Starlink's 11,000 anchors at 60 Hz is about 270 KB a
  second. Subscribe to some, or publish their elements once and let the
  host propagate?
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
  - `origins.js`, the allow-list and an origin-checking transport;
  - `anchors.js`, the ids;
  - `frames.js`, equator of date and body-fixed to ECEF.

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
- **Checked** (headless Chromium, SwiftShader, 2026-10-23 20:17 UTC):
  - On the three.js check host: the ISS anchor is 2.6 m from
    satellite.js's own ECF, and its dot sits in the host's ring.
  - The geostationary sample lies on the host's circle.
  - The guest's frames hold no `clear` calls.
  - With the host's depth, Starlink behind the globe is hidden; with
    `depth=0` it shows through.
  - The DSN's beams leave Goldstone and Madrid, and from 400 AU one
    reaches out to a Voyager.
- **Size:** the page's static load is 823 KB minified, 233 KB gzipped,
  three 694 KB of it, against `esbuild/budget.js` `LAYER_BUDGET`'s
  910 / 260 KB. The networks' chunk and the snapshots load after.
- **portal-netgl 0.3.0, pinned:**
  - its `makeNetGLGuestContext` with checkpoints, so each frame replays
    from the guest's own GL state;
  - an origin-checking transport of our own (`origins.js`), because
    0.3.0's `windowTransport` filters by source, not origin.
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
- **When portal-netgl 0.4.0 is published:**
  - take `parentTransport({hostOrigins: ALLOWED_ORIGINS})` in place of
    `origins.js`'s transport;
  - take 0.4.0's `isNetGLLayerViewMessage` and types;
  - put the `viewId` on `netgl:frame-end` once portal-netgl carries it
    (RFC open question 18).
