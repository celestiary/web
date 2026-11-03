# The sky guest: celestiary's sky in another app

*Built 2026-11-02, for exo.cafe's abode.*

## What and why

**The sky guest** is celestiary's own sky, drawn inside another app's 3D
world. The first host is exo.cafe, a bar in cyberspace with a courtyard
that is open to the sky (the abode). The app runs whole, less its chrome:
the stars, Gaia's, the Milky Way, the planets, the Moon and the Sun, the
clouds and the air. It runs in a page of its own, landed on Earth where the
host says. NetGL (portal-netgl) carries its WebGL calls into the host's
context, so each frame is celestiary's, drawn by the host's GPU.

Layer mode ([LayerMode.md](LayerMode.md)) is the other way to appear in a
host: a few of celestiary's objects (satellites and networks) on the
host's globe. The sky guest is the app itself.

## The page

- **`sky.html`**, with its entry `js/sky/sky.js`.
  - It has its own build (`esbuild/common.js` `skyConfig`, into
    `docs/sky/`), so it shares no chunk with the app.
  - Production serves it at `https://celestiary.org/sky.html`.
  - A PR preview serves it at
    `https://celestiary.org/web/pr-preview/pr-<n>/sky.html`.
- **The host embeds it as a cross-origin iframe.**
  - Its origin is found and checked as layer mode's
    (`js/layer/origins.js`): the allow-list has `https://exo.cafe` too.
  - The wire is layer mode's (`js/layer/protocol.js` `serveLayer`), with
    the sky's hello (below).
- **It boots the app on the guest's context.**
  - The context is portal-netgl's `makeNetGLGuestContext`.
  - The app is `new Celestiary(useStore, container, nav, …, {renderer,
    viewSize})`. A renderer handed in is set up as celestiary's own would be
    (`ThreeUi.configureRenderer`).
  - The scene is sized to the host's view (`Celestiary.setViewSize`), not
    to the page's window, which is 1 px.
  - It has no animation loop of its own: the host's views drive the frames.
  - It writes no permalink.
  - Earth, the Moon and Mars use their default layers, so Cesium stays off.
  - The overlays are off (labels, orbits, grids, asterisms).
- **On each `layer:view`:**
  - it sets the clock to the view's `timeMs`, paused;
  - it lands on Earth at the view's `observer` (`Scene.land`, 2 m up),
    again if the app's own arrival took the camera away;
  - it sets the camera's field from the projection;
  - it turns the camera by the view's rotation;
  - it runs one `renderLoop`, then `guest.endFrame({viewId})`.

## The view

The host's camera arrives as a rotation in **Earth's equator of date**: +X
to the equinox, +Z to the north pole, with no translation. With it come a
symmetric perspective, the viewport, the time and the observer
(`{lat, lon, alt}`).

The landed camera's quaternion is relative to Earth's body-fixed frame, its
spun node. The equator frame is Rx(−90°) from Earth's tilt frame, as
`sgp4.js` `temeToEquator` has it, and the body-fixed frame is the tilt frame
turned by GMST about +Y. So:

```
camera = Ry(−GMST) · Rx(−90°) · viewRotationᵀ
```

That is `js/sky/view.js` `landedQuaternion`. Its tests look at the celestial
pole along Earth's axis at any time, and find the equinox west of Greenwich
by GMST.

## Exposure

- **By default the meter is celestiary's own.** It meters the frame, and
  the eye adapts as in the app.
  - The meter reads the scene's buffer back, so the guest's shadow
    context must draw (portal-netgl's `shadowDraws: true`).
  - So each frame costs its GPU work twice: once for the shadow, once for
    the host's replay.
  - Measured on the check host at 55.6° N, looking south 20° up:
    - gain 1 by day;
    - 3.7 at sunset, 340 at 8° below the horizon;
    - 3.7×10⁵ at night.

    That is the app's own within 15%, measured there the same way.
  - A view of a darker part of the sky (clouds against the stars) reads
    darker and is exposed brighter, up to the dark-adapted eye's 4×10⁶.
- **`sky.html?meter=0`** keeps the shadow from drawing (`shadowDraws:
  false`), and turns the meter off.
  - The gain is then the one the meter settles on for the Sun's altitude:
    `view.js` `skyGain`, interpolated in its logarithm over
    `METERED_GAIN`.
  - The table was measured from the metered guest, looking south 20° up.
  - It is right on average, and wrong where the frame's content matters:
    the Moon in view, or the Sun's disc.

## What it leaves out

A host's numbers (exo's, on a laptop's GPU, 2026-11-03) showed where a guest's frame went.

- **Earth's ground stays plain.** A host draws its own ground under the
  sky, so the guest leaves out the surface's maps: colour, terrain, water,
  normals and night lights. That was about 80 MB uploaded at load, and the
  month's 34 MB colour map again each simulated month, at a host's fast
  clock. Each crossed to the host as one frame's uploads, 45 to 91 MB,
  stalling its frame 0.5 to 2.5 s.
  - `sky.js` `plainGround` puts one 1×1 texture in their place, held in
    the surface mesh's `onBeforeRender`. Held there because the planet hands
    its stand-in map over to the real one, and the month's to the next,
    inside the frame's own animation.
  - The night lights' uniform is on the material's `userData.uNightMap`
    for this (Planet.js).
  - The atmosphere is the LUTs', not the ground's, so the sky is unchanged.
  - The clouds stay: they are sky.
- **The meter reads back synchronously** (ThreeUi's `meter=sync`, set by
  `sky.js` unless the URL says otherwise):
  - It reads into client memory, which portal-netgl keeps on the guest's
    shadow, and the wait for the pixels stays in the guest's process.
  - The pixel-pack buffer it reads through otherwise is replayed on the
    host, where nothing reads it. Chrome then warns "READ-usage buffer was
    written, then fenced, but written again before being read back" and
    copies it for nothing, every metered frame.
- **The host sets the rest:** the frame's size (exo: 0.6 of its CSS pixels
  × the overscan) and how often it asks (exo: at most every 250 ms while
  the head is still).

