# Layer mode: celestiary's orbits inside another app's globe

*Proposal, 2026-10-23.  Builds on PR [#294](https://github.com/celestiary/web/pull/294)
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
  to draw (`?nets=S,I,D&sats=1`) and names the host's origin (`?host=`).
- **It loads what it needs and nothing else:**
  - three, satellite.js, the network classes and portal-netgl;
  - no React, MUI, Scene, ThreeUi or ephemeris;
  - its own budget in `esbuild/budget.js`, checked by `yarn bundle-check`.
- **It draws into the host's context through NetGL**, with a
  transparent frame and no clears. It tests against the host's depth
  (shared depth: the host's exact projection, LEQUAL, no depth writes), so
  the host's globe hides what's behind it.

## The contract (host ↔ guest)

The messages ride beside NetGL's call stream on the same `postMessage`
channel. Names follow portal-layers.md's control plane.

| Direction | Message | Carries |
|---|---|---|
| guest → host | `layer:hello` | `{version, kind: 'celestiary-orbits', capabilities: {anchors, time}, extent: {radiusM}}`. Repeated until acked. |
| host → guest | `layer:hello-ack` | `{accepted}` |
| host → guest | `layer:view` | `{viewId, viewMatrix, projectionMatrix, viewport, pixelRatio, timeMs?}`. viewMatrix maps ECEF metres to eye metres and is rigid; projectionMatrix maps eye to clip and is the host's own. Both are column-major arrays of 16, composed in doubles. viewport is `[x, y, w, h]` in drawing-buffer pixels. |
| host → guest | `layer:time` | `{utcMs, rate?}`: the host's clock, if it isn't in each view. Time is UTC; ECEF is of date (Earth turned by GMST). |
| guest → host | `netgl:*` | the frame's GL calls, ending in `netgl:frame-end` |
| host → guest | `layer:anchors-subscribe` | `{patterns: ['dsn:*', 'norad:25544', ...]}`: which anchors to publish |
| guest → host | `layer:anchors` | `{viewId, timeMs, anchors: [{id, ecef: [x, y, z], name?, kind}]}`: after each frame, only those subscribed |
| guest → host | `layer:status` | `loading`, `ready`, or `error {message}` |
| host → guest | `layer:visibility`, `layer:dispose` | throttle, or tear down |

- **Anchors** are URI-style ids: `norad:<catalogue number>`,
  `dsn:<dish>` (`dsn:DSS-43`), `dsn-site:<complex>`, `spacecraft:<code>`.
  They're made in one module (`js/layer/anchors.js`) so the scheme can
  follow the RFC being written. ECEF is metres, in the guest's frame, at
  the frame's time.
- **Origins.** The guest takes messages only from an allow-list:
  `https://pablo-mayrgundter.github.io`, `https://celestiary.org`, and
  `http://localhost:*` or `http://127.0.0.1:*` for development, extendable
  by the build. It posts only to the host's origin once that is known.
  Anything else is ignored.
- **Frames.** Satellites and networks hang in Earth's equator frame of
  date, the same frame as Satellites.md, turned to ECEF by GMST from the
  host's time:
  - `ECEF = bodyToEcef · Ry(−GMST) · equator`;
  - Earth is a sphere for the DSN's dishes, WGS84 is a follow-up;
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

- **The anchor URI scheme**: composing with layer and frame paths, for
  example `layer:celestiary/norad:25544`. This waits on the RFC.
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