## Measuring it

The guest's cost is in two places, and both are measured.

- **Celestiary's side.** This is the recording, plus the shadow's draws
  while metering. `sky.html?perf=1` (or `perf=sync`) turns on the app's own
  perf tool (`js/perf`, DESIGN.md [Perf overlay](../DESIGN.md#perf-overlay))
  inside the guest. Its overlay is in the 1-pixel iframe, unseen, so a host
  asks for the snapshot instead: it posts `{type: 'sky:perf-request', id}`
  and gets back `{type: 'sky:perf', id, snapshot}`. The snapshot is the
  Copy button's JSON, with the last frame's cost (`served.state.last`) and
  whether it meters. `layer:stats` (layer mode's) reports the per-frame
  cost about once a second, once subscribed.
- **The host's side.** The host times its own replay. exo:
  - `?sky_perf=1` passes `perf=1` on to the guest;
  - it times each replay on the CPU, and with its GPU work (a 1-pixel read
    after it, so in perf mode only);
  - it records the frames' latency and the frames over 100 ms (with the
    Sun's altitude and the head's turn rate);
  - `await exo.abode.sky.perf()` returns both sides as one object to paste.

## The contract

The sky's hello:

```js
{adapter: 'celestiary-sky',
 capabilities: {kinds: ['sky'], depth: ['none'], projections: ['matrix'],
   frames: ['equator-of-date'], anchors: false, time: true, labels: false,
   observer: true},
 contracts: {alpha: 'opaque', color: 'display'},
 extent: {frame: 'equator-of-date', beyond: 'infinite'}}
```

- **A frame is the whole view.** It is opaque and tone-mapped (display
  values), with celestiary's ground below the horizon.
- **It is drawn to the host's screen framebuffer**, which a host points at
  a render target of its own (portal-netgl's `replay.screenFramebuffer`).
- **The sky is at infinity**, so a host can show a frame drawn for one
  camera rotation at another. It looks each direction up through the
  frame's own view and projection. That is exact for any turn of the
  head, so a frame that comes late still has its stars in place.
- **exo does this** (`src/world/celestiary-sky.js`):
  - it asks for its camera each frame, one view in flight, with a wider
    field than its own;
  - its abode's dome samples the latest frame by direction;
  - outside the frame's coverage it shows exo's own dusk.

## The check host

`yarn sky-host` (`tools/sky/serve.mjs`) serves `docs/` at
`http://127.0.0.1:5482` as the guest's origin. It also serves a small host
at `http://localhost:5483/host.html?guest=http://127.0.0.1:5482`, which:

- sends a camera at a place, looking at an azimuth and altitude:
  `&lat=&lon=&az=&alt=&fov=&t=<ISO>&rate=`, and `&meter=0` passes through;
- replays each frame onto its own canvas;
- `window.look(az, alt)` and `window.at(iso)` move it;
- `window.hostState` has the hello, the status, the frames and the errors.

Run `yarn build` first, with `CESIUM_ION_TOKEN=` (CLAUDE.md).

## Status

- **Checked** on the check host (headless Chromium on SwiftShader,
  2026-11-02, 640×400):
  - the guest's first frames came 4 to 13 s after load, with no replay
    errors;
  - noon at 55.6° N looking south: celestiary's blue sky, the Sun and its
    glare, Venus;
  - just after sunset: its sunset;
  - at night: its stars, with the bundled cloud map dark against them.
- **Not yet checked:**
  - the cost on a real GPU (the frame twice with the meter);
  - Gaia's tiles, which are LFS data a checkout without git-lfs doesn't
    have;
  - NASA GIBS's daily clouds, which the sandbox can't reach.
- **Left:**
  - a portal-netgl switch to let the shadow draw only the frames the
    meter samples (`MeterCadence`), which would take the meter's cost from
    every frame to a few;
  - the host's pixel ratio below 1, for a cheaper sky on a slow GPU.
